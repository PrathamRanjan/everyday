import { Router, type Request } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { fmtWall } from "../core/time.js";
import { GtError } from "../lib/util.js";
import { J, nowIso, nowOf, type Account } from "../store.js";
import { catalog, CATEGORY_LABEL } from "../services/catalog.js";
import { BASIS, capture, linkCode, selectObject } from "../services/captures.js";
import { addOwned, calendar, owned, recallsFor, repairAdvice, setOwnedStatus, today, watchPrice } from "../services/life.js";
import { choiceReceipts, deleteMemory, forgetFeature, modelFor, undoChoice, whyPanel } from "../services/ml.js";
import { claimPriceProtection, protectionsFor } from "../services/protect.js";
import { acceptSwap, approveQuote, checkoutLink, openCase, paypalReturn, quotePlan, requestRemedy, spending } from "../services/orders.js";
import { answer, choose, createIntent, currentPlan, intentRow, tastePairs, type SlotView } from "../services/plans.js";
import { keyLogin, shopper, signIn, signOut, whoami } from "./auth.js";
import { back, flashOf } from "./common.js";
import { html, layout, money, pill, raw, type Raw } from "./html.js";
import { readForm } from "./upload.js";
import { randomBytes } from "node:crypto";
import { landing } from "./landing.js";
import { icon } from "./icons.js";
import { messageFlag } from "./safetyui.js";
import { approvalCard } from "./guard.js";
import { pendingApprovals } from "../guard/dryrun.js";

const page = (req: Request, a: Account | null, title: string, body: Raw, area: "shopper" | "public" = "shopper") => layout({ title, area, who: a ? { name: a.name, clock: fmtWall(nowOf(a)) } : null, flash: flashOf(req) }, body);

