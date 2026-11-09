/**
 * Guard console (roadmap B.6, E6). The shopper writes a mandate in plain words, sees the compiled rules, replays a
 * year of purchases through them (backtest), adopts earned-autonomy suggestions, holds the kill switch, and
 * approves or declines held moves (passkey above the countersign threshold). The merchant has the same for refunds
 * at /merchant/approvals. "The agent proposes, code decides, the owner can always stop it."
 */
import { guardCard, nextOf } from "./safetyui.js";
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { enqueue } from "../jobs.js";
import { GtError } from "../lib/util.js";
import { fmtWall } from "../core/time.js";
import { recentAudit, verifyChain } from "../guard/audit.js";
import { applySuggestions, backtest, suggestAutonomy } from "../guard/backtest.js";
import { countersignThreshold, decideApproval, payloadHash, pendingApprovals } from "../guard/dryrun.js";
import { isKilled, listKills, setKill } from "../guard/kill.js";
import { finishRegistration, hasPasskey, newChallenge, PASSKEY_JS, verifyAssertion } from "../guard/passkey.js";
import { activatePolicy, activePolicy, compilePolicy, DEFAULT_RULES, listPolicies, MERCHANT, RulesSchema, savePolicy, type Rules } from "../guard/policy.js";
import { nowOf, type Account } from "../store.js";
import { recentRuns } from "../trace.js";
import { merchant, shopper, whoami } from "./auth.js";
import { back, flashOf, json } from "./common.js";
import { fmtDate, html, layout, money, raw, type Raw } from "./html.js";

const RULE_LABELS: Record<keyof Rules, string> = {
  max_purchase_cents: "Largest single purchase the agent may put in front of me",
  approve_above_cents: "Ask me before a repeat buy (or a refund, for the merchant) at or above",
  max_refund_pct: "Merchant: largest refund as a share of what was paid",
  agents_may_plan: "Outside assistants may plan and quote for me",
  agents_may_request_approval: "Outside assistants may start the PayPal approval step",
  one_tap_repeat: "Repeat buys may run on my saved PayPal without a tap (under the threshold)",
  allowed_merchants: "Only buy from",
  blocked_categories: "Never buy",
};
const SHOPPER_KEYS: (keyof Rules)[] = ["max_purchase_cents", "approve_above_cents", "one_tap_repeat", "agents_may_plan", "agents_may_request_approval", "allowed_merchants", "blocked_categories"];
const MERCHANT_KEYS: (keyof Rules)[] = ["max_refund_pct", "approve_above_cents"];

const fmtRule = (k: keyof Rules, v: unknown) => (typeof v === "boolean" ? (v ? "yes" : "no") : String(k).endsWith("_cents") ? money(Number(v)) : String(k).endsWith("_pct") ? `${v}%` : Array.isArray(v) ? (v.length ? v.join(", ") : k === "allowed_merchants" ? "any connected merchant" : "nothing blocked") : String(v));

function rulesTable(keys: (keyof Rules)[], rules: Rules, compare?: Rules): Raw {
  return html`<table class="small"><tbody>${raw(keys.map((k) => {
    const changed = compare && JSON.stringify(compare[k]) !== JSON.stringify(rules[k]);
    return `<tr><th>${RULE_LABELS[k]}</th><td>${fmtRule(k, rules[k])}${changed ? ` <span class="muted">(was ${fmtRule(k, compare![k])})</span>` : ""}</td></tr>`;
  }).join(""))}</tbody></table>`;
}

async function release(approvalId: string) {
  await enqueue(await getDb(), "release_approved", { approvalId }, new Date(), `release:${approvalId}`);
}

const spage = (req: Request, a: Account, title: string, body: Raw) => layout({ title, area: "shopper", who: { name: a.name, clock: fmtWall(nowOf(a)) }, flash: flashOf(req) }, body);
const mpage = (req: Request, title: string, body: Raw) => layout({ title, area: "merchant", flash: flashOf(req) }, body);

