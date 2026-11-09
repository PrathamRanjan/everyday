import { Router, type Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { GtError } from "../lib/util.js";
import { getDb } from "../db.js";
import { FEATURES, label } from "../core/prefs.js";
import { addWorkDays, fmtWall, wallIso } from "../core/time.js";
import { armFault } from "../paypal/index.js";
import { accountById, J, nowIso, nowOf, setting } from "../store.js";
import { catalog } from "../services/catalog.js";
import { handleTelegram } from "../services/captures.js";
import { setPrice } from "../services/life.js";
import { backorderLine, deliverLine, merchantDecide, reconcile, shipLine, verifyRefunds } from "../services/orders.js";
import { seed, seedAll } from "../services/seed.js";
import { aiUsageSummary, hasOpenAI, providerLabel } from "../ai/provider.js";
import { evalRows, summarise } from "../eval/store.js";
import { verifyChain } from "../guard/audit.js";
import { telegramReady, whatsappReady } from "../channels/index.js";
import { pushReady } from "../channels/push.js";
import { channel3Ready } from "../services/channel3.js";
import { runTechjam } from "../core/techjam.js";
import { runAdversarial } from "../eval/adversarial.js";
import { runCaptureEval } from "../eval/capture.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { esc, raw } from "./html.js";
import { demoOnly, merchant, signOut } from "./auth.js";
import { back, flashOf } from "./common.js";
import { html, layout, money, pill, type Raw } from "./html.js";

const page = (req: Request, area: "merchant" | "console", title: string, body: Raw) => layout({ title, area, flash: flashOf(req) }, body);

export function opsRoutes() {
  const r = Router();

  // ---------- Merchant console (the connected test merchant) ----------
  r.get("/merchant", merchant(async (req, res, m) => {
    const db = await getDb();
    const lines = (await db.query<any>("SELECT l.*, o.number, o.status AS order_status, a.name AS customer FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN accounts a ON a.id = o.account_id WHERE o.merchant_id = $1 AND o.status <> 'created' ORDER BY o.created_at DESC, l.slot", [m.id])).rows;
    const cases = (await db.query<any>("SELECT c.*, o.number AS order_number, l.title FROM cases c JOIN orders o ON o.id = c.order_id JOIN order_lines l ON l.id = c.line_id WHERE o.merchant_id = $1 ORDER BY c.created_at DESC", [m.id])).rows;
    const cat = (await catalog(db)).products.filter((p) => p.merchant_id === m.id);
    res.send(page(req, "merchant", "Orders", html`<h1>${m.name}</h1><p class="muted">Sandbox test merchant: authored products, PayPal sandbox payments.</p>
<section class="card"><h2>Order lines</h2><div class="table-wrap"><table><thead><tr><th>Order</th><th>Item</th><th>Status</th><th>ETA</th><th></th></tr></thead><tbody>${lines.map((l) => html`<tr><td>${l.number}<br><span class="small muted">${l.customer}</span></td><td>${l.title}</td><td>${pill(l.status)}</td><td>${l.eta ?? ""}</td><td class="row">${l.status === "ordered" ? html`<form method="post" action="/merchant/lines/${l.id}/ship" class="inline"><button class="btn small" type="submit">Ship</button></form><form method="post" action="/merchant/lines/${l.id}/backorder" class="row"><label class="sr" for="bd-${l.id}">Days</label><input id="bd-${l.id}" type="number" name="days" value="4" min="1" style="width:4rem"><button class="btn small" type="submit">Backorder</button></form>` : ""}${l.status === "shipped" ? html`<form method="post" action="/merchant/lines/${l.id}/deliver" class="row"><label class="sr" for="dn-${l.id}">Note</label><input id="dn-${l.id}" type="text" name="note" placeholder="note"><button class="btn small" type="submit">Delivered</button></form>` : ""}</td></tr>`)}</tbody></table></div></section>
<section class="card" id="cases"><h2>Cases</h2>${cases.length ? cases.map((c) => html`<div class="slot"><b>${c.number}</b> ${pill(c.status)} ${c.title}: ${c.issue}<p>${c.claim}</p>${J<any[]>(c.flags).length ? html`<p class="small"><span class="flag bad">ignored</span> instruction-like text in the claim</p>` : ""}<p class="small">Customer asked for: ${c.requested ?? "—"}${c.refund_cents ? ` (${money(c.refund_cents)})` : ""}</p>${c.status === "awaiting_merchant" ? html`<form method="post" action="/merchant/cases/${c.id}" class="row"><label class="sr" for="mn-${c.id}">Note</label><input id="mn-${c.id}" type="text" name="note" placeholder="note to customer"><button class="btn primary small" name="approve" value="1" type="submit">Approve</button><button class="btn small" name="approve" value="0" type="submit">Decline</button></form>` : ""}</div>`) : html`<p class="muted">No cases.</p>`}</section>
<section class="card" id="catalog"><h2>Catalog prices and stock</h2><div class="table-wrap"><table><tbody>${cat.map((p) => html`<tr><td>${p.title}<br><span class="small muted">${p.sku}</span></td><td class="num">${p.stock} in stock</td><td><form method="post" action="/merchant/products/${p.id}/price" class="row"><label class="sr" for="pp-${p.id}">Price</label><input id="pp-${p.id}" type="number" step="0.01" name="price" value="${(p.price_cents / 100).toFixed(2)}" style="width:6rem"><button class="btn small" type="submit">Set price</button></form></td></tr>`)}</tbody></table></div></section>`));
  }));

  const owns = async (mId: string, lineId: string) => (await (await getDb()).query("SELECT 1 FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.id = $1 AND o.merchant_id = $2", [lineId, mId])).rows.length > 0;
  r.post("/merchant/lines/:id/ship", merchant(async (req, res, m) => {
    if (!(await owns(m.id, req.params.id))) return res.status(404).send("Not found");
    await shipLine(req.params.id);
    back(res, "/merchant", "Shipped.");
  }, true));
  r.post("/merchant/lines/:id/deliver", merchant(async (req, res, m) => {
    if (!(await owns(m.id, req.params.id))) return res.status(404).send("Not found");
    await deliverLine(req.params.id, String(req.body.note ?? ""));
    back(res, "/merchant", "Delivered.");
  }, true));
  r.post("/merchant/lines/:id/backorder", merchant(async (req, res, m) => {
    if (!(await owns(m.id, req.params.id))) return res.status(404).send("Not found");
    const out = await backorderLine(req.params.id, Math.max(1, Number(req.body.days) || 4));
    back(res, "/merchant", `Backordered to ${out.eta}${out.offer ? `; swap offered: ${out.offer.title}` : ""}.`);
  }, true));
  r.post("/merchant/cases/:id", merchant(async (req, res, m) => {
    const db = await getDb();
    const ok = (await db.query("SELECT 1 FROM cases c JOIN orders o ON o.id = c.order_id WHERE c.id = $1 AND o.merchant_id = $2", [req.params.id, m.id])).rows.length;
    if (!ok) return res.status(404).send("Not found");
    await merchantDecide(req.params.id, req.body.approve === "1", String(req.body.note ?? ""));
    back(res, "/merchant#cases", "Decision recorded.");
  }, true));
  r.post("/merchant/products/:id/price", merchant(async (req, res, m) => {
    const db = await getDb();
    const p = (await db.query<any>("SELECT * FROM products WHERE id = $1 AND merchant_id = $2", [req.params.id, m.id])).rows[0];
    if (!p) return res.status(404).send("Not found");
    const acc = (await db.query<any>("SELECT * FROM accounts LIMIT 1")).rows[0];
    const n = await setPrice(p.id, Math.round(Number(req.body.price) * 100), acc ? nowIso(await accountById(db, acc.id)) : wallIso(new Date()));
    back(res, "/merchant#catalog", `Price recorded${n ? `; ${n} shopper(s) notified (price watches and price protection)` : ""}.`);
  }, true));

  // ---------- Operator console: model, data use, failure lab ----------
  r.get("/console", demoOnly(async (req, res) => {
    const db = await getDb();
    const art = (await db.query<any>("SELECT * FROM model_artifacts WHERE kind = 'pref_prior' ORDER BY created_at DESC LIMIT 1")).rows[0];
    const rep = art ? J<any>(art.report) : null;
    const man = art ? J<any>(art.manifest) : null;
    const events = (await db.query<any>("SELECT e.*, a.title AS at, b.title AS bt FROM pref_events e JOIN products a ON a.id = e.a_product JOIN products b ON b.id = e.b_product ORDER BY e.id DESC LIMIT 20")).rows;
    const prior = art ? J<number[]>(art.weights) : [];
    const bar = (v: number) => html`<div class="bar" title="${v.toFixed(3)}"><span style="width:${Math.min(100, Math.round(v * 100))}%"></span></div>`;
    res.send(page(req, "console", "Model", html`<h1>Preference model</h1>
${rep ? html`<section class="card"><h2>Evaluation (${rep.metric})</h2><p class="small"><b>Data:</b> ${rep.data}. ${rep.train_shoppers} training / ${rep.test_shoppers} held-out shoppers, ${rep.train_pairs} training pairs, seeds ${rep.seeds.join(", ")}.</p>
<div class="table-wrap"><table><thead><tr><th>Ranker</th><th>NDCG@3 (mean)</th><th></th><th class="num">Spread across seeds</th></tr></thead><tbody>
<tr><td>Popularity (win rate)</td><td class="num">${rep.popularity.mean}</td><td style="width:40%">${bar(rep.popularity.mean)}</td><td class="num">${rep.popularity.spread}</td></tr>
<tr><td>Global logistic prior</td><td class="num">${rep.global.mean}</td><td>${bar(rep.global.mean)}</td><td class="num">${rep.global.spread}</td></tr>
${Object.entries(rep.personal).map(([k, v]: any) => html`<tr><td>Personal after ${k} choices</td><td class="num">${v.mean}</td><td>${bar(v.mean)}</td><td class="num">${v.spread}</td></tr>`)}
</tbody></table></div><p>${rep.promote_personal ? html`${pill("succeeded", "promoted")} Personalisation gains ${rep.gain_at_5} NDCG after 5 choices, more than the global model's seed-to-seed spread.` : html`${pill("failed", "not promoted")} Gain does not beat seed noise; the simpler model stays.`}</p></section>
<section class="card"><h2>Global prior weights</h2><div class="table-wrap"><table><tbody>${prior.map((w, i) => html`<tr><td>${FEATURES[i]}</td><td class="small">${label(i)}</td><td class="num">${w.toFixed(3)}</td></tr>`)}</tbody></table></div><details><summary>Training manifest</summary><pre class="small">${JSON.stringify(man, null, 2)}</pre></details></section>` : ""}
<section class="card"><h2>Explicit choices (latest 20)</h2><div class="table-wrap"><table><thead><tr><th>Pair</th><th>Reason</th><th>Used for learning?</th></tr></thead><tbody>${events.map((e) => html`<tr><td>${e.chosen === e.a_product ? html`<b>${e.at}</b> over ${e.bt}` : e.chosen === e.b_product ? html`<b>${e.bt}</b> over ${e.at}` : html`${e.at} / ${e.bt}`}</td><td>${e.reason}</td><td>${e.eligible ? pill("succeeded", "yes") : html`${pill("muted", "no")} <span class="small">${e.excluded_reason}</span>`}</td></tr>`)}</tbody></table></div></section>
<section class="card" id="lab"><h2>Failure lab</h2><p class="small">Each arms a one-shot fault on the next matching PayPal call; the financial effect stays single and the order's history explains the recovery.</p><form method="post" action="/console/fault" class="row"><button class="btn small" name="f" value="drop_return" type="submit">Drop the next PayPal return</button><button class="btn small" name="f" value="capture_lost" type="submit">Lose the next capture response</button><button class="btn small" name="f" value="refund_503" type="submit">Next refund gets a 503</button></form><form method="post" action="/console/run" class="row"><button class="btn small" type="submit">Run reconcile and refund verification now</button></form><p class="small muted">A stale quote is refused at approval if the price, stock or plan changed: change a price in the merchant console after quoting to see it.</p></section>`));
  }));

  r.get("/console/evidence", demoOnly(async (req, res) => {
    const db = await getDb();
    const [cap, adv, ai, chain] = await Promise.all([summarise("capture"), summarise("adversarial"), aiUsageSummary(), verifyChain()]);
    const tj = existsSync("eval/techjam.md") ? readFileSync("eval/techjam.md", "utf8") : null;
    const real = (await db.query<any>(`SELECT
      (SELECT count(*) FROM orders WHERE capture_id IS NOT NULL) AS captures,
      (SELECT count(*) FROM payment_ops WHERE kind = 'refund' AND status = 'succeeded') AS refunds,
      (SELECT count(*) FROM repeat_buys WHERE status = 'paid') AS repeats_paid,
      (SELECT count(*) FROM repeat_buys WHERE status IN ('held','denied')) AS repeats_stopped,
      (SELECT count(*) FROM vault_tokens WHERE status = 'active') AS vaults,
      (SELECT count(*) FROM trackers) AS trackers,
      (SELECT count(*) FROM disputes) AS disputes,
      (SELECT count(*) FROM agent_runs) AS runs,
      (SELECT count(*) FROM approvals WHERE status = 'pending') AS approvals_pending,
      (SELECT count(*) FROM agent_requests) AS agent_requests,
      (SELECT count(*) FROM captures WHERE reader <> 'rules') AS model_captures`)).rows[0];
    const table = (arms: any[]) => html`<div class="table-wrap"><table><thead><tr><th>Arm</th><th>Cases</th><th>Correct</th><th>Traps</th><th>Traps caught</th><th>$ naive</th><th>$ Everyday moved</th><th>p50</th></tr></thead><tbody>${raw(arms.map((a) => `<tr><td><b>${a.arm}</b></td><td>${a.cases}</td><td>${a.correct}</td><td>${a.traps}</td><td>${a.traps_caught}</td><td>${a.naive_usd.toFixed(2)}</td><td class="${a.paid_usd ? "bad" : "good"}">${a.paid_usd.toFixed(2)}</td><td>${a.p50_ms} ms</td></tr>`).join(""))}</tbody></table></div>`;
    res.send(page(req, "console", "Evidence", html`<h1>Evidence</h1><p class="sub">What is real, what is simulated, and what the evals measured on this instance.</p>
<section class="card"><h2>Real vs simulated</h2><table class="small"><tbody>
<tr><th>PayPal</th><td>Sandbox REST: orders, captures, refunds, vault setup and payment tokens, merchant-initiated captures on a token, order tracking, disputes with evidence, transaction search, negative-testing mock responses. ${config.paypal.clientId ? "Credentials present." : "No credentials in this instance: the fake client is in use."} No live money.</td></tr>
<tr><th>Models</th><td>${providerLabel()}. ${ai.calls} calls recorded (${ai.ok} ok), about ${ai.cost_usd.toFixed(3)} at list prices. Models read screenshots and compile mandates; they never set a price, a refund or a payee.</td></tr>
<tr><th>Catalog</th><td>Seeded Northlight catalog; demo clips have authored objects. Channel3 ${channel3Ready() ? "live" : "not configured: catalog results stand in and say so"}.</td></tr>
<tr><th>Agents</th><td>Shopper agent over MCP (${real.agent_requests} requests logged). Agents plan and quote; the shopper approves on PayPal; the gate decides repeat buys.</td></tr>
<tr><th>Channels</th><td>Telegram ${telegramReady() ? "live" : "not configured"} · WhatsApp ${whatsappReady() ? "live" : "not configured"} · Web push ${pushReady() ? "live" : "not configured"} · Simulator always on at <a href="/channels">/channels</a>.</td></tr>
<tr><th>Audit chain</th><td>${chain.ok ? `intact, ${chain.rows} rows` : `BROKEN at row ${chain.broken_at}`}, head <span class="mono">${chain.head.slice(0, 16)}…</span></td></tr>
</tbody></table>
<div class="stats"><div><b>${real.captures}</b><span>PayPal captures</span></div><div><b>${real.refunds}</b><span>refunds sent</span></div><div><b>${real.repeats_paid}</b><span>repeat buys paid</span></div><div><b>${real.repeats_stopped}</b><span>repeat buys held/denied</span></div><div><b>${real.vaults}</b><span>saved PayPals</span></div><div><b>${real.trackers}</b><span>trackers</span></div><div><b>${real.disputes}</b><span>disputes</span></div><div><b>${real.runs}</b><span>runs traced</span></div><div><b>${real.approvals_pending}</b><span>approvals waiting</span></div><div><b>${real.model_captures}</b><span>captures read by a model</span></div></div></section>
<section class="card"><h2>Capture reader eval</h2><p class="small muted">Synthetic frames through the caption-only rules arm, the vision model (grounded and quarantined by code) and the oracle. Money never moves on a capture.</p>${cap.length ? html`${table(cap)}<p class="small"><a href="/console/capture.md">Markdown report</a></p>` : html`<p class="muted">Not run yet: <span class="mono">npm run eval:capture</span> or the button below.</p>`}</section>
<section class="card"><h2>Adversarial money harness</h2><p class="small muted">Hostile and malformed money moves through the live gate. Every one must be denied, refused or held.</p>${adv.length ? html`${table(adv)}<p class="small"><a href="/console/adversarial.md">Markdown report</a></p>` : html`<p class="muted">Not run yet: <span class="mono">npm run eval:adversarial</span>.</p>`}</section>
<section class="card"><h2>TechJam-style conversational shopping eval</h2>${tj ? html`<pre class="small" style="white-space:pre-wrap">${tj}</pre>` : html`<p class="muted">Not run yet: <span class="mono">npm run eval:techjam</span>.</p>`}</section>
<section class="card"><h2>Model usage by purpose</h2>${ai.by_purpose.length ? html`<table class="small"><thead><tr><th>Purpose</th><th>Calls</th><th>Cost</th><th>p50</th></tr></thead><tbody>${raw(ai.by_purpose.map((x) => `<tr><td>${x.purpose}</td><td>${x.calls}</td><td>${x.cost_usd.toFixed(4)}</td><td>${x.p50_ms} ms</td></tr>`).join(""))}</tbody></table>` : html`<p class="muted">No model calls yet${hasOpenAI() ? "" : " (no OpenAI key configured)"}.</p>`}</section>
<section class="card"><h2>Run the evals here</h2><p class="small"><a href="/console/eval">Eval explorer</a>: every recorded row, sliced by arm, outcome and trap, with CSV.</p><form method="post" action="/console/eval" class="row"><button class="btn small" name="suite" value="capture">Capture (rules${hasOpenAI() ? " + model" : ""})</button><button class="btn small" name="suite" value="adversarial">Adversarial</button><button class="btn small" name="suite" value="techjam">TechJam-style</button></form></section>`));
  }));
  // ---- Eval explorer (roadmap B.4): every eval row, sliced by suite, arm, outcome and trap, with CSV ----
  const sliceRows = async (req: Request) => {
    const suite = typeof req.query.suite === "string" ? req.query.suite : "capture";
    const arm = typeof req.query.arm === "string" ? req.query.arm : undefined;
    const outcome = typeof req.query.outcome === "string" ? req.query.outcome : undefined;
    const trap = typeof req.query.trap === "string" ? req.query.trap : undefined;
    const all = await evalRows(suite, 3000);
    const kindOf = (x: any) => x.detail?.trap_kind ?? x.detail?.kind ?? null;
    const rows = all.filter((x: any) => (!arm || x.arm === arm) && (!outcome || (outcome === "correct") === Boolean(x.correct)) && (!trap || (trap === "trap" ? x.trap : trap === "plain" ? !x.trap : kindOf(x) === trap)));
    return { suite, arm, outcome, trap, all, rows, kindOf };
  };
  r.get("/console/eval", demoOnly(async (req, res) => {
    const { suite, arm, outcome, trap, all, rows, kindOf } = await sliceRows(req);
    const q = (patch: Record<string, string | undefined>) => "/console/eval?" + new URLSearchParams(Object.entries({ suite, arm, outcome, trap, ...patch }).filter(([, v]) => v) as [string, string][]).toString();
    const chip = (label: string, patch: Record<string, string | undefined>, on: boolean) => html`<a class="chip ${on ? "on" : ""}" href="${q(patch)}">${label}</a>`;
    const kinds = [...new Set(all.map(kindOf).filter(Boolean))] as string[];
    const sums = await summarise(suite);
    res.send(layout({ title: "Eval explorer", area: "console", flash: flashOf(req) }, html`<h1>Eval explorer</h1>
<p class="sub">Every recorded eval row on this instance. Slice by arm, outcome and trap; export the slice as CSV. Summaries and the run buttons live on <a href="/console/evidence">Evidence</a>.</p>
<section class="card"><div class="chips">Suite: ${["capture", "adversarial", "techjam"].map((su) => chip(su, { suite: su, arm: undefined, outcome: undefined, trap: undefined }, suite === su))}</div>
<div class="chips">Arm: ${chip("all", { arm: undefined }, !arm)}${[...new Set(all.map((x: any) => String(x.arm)))].map((a) => chip(a, { arm: a }, arm === a))}</div>
<div class="chips">Outcome: ${chip("all", { outcome: undefined }, !outcome)}${chip("correct", { outcome: "correct" }, outcome === "correct")}${chip("wrong", { outcome: "wrong" }, outcome === "wrong")}</div>
<div class="chips">Traps: ${chip("all", { trap: undefined }, !trap)}${chip("traps only", { trap: "trap" }, trap === "trap")}${chip("plain", { trap: "plain" }, trap === "plain")}${kinds.map((k) => chip(k, { trap: k }, trap === k))}</div>
<p class="small"><a class="btn small" href="${q({}).replace("/console/eval?", "/console/eval.csv?")}">Download this slice as CSV</a> · ${rows.length} of ${all.length} rows</p>
${sums.length ? html`<div class="table-wrap"><table class="small"><thead><tr><th>Arm</th><th>Cases</th><th>Correct</th><th>Traps</th><th>Traps paid</th><th>$ paid</th><th>$ naive</th><th>p50</th></tr></thead><tbody>${raw(sums.map((a: any) => `<tr><td><b>${esc(a.arm)}</b></td><td>${a.cases}</td><td>${a.correct}</td><td>${a.traps}</td><td>${a.traps_paid}</td><td>${Number(a.paid_usd ?? 0).toFixed(2)}</td><td>${Number(a.naive_usd ?? 0).toFixed(2)}</td><td>${a.p50_ms} ms</td></tr>`).join(""))}</tbody></table></div>` : ""}
</section>
<section class="card"><div class="table-wrap"><table class="small"><thead><tr><th>Case</th><th>Arm</th><th>Expected</th><th>Actual</th><th>OK</th><th>Trap</th><th>$ naive</th><th>$ ours</th><th>ms</th><th>Detail</th></tr></thead><tbody>
${raw(rows.slice(0, 400).map((x: any) => `<tr><td class="mono">${esc(String(x.case_id))}</td><td>${esc(String(x.arm))}</td><td class="small">${esc(String(x.expected).slice(0, 100))}</td><td class="small">${esc(String(x.actual).slice(0, 100))}</td><td>${x.correct ? '<span class="pill good">yes</span>' : '<span class="pill bad">no</span>'}</td><td>${esc(String(kindOf(x) ?? (x.trap ? "trap" : "")))}</td><td>${(Number(x.naive_paid_cents) / 100).toFixed(2)}</td><td>${(Number(x.ours_paid_cents) / 100).toFixed(2)}</td><td>${x.latency_ms}</td><td class="small">${esc(String(x.detail?.reason ?? x.detail?.title ?? x.detail?.note ?? "").slice(0, 120))}</td></tr>`).join(""))}
</tbody></table></div>${rows.length ? "" : html`<p class="muted">Nothing recorded for this slice. Run an eval from Evidence.</p>`}</section>`));
  }));
  r.get("/console/eval.csv", demoOnly(async (req, res) => {
    const { suite, rows } = await sliceRows(req);
    const cols = ["id", "arm", "case_id", "expected", "actual", "correct", "trap", "naive_paid_cents", "ours_paid_cents", "latency_ms", "at"];
    const cell = (v: unknown) => { const t = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    res.type("text/csv").set("Content-Disposition", `attachment; filename="everyday-eval-${suite}.csv"`).send([cols.join(","), ...rows.map((x: any) => cols.map((c) => cell(x[c])).join(","))].join("\n"));
  }));
  r.get("/llms.txt", (_req, res) => {
    res.type("text/plain").send(`# Everyday
A shopping agent that buys for a person inside the mandate they set, approves every purchase on PayPal, and a merchant desk that ships, handles cases and disputes under its own refund ceiling.

MCP shopper agent (Streamable HTTP, stateless): ${config.appUrl}/mcp with Authorization: Bearer <shopper key>.
MCP merchant agent (read-only): ${config.appUrl}/merchant/mcp with Authorization: Bearer <merchant key>.
Skill: ${config.appUrl}/skill.md
Runs API: ${config.appUrl}/api/v1/runs
Evidence: ${config.appUrl}/console/evidence · eval explorer ${config.appUrl}/console/eval · judge ${config.appUrl}/judge

Guarantees: amounts come from the catalog and quotes, never from text; a quote hash must match before approval; every money move is dry-run against kill switches, the mandate, the monthly limit, the refund ceiling and live PayPal state; held moves wait for a click or passkey.
`);
  });
  r.get("/skill.md", (_req, res) => {
    try {
      res.type("text/markdown").send(readFileSync("skill/SKILL.md", "utf8").replace(/\{APP_URL\}/g, config.appUrl));
    } catch {
      res.status(404).type("text/plain").send("No skill file.");
    }
  });
  r.post("/console/eval", demoOnly(async (req, res) => {
    const suite = String(req.body.suite ?? "");
    const db = await getDb();
    if (suite === "capture") {
      const r2 = await runCaptureEval();
      writeFileSync("eval/capture.md", r2.markdown);
    } else if (suite === "adversarial") {
      const acc = (await db.query<any>("SELECT id FROM accounts ORDER BY created_at LIMIT 1")).rows[0]?.id;
      const ord = (await db.query<any>("SELECT id FROM orders WHERE capture_id IS NOT NULL ORDER BY created_at DESC LIMIT 1")).rows[0]?.id ?? null;
      if (!acc) throw new GtError("Seed the demo first", "bad_state", 409);
      const r2 = await runAdversarial(acc, ord);
      writeFileSync("eval/adversarial.md", r2.markdown);
      if (r2.leaked.length) return back(res, "/console/evidence", `LEAK: ${r2.leaked.length} case(s) were allowed`, true);
    } else if (suite === "techjam") {
      const manifest = JSON.parse(readFileSync("eval/techjam-heldout.json", "utf8"));
      writeFileSync("eval/techjam.md", runTechjam(manifest.seeds, manifest.per_seed).markdown);
    } else throw new GtError("Unknown suite", "validation", 422);
    back(res, "/console/evidence", `${suite} eval done`);
  }, true));
  r.get(["/console/capture.md", "/console/adversarial.md", "/console/techjam.md"], demoOnly(async (req, res) => {
    const f = `eval/${req.path.split("/").pop()}`;
    if (!existsSync(f)) throw new GtError("Not run yet", "not_found", 404);
    res.type("text/markdown").send(readFileSync(f, "utf8"));
  }));

  r.post("/console/fault", demoOnly(async (req, res) => {
    const f = String(req.body.f);
    if (f === "drop_return") await (await getDb()).query("INSERT INTO demo_faults (method, kind) VALUES ('paypal_return','drop')");
    if (f === "capture_lost") await armFault("captureOrder", "lose_response");
    if (f === "refund_503") await armFault("refundCapture", "fail_503");
    back(res, "/console#lab", `Armed: ${f.replace(/_/g, " ")}.`);
  }, true));
  r.post("/console/run", demoOnly(async (_req, res) => {
    const n = await reconcile();
    await verifyRefunds();
    back(res, "/console#lab", `Reconciled ${n} order(s); refunds verified.`);
  }, true));

  // ---------- Telegram: real webhook and a simulator that posts the same updates ----------
  r.post("/c/telegram/webhook", async (req, res) => {
    const want = config.telegram.webhookSecret;
    const got = String(req.header("x-telegram-bot-api-secret-token") ?? "");
    if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return res.status(401).json({ ok: false });
    await handleTelegram(req.body).catch((e) => console.error("[telegram]", (e as Error).message));
    res.json({ ok: true });
  });

  r.get("/telegram", demoOnly(async (req, res) => {
    const db = await getDb();
    const chat = String(req.query.chat ?? "555001");
    const acc = (await db.query<any>("SELECT account_id FROM channel_links WHERE channel = 'telegram' AND external_id = $1", [chat])).rows[0];
    const msgs = (await db.query<any>("SELECT * FROM inbox WHERE channel = 'telegram' AND (account_id = $1 OR account_id = $2) ORDER BY id", [acc?.account_id ?? "-", `chat:${chat}`])).rows;
    const sent = J<any[]>((await setting(db, `tg_sent:${chat}`)) ?? "[]");
    const all = [...msgs.map((m) => ({ at: new Date(m.created_at).getTime(), me: false, text: m.text, buttons: J<any[][]>(m.buttons) })), ...sent.map((s) => ({ at: s.at, me: true, text: s.text, buttons: null }))].sort((a, b) => a.at - b.at);
    res.send(page(req, "console", "Telegram", html`<h1>Telegram simulator</h1><p class="small muted">Posts real Bot API update JSON to the same webhook a live bot uses (secret token included). Replies are what the bot sends${config.telegram.botToken ? " (also delivered to Telegram)" : ""}. Chat id ${chat}.</p>
<div class="chat">${all.map((m) => html`<div class="m ${m.me ? "me" : "bot"}">${m.text}${m.buttons ? html`<div class="kb">${m.buttons.flat().map((b: any) => (b.url ? html`<a class="btn small" href="${b.url.replace(config.appUrl, "")}">${b.text}</a>` : html`<form method="post" action="/telegram/send" class="inline"><input type="hidden" name="chat" value="${chat}"><input type="hidden" name="callback" value="${b.data}"><button class="btn small" type="submit">${b.text}</button></form>`))}</div>` : ""}</div>`)}</div>
<form method="post" action="/telegram/send" class="row" style="margin-top:10px"><input type="hidden" name="chat" value="${chat}"><label class="sr" for="tg">Message</label><input id="tg" type="text" name="text" placeholder="Paste a link or type a message" style="flex:1"><button class="btn primary" type="submit">Send</button></form>
<p class="small muted">Link first with <code>/start CODE</code> from You → Telegram (signed in as Maya).</p>`));
  }));

  r.post("/telegram/send", demoOnly(async (req, res) => {
    const db = await getDb();
    const chat = String(req.body.chat ?? "555001");
    const text = req.body.text ? String(req.body.text) : null;
    const update = text
      ? { update_id: Date.now(), message: { message_id: Date.now(), chat: { id: Number(chat), type: "private" }, from: { id: Number(chat), first_name: "Maya" }, text } }
      : { update_id: Date.now(), callback_query: { id: String(Date.now()), data: String(req.body.callback), message: { chat: { id: Number(chat) } } } };
    if (text) {
      const sent = J<any[]>((await setting(db, `tg_sent:${chat}`)) ?? "[]");
      sent.push({ at: Date.now(), text });
      await db.query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`tg_sent:${chat}`, JSON.stringify(sent.slice(-50))]);
    }
    const r2 = await fetch(`http://127.0.0.1:${(req.socket.localPort ?? config.port)}/c/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": config.telegram.webhookSecret }, body: JSON.stringify(update) });
    if (!r2.ok) return back(res, `/telegram?chat=${chat}`, "Webhook refused the update (secret not configured?).", true);
    res.redirect(`/telegram?chat=${chat}`);
  }, true));

  // ---------- Demo ----------
  r.get("/demo", async (req, res) => {
    const db = await getDb();
    const acc = (await db.query<any>("SELECT * FROM accounts LIMIT 1")).rows[0];
    res.send(layout({ title: "Demo", area: "console", flash: flashOf(req) }, html`<h1>Demo</h1>${!config.demoMode ? html`<p class="banner warn">Demo mode is off.</p>` : html`
<section class="card"><h2>Script</h2><ol>
<li>Sign in as <b>Maya</b> → You → Telegram → get a code. In the <a href="/telegram">Telegram simulator</a> send <code>/start CODE</code>, then the Short <code>https://youtube.com/shorts/dSk7Setup01</code>, pick the lamp, and send <code>Help me create this comfortable study setup by Friday for $350. I already own a monitor.</code></li>
<li>Open the plan: the monitor is excluded (owned), the hub without video is explained, and one question asks about the laptop's port. Answer USB-C.</li>
<li>Do two taste choices: pick the oak lamp over black, and the Ergo Mesh Chair over the Lite. The plan explains the change.</li>
<li>Get the exact quote and approve: PayPal sandbox checkout; the server reads the capture back.</li>
<li>Open the <a href="/login">merchant console</a>: backorder the chair. Maya sees the Friday risk and an in-stock swap with $20 back; she swaps and PayPal refunds $20.</li>
<li>Merchant ships and delivers; Maya reports the lamp scuffed, asks to keep it for $15 back; merchant approves; PayPal confirms the refund.</li>
<li>Possessions now include the lamp, chair and dock with return and warranty dates; the recall feed flags her headphones. Try a new plan: "a monitor arm" uses her monitor's VESA size.</li></ol></section>
<section class="card"><h2>Clock</h2><p>${acc ? `Maya's clock: ${fmtWall(acc.sim_now ?? wallIso(new Date()))}` : "Not loaded."}</p><form method="post" action="/demo/clock" class="row"><button class="btn small" name="step" value="day" type="submit">Next working day</button><button class="btn small" name="step" value="week" type="submit">+7 days</button></form></section>
<section class="card"><h2>Reset</h2><form method="post" action="/demo/reset"><button class="btn danger" type="submit">Reset demo data</button></form></section>
<section class="card"><h2>Sign in (demo)</h2><p class="small muted">Demo mode signs you in as a seeded person without a key. MCP clients use the keys printed by <span class="mono">npm run seed</span>; they are never shown on a page.</p>${config.demoMode ? await (async () => { const accs = (await db.query<any>("SELECT id, name FROM accounts ORDER BY name")).rows; const mers = (await db.query<any>("SELECT id, name FROM merchants WHERE kind = 'test_merchant' ORDER BY name")).rows; return html`<div class="row">${accs.map((a: any) => html`<form method="post" action="/login" class="inline"><input type="hidden" name="as" value="acc:${a.id}"><button class="btn small" type="submit">Sign in as ${a.name} (shopper)</button></form>`)}${mers.map((m: any) => html`<form method="post" action="/login" class="inline"><input type="hidden" name="as" value="mer:${m.id}"><button class="btn small" type="submit">Sign in as ${m.name} (merchant)</button></form>`)}</div>`; })() : html`<p class="muted">Demo mode is off.</p>`}</section>`}`));
  });

  r.post("/demo/reset", demoOnly(async (_req, res) => {
    await seedAll();
    signOut(res);
    back(res, "/login", "Demo loaded. Sign in as Maya.");
  }, true));

  r.post("/demo/clock", demoOnly(async (req, res) => {
    const db = await getDb();
    const acc = (await db.query<any>("SELECT * FROM accounts LIMIT 1")).rows[0];
    const a = await accountById(db, acc.id);
    const now = nowOf(a);
    const next = req.body.step === "week" ? new Date(now.getTime() + 7 * 864e5) : addWorkDays(now, 1);
    await db.query("UPDATE accounts SET sim_now = $2 WHERE id = $1", [a.id, wallIso(next)]);
    back(res, "/demo", `Clock: ${fmtWall(next)}`);
  }, true));

  return r;
}