function slotCard(s: SlotView, intentId: string, open: boolean): Raw {
  return html`<div class="slot"><div class="spread"><h3>${s.label} ${s.required ? "" : html`<span class="flag info">optional</span>`}</h3>${pill(s.outcome, s.outcome === "buy" ? "in plan" : s.outcome === "suggested" ? "suggested add-on" : s.outcome === "none" ? "no fit yet" : s.outcome.replace("_", " "))}</div>
${s.note ? html`<p class="small">${s.note}</p>` : ""}
${s.pick ? html`<div class="pick"><div><b>${s.pick.title}</b> ${s.pick.exact ? html`<span class="flag good">exact match from your clip</span>` : ""}${s.pick.delay_days ? html` <span class="flag bad">ships after ${s.pick.delay_days} day backorder</span>` : ""}<br><span class="small muted">${s.pick.label} · ${s.pick.merchant}</span>${s.pick.reasons.length ? html`<br><span class="small">${s.pick.reasons.join(" · ")}</span>` : ""}</div><div class="price">${money(s.pick.price_cents)}</div></div>` : ""}
${open && !s.required ? html`<form method="post" action="/plans/${intentId}/answer" class="inline"><input type="hidden" name="key" value="addon"><input type="hidden" name="value" value="${s.key}"><button class="btn small" type="submit">${s.outcome === "buy" ? "Remove from plan" : "Add to plan"}</button></form>` : ""}
${s.alternatives.length ? html`<details><summary>Other good fits (${s.alternatives.length})</summary><ul>${s.alternatives.map((x) => html`<li>${x.title} — ${money(x.price_cents)}${x.reasons.length ? html` <span class="muted small">${x.reasons.join(" · ")}</span>` : ""}</li>`)}</ul></details>` : ""}
${s.excluded.length ? html`<details><summary>Why not these (${s.excluded.length})</summary><ul>${s.excluded.map((x) => html`<li><b>${x.title}</b> ${money(x.price_cents)}: ${x.reasons.join("; ")}</li>`)}</ul></details>` : ""}
${s.unknown.length ? html`<details open><summary>Can't check yet (${s.unknown.length})</summary><ul>${s.unknown.map((x) => html`<li>${x.title}: need ${x.unknown.join(", ")}</li>`)}</ul></details>` : ""}
${s.discovery.length ? html`<details><summary>Elsewhere (${s.discovery.length})</summary><ul>${s.discovery.map((x) => html`<li>${x.title} — ${money(x.price_cents)} <span class="flag">${x.label}</span>${x.url ? html` <a href="${x.url}" rel="noopener nofollow">view</a>` : ""}</li>`)}</ul></details>` : ""}</div>`;
}

export function shopperRoutes() {
  const r = Router();

  r.get("/", async (req, res) => {
    const w = await whoami(req);
    if (w?.account) return res.redirect("/today");
    if (w?.merchant) return res.redirect("/merchant");
    await landing(req, res);
  });

  r.get("/login", async (req, res) => {
    const db = await getDb();
    const accounts = config.demoMode ? (await db.query<any>("SELECT id, name FROM accounts")).rows : [];
    const merchants = config.demoMode ? (await db.query<any>("SELECT id, name FROM merchants WHERE kind = 'test_merchant'")).rows : [];
    const next = String(req.query.next ?? "");
    res.send(page(req, null, "Sign in", html`<div class="page-head"><div><h1>Sign in to Everyday</h1><p>Shoppers see their plans and purchases; the test merchant sees orders and cases.</p></div></div>
<div class="lp-personas">
${accounts.map((a) => html`<div class="persona-card"><div class="who"><span class="avatar">${a.name[0]}</span><span><b>${a.name}</b><span>Demo shopper</span></span></div><form method="post" action="/login"><input type="hidden" name="as" value="acc:${a.id}"><input type="hidden" name="next" value="${next}"><button class="btn primary" type="submit">Continue as ${a.name}</button></form></div>`)}
${merchants.map((m) => html`<div class="persona-card"><div class="who"><span class="avatar">${raw(icon("store"))}</span><span><b>${m.name}</b><span>Test merchant console</span></span></div><form method="post" action="/login"><input type="hidden" name="as" value="mer:${m.id}"><button class="btn" type="submit">Open merchant console</button></form></div>`)}
<div class="persona-card"><div class="who"><span class="avatar">${raw(icon("lock"))}</span><span><b>With an access key</b><span>For your own account</span></span></div><form method="post" action="/login" class="stack"><label for="key">Access key</label><input id="key" type="password" name="key" autocomplete="off"><input type="hidden" name="next" value="${next}"><button class="btn" type="submit">Sign in</button></form></div>
</div>`, "public"));
  });

  r.post("/login", async (req, res) => {
    const v = req.body.as && config.demoMode ? String(req.body.as) : req.body.key ? await keyLogin(String(req.body.key)) : null;
    if (!v) return back(res, "/login", "That key is not valid.", true);
    signIn(res, v);
    const next = String(req.body.next ?? "");
    res.redirect(next.startsWith("/") && !next.startsWith("//") ? next : v.startsWith("mer:") ? "/merchant" : "/today");
  });
  r.post("/logout", (_req, res) => {
    signOut(res);
    res.redirect("/");
  });

  // ---------- Today ----------
  r.get("/today", shopper(async (req, res, a) => {
    const db = await getDb();
    const items = await today(db, a);
    const cal = await calendar(db, a);
    const sp = await spending(db, a);
    const inbox = (await db.query<any>("SELECT * FROM inbox WHERE account_id = $1 AND channel = 'app' ORDER BY id DESC LIMIT 5", [a.id])).rows;
    const held = (await pendingApprovals(a.id)).slice(0, 4);
    const KIND: Record<string, [string, string]> = { question: ["sparkles", ""], approve: ["checkCircle", ""], gap: ["alert", "muted"], payment: ["wallet", ""], risk: ["truck", "bad"], delivery: ["package", ""], case: ["receipt", ""], return: ["undo", ""], warranty: ["shield", "muted"], recall: ["alert", "bad"], price: ["chart", ""] };
    const first = a.name.split(" ")[0];
    res.send(page(req, a, "Today", html`<div class="page-head"><div><h1>Hi ${first}</h1><p>${items.length || held.length ? `${items.length + held.length} thing${items.length + held.length === 1 ? "" : "s"} could use you today.` : "Nothing needs you today."} Share something you like in Discover any time.</p></div><a class="btn primary" href="/discover">${raw(icon("camera"))}Share something</a></div>
<div class="kpis"><div class="kpi"><div class="label">Left this month</div><div class="value">${money(sp.left_cents)}</div><div class="hint">of your ${money(sp.limit_cents)} limit · ${sp.note}</div></div><div class="kpi"><div class="label">Spent</div><div class="value">${money(sp.spent_cents)}</div><div class="hint">${sp.reserved_cents ? `${money(sp.reserved_cents)} not paid yet` : "net of refunds"}</div></div><div class="kpi"><div class="label">Needs you</div><div class="value">${items.length + held.length}</div><div class="hint">${held.length ? `${held.length} payment${held.length === 1 ? "" : "s"} paused for you` : "plans, deliveries and returns"}</div></div></div>
${held.length ? html`<div class="section-title"><h2>Paused for you</h2><p>Payments Everyday stopped before they happened. Nothing has been charged.</p></div>${held.map((h: any) => approvalCard(h, "/guard", "/today"))}` : ""}
<div class="section-title"><h2>Needs attention</h2><p>Most urgent first.</p></div>
${items.length ? html`<div class="rows" style="margin-bottom:1.5rem">${items.map((i) => { const [ic, tone] = KIND[i.kind] ?? ["sparkles", ""]; return html`<a class="r" href="${i.href}"><span class="av ${tone === "muted" ? "muted" : ""}" style="${tone === "bad" ? "background:var(--ui-destructive-bg);color:var(--ui-destructive)" : ""}">${raw(icon(ic))}</span><span><div class="t">${i.title}</div><div class="s">${i.detail}</div></span><span class="m">${i.when ?? ""}</span><span class="act">${raw(icon("arrowRight"))}</span></a>`; })}</div>` : html`<div class="empty" style="margin-bottom:1.5rem">All clear. Share something you like in Discover.</div>`}
<div class="grid g2">
<section class="card"><h2>Coming up</h2>${cal.length ? html`<div class="stack">${cal.map((c) => html`<div class="spread"><a href="${c.href}">${c.what}</a><span class="small muted num">${c.date}</span></div>`)}</div>` : html`<p class="muted">Nothing dated yet.</p>`}</section>
<section class="card"><h2>Messages</h2>${inbox.length ? html`<div class="stack">${inbox.map((m) => html`<div>${messageFlag(String(m.text), "Everyday only pays through PayPal checkout; nothing in a message changes that.")}<p style="margin:0">${m.text}</p></div>`)}</div>` : html`<p class="muted">No messages.</p>`}</section>
</div>`));
  }));

  // ---------- Discover ----------
  r.get("/discover", shopper(async (req, res, a) => {
    const db = await getDb();
    const caps = (await db.query<any>("SELECT * FROM captures WHERE account_id = $1 ORDER BY created_at DESC", [a.id])).rows;
    const cat = await catalog(db);
    const qtext = String(req.query.q ?? "").trim();
    const results = qtext ? cat.index.fused(qtext, 12).map((x) => cat.byId.get(x.id)!).filter(Boolean) : [];
    const watches = (await db.query<any>("SELECT w.*, p.title, p.price_cents FROM price_watches w JOIN products p ON p.id = w.product_id WHERE w.account_id = $1", [a.id])).rows;
    res.send(page(req, a, "Discover", html`<h1>Discover</h1>
<section class="card"><h2>Share something</h2><form method="post" action="/discover/capture" enctype="multipart/form-data" class="stack"><div class="field"><label for="url">Reel, TikTok, Short or product link</label><input id="url" type="url" name="url" placeholder="https://youtube.com/shorts/…"></div><div class="field"><label for="shot">Or a screenshot</label><input id="shot" type="file" name="shot" accept="image/*"></div><div class="field"><label for="txt">Or describe it</label><input id="txt" type="text" name="text" placeholder="a warm oak desk lamp"></div><button class="btn primary" type="submit">Save</button></form>
<p class="small muted">Demo clips: <code>https://youtube.com/shorts/dSk7Setup01</code> · <code>https://www.instagram.com/reel/Cz9DeskReel/</code> · <code>https://www.tiktok.com/@deskdays/video/7300000000000000001</code></p></section>
<section class="card"><h2>Search</h2><form method="get" action="/discover" class="row"><label class="sr" for="q">Search</label><input id="q" type="text" name="q" value="${qtext}" placeholder="model number, kind or description"><button class="btn small" type="submit">Search</button></form>
${results.length ? html`<div class="table-wrap"><table><tbody>${results.map((p) => html`<tr><td><b>${p.title}</b><br><span class="small muted">${p.model} · ${p.merchant_label}</span></td><td class="num">${money(p.price_cents)}</td><td>${p.checkout ? html`<form method="post" action="/discover/watch" class="row"><input type="hidden" name="product" value="${p.id}"><label class="sr" for="w-${p.id}">Target</label><input id="w-${p.id}" type="number" step="1" min="1" name="target" placeholder="target $" style="width:6rem"><button class="btn small" type="submit">Watch price</button></form>` : html`<span class="flag">${p.merchant_label}</span>`}</td></tr>`)}</tbody></table></div>` : qtext ? html`<p class="muted">No matches.</p>` : ""}</section>
${watches.length ? html`<section class="card"><h2>Price watches</h2><ul>${watches.map((w) => html`<li>${w.title}: target ${money(w.target_cents)}, now ${money(w.price_cents)} ${pill(w.status === "fired" ? "resolved" : "current", w.status)}</li>`)}</ul></section>` : ""}
<section class="card"><h2>Saved</h2>${caps.length ? html`<ul>${caps.map((c) => html`<li><a href="/captures/${c.id}">${c.title || c.url}</a> ${pill(c.status, c.status.replace("_", " "))} <span class="small muted">via ${c.channel} · ${c.platform}</span></li>`)}</ul>` : html`<p class="muted">Nothing saved yet.</p>`}</section>`));
  }));

  r.post("/discover/capture", shopper(async (req, res, a) => {
    const { fields, files } = await readForm(req);
    const shot = files.shot?.[0] ?? null;
    if (!fields.url && !fields.text && !shot) throw new GtError("Paste a link, add a screenshot or describe it.", "invalid");
    const c = await capture(a, { url: fields.url || undefined, text: fields.text, channel: "app", image: shot ? { mime: shot.mime, body: shot.body } : null });
    back(res, `/captures/${c.id}`, c.reused ? "Already in your library." : "Saved.");
  }, true));

  r.post("/discover/watch", shopper(async (req, res, a) => {
    await watchPrice(a, String(req.body.product), Math.round(Number(req.body.target) * 100));
    back(res, "/discover", "Watching. You'll hear only when the merchant's recorded price reaches your target.");
  }, true));

  r.get("/captures/:id", shopper(async (req, res, a) => {
    const db = await getDb();
    const c = (await db.query<any>("SELECT * FROM captures WHERE id = $1 AND account_id = $2", [req.params.id, a.id])).rows[0];
    if (!c) return res.status(404).send("Not found");
    const objects = J<any[]>(c.objects);
    const intents = (await db.query<any>("SELECT * FROM intents WHERE capture_id = $1 ORDER BY created_at DESC", [c.id])).rows;
    res.send(page(req, a, c.title || "Capture", html`<p><a href="/discover">← Discover</a></p><h1>${c.title || c.url}</h1><p class="small"><a href="${c.url}" rel="noopener nofollow">${c.url}</a> · ${c.platform} · saved via ${c.channel}</p>
<p class="banner info">${pill(c.status, c.status.replace("_", " "))} ${BASIS[c.status] ?? c.basis}</p>
${objects.length ? html`<section class="card"><h2>Which item do you mean?</h2><form method="post" action="/captures/${c.id}/select" class="objects">${objects.map((o) => html`<button type="submit" name="key" value="${o.key}" class="${c.selected === o.key ? "on" : ""}">${o.label}</button>`)}</form></section>` : ""}
<section class="card"><h2>What would you like to do?</h2><form method="post" action="/plans" class="stack"><input type="hidden" name="capture_id" value="${c.id}"><div class="field"><label for="goal">Your goal</label><input id="goal" type="text" name="text" required placeholder="Help me create this setup by Friday for $350. I already own a monitor."></div><button class="btn primary" type="submit" ${objects.length && !c.selected ? "disabled" : ""}>Plan it</button>${objects.length && !c.selected ? html`<span class="small muted">Pick an item first.</span>` : ""}</form></section>
${intents.length ? html`<section class="card"><h2>Plans from this</h2><ul>${intents.map((i) => html`<li><a href="/plans/${i.id}">${i.text}</a> ${pill(i.status)}</li>`)}</ul></section>` : ""}`));
  }));

  r.post("/captures/:id/select", shopper(async (req, res, a) => {
    const o = await selectObject(a, req.params.id, String(req.body.key));
    back(res, `/captures/${req.params.id}`, `Selected: ${o.label}.`);
  }, true));

  // ---------- Plans ----------
  r.get("/plans", shopper(async (req, res, a) => {
    const db = await getDb();
    const rows = (await db.query<any>("SELECT i.*, r.name AS recipient FROM intents i JOIN recipients r ON r.id = i.recipient_id WHERE i.account_id = $1 ORDER BY i.created_at DESC", [a.id])).rows;
    const recipients = (await db.query<any>("SELECT * FROM recipients WHERE account_id = $1 ORDER BY is_self DESC", [a.id])).rows;
    res.send(page(req, a, "Plans", html`<h1>Plans</h1><section class="card"><h2>New plan</h2><form method="post" action="/plans" class="stack"><div class="field"><label for="t">What do you need?</label><input id="t" type="text" name="text" required placeholder="A quiet keyboard under $60 by Thursday"></div><div class="field"><label for="rc">For</label><select id="rc" name="recipient_id">${recipients.map((x) => html`<option value="${x.id}">${x.is_self ? "Me" : `${x.name} (${x.relation}) — gift; won't change your own taste`}</option>`)}</select></div><button class="btn primary" type="submit">Plan it</button></form></section>
<section class="card"><h2>Your plans</h2>${rows.length ? html`<ul>${rows.map((i) => html`<li><a href="/plans/${i.id}">${i.text}</a> ${pill(i.status)} <span class="small muted">for ${i.recipient} · via ${i.channel}</span></li>`)}</ul>` : html`<p class="muted">No plans yet.</p>`}</section>`));
  }));

  r.post("/plans", shopper(async (req, res, a) => {
    const id = await createIntent(a, { text: String(req.body.text ?? ""), capture_id: req.body.capture_id || null, recipient_id: req.body.recipient_id || null, channel: "app" });
    res.redirect(`/plans/${id}`);
  }, true));

  r.get("/plans/:id", shopper(async (req, res, a) => {
    const db = await getDb();
    const i = await intentRow(db, a, req.params.id);
    const p = await currentPlan(db, i.id);
    const b = p?.body;
    const open = p?.status === "current" && i.status === "planning";
    const pairs = open && b && !b.questions.length ? await tastePairs(db, a, i.id, 1) : [];
    const answered = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pref_events WHERE intent_id = $1", [i.id])).rows[0].n;
    const quote = (await db.query<any>("SELECT * FROM quotes WHERE plan_id = $1 AND status = 'open' AND expires_at > now() ORDER BY created_at DESC LIMIT 1", [p?.id ?? ""])).rows[0];
    const order = (await db.query<any>("SELECT * FROM orders WHERE intent_id = $1 ORDER BY created_at DESC LIMIT 1", [i.id])).rows[0];
    const recipient = (await db.query<any>("SELECT * FROM recipients WHERE id = $1", [i.recipient_id])).rows[0];
    res.send(page(req, a, "Plan", html`<p><a href="/plans">← Plans</a></p><h1>${i.text}</h1>
<p class="muted">For ${recipient.is_self ? "you" : `${recipient.name} (gift: your own taste is not changed)`}${i.budget_cents ? ` · budget ${money(i.budget_cents)}` : ""}${i.deadline ? ` · by ${i.deadline}` : ""} · plan v${p?.version ?? "—"} ${pill(i.status)}</p>
${b?.note ? html`<p class="banner good">${b.note}</p>` : ""}
${b?.avoided?.length ? html`<p class="banner info">${b.avoided.join(" ")} Everyday won't suggest another.</p>` : ""}
${b?.questions.length ? html`<section class="card"><h2>One question</h2>${b.questions.map((qn: any) => html`<form method="post" action="/plans/${i.id}/answer" class="stack"><input type="hidden" name="key" value="${qn.key}"><p><b>${qn.text}</b></p>${qn.why ? html`<p class="small muted">${qn.why}</p>` : ""}<div class="objects">${qn.choices.map((c: any) => html`<button type="submit" name="value" value="${c.value}">${c.label}</button>`)}</div></form>`)}</section>` : ""}
${pairs.length ? html`<section class="card"><h2>Quick taste check <span class="muted small">(${answered} answered · optional)</span></h2><p class="small muted">Pick the one you'd rather have. Each choice is a real training step for your personal model; "too expensive" only teaches price.</p>${pairs.map(([x, y]) => html`<form method="post" action="/plans/${i.id}/choose"><input type="hidden" name="a" value="${x.id}"><input type="hidden" name="b" value="${y.id}"><div class="pair"><button class="opt" name="chosen" value="a" type="submit"><b>${x.title}</b><br><span class="small">${money(x.price_cents)} · ${[...new Set([x.attrs.finish, x.attrs.material].filter(Boolean))].join(" ")} · ${(x.attrs.style ?? []).join(", ")}</span></button><span class="or">or</span><button class="opt" name="chosen" value="b" type="submit"><b>${y.title}</b><br><span class="small">${money(y.price_cents)} · ${[...new Set([y.attrs.finish, y.attrs.material].filter(Boolean))].join(" ")} · ${(y.attrs.style ?? []).join(", ")}</span></button></div><div class="row small"><button class="btn small" name="reason" value="too_expensive" type="submit">Both too expensive</button><button class="btn small" name="reason" value="already_own" type="submit">I already own one</button></div></form>`)}</section>` : ""}
${b ? html`<section class="card"><h2>The plan</h2>${(b.slots as SlotView[]).map((s) => slotCard(s, i.id, open))}
${b.feasible ? html`<dl class="kv2"><dt>Items</dt><dd>${money(b.items_cents)}</dd><dt>Shipping (${b.shipping})</dt><dd>${b.shipping_cents ? money(b.shipping_cents) : "free"}</dd><dt><b>Total</b></dt><dd><b>${money(b.total_cents)}</b>${b.budget_cents ? ` of ${money(b.budget_cents)}` : ""}</dd><dt>Arrives</dt><dd>${b.arrival ?? "—"}${b.deadline ? ` (deadline ${b.deadline})` : ""}</dd><dt>Searched</dt><dd>${b.considered} complete bundles</dd></dl>` : html`<p class="banner warn">${b.gap}</p>`}
${open && b.feasible && !b.questions.length ? html`<form method="post" action="/plans/${i.id}/quote"><button class="btn primary" type="submit">Get an exact quote</button></form>` : ""}</section>` : ""}
${quote ? html`<section class="card" id="quote"><h2>Exact quote from ${J<any>(quote.body).merchant.name}</h2><div class="table-wrap"><table><tbody>${J<any>(quote.body).lines.map((l: any) => html`<tr><td>${l.title} <span class="small muted">${l.sku}</span></td><td class="num">${l.qty} × ${money(l.unit_cents)}</td><td class="small">arrives ${l.eta}</td></tr>`)}<tr><td>Shipping (${J<any>(quote.body).shipping.method})</td><td class="num">${money(J<any>(quote.body).shipping.cents)}</td><td></td></tr><tr><td><b>Total</b></td><td class="num"><b>${money(quote.total_cents)}</b></td><td></td></tr></tbody></table></div>
<p class="small">Ships to ${J<any>(quote.body).address} · returns policy ${J<any>(quote.body).return_policy} · payee: ${J<any>(quote.body).merchant.payee} · expires ${new Date(quote.expires_at).toISOString().slice(11, 16)} UTC</p><p class="hash">${quote.hash}</p>
<form method="post" action="/quotes/${quote.id}/approve"><input type="hidden" name="hash" value="${quote.hash}"><button class="btn primary" type="submit">Approve ${money(quote.total_cents)} and pay with PayPal</button></form></section>` : ""}
${order ? html`<p class="banner info">Ordered: <a href="/orders/${order.id}">${order.number}</a> ${pill(order.status)}</p>` : ""}`));
  }));

  r.post("/plans/:id/answer", shopper(async (req, res, a) => {
    await answer(a, req.params.id, String(req.body.key), String(req.body.value ?? ""));
    back(res, `/plans/${req.params.id}`, "Plan updated.");
  }, true));

  r.post("/plans/:id/choose", shopper(async (req, res, a) => {
    const reason = ["too_expensive", "already_own", "wrong_recipient"].includes(req.body.reason) ? req.body.reason : "style";
    const out = await choose(a, req.params.id, String(req.body.a), String(req.body.b), reason === "style" ? (req.body.chosen === "b" ? "b" : "a") : reason === "too_expensive" ? (req.body.chosen === "b" ? "b" : "a") : null, reason);
    back(res, `/plans/${req.params.id}`, out.excluded ? `Noted (not used for learning: ${out.excluded}).` : out.changed ? "Your plan changed. See why at the top." : "Learned. Your plan already fits.");
  }, true));

  r.post("/plans/:id/quote", shopper(async (req, res, a) => {
    await quotePlan(a, req.params.id);
    res.redirect(`/plans/${req.params.id}#quote`);
  }, true));

  r.post("/quotes/:id/approve", shopper(async (req, res, a) => {
    const url = await approveQuote(a, req.params.id, String(req.body.hash ?? ""));
    res.redirect(url);
  }, true));

  // ---------- Purchases ----------
  r.get("/purchases", shopper(async (req, res, a) => {
    const db = await getDb();
    const orders = (await db.query<any>("SELECT * FROM orders WHERE account_id = $1 ORDER BY created_at DESC", [a.id])).rows;
    res.send(page(req, a, "Purchases", html`<h1>Purchases</h1><section class="card">${orders.length ? html`<div class="table-wrap"><table><thead><tr><th>Order</th><th>Status</th><th class="num">Paid</th><th class="num">Refunded</th></tr></thead><tbody>${orders.map((o) => html`<tr><td><a href="/orders/${o.id}">${o.number}</a></td><td>${pill(o.status, o.status === "created" ? "awaiting payment" : undefined)}${o.repaired ? html` <span class="flag good">repaired from PayPal</span>` : ""}</td><td class="num">${o.status === "created" ? html`<span class="muted">not paid · ${money(o.total_cents)} due</span>` : money(o.gross_cents ?? o.total_cents)}</td><td class="num">${o.refunded_cents ? money(o.refunded_cents) : ""}</td></tr>`)}</tbody></table></div>` : html`<p class="muted">No purchases yet.</p>`}</section>`));
  }));

  r.get("/orders/:id", shopper(async (req, res, a) => {
    const db = await getDb();
    const o = (await db.query<any>("SELECT * FROM orders WHERE id = $1 AND account_id = $2", [req.params.id, a.id])).rows[0];
    if (!o) return res.status(404).send("Not found");
    const lines = (await db.query<any>("SELECT * FROM order_lines WHERE order_id = $1 ORDER BY status = 'swapped'", [o.id])).rows;
    const ops = (await db.query<any>("SELECT * FROM payment_ops WHERE order_id = $1 ORDER BY created_at", [o.id])).rows;
    const cases = (await db.query<any>("SELECT * FROM cases WHERE order_id = $1 ORDER BY created_at", [o.id])).rows;
    const events = (await db.query<any>("SELECT * FROM events WHERE entity_id = $1 ORDER BY id DESC", [o.id])).rows;
    const i = (await db.query<any>("SELECT * FROM intents WHERE id = $1", [o.intent_id])).rows[0];
    const prot = new Map((await protectionsFor(db, a)).filter((x) => x.order_id === o.id).map((x) => [x.line_id, x]));
    res.send(page(req, a, o.number, html`<p><a href="/purchases">← Purchases</a> · <a href="/plans/${o.intent_id}">plan</a></p><h1>${o.number} ${pill(o.status, o.status === "created" ? "awaiting payment" : undefined)}</h1>
${o.status === "created" ? html`${(await pendingApprovals(a.id)).filter((x: any) => x.payload?.entity_id === o.id).map((x: any) => approvalCard(x, "/guard", `/orders/${o.id}`))}<p class="banner warn">${o.paypal_order_id ? "Not paid yet. A PayPal checkout was started but not approved. If you closed the PayPal window, pay again below; if you did approve it, this page updates within a minute once PayPal confirms." : "Not paid yet."}</p><form method="post" action="/orders/${o.id}/pay"><button class="btn primary" type="submit">Pay ${money(o.total_cents)} with PayPal</button></form>` : ""}
<section class="card"><h2>Items</h2>${lines.map((l) => {
  const offer = J<any>(l.swap_offer);
  return html`<div class="slot"><div class="pick"><div><b>${l.title}</b> ${pill(l.status)}<br><span class="small muted">${l.eta ? `ETA ${l.eta}` : ""}${l.delivered_at ? ` · delivered ${l.delivered_at.replace("T", " ")}` : ""}${i.deadline && l.eta && l.eta > i.deadline && l.status !== "delivered" ? ` · after your ${i.deadline} deadline` : ""}</span></div><div class="price">${money(l.unit_cents)}</div></div>
${prot.get(l.id) ? (() => {
  const pr = prot.get(l.id)!;
  return pr.eligible
    ? html`<div class="banner good"><b>Price protection:</b> Northlight now charges ${money(pr.now_cents)}; you paid ${money(pr.protected_unit_cents)}. ${pr.policy_version} says: <i>${pr.clause}</i> <span class="small">(${pr.evidence})</span><form method="post" action="/lines/${l.id}/price-protection" class="inline"><button class="btn primary small" type="submit">Ask for ${money(pr.amount_cents)} back</button></form><br><span class="small muted">Northlight approves it; the refund goes back on your original PayPal payment and counts once PayPal confirms it.</span></div>`
    : html`<p class="small muted">Now ${money(pr.now_cents)}, but price protection doesn't apply: ${pr.reasons.join(" ")}</p>`;
})() : ""}
${l.status === "backordered" && offer ? html`<div class="banner warn">In stock instead: <b>${offer.title}</b> (${money(offer.price_cents)}, arrives ${offer.eta})${offer.diff_cents ? `; ${money(offer.diff_cents)} back to your PayPal` : ""}. Same requirements checked (comfort, compatibility).<form method="post" action="/lines/${l.id}/swap" class="inline"><button class="btn primary small" type="submit">Swap it</button></form></div>` : ""}
${l.status === "delivered" ? html`<details><summary>Problem with this item?</summary><form method="post" action="/lines/${l.id}/case" class="stack"><div class="field"><label for="is-${l.id}">What happened</label><select id="is-${l.id}" name="issue"><option value="damaged">Arrived damaged</option><option value="wrong">Wrong item</option><option value="defective">Stopped working</option><option value="change_of_mind">Changed my mind</option></select></div><div class="field"><label for="cl-${l.id}">Tell us</label><input id="cl-${l.id}" type="text" name="claim" required></div><label class="check"><input type="checkbox" name="photo" value="1"> I have a photo</label><button class="btn small" type="submit">Open a case</button></form></details>` : ""}</div>`;
})}<dl class="kv2"><dt>Paid</dt><dd>${money(o.gross_cents)}${o.fee_cents !== null ? html` <span class="small muted">(merchant fee ${money(o.fee_cents)})</span>` : ""}</dd><dt>Refunded</dt><dd>${money(o.refunded_cents)}</dd><dt>Net</dt><dd>${money((o.gross_cents ?? 0) - o.refunded_cents)}</dd><dt>PayPal</dt><dd class="small">${o.paypal_order_id ?? "—"} / ${o.capture_id ?? "—"}</dd></dl></section>
${cases.length ? html`<section class="card" id="cases"><h2>Cases</h2>${cases.map((c) => {
  const el = J<any>(c.eligibility);
  return html`<div class="slot"><b>${c.number}</b> ${pill(c.status)} ${c.issue.replace(/_/g, " ")}<p>${c.claim}</p><p class="small"><b>Observed:</b> ${J<string[]>(c.observations).join(" ")}</p>${J<any[]>(c.missing).length ? html`<p class="small"><b>Needed:</b> ${J<any[]>(c.missing).map((m) => m.question).join(" ")}</p>` : ""}<p class="small"><b>${c.issue === "price_drop" ? "Price protection" : "Return eligibility"}:</b> ${el?.eligible ? `yes${el.until ? `, until ${String(el.until).slice(0, 10)}` : ""}` : "no"} — ${(el?.reasons ?? []).join(" ")}</p>
${c.status === "choose" ? html`<form method="post" action="/cases/${c.id}/remedy" class="row">${J<any[]>(c.options).map((op) => html`<button class="btn small" name="key" value="${op.key}" type="submit">${op.label}</button>`)}</form>` : ""}
${c.requested ? html`<p class="small">Requested: ${c.requested} · merchant: ${c.merchant_decision ? (J<any>(c.merchant_decision).approve ? "approved" : "declined") : "reviewing"}${c.refund_cents ? ` · refund ${money(c.refund_cents)}` : ""}${c.status === "resolved" && c.refund_cents ? " · confirmed by PayPal" : ""}</p>` : ""}</div>`;
})}</section>` : ""}
<section class="card"><h2>Payment record</h2><div class="table-wrap"><table><thead><tr><th>Action</th><th class="num">Amount</th><th>Status</th><th>PayPal</th><th>Request id</th></tr></thead><tbody>${ops.map((x) => html`<tr><td>${x.kind}${x.reason ? html`<br><span class="small">${x.reason}</span>` : ""}${x.status === "failed" && x.error ? html`<br><span class="small muted">${String(x.error).slice(0, 160)}</span>` : ""}</td><td class="num">${money(x.amount_cents)}</td><td>${pill(x.status)} ${x.paypal_status ?? ""}</td><td class="small">${x.paypal_id ?? ""}</td><td class="small mono">${x.request_id}</td></tr>`)}</tbody></table></div></section>
<section class="card"><h2>What happened</h2><ul>${events.map((e) => html`<li><span class="small muted">${e.wall ? fmtWall(e.wall) : ""}</span> ${e.summary} <span class="small muted">· ${e.actor}</span></li>`)}</ul></section>`));
  }));

  r.post("/orders/:id/pay", shopper(async (req, res, a) => {
    res.redirect(await checkoutLink(a, req.params.id));
  }, true));

  r.get("/orders/:id/paypal/return", shopper(async (req, res, a) => {
    const out = await paypalReturn(a, req.params.id, String(req.query.token ?? ""));
    back(res, `/orders/${req.params.id}`, out === "paid" ? "Paid and confirmed with PayPal." : out === "failed" ? "PayPal refused the payment; nothing was charged. Pay again and choose another way to pay." : "Thanks — confirming with PayPal.");
  }, true));

  r.post("/lines/:id/swap", shopper(async (req, res, a) => {
    const offer = await acceptSwap(a, req.params.id);
    back(res, req.get("referer")?.split("?")[0] ?? "/purchases", `Swapped to ${offer.title}${offer.diff_cents ? `; ${money(offer.diff_cents)} refunded to your PayPal` : ""}.`);
  }, true));

  r.post("/lines/:id/price-protection", shopper(async (req, res, a) => {
    const c = await claimPriceProtection(a, req.params.id);
    back(res, (req.get("referer")?.split("?")[0] ?? "/purchases") + "#cases", `${c.number}: asked Northlight for ${money(c.amount_cents)}. You'll see it here once they approve and PayPal confirms.`);
  }, true));

  r.post("/lines/:id/case", shopper(async (req, res, a) => {
    await openCase(a, req.params.id, req.body.issue, String(req.body.claim ?? ""), req.body.photo === "1");
    back(res, (req.get("referer")?.split("?")[0] ?? "/purchases") + "#cases", "Case opened. Choose a remedy below.");
  }, true));

  r.post("/cases/:id/remedy", shopper(async (req, res, a) => {
    await requestRemedy(a, req.params.id, String(req.body.key));
    back(res, (req.get("referer")?.split("?")[0] ?? "/purchases") + "#cases", "Sent to the merchant.");
  }, true));

  // ---------- You ----------
  r.get("/you", shopper(async (req, res, a) => {
    const db = await getDb();
    const items = await owned(db, a);
    const recalls = await recallsFor(db, a);
    const recipients = (await db.query<any>("SELECT * FROM recipients WHERE account_id = $1 ORDER BY is_self DESC", [a.id])).rows;
    const linked = (await db.query<any>("SELECT * FROM channel_links WHERE account_id = $1", [a.id])).rows;
    const facts = (await db.query<any>("SELECT * FROM profile_facts WHERE account_id = $1 ORDER BY created_at DESC", [a.id])).rows;
    const panels: Raw[] = [];
    const byId = (await catalog(db)).byId;
    for (const r0 of recipients) {
      const m = await modelFor(db, r0.id);
      const why = whyPanel(m.weights, m.prior);
      const receipts = await choiceReceipts(db, r0.id, byId);
      panels.push(html`<div class="slot"><b>${r0.is_self ? "You" : `${r0.name} (${r0.relation})`}</b> <span class="small muted">model v${m.version}</span>${why.length ? html`<ul>${why.map((w) => html`<li>${w.text} <form method="post" action="/you/forget" class="inline"><input type="hidden" name="recipient" value="${r0.id}"><input type="hidden" name="feature" value="${w.feature}"><button class="btn small" type="submit">Forget</button></form></li>`)}</ul>` : html`<p class="small muted">Nothing personal learned yet: recommendations use the general model.</p>`}<form method="post" action="/you/delete-memory" class="inline"><input type="hidden" name="recipient" value="${r0.id}"><button class="btn small danger" type="submit">Delete all preference memory</button></form>${receipts.length ? html`<details style="margin-top:8px"><summary class="small">Recent choices and what each changed</summary><ul class="small">${receipts.map((x) => html`<li>${x.chosen ? html`Chose <b>${x.chosen}</b> over ${x.other}` : "No choice"} (${x.reason.replace(/_/g, " ")}): ${x.undone ? "undone" : x.used ? (x.changed.length ? x.changed.join("; ") : "no visible change") : html`not used (${x.why_not})`}${x.used ? html` <form method="post" action="/you/undo" class="inline"><input type="hidden" name="event" value="${x.id}"><button class="btn small" type="submit">Undo</button></form>` : ""}</li>`)}</ul></details>` : ""}</div>`);
    }
    res.send(page(req, a, "You", html`<h1>You</h1>
<section class="card" id="owned"><h2>What you own</h2><div class="table-wrap"><table><thead><tr><th>Item</th><th>Details</th><th>Return by</th><th>Warranty</th><th></th></tr></thead><tbody>${items.map((o) => html`<tr><td><b>${o.title}</b> ${pill(o.status)}<br><span class="small muted">${o.source}</span></td><td class="small">${o.attrs.inputs ? `inputs ${o.attrs.inputs.join("/").toUpperCase()}` : ""}${o.attrs.vesa_mount ? ` · VESA ${o.attrs.vesa_mount}` : ""}${o.price_cents ? ` · ${money(o.price_cents)}` : ""} · since ${o.acquired}</td><td>${o.return_until ?? "—"}</td><td>${o.warranty_until ?? "—"}</td><td>${o.status === "owned" ? html`<form method="post" action="/you/owned/${o.id}/advice" class="row"><label class="sr" for="rq-${o.id}">Repair quote</label><input id="rq-${o.id}" type="number" name="quote" placeholder="repair $" style="width:6rem"><button class="btn small" type="submit">Repair or replace?</button></form><form method="post" action="/you/owned/${o.id}/status" class="row"><select name="status" aria-label="Mark as"><option value="sold">Sold</option><option value="given">Given away</option><option value="recycled">Recycled</option></select><button class="btn small" type="submit">Mark</button></form>` : ""}</td></tr>`)}</tbody></table></div>
${recalls.length ? html`<div class="banner bad">${recalls.map((r0) => html`<p><b>Recall:</b> ${r0.item.title}: ${r0.recall.title}. ${r0.recall.remedy}. <a href="${r0.recall.url}" rel="noopener">details</a></p>`)}</div>` : ""}
<details><summary>Add something you own</summary><form method="post" action="/you/owned" class="grid g3"><div class="field"><label for="ot">Name</label><input id="ot" name="title" required></div><div class="field"><label for="oc">Kind</label><select id="oc" name="category">${Object.entries(CATEGORY_LABEL).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></div><div class="field"><label for="ob">Brand / model</label><input id="ob" name="brand_model" placeholder="Dell P2422H"></div><div class="field"><label for="oi">Monitor inputs</label><input id="oi" name="inputs" placeholder="hdmi, dp"></div><div class="field"><label for="ov">VESA</label><input id="ov" type="number" name="vesa"></div><div class="field"><label for="op">Price ($)</label><input id="op" type="number" name="price"></div><button class="btn" type="submit">Add</button></form></details></section>
<section class="card"><h2>Why you see what you see</h2><p class="small muted">What Everyday has learned from your explicit choices, compared with the general model. Gifts learn separately.</p>${panels}</section>
<section class="card"><h2>Spending limit</h2><form method="post" action="/you/limit" class="row"><label for="lim">Monthly limit ($)</label><input id="lim" type="number" name="limit" value="${a.monthly_limit_cents / 100}" style="width:8rem"><button class="btn small" type="submit">Save</button></form><p class="small muted">A stated allowance used to check purchases before approval; not a bank balance.</p></section>
<section class="card" id="phone"><h2>Everyday on your phone</h2><p class="small muted">Share Reels straight from Telegram, and get approvals, delays and price drops there with buttons.</p><div class="row">${linked.length ? html`<span class="pill good">Telegram connected</span>` : html`<span class="pill">Telegram not connected</span>`}<form method="post" action="/connect/telegram" class="inline" target="_blank"><button class="btn ${linked.length ? "" : "primary"}" type="submit">${raw(icon("message"))}${linked.length ? "Connect another chat" : "Connect Telegram"}</button></form><button class="btn" type="button" id="push-sub">${raw(icon("zap"))}Notifications in this browser</button></div><p class="small muted">Telegram opens with a one-time code that lasts 15 minutes: press Start and you're done.</p></section>
${facts.length ? html`<section class="card"><h2>Facts Everyday keeps</h2><ul>${facts.map((f) => html`<li>${f.key.replace("_", " ")}: ${f.value} <span class="small muted">(${f.source})</span></li>`)}</ul></section>` : ""}`));
  }));

  r.post("/you/owned", shopper(async (req, res, a) => {
    const [brand, ...model] = String(req.body.brand_model ?? "").trim().split(/\s+/);
    await addOwned(a, { title: String(req.body.title ?? ""), category: String(req.body.category ?? ""), brand: brand ?? "", model: model.join(" "), inputs: String(req.body.inputs ?? "").split(/[,\s]+/).map((x) => x.toLowerCase()).filter((x) => ["hdmi", "dp", "usb-c"].includes(x)), vesa: req.body.vesa ? Number(req.body.vesa) : null, price_cents: req.body.price ? Math.round(Number(req.body.price) * 100) : null, acquired: nowIso(a).slice(0, 10) });
    back(res, "/you#owned", "Added. Future plans will use it.");
  }, true));

  r.post("/you/owned/:id/status", shopper(async (req, res, a) => {
    await setOwnedStatus(a, req.params.id, req.body.status);
    back(res, "/you#owned", "Updated.");
  }, true));

  r.post("/you/owned/:id/advice", shopper(async (req, res, a) => {
    const out = await repairAdvice(a, req.params.id, req.body.quote ? Math.round(Number(req.body.quote) * 100) : null);
    back(res, "/you#owned", `${out.decision.replace("_", " ").toUpperCase()}: ${out.reasons.join(" ")}`);
  }, true));

  r.post("/you/undo", shopper(async (req, res, a) => {
    const db = await getDb();
    await undoChoice(db, a, Number(req.body.event), (await catalog(db)).byId);
    back(res, "/you", "Undone. Your taste model was rebuilt from your other choices.");
  }, true));
  r.post("/you/forget", shopper(async (req, res, a) => {
    const db = await getDb();
    await forgetFeature(db, a, String(req.body.recipient), String(req.body.feature));
    back(res, "/you", "Forgotten.");
  }, true));

  r.post("/you/delete-memory", shopper(async (req, res, a) => {
    const db = await getDb();
    const own = (await db.query("SELECT 1 FROM recipients WHERE id = $1 AND account_id = $2", [req.body.recipient, a.id])).rows.length;
    if (!own) throw new GtError("Not found", "not_found", 404);
    await deleteMemory(db, a, String(req.body.recipient));
    back(res, "/you", "Preference memory deleted.");
  }, true));

  r.post("/you/limit", shopper(async (req, res, a) => {
    const v = Math.round(Number(req.body.limit) * 100);
    if (!(v >= 0 && v <= 10_000_000)) throw new GtError("Enter a limit in dollars.", "invalid");
    await (await getDb()).query("UPDATE accounts SET monthly_limit_cents = $2 WHERE id = $1", [a.id, v]);
    back(res, "/you", "Saved.");
  }, true));

  r.post("/you/telegram", shopper(async (_req, res, a) => {
    const code = await linkCode(a);
    res.redirect(`/you?code=${code}`);
  }, true));
  /** One tap: a 15-minute one-time code, then straight into Telegram; the shared bot routes "everyday-<code>" here. */
  r.post("/connect/telegram", async (req, res, next) => {
    try {
      const w = await whoami(req);
      if (w?.account) return res.redirect(303, `https://t.me/${config.channels.telegramBot}?start=everyday-${await linkCode(w.account)}`);
      if (w?.merchant) {
        const code = `m${randomBytes(9).toString("hex")}`;
        await (await getDb()).query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`tglink:${code}`, JSON.stringify({ party: "merchant", exp: Date.now() + 15 * 60_000 })]);
        return res.redirect(303, `https://t.me/${config.channels.telegramBot}?start=everyday-${code}`);
      }
      res.redirect("/login?next=/you");
    } catch (e) {
      next(e);
    }
  });

  void raw;
  return r;
}