/** One held move as an in-flow card: what it is, why it waited, and approve or decline right there (passkey above the countersign line). */
export function approvalCard(a: any, base: string, next: string): Raw {
  const p = a.payload ?? {};
  const scam = Array.isArray(p.safety_reasons) && p.safety_reasons.length > 0;
  const big = Number(p.cents ?? 0) > countersignThreshold();
  const what = `${String(a.action).replace(/_/g, " ")} of ${money(Number(p.cents ?? 0))}`;
  const reasons = scam ? p.safety_reasons : [`It's at or above the approval limit you set (${base === "/guard" ? "Approvals and limits" : "merchant policy"}).`];
  return html`<div id="ap-${a.id}">${guardCard({ level: scam ? "hold" : "caution", reasons }, { approve: big ? null : `${base}/approvals/${a.id}`, next, title: what.charAt(0).toUpperCase() + what.slice(1), doText: big ? "Above your passkey limit: your passkey signs the exact amount." : scam ? "Nothing was charged. Check the seller is real (a site you know, reviews, a way to contact them) before you approve." : "Approve it and Everyday carries on; decline and nothing moves." })}${big ? html`<div class="row" style="margin-top:-0.5rem;margin-bottom:0.75rem">${next.startsWith("/guard") || next.startsWith("/merchant/approvals") ? html`<button class="btn primary small" data-countersign="${a.id}" type="button">Sign with passkey and approve</button>` : html`<a class="btn primary small" href="${base === "/guard" ? "/guard" : "/merchant/approvals"}#ap-${a.id}">Sign with passkey on Approvals</a>`}<form method="post" action="${base}/approvals/${a.id}/decline" class="inline"><input type="hidden" name="next" value="${next}"><button class="btn small" type="submit">Decline</button></form></div>` : ""}</div>`;
}

/** Approvals, kill switch, passkey and audit blocks shared by the shopper and merchant consoles. */
async function approvalsBlock(ownerId: string, base: string): Promise<Raw> {
  const [approvals, passkey, chain, audit] = await Promise.all([pendingApprovals(ownerId), hasPasskey(ownerId), verifyChain(), recentAudit(25)]);
  return html`<div class="grid g2">
<section class="card" id="approvals"><h2>Waiting for you (${approvals.length})</h2>
<p class="small muted">Moves above ${money(countersignThreshold())} need your passkey; the signature covers the exact amount and entity, so nothing can be swapped after you sign. ${passkey ? "Passkey registered." : html`<button class="btn small" id="pk-register" type="button">Register a passkey</button>`}</p>
${approvals.length ? html`<div class="stack">${approvals.map((a: any) => approvalCard(a, base, base === "/guard" ? "/guard#approvals" : "/merchant/approvals"))}</div>` : html`<p class="muted">Nothing waiting.</p>`}</section>
<section class="card"><h2>Audit chain <span class="pill ${chain.ok ? "good" : "bad"}">${chain.ok ? `intact · ${chain.rows} rows` : `BROKEN at ${chain.broken_at}`}</span></h2>
<p class="small muted">Every money decision is hashed over the previous row. Head <span class="mono">${chain.head.slice(0, 16)}…</span> · <a href="${base}/audit.json">Export</a></p>
<div class="table-wrap"><table class="small"><thead><tr><th>#</th><th>When</th><th>Kind</th><th>Entity</th><th>Hash</th></tr></thead><tbody>${raw(audit.map((a: any) => `<tr><td>${a.seq}</td><td>${fmtDate(a.at)}</td><td>${a.kind}</td><td class="mono">${a.entity} ${String(a.entity_id).slice(0, 18)}</td><td class="mono">${String(a.hash).slice(0, 12)}…</td></tr>`).join(""))}</tbody></table></div></section></div>`;
}

