/**
 * Purchase passport (shopper) and the merchant's money page (roadmap E3, E5): dollars recovered, saved PayPal and
 * repeat buys behind the gate, price watches and recalls; merchant tracking uploads, disputes with evidence packs,
 * transaction reconcile and sandbox negative tests.
 */
import { Router, type Request } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { fmtWall } from "../core/time.js";
import { GtError } from "../lib/util.js";
import { nowOf, type Account } from "../store.js";
import { catalog } from "../services/catalog.js";
import { recallsFor } from "../services/life.js";
import { acceptDispute, addTrackingForLine, evidencePack, finishVaultSetup, negativeTest, passportSummary, planRepeatBuy, reconcileTransactions, revokeVault, sendEvidence, startVaultSetup, syncDisputes, vaultStatus } from "../services/passport.js";
import { channel3Ready, searchProducts } from "../services/channel3.js";
import { merchant, shopper } from "./auth.js";
import { back, flashOf, json } from "./common.js";
import { fmtDate, html, layout, money, pill, raw, type Raw } from "./html.js";

const spage = (req: Request, a: Account, title: string, body: Raw) => layout({ title, area: "shopper", who: { name: a.name, clock: fmtWall(nowOf(a)) }, flash: flashOf(req) }, body);
const mpage = (req: Request, title: string, body: Raw) => layout({ title, area: "merchant", flash: flashOf(req) }, body);
const KIND: Record<string, string> = { price_protection: "Price protection", case_refund: "Case refunds", swap_difference: "Swap differences", recall_remedy: "Recall remedies" };

export function passportRoutes() {
  const r = Router();

  r.get("/passport", shopper(async (req, res, a) => {
    const db = await getDb();
    const [p, vault, recalls, cat] = await Promise.all([passportSummary(db, a), vaultStatus(db, a.id), recallsFor(db, a), catalog(db)]);
    const repeats = (await db.query<any>("SELECT r.*, p.title FROM repeat_buys r JOIN products p ON p.id = r.product_id WHERE r.account_id = $1 ORDER BY r.created_at DESC LIMIT 12", [a.id])).rows;
    const watches = (await db.query<any>("SELECT w.*, p.title, p.price_cents FROM price_watches w JOIN products p ON p.id = w.product_id WHERE w.account_id = $1", [a.id])).rows;
    const buyable = cat.products.filter((x) => x.checkout && x.stock > 0).slice(0, 40);
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 120) : "";
    const ext = q ? await searchProducts(q, db) : null;
    res.send(spage(req, a, "Passport", html`<h1>Purchase passport</h1><p class="sub">What you bought, what came back, and what runs on its own under your mandate.</p>
<div class="stats"><div><b>${money(p.spent)}</b><span>spent in the last year (seeded history)</span></div><div><b>${money(p.back)}</b><span>came back to you</span></div><div><b>${money(p.live.paid_live)}</b><span>paid in this sandbox</span></div><div><b>${money(p.live.refunded_live)}</b><span>refunded in this sandbox</span></div></div>
<div class="grid g2">
<section class="card"><h2>Dollars recovered</h2><p class="small muted">From the seeded year, labelled as such. Live refunds appear on each order.</p>
${p.recovered.length ? html`<table class="small"><thead><tr><th>How</th><th>Times</th><th class="num">Total</th></tr></thead><tbody>${raw(p.recovered.map((x: any) => `<tr><td>${KIND[x.kind] ?? x.kind}</td><td>${x.n}</td><td class="num">${money(x.cents)}</td></tr>`).join(""))}</tbody></table>` : html`<p class="muted">Nothing recovered yet.</p>`}
<h3>Spending by category</h3><table class="small"><tbody>${raw(p.byCategory.map(([c, cents]) => `<tr><td>${String(c).replace(/_/g, " ")}</td><td class="num">${money(Number(cents))}</td></tr>`).join(""))}</tbody></table></section>
<section class="card"><h2>Saved PayPal and repeat buys</h2>
${vault?.status === "active" ? html`<p>${pill("succeeded", "saved")} PayPal token …${String(vault.payment_token).slice(-4)}. Repeat buys run on it only inside your <a href="/guard">mandate</a>; at or above your threshold they wait for your tap.</p><form method="post" action="/passport/vault/revoke" class="inline"><button class="btn small">Remove saved PayPal</button></form>` : html`<p class="muted">No saved PayPal. Save one once (PayPal Vault, sandbox) to allow repeat buys within your limits.</p><form method="post" action="/passport/vault"><button class="btn primary">Save a PayPal for repeat buys</button></form>`}
<h3>Buy again</h3><form method="post" action="/passport/repeat" class="row"><label class="sr" for="rp">Product</label><select id="rp" name="product">${raw(buyable.map((x) => `<option value="${x.id}">${x.title.replace(/</g, "&lt;")} · ${money(x.price_cents)}</option>`).join(""))}</select><label class="sr" for="rq">Qty</label><input id="rq" type="number" name="qty" value="1" min="1" max="5" style="width:4rem"><button class="btn small" ${vault?.status === "active" ? "" : "disabled"}>Buy again now</button></form>
${repeats.length ? html`<table class="small"><thead><tr><th>When</th><th>What</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>${raw(repeats.map((x: any) => `<tr><td>${fmtDate(x.created_at)}</td><td>${x.qty} × ${String(x.title).replace(/</g, "&lt;")}</td><td class="num">${money(x.amount_cents)}</td><td>${pill(x.status).value}${x.status === "held" ? ` <a href="/guard#approvals">approve</a>` : ""}${x.order_id ? ` <a href="/orders/${x.order_id}">order</a>` : ""}</td></tr>`).join(""))}</tbody></table>` : ""}</section></div>
<div class="grid g2">
<section class="card"><h2>Price watches and recalls</h2>${watches.length ? html`<ul class="small">${raw(watches.map((w: any) => `<li>${String(w.title).replace(/</g, "&lt;")}: now ${money(w.price_cents)}, you want ${money(w.target_cents)} ${pill(w.status).value}</li>`).join(""))}</ul>` : html`<p class="muted small">No price watches. Set one from Discover.</p>`}
${recalls.length ? html`<h3>Recalls on what you own</h3><ul class="small">${raw(recalls.map((x: any) => `<li><b>${String(x.item.title).replace(/</g, "&lt;")}</b>: ${String(x.recall.title).replace(/</g, "&lt;")} · ${String(x.recall.remedy).replace(/</g, "&lt;")} <a href="${x.recall.url}" rel="noopener">source</a></li>`).join(""))}</ul>` : html`<p class="small muted">No recalls match what you own (demo recall feed).</p>`}</section>
<section class="card"><h2>Search the wider web</h2><p class="small muted">Channel3 ${channel3Ready() ? pill("live") : pill("not_configured", "no key: catalog only")}. Results are discovery only; buying stays with the merchant.</p>
<form method="get" action="/passport" class="row"><label class="sr" for="q3">Search</label><input id="q3" type="text" name="q" value="${q}" placeholder="oak desk lamp under $60"><button class="btn small">Search</button></form>
${ext ? html`<p class="small muted">${ext.note}</p>${ext.results.length ? html`<ul class="small">${raw(ext.results.map((x) => `<li><b>${x.title.replace(/</g, "&lt;")}</b>${x.brand ? ` · ${x.brand.replace(/</g, "&lt;")}` : ""}${x.price_cents !== null ? ` · ${money(x.price_cents)} ${x.currency}` : ""}${x.merchant ? ` · ${x.merchant.replace(/</g, "&lt;")}` : ""} <span class="flag">${x.source}</span>${x.url ? ` <a href="${x.url}" rel="noopener nofollow">view</a>` : ""}</li>`).join(""))}</ul>` : html`<p class="muted small">No results.</p>`}` : ""}</section></div>
<section class="card"><h2>The year, row by row</h2><details><summary class="small">Seeded purchase history (${p.hist.length})</summary><div class="table-wrap"><table class="small"><thead><tr><th>When</th><th>Category</th><th>Merchant</th><th class="num">Paid</th><th class="num">Back</th><th>Note</th></tr></thead><tbody>${raw(p.hist.map((h: any) => `<tr><td>${fmtDate(h.at, false)}</td><td>${String(h.category).replace(/_/g, " ")}</td><td>${h.merchant}</td><td class="num">${money(h.price_cents)}</td><td class="num">${h.refund_cents ? money(h.refund_cents) : ""}</td><td class="small">${String(h.note).replace(/</g, "&lt;")}${h.repeat ? " <span class='flag'>repeat</span>" : ""}</td></tr>`).join(""))}</tbody></table></div></details></section>`));
  }));

  r.post("/passport/vault", shopper(async (_req, res, a) => {
    res.redirect(await startVaultSetup(a));
  }, true));
  r.get("/passport/vault/return", shopper(async (req, res, a) => {
    const v = await finishVaultSetup(a, String(req.query.v ?? ""));
    back(res, "/passport", `PayPal saved (…${String(v.payment_token).slice(-4)}). Repeat buys run inside your mandate.`);
  }));
  r.post("/passport/vault/revoke", shopper(async (_req, res, a) => {
    await revokeVault(a);
    back(res, "/passport", "Saved PayPal removed.");
  }, true));
  r.post("/passport/repeat", shopper(async (req, res, a) => {
    const out = await planRepeatBuy(a, String(req.body.product ?? ""), Number(req.body.qty ?? 1), a.name, "shopper");
    back(res, "/passport", out.message, out.status === "denied" || out.status === "failed");
  }, true));
  r.get("/passport.json", json(async (req) => {
    const { partyOf } = await import("./trace.js");
    const who = await partyOf(req);
    if (!who || who.kind !== "shopper") throw new GtError("Unauthorized", "unauthorized", 401);
    const db = await getDb();
    const { accountById } = await import("../store.js");
    const a = await accountById(db, who.id);
    const p = await passportSummary(db, a);
    return { recovered: p.recovered, spent_cents: p.spent, back_cents: p.back, live: p.live, history: p.hist };
  }));

  // ---------- Merchant money ----------
  r.get("/merchant/money", merchant(async (req, res, m) => {
    const db = await getDb();
    const disputes = (await db.query<any>("SELECT d.*, o.number FROM disputes d LEFT JOIN orders o ON o.id = d.order_id ORDER BY d.synced_at DESC")).rows;
    const trackers = (await db.query<any>("SELECT t.*, o.number FROM trackers t JOIN orders o ON o.id = t.order_id ORDER BY t.created_at DESC LIMIT 20")).rows;
    const lines = (await db.query<any>("SELECT l.id, l.title, l.status, o.number FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.merchant_id = $1 AND o.capture_id IS NOT NULL AND l.status IN ('ordered','shipped') AND NOT EXISTS (SELECT 1 FROM trackers t WHERE t.line_id = l.id) ORDER BY o.created_at DESC", [m.id])).rows;
    const totals = (await db.query<any>("SELECT count(*)::int AS orders, coalesce(sum(gross_cents),0)::int AS gross, coalesce(sum(fee_cents),0)::int AS fees, coalesce(sum(refunded_cents),0)::int AS refunded FROM orders WHERE merchant_id = $1 AND capture_id IS NOT NULL", [m.id])).rows[0];
    const recon = typeof req.query.reconcile === "string" ? await reconcileTransactions(30).catch((e) => ({ error: (e as Error).message })) : null;
    res.send(mpage(req, "Money", html`<h1>Money</h1><p class="sub">${m.name} · PayPal sandbox${config.paypal.clientId ? "" : " (fake client in this instance)"}.</p>
<div class="stats"><div><b>${totals.orders}</b><span>paid orders</span></div><div><b>${money(totals.gross)}</b><span>gross</span></div><div><b>${money(totals.fees)}</b><span>PayPal fees</span></div><div><b>${money(totals.refunded)}</b><span>refunded</span></div></div>
<div class="grid g2">
<section class="card" id="tracking"><h2>Tracking</h2><p class="small muted">Attached to the PayPal order so the shopper sees it in PayPal too (Orders v2 tracking).</p>
${lines.length ? html`<table class="small"><tbody>${raw(lines.map((l: any) => `<tr><td>${l.number}<br><span class="muted">${String(l.title).replace(/</g, "&lt;")}</span></td><td><form method="post" action="/merchant/lines/${l.id}/tracking" class="row"><input type="text" name="carrier" placeholder="carrier (e.g. DHL)" required style="width:7rem"><input type="text" name="number" placeholder="tracking number" required style="width:9rem"><button class="btn small">Attach</button></form></td></tr>`).join(""))}</tbody></table>` : html`<p class="muted small">No paid lines without tracking.</p>`}
${trackers.length ? html`<h3>Attached</h3><ul class="small">${raw(trackers.map((t: any) => `<li>${t.number}: ${t.carrier} ${t.tracking_number} ${pill(t.paypal_status ?? "pending").value}</li>`).join(""))}</ul>` : ""}</section>
<section class="card" id="disputes"><h2>Disputes</h2><p class="small muted">Synced from PayPal every ten minutes and on demand. The evidence pack is built from what the shopper agreed (quote hash, policy version, delivery, case history) and sent as the response.</p>
<form method="post" action="/merchant/money/disputes/sync" class="inline"><button class="btn small">Sync now</button></form>
${disputes.length ? html`<table class="small"><thead><tr><th>PayPal id</th><th>Order</th><th>Reason</th><th class="num">Amount</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>${raw(disputes.map((d: any) => `<tr><td class="mono">${d.paypal_id}</td><td>${d.number ?? "?"}</td><td>${d.reason ?? ""}</td><td class="num">${money(d.amount_cents)}</td><td>${pill(d.status).value}${d.evidence_sent_at ? `<div class="muted">evidence sent ${fmtDate(d.evidence_sent_at)}</div>` : ""}</td><td class="small">${d.due_at ? fmtDate(d.due_at) : ""}</td><td class="row"><a class="btn small" href="/merchant/money/disputes/${d.id}/evidence.json">Pack</a>${!d.evidence_sent_at && /WAITING|OPEN|REQUIRED/i.test(d.status) ? `<form method="post" action="/merchant/money/disputes/${d.id}/evidence" class="inline"><button class="btn small primary">Send evidence</button></form><form method="post" action="/merchant/money/disputes/${d.id}/accept" class="inline"><button class="btn small">Accept claim</button></form>` : ""}</td></tr>`).join(""))}</tbody></table>` : html`<p class="muted small">No disputes on file.</p>`}</section></div>
<div class="grid g2">
<section class="card"><h2>Transaction Search</h2><p class="small muted">PayPal's record of the last 30 days against Everyday's orders.</p><a class="btn small" href="/merchant/money?reconcile=1#recon">Reconcile now</a>
${recon ? ("error" in recon ? html`<p class="banner bad">${recon.error}</p>` : html`<p id="recon" class="small">${recon.rows.length} PayPal transactions · ${recon.unmatched} unmatched captures · ${recon.disagree} amount mismatches. ${recon.note}</p><div class="table-wrap"><table class="small"><thead><tr><th>PayPal id</th><th>Code</th><th class="num">Amount</th><th>Order</th><th>Agrees</th></tr></thead><tbody>${raw(recon.rows.slice(0, 50).map((x) => `<tr><td class="mono">${x.id}</td><td>${x.code}</td><td class="num">${money(x.cents)}</td><td>${x.order ?? "—"}</td><td>${x.agrees === true ? "yes" : x.agrees === "refund" ? "refund" : x.order ? "<b>no</b>" : "not ours"}</td></tr>`).join(""))}</tbody></table></div>`) : ""}</section>
<section class="card"><h2>Negative tests</h2><p class="small muted">Asks PayPal (or the fake) to refuse the next write with a mock code, so the failure path is exercised for real: a one-cent refund against the latest capture.</p>
<form method="post" action="/merchant/money/negative-test" class="row"><select name="code"><option>INSTRUMENT_DECLINED</option><option>INSUFFICIENT_FUNDS</option><option>TRANSACTION_REFUSED</option><option>INTERNAL_SERVER_ERROR</option></select><button class="btn small">Run</button></form></section></div>`));
  }));
  r.post("/merchant/lines/:id/tracking", merchant(async (req, res) => {
    await addTrackingForLine(req.params.id, String(req.body.carrier ?? ""), String(req.body.number ?? ""));
    back(res, "/merchant/money#tracking", "Tracking attached to the PayPal order.");
  }, true));
  r.post("/merchant/money/disputes/sync", merchant(async (_req, res) => {
    const n = await syncDisputes();
    back(res, "/merchant/money#disputes", `Synced ${n} dispute(s).`);
  }, true));
  r.post("/merchant/money/disputes/:id/evidence", merchant(async (req, res) => {
    await sendEvidence(req.params.id);
    back(res, "/merchant/money#disputes", "Evidence sent to PayPal.");
  }, true));
  r.post("/merchant/money/disputes/:id/accept", merchant(async (req, res) => {
    await acceptDispute(req.params.id, String(req.body.note ?? ""));
    back(res, "/merchant/money#disputes", "Claim accepted; PayPal refunds the shopper.");
  }, true));
  r.get("/merchant/money/disputes/:id/evidence.json", merchant(async (req, res) => {
    res.json((await evidencePack(req.params.id)).pack);
  }));
  r.post("/merchant/money/negative-test", merchant(async (req, res) => {
    const code = String(req.body.code ?? "INSTRUMENT_DECLINED").replace(/[^A-Z_]/g, "");
    const out = await negativeTest(code);
    back(res, "/merchant/money", `${out.code}: ${out.message}`, out.outcome === "accepted");
  }, true));
  r.get("/merchant/money/transactions.json", merchant(async (_req, res) => {
    res.json(await reconcileTransactions(30));
  }));
  return r;
}