export function guardRoutes() {
  const r = Router();

  // ---------- Shopper ----------
  r.get("/guard", shopper(async (req, res, a) => {
    const policy = await activePolicy(a.id);
    const rules = policy?.rules ?? DEFAULT_RULES;
    const [kills, runs, drafts, myKill, suggestions, bt] = await Promise.all([listKills(), recentRuns(12), listPolicies(a.id), isKilled(`account:${a.id}`), suggestAutonomy(a.id, rules), backtest(rules, 365)]);
    const agentKills = kills.filter((k: any) => String(k.scope).startsWith("agent:"));
    res.send(spage(req, a, "Guard", html`<h1>Guard</h1>
<p class="sub">Your mandate in your own words becomes the rules every checkout, repeat buy and outside assistant runs under. Code enforces them before any PayPal request. One switch stops everything.</p>
<script>${raw(PASSKEY_JS)}</script><script src="/static/guard.js" defer></script>
<div class="grid g2">
<section class="card"><h2>Mandate</h2>
<form method="post" action="/guard/policy"><div class="field"><label for="ptext">In plain words</label><textarea id="ptext" name="text" rows="5" maxlength="2000" placeholder="Never spend more than $400 on a single purchase. Ask me before any repeat buy over $30. Repeat buys are on. Assistants may plan. Only buy from Northlight. Never buy headphones">${policy?.text ?? ""}</textarea></div>
<div class="row"><button class="btn primary" name="mode" value="preview">Compile and preview</button> <button class="btn" name="mode" value="adopt">Compile and adopt</button></div></form>
${policy ? html`<p class="small muted">Active · compiled by ${policy.compiler}${policy.unexpressed.length ? html` · <strong>could not express:</strong> ${policy.unexpressed.join("; ")}` : ""}</p>` : html`<p class="small muted">No mandate yet: the defaults below apply.</p>`}
${rulesTable(SHOPPER_KEYS, rules)}</section>
<section class="card"><h2>Backtest: a year of purchases under this mandate</h2>
<p class="small muted">Your purchase history (a seeded, labelled year) replayed through the rules. Nothing moves; this only says what would have run without you, waited for a tap, or been refused.</p>
<div class="stats"><div><b>${bt.purchases}</b><span>purchases</span></div><div><b>${bt.run}</b><span>would run</span></div><div><b>${bt.wait}</b><span>would wait for a tap</span></div><div><b>${bt.deny}</b><span>would be refused</span></div></div>
<div class="stats"><div><b>${money(bt.auto_cents)}</b><span>repeat buys without you</span></div><div><b>${money(bt.held_cents)}</b><span>waits for you</span></div><div><b>${money(bt.recovered_cents)}</b><span>recovered in the year</span></div></div>
<form method="post" action="/guard/backtest" class="row" id="bt-form"><label class="small">Try an approval threshold: <output id="bt-out">${money(rules.approve_above_cents)}</output></label><input type="range" name="approve_above_cents" min="1000" max="40000" step="500" value="${rules.approve_above_cents}" id="bt-slider"><button class="btn small">Re-run backtest</button></form>
${bt.rows.length ? html`<details><summary class="small">Rows (${bt.rows.length})</summary><div class="table-wrap"><table class="small"><thead><tr><th>When</th><th>Category</th><th>Merchant</th><th>Price</th><th>Back</th><th>Repeat</th><th>Outcome</th><th>Why</th></tr></thead><tbody>${raw(bt.rows.map((x) => `<tr><td>${fmtDate(x.at, false)}</td><td>${x.category.replace(/_/g, " ")}</td><td>${x.merchant}</td><td>${money(x.price_cents)}</td><td>${x.refund_cents ? money(x.refund_cents) : ""}</td><td>${x.repeat ? "yes" : ""}</td><td><span class="pill ${x.outcome === "run" ? "good" : x.outcome === "wait" ? "warn" : "bad"}">${x.outcome}</span></td><td>${x.reason}</td></tr>`).join(""))}</tbody></table></div></details>` : ""}</section></div>
<div class="grid g2">
<section class="card"><h2>Earned autonomy</h2><p class="small muted">Limits your own decisions already support. We never suggest past anything you declined.</p>
${suggestions.length ? html`<form method="post" action="/guard/suggestions">${raw(suggestions.map((s, i) => `<label class="check"><input type="checkbox" name="pick" value="${i}" checked> <b>${RULE_LABELS[s.field]}</b>: ${fmtRule(s.field, s.current)} → ${fmtRule(s.field, s.suggested)}<br><span class="small muted">${s.basis}</span></label>`).join(""))}<input type="hidden" name="payload" value="${JSON.stringify(suggestions)}"><button class="btn">Adopt selected</button></form>` : html`<p class="muted">Nothing to suggest yet. Approve a few held repeat buys by hand and come back.</p>`}</section>
<section class="card"><h2>Kill switch</h2><p class="small muted">Engaged: every checkout, capture, repeat buy and assistant call for your account is refused before it reaches PayPal.</p>
<form method="post" action="/guard/kill" class="row"><input type="hidden" name="scope" value="account">${myKill?.engaged ? html`<span class="pill bad">ENGAGED</span> <span class="small">${myKill.reason ?? ""}</span> <button class="btn" name="engaged" value="0">Release</button>` : html`<span class="pill good">clear</span> <input type="text" name="reason" placeholder="why (optional)" maxlength="120"> <button class="btn danger" name="engaged" value="1">Stop everything</button>`}</form>
${agentKills.length ? html`<h3>Per-assistant</h3><ul class="small">${raw(agentKills.map((k: any) => `<li class="mono">${k.scope} <span class="pill ${k.engaged ? "bad" : "good"}">${k.engaged ? "stopped" : "clear"}</span> <form method="post" action="/guard/kill" class="inline"><input type="hidden" name="scope" value="${k.scope}"><button class="btn small" name="engaged" value="${k.engaged ? 0 : 1}">${k.engaged ? "release" : "stop"}</button></form></li>`).join(""))}</ul>` : ""}
<form method="post" action="/guard/kill" class="row small"><input type="text" name="scope" placeholder="agent:<id>" required pattern="agent:.+"><input type="hidden" name="engaged" value="1"><button class="btn small">Stop one assistant</button></form></section></div>
${await approvalsBlock(a.id, "/guard")}
<section class="card"><h2>Recent agent runs</h2>${runs.length ? html`<ul class="small">${raw(runs.map((x: any) => `<li><a href="/trace/${x.id}">${String(x.subject).replace(/</g, "&lt;")}</a> · ${x.actor}${x.agent_id ? ` <span class="mono">${String(x.agent_id).replace(/</g, "&lt;")}</span>` : ""} · ${x.steps} steps${Number(x.blocked) ? ` · ${x.blocked} blocked` : ""} · <span class="pill ${x.status === "done" ? "good" : x.status === "failed" ? "bad" : "warn"}">${x.status}</span> · ${fmtDate(x.started_at)}</li>`).join(""))}</ul>` : html`<p class="muted">No runs yet.</p>`}<p class="small"><a href="/traces">All runs</a> · <a href="/channels">Channels</a></p></section>
${drafts.length > 1 ? html`<section class="card"><h2>Mandate history</h2><ul class="small">${raw(drafts.map((d: any) => `<li>${fmtDate(d.created_at)} · ${d.active ? "<b>active</b>" : `<form method="post" action="/guard/policy/${d.id}/activate" class="inline"><button class="btn small">make active</button></form>`} · ${d.compiler} · <span class="muted">${String(d.text).replace(/</g, "&lt;").slice(0, 100)}</span></li>`).join(""))}</ul></section>` : ""}`));
  }));

  r.post("/guard/policy", shopper(async (req, res, a) => {
    const text = String(req.body.text ?? "").slice(0, 2000);
    if (!text.trim()) throw new GtError("Write the mandate first", "validation", 422);
    const compiled = await compilePolicy(text);
    const adopt = req.body.mode === "adopt";
    const id = await savePolicy(a.id, text, compiled, adopt);
    if (adopt) return back(res, "/guard", `Mandate adopted (${compiled.compiler})${compiled.unexpressed.length ? `; could not express: ${compiled.unexpressed.join("; ")}` : ""}`);
    const current = (await activePolicy(a.id))?.rules ?? DEFAULT_RULES;
    res.send(spage(req, a, "Mandate preview", html`<h1>Mandate preview</h1><p class="sub">Compiled by ${compiled.compiler}. Nothing is active until you adopt it.</p>
<section class="card"><blockquote>${text}</blockquote>${rulesTable(SHOPPER_KEYS, compiled.rules, current)}
${compiled.unexpressed.length ? html`<p class="banner warn"><b>Could not express:</b> ${compiled.unexpressed.join("; ")}. These sentences have no rule behind them; write them differently or accept that they are not enforced.</p>` : ""}
<form method="post" action="/guard/policy/${id}/activate" class="row"><button class="btn primary">Adopt this mandate</button> <a class="btn" href="/guard">Back</a></form></section>`));
  }, true));

  r.post("/guard/policy/:id/activate", shopper(async (req, res, a) => {
    if (!(await activatePolicy(a.id, req.params.id))) throw new GtError("Mandate not found", "not_found", 404);
    back(res, "/guard", "Mandate adopted");
  }, true));

  r.post("/guard/backtest", shopper(async (req, res, a) => {
    const current = (await activePolicy(a.id))?.rules ?? DEFAULT_RULES;
    const candidate = RulesSchema.parse({ ...current, approve_above_cents: Number(req.body.approve_above_cents) });
    const [x, y] = await Promise.all([backtest(current, 365), backtest(candidate, 365)]);
    res.send(spage(req, a, "Backtest", html`<h1>Backtest</h1><p class="sub">Current mandate against a candidate with approval threshold ${money(candidate.approve_above_cents)}.</p>
<div class="grid g2"><section class="card"><h2>Current</h2><div class="stats"><div><b>${x.run}</b><span>run</span></div><div><b>${x.wait}</b><span>wait</span></div><div><b>${x.deny}</b><span>refused</span></div></div><p>${money(x.auto_cents)} of repeat buys without you; ${money(x.held_cents)} waits.</p></section>
<section class="card"><h2>Candidate</h2><div class="stats"><div><b>${y.run}</b><span>run</span></div><div><b>${y.wait}</b><span>wait</span></div><div><b>${y.deny}</b><span>refused</span></div></div><p>${money(y.auto_cents)} without you; ${money(y.held_cents)} waits.</p>
<form method="post" action="/guard/adopt-rules"><input type="hidden" name="rules" value="${JSON.stringify(candidate)}"><button class="btn primary">Adopt candidate</button> <a class="btn" href="/guard">Back</a></form></section></div>`));
  }, true));

  r.post("/guard/adopt-rules", shopper(async (req, res, a) => {
    const rules = RulesSchema.parse(JSON.parse(String(req.body.rules)));
    const prev = await activePolicy(a.id);
    await savePolicy(a.id, `${prev?.text ?? "(defaults)"} [edited from backtest]`, { rules, unexpressed: prev?.unexpressed ?? [], compiler: "backtest" }, true);
    back(res, "/guard", "Rules adopted");
  }, true));

  r.post("/guard/suggestions", shopper(async (req, res, a) => {
    const all = JSON.parse(String(req.body.payload ?? "[]"));
    const picks = (Array.isArray(req.body.pick) ? req.body.pick : req.body.pick ? [req.body.pick] : []).map((i: string) => all[Number(i)]).filter(Boolean);
    if (!picks.length) throw new GtError("Pick at least one suggestion", "validation", 422);
    const prev = await activePolicy(a.id);
    const rules = applySuggestions(prev?.rules ?? DEFAULT_RULES, picks);
    await savePolicy(a.id, `${prev?.text ?? "(defaults)"} [earned autonomy: ${picks.map((x: any) => x.field).join(", ")}]`, { rules, unexpressed: prev?.unexpressed ?? [], compiler: "earned-autonomy" }, true);
    back(res, "/guard", `Adopted ${picks.length} suggestion(s)`);
  }, true));

  r.post("/guard/kill", shopper(async (req, res, a) => {
    const raw_ = String(req.body.scope ?? "");
    const scope = raw_ === "account" ? `account:${a.id}` : raw_;
    if (scope !== `account:${a.id}` && !scope.startsWith("agent:")) throw new GtError("Scope must be account or agent:<id>", "validation", 422);
    const engaged = String(req.body.engaged) === "1";
    await setKill(scope, engaged, engaged ? String(req.body.reason ?? "").slice(0, 200) || null : null, a.name);
    back(res, "/guard", engaged ? `Kill switch engaged for ${scope}` : `Kill switch released for ${scope}`);
  }, true));

  r.post("/guard/approvals/:id/click", shopper(async (req, res, a) => {
    const approve = String(req.body.approve) === "1";
    const db = await getDb();
    const ap = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, a.id])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    if (approve && ap.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
    const payload = await decideApproval(ap.id, a.id, approve, "click");
    if (payload && approve) await release(ap.id);
    back(res, "/guard", approve ? "Approved; the held step is back in the queue" : "Declined");
  }, true));

  r.post("/guard/approvals/:id/:choice(approve|decline)", shopper(async (req, res, a) => {
    const approve = req.params.choice === "approve";
    const ap = (await (await getDb()).query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, a.id])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    if (approve && ap.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
    const payload = await decideApproval(ap.id, a.id, approve, "click");
    if (payload && approve) await release(ap.id);
    back(res, nextOf(req.body?.next, "/guard"), approve ? "Approved. Everyday is carrying on with it." : "Declined. Nothing was charged.");
  }, true));

  // Passkey endpoints serve both owners: the signed-in party decides which owner id applies.
  const ownerOf = async (req: Request): Promise<{ id: string; name: string }> => {
    const w = await whoami(req);
    if (w?.account) return { id: w.account.id, name: w.account.name };
    if (w?.merchant) return { id: MERCHANT, name: w.merchant.name };
    throw new GtError("Sign in", "unauthorized", 401);
  };
  r.post(["/guard/passkey/register/start", "/merchant/approvals/passkey/register/start"], json(async (req) => {
    const o = await ownerOf(req);
    const c = newChallenge(o.id, null);
    return { id: c.id, challenge: c.challenge, rpName: "Everyday", userId: Buffer.from(o.id).toString("base64url"), userName: o.name };
  }));
  r.post(["/guard/passkey/register/finish", "/merchant/approvals/passkey/register/finish"], json(async (req) => {
    const o = await ownerOf(req);
    try {
      return await finishRegistration(o.id, String(req.body.chalId), req.body);
    } catch (e) {
      throw new GtError((e as Error).message, "passkey_failed", 400);
    }
  }));
  r.post(["/guard/passkey/sign/start", "/merchant/approvals/passkey/sign/start"], json(async (req) => {
    const o = await ownerOf(req);
    const db = await getDb();
    const ap = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2 AND status = 'pending'", [String(req.body.approvalId), o.id])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    const c = newChallenge(o.id, ap.payload_hash);
    return { id: c.id, challenge: c.challenge, payloadHash: ap.payload_hash, summary: `${ap.action} ${money(ap.payload.cents)} ${ap.payload.entity_id}` };
  }));
  r.post(["/guard/passkey/sign/finish", "/merchant/approvals/passkey/sign/finish"], json(async (req) => {
    const o = await ownerOf(req);
    const db = await getDb();
    const ap = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2 AND status = 'pending'", [String(req.body.approvalId), o.id])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    const ok = await verifyAssertion(o.id, String(req.body.chalId), ap.payload_hash, req.body);
    if (!ok) throw new GtError("Signature did not verify", "passkey_failed", 400);
    const payload = await decideApproval(ap.id, o.id, true, "passkey");
    if (payload) await release(ap.id);
    return { approved: true, payload_hash: ap.payload_hash, hashed: payloadHash(ap.payload) === ap.payload_hash };
  }));
  r.get(["/guard/audit.json", "/merchant/approvals/audit.json"], json(async (req) => {
    await ownerOf(req);
    return { chain: await verifyChain(), rows: await recentAudit(1000) };
  }));
  r.get("/guard/runs.json", json(async (req) => {
    await ownerOf(req);
    return { runs: await recentRuns(50), threshold_cents: config.guard.countersignAboveCents };
  }));

  // ---------- Merchant ----------
  r.get("/merchant/approvals", merchant(async (req, res, m) => {
    const policy = await activePolicy(MERCHANT);
    const rules = policy?.rules ?? DEFAULT_RULES;
    const kill = await isKilled("merchant");
    res.send(mpage(req, "Approvals", html`<h1>Refund mandate and approvals</h1><p class="sub">${m.name}. Refunds code may send without a person, and the ones that wait for you.</p>
<script>${raw(PASSKEY_JS)}</script><script src="/static/guard.js" defer></script>
<div class="grid g2"><section class="card"><h2>Mandate</h2>
<form method="post" action="/merchant/approvals/policy"><div class="field"><label for="mtext">In plain words</label><textarea id="mtext" name="text" rows="3" maxlength="1000" placeholder="Refund at most 60%. Ask me before refunding more than $150">${policy?.text ?? ""}</textarea></div><button class="btn primary" name="mode" value="adopt">Compile and adopt</button></form>
${policy ? html`<p class="small muted">Active · compiled by ${policy.compiler}${policy.unexpressed.length ? html` · <strong>could not express:</strong> ${policy.unexpressed.join("; ")}` : ""}</p>` : ""}${rulesTable(MERCHANT_KEYS, rules)}</section>
<section class="card"><h2>Kill switch</h2><p class="small muted">Engaged: no refund, tracking or dispute write reaches PayPal.</p><form method="post" action="/merchant/approvals/kill" class="row">${kill?.engaged ? html`<span class="pill bad">ENGAGED</span> <button class="btn" name="engaged" value="0">Release</button>` : html`<span class="pill good">clear</span> <input type="text" name="reason" placeholder="why (optional)" maxlength="120"> <button class="btn danger" name="engaged" value="1">Stop all refunds</button>`}</form></section></div>
${await approvalsBlock(MERCHANT, "/merchant/approvals")}`));
  }));
  r.post("/merchant/approvals/policy", merchant(async (req, res) => {
    const text = String(req.body.text ?? "").slice(0, 1000);
    if (!text.trim()) throw new GtError("Write the mandate first", "validation", 422);
    const compiled = await compilePolicy(text);
    await savePolicy(MERCHANT, text, compiled, true);
    back(res, "/merchant/approvals", `Mandate adopted (${compiled.compiler})${compiled.unexpressed.length ? `; could not express: ${compiled.unexpressed.join("; ")}` : ""}`);
  }, true));
  r.post("/merchant/approvals/kill", merchant(async (req, res, m) => {
    const engaged = String(req.body.engaged) === "1";
    await setKill("merchant", engaged, engaged ? String(req.body.reason ?? "").slice(0, 200) || null : null, m.name);
    back(res, "/merchant/approvals", engaged ? "Kill switch engaged" : "Kill switch released");
  }, true));
  r.post("/merchant/approvals/:id/click", merchant(async (req, res) => {
    const approve = String(req.body.approve) === "1";
    const db = await getDb();
    const ap = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, MERCHANT])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    if (approve && ap.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
    const payload = await decideApproval(ap.id, MERCHANT, approve, "click");
    if (payload && approve) await release(ap.id);
    back(res, "/merchant/approvals", approve ? "Approved; the refund is back in the queue" : "Declined");
  }, true));
  r.post("/merchant/approvals/:id/:choice(approve|decline)", merchant(async (req, res) => {
    const approve = req.params.choice === "approve";
    const ap = (await (await getDb()).query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, MERCHANT])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    if (approve && ap.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
    const payload = await decideApproval(ap.id, MERCHANT, approve, "click");
    if (payload && approve) await release(ap.id);
    back(res, nextOf(req.body?.next, "/merchant/approvals"), approve ? "Approved; the refund is back in the queue." : "Declined. Nothing moves.");
  }, true));
  return r;
}
export type { Response };
