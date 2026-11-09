/**
 * Purchase passport and PayPal depth (roadmap E3, E5).
 *  - A seeded year of purchase history gives the shopper a "dollars recovered" table (price protection, swaps,
 *    case refunds, recall remedies) and gives the mandate backtest something to replay.
 *  - Repeat buys: the shopper saves PayPal once (Vault setup token -> payment token); a repeat buy is a
 *    merchant-initiated capture on that token, which is the one move here that most needs the gate. Under the
 *    mandate's threshold with one-tap on it runs; otherwise it waits for a tap (or a passkey) in the app.
 *  - Disputes are synced from PayPal; the evidence pack is built from what the shopper agreed (quote hash, policy
 *    version, delivery, case history) and sent as the merchant's response, or the claim is accepted.
 *  - Tracking is attached to the PayPal order when the merchant ships, so the shopper sees it in PayPal too.
 *  - Transaction Search reconciles PayPal's view of the money against our ledger.
 */
import { config } from "../config.js";
import { getDb, type Queryable } from "../db.js";
import { enqueue } from "../jobs.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { firstCapture, paypal, PayPalError, toCents, UnknownOutcomeError } from "../paypal/index.js";
import { accountById, J, logEvent, notify, type Account } from "../store.js";
import { gate, GateDenied, HeldForApproval, preApprove } from "../guard/dryrun.js";
import { appendAudit } from "../guard/audit.js";
import { startRun } from "../trace.js";
import { catalog } from "./catalog.js";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// ---------- Purchase history (seeded, clearly labelled) ----------

const HIST: { daysAgo: number; category: string; merchant: string; price: number; refund?: number; kind?: string; repeat?: boolean; note: string }[] = [
  { daysAgo: 350, category: "monitor", merchant: "Northlight Supply", price: 189, note: "Dell P2422H for the first desk" },
  { daysAgo: 338, category: "desk_mat", merchant: "Northlight Supply", price: 25, repeat: true, note: "Felt mat" },
  { daysAgo: 320, category: "lamp", merchant: "Lumen & Oak", price: 89, refund: 20, kind: "price_protection", note: "Orbit lamp dropped to $69 within 30 days" },
  { daysAgo: 301, category: "mouse", merchant: "Northlight Supply", price: 29, repeat: true, note: "Glide mouse, replaced a dead one" },
  { daysAgo: 288, category: "keyboard", merchant: "Northlight Supply", price: 49, refund: 49, kind: "case_refund", note: "Quiet Keys arrived with a stuck key; full refund" },
  { daysAgo: 260, category: "chair", merchant: "Northlight Supply", price: 169, refund: 20, kind: "swap_difference", note: "Backordered Ergo Lite swapped for the Nordic chair" },
  { daysAgo: 240, category: "dock", merchant: "Northlight Supply", price: 59, note: "LinkDock 7-in-1" },
  { daysAgo: 211, category: "headphones", merchant: "Marketplace listing", price: 99, refund: 99, kind: "recall_remedy", note: "Hush H-ANC recalled; replaced by the maker" },
  { daysAgo: 190, category: "desk_mat", merchant: "Northlight Supply", price: 25, repeat: true, note: "Felt mat for the second desk" },
  { daysAgo: 170, category: "webcam", merchant: "Northlight Supply", price: 45, note: "ClearCam for calls" },
  { daysAgo: 150, category: "lamp", merchant: "Northlight Supply", price: 29, repeat: true, note: "Brite clamp lamp for the bookshelf" },
  { daysAgo: 128, category: "mouse", merchant: "Northlight Supply", price: 12, repeat: true, note: "Spare wired mouse" },
  { daysAgo: 110, category: "monitor_arm", merchant: "Northlight Supply", price: 59, refund: 10, kind: "price_protection", note: "Lift arm dropped to $49" },
  { daysAgo: 95, category: "keyboard", merchant: "Northlight Supply", price: 79, note: "Oak Keys" },
  { daysAgo: 70, category: "desk_mat", merchant: "Northlight Supply", price: 29, repeat: true, note: "Cork mat" },
  { daysAgo: 52, category: "chair", merchant: "Northlight Supply", price: 329, note: "Aero Pro, approved by hand" },
  { daysAgo: 33, category: "mouse", merchant: "Northlight Supply", price: 35, repeat: true, note: "Silent oak mouse" },
  { daysAgo: 14, category: "lamp", merchant: "Northlight Supply", price: 49, refund: 49, kind: "case_refund", note: "Halden lamp arrived cracked; refunded" },
];

export async function seedPurchaseHistory(q: Queryable) {
  await q.query("DELETE FROM purchase_history");
  for (const h of HIST) {
    await q.query("INSERT INTO purchase_history (id, at, category, merchant, price_cents, refund_cents, refund_kind, approved_by_hand, repeat, note) VALUES ($1, now() - ($2 || ' days')::interval, $3, $4, $5, $6, $7, true, $8, $9)", [newId("ph"), String(h.daysAgo), h.category, h.merchant, h.price * 100, (h.refund ?? 0) * 100, h.kind ?? null, Boolean(h.repeat), h.note]);
  }
}

export async function passportSummary(q: Queryable, a: Account) {
  const hist = (await q.query<any>("SELECT * FROM purchase_history ORDER BY at DESC")).rows;
  const recovered = (await q.query<any>("SELECT refund_kind AS kind, count(*)::int AS n, sum(refund_cents)::int AS cents FROM purchase_history WHERE refund_cents > 0 GROUP BY refund_kind ORDER BY cents DESC")).rows;
  const live = (await q.query<any>(`SELECT
      (SELECT coalesce(sum(refunded_cents),0)::int FROM orders WHERE account_id = $1) AS refunded_live,
      (SELECT coalesce(sum(gross_cents),0)::int FROM orders WHERE account_id = $1 AND status NOT IN ('created','cancelled')) AS paid_live,
      (SELECT count(*)::int FROM cases c JOIN orders o ON o.id = c.order_id WHERE o.account_id = $1 AND c.issue = 'price_drop' AND c.status = 'resolved') AS protections_live,
      (SELECT count(*)::int FROM repeat_buys WHERE account_id = $1 AND status = 'paid') AS repeats_paid,
      (SELECT count(*)::int FROM repeat_buys WHERE account_id = $1 AND status = 'held') AS repeats_held`, [a.id])).rows[0];
  const spent = hist.reduce((s: number, h: any) => s + Number(h.price_cents), 0);
  const back = hist.reduce((s: number, h: any) => s + Number(h.refund_cents), 0);
  const byCategory = Object.entries(hist.reduce((m: Record<string, number>, h: any) => ((m[h.category] = (m[h.category] ?? 0) + Number(h.price_cents)), m), {})).sort((x, y) => y[1] - x[1]);
  return { hist, recovered, live, spent, back, byCategory };
}

// ---------- Saved PayPal (Vault) ----------

export async function vaultStatus(q: Queryable, accountId: string) {
  return (await q.query<any>("SELECT * FROM vault_tokens WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1", [accountId])).rows[0] ?? null;
}

export async function startVaultSetup(a: Account): Promise<string> {
  const db = await getDb();
  const id = newId("vlt");
  const st = await paypal().createSetupToken({ returnUrl: `${config.appUrl}/passport/vault/return?v=${id}`, cancelUrl: `${config.appUrl}/passport?err=${encodeURIComponent("Saving PayPal was cancelled")}`, description: "Everyday repeat buys on your saved PayPal, within the limits you set" }, `vault-setup:${id}`);
  await db.query("INSERT INTO vault_tokens (id, account_id, setup_token, status) VALUES ($1,$2,$3,'pending')", [id, a.id, st.id]);
  await logEvent(db, a, "account", a.id, "vault.setup_started", `${a.name} started saving a PayPal for repeat buys (setup ${st.id})`, a.name);
  if (!st.approveUrl) throw new GtError("PayPal did not return an approval link for saving your PayPal.", "paypal", 502);
  return st.approveUrl;
}

export async function finishVaultSetup(a: Account, vaultId: string) {
  const db = await getDb();
  const v = (await db.query<any>("SELECT * FROM vault_tokens WHERE id = $1 AND account_id = $2", [vaultId, a.id])).rows[0];
  if (!v) throw new GtError("That setup is not yours or does not exist.", "not_found", 404);
  if (v.status === "active") return v;
  try {
    const pt = await paypal().createPaymentToken(v.setup_token, `vault-token:${v.id}`);
    await db.query("UPDATE vault_tokens SET payment_token = $2, customer_id = $3, status = 'active' WHERE id = $1", [v.id, pt.id, pt.customerId ?? null]);
    await db.query("UPDATE vault_tokens SET status = 'revoked' WHERE account_id = $1 AND id <> $2 AND status = 'active'", [a.id, v.id]);
    await appendAudit("vault.saved", "account", a.id, { vault: v.id, token_suffix: pt.id.slice(-4) }, db);
    await logEvent(db, a, "account", a.id, "vault.saved", `PayPal saved for repeat buys (token …${pt.id.slice(-4)}). Nothing is charged without the mandate's say-so.`, "PayPal");
    return { ...v, status: "active", payment_token: pt.id };
  } catch (e) {
    await db.query("UPDATE vault_tokens SET status = 'failed' WHERE id = $1", [v.id]);
    throw new GtError(`PayPal did not complete saving your PayPal: ${(e as Error).message}`, "paypal", 502);
  }
}

export async function revokeVault(a: Account) {
  const db = await getDb();
  await db.query("UPDATE vault_tokens SET status = 'revoked' WHERE account_id = $1 AND status = 'active'", [a.id]);
  await appendAudit("vault.revoked", "account", a.id, {}, db);
  await logEvent(db, a, "account", a.id, "vault.revoked", "Saved PayPal removed; repeat buys stop", a.name);
}

// ---------- Repeat buys (merchant-initiated on the saved PayPal, behind the gate) ----------

export async function planRepeatBuy(a: Account, productId: string, qty: number, by: string, agentScope = "shopper") {
  const db = await getDb();
  const cat = await catalog(db);
  const p = cat.byId.get(productId);
  if (!p || !p.checkout) throw new GtError("That product cannot be bought here.", "not_found", 404);
  if (!Number.isInteger(qty) || qty < 1 || qty > 5) throw new GtError("Quantity must be 1 to 5.", "invalid");
  const v = await vaultStatus(db, a.id);
  if (!v || v.status !== "active") throw new GtError("Save a PayPal on your passport first; repeat buys run on it.", "no_vault", 409);
  const id = newId("rpt");
  const amount = p.price_cents * qty;
  await db.query("INSERT INTO repeat_buys (id, account_id, product_id, qty, amount_cents, request_id, status, note) VALUES ($1,$2,$3,$4,$5,$6,'planned',$7)", [id, a.id, p.id, qty, amount, `repeat:${id}`, `${qty} × ${p.title} by ${by}`]);
  await logEvent(db, a, "repeat_buy", id, "repeat.planned", `Repeat buy planned by ${by}: ${qty} × ${p.title} = ${money(amount)}`, by);
  const out = await runRepeatBuy(id, agentScope);
  return { id, ...out };
}

/** Gate, then charge the saved PayPal. Called at planning time and again from the queue after an approval. */
export async function runRepeatBuy(repeatId: string, agentScope = "worker"): Promise<{ status: string; message: string }> {
  const db = await getDb();
  const rb = (await db.query<any>("SELECT * FROM repeat_buys WHERE id = $1", [repeatId])).rows[0];
  if (!rb) throw new GtError("Repeat buy not found", "not_found", 404);
  if (rb.status === "paid") return { status: "paid", message: "Already paid." };
  const a = await accountById(db, rb.account_id);
  const cat = await catalog(db);
  const p = cat.byId.get(rb.product_id);
  const v = await vaultStatus(db, a.id);
  const run = await startRun({ actor: agentScope.startsWith("agent:") ? "agent" : agentScope === "worker" ? "worker" : "customer", agentId: agentScope.startsWith("agent:") ? agentScope.slice(6) : null, subject: `repeat buy ${rb.qty} × ${p?.title ?? rb.product_id} ${money(rb.amount_cents)}`, entity: "repeat_buy", entityId: rb.id });
  if (!p || !v || v.status !== "active") {
    await run.step({ actor: "code", tool: "repeat.precheck", args: { product: rb.product_id }, gate: "denied", result: { reason: !p ? "product gone" : "no active saved PayPal" } });
    await run.end("failed");
    await db.query("UPDATE repeat_buys SET status = 'failed', note = note || ' (no product or saved PayPal)' WHERE id = $1", [rb.id]);
    return { status: "failed", message: "No product or no saved PayPal." };
  }
  try {
    await gate({ action: "repeat_buy", ownerId: a.id, agentScope, entity: "repeat_buy", entityId: rb.id, cents: rb.amount_cents, trustedCents: [p.price_cents * rb.qty, rb.amount_cents], merchantName: p.merchant_name, category: p.category }, run);
  } catch (e) {
    if (e instanceof HeldForApproval) {
      await db.query("UPDATE repeat_buys SET status = 'held' WHERE id = $1", [rb.id]);
      await run.end("held");
      await logEvent(db, a, "repeat_buy", rb.id, "repeat.held", `Repeat buy of ${money(rb.amount_cents)} waits for your approval (${e.approvalId}).`);
      return { status: "held", message: `Waiting for your approval in the app (${e.approvalId}).` };
    }
    if (e instanceof GateDenied) {
      await db.query("UPDATE repeat_buys SET status = 'denied', note = note || ' | ' || $2 WHERE id = $1", [rb.id, e.message.slice(0, 200)]);
      await run.end("failed");
      await logEvent(db, a, "repeat_buy", rb.id, "repeat.denied", `Refused before PayPal: ${e.message}`);
      return { status: "denied", message: `Refused before PayPal: ${e.message}` };
    }
    await run.end("failed");
    throw e;
  }
  try {
    const order = await paypal().createVaultedCaptureOrder({ amountCents: rb.amount_cents, currency: "USD", customId: rb.id, invoiceId: `RPT-${rb.id.slice(-8)}`, description: `Everyday repeat buy: ${rb.qty} × ${p.title}`, vaultId: v.payment_token, items: [{ name: p.title, sku: p.sku, quantity: rb.qty, unitCents: p.price_cents }] }, rb.request_id);
    const cap = firstCapture(order);
    await run.step({ actor: "paypal", tool: "orders.create+capture (vault)", args: { request_id: rb.request_id, cents: rb.amount_cents }, gate: "allowed", result: { paypal_order_id: order.id, status: order.status, capture: cap?.id ?? null, capture_status: cap?.status ?? null }, pp_request_id: rb.request_id });
    if (!cap || cap.status !== "COMPLETED") {
      await db.query("UPDATE repeat_buys SET status = 'failed', paypal_order_id = $2, note = note || ' (capture ' || $3 || ')' WHERE id = $1", [rb.id, order.id, cap?.status ?? "missing"]);
      await run.end("failed");
      return { status: "failed", message: `PayPal did not complete the capture (${cap?.status ?? "none"}).` };
    }
    if (toCents(cap.amount) !== rb.amount_cents) {
      await db.query("UPDATE repeat_buys SET status = 'failed', paypal_order_id = $2, capture_id = $3, note = note || ' (amount mismatch)' WHERE id = $1", [rb.id, order.id, cap.id]);
      await run.end("failed");
      return { status: "failed", message: "PayPal captured a different amount; flagged for a person." };
    }
    // Record it as an order so the purchases page, refunds and tracking treat it like any other paid order.
    const n = Number((await db.query<{ n: string }>("SELECT count(*) AS n FROM orders")).rows[0].n) + 1;
    const orderId = newId("ord");
    const quoteId = newId("quo");
    await db.tx(async (q) => {
      const intent = newId("int");
      const self = (await q.query<{ id: string }>("SELECT id FROM recipients WHERE account_id = $1 AND is_self ORDER BY id LIMIT 1", [a.id])).rows[0]?.id ?? "self";
      await q.query("INSERT INTO intents (id, account_id, recipient_id, version, goal, text, reqs, status, channel) VALUES ($1,$2,$3,1,'repeat',$4,$5,'purchased','app')", [intent, a.id, self, `Repeat buy: ${rb.qty} × ${p.title}`, JSON.stringify({ goal: "repeat", focus: null, style_words: [], addons: [], owned_mentioned: [] })]);
      const planId = newId("pln");
      await q.query("INSERT INTO plans (id, intent_id, version, intent_version, body, status) VALUES ($1,$2,1,1,$3,'ordered')", [planId, intent, JSON.stringify({ slots: [], questions: [], feasible: true, total_cents: rb.amount_cents, repeat: true })]);
      await q.query("INSERT INTO quotes (id, plan_id, merchant_id, body, total_cents, hash, expires_at, status, approved_at) VALUES ($1,$2,$3,$4,$5,$6, now(), 'used', now())", [quoteId, planId, p.merchant_id, JSON.stringify({ merchant: { id: p.merchant_id, name: p.merchant_name }, lines: [{ product_id: p.id, sku: p.sku, title: p.title, qty: rb.qty, unit_cents: p.price_cents }], shipping: { method: "standard", cents: 0 }, items_cents: rb.amount_cents, total_cents: rb.amount_cents, currency: "USD", repeat: true }), rb.amount_cents, rb.request_id]);
      await q.query("INSERT INTO orders (id, number, account_id, intent_id, quote_id, merchant_id, status, total_cents, shipping_cents, paypal_order_id, capture_id, gross_cents, net_cents, paid_at, run_id, policy) VALUES ($1,$2,$3,$4,$5,$6,'paid',$7,0,$8,$9,$7,$7,now(),$10,(SELECT return_policy FROM merchants WHERE id = $6))", [orderId, `EV-${4000 + n}`, a.id, intent, quoteId, p.merchant_id, rb.amount_cents, order.id, cap.id, run.id]);
      await q.query("INSERT INTO order_lines (id, order_id, product_id, slot, title, qty, unit_cents, status, eta) VALUES ($1,$2,$3,'repeat',$4,$5,$6,'ordered',NULL)", [newId("oln"), orderId, p.id, p.title, rb.qty, p.price_cents]);
      await q.query("UPDATE products SET stock = greatest(0, stock - $2) WHERE id = $1", [p.id, rb.qty]);
      await q.query("INSERT INTO payment_ops (id, order_id, kind, status, amount_cents, request_id, paypal_id, paypal_status) VALUES ($1,$2,'capture','succeeded',$3,$4,$5,$6)", [newId("pop"), orderId, rb.amount_cents, `repeat-capture:${rb.id}`, cap.id, cap.status]);
      await q.query("UPDATE repeat_buys SET status = 'paid', paypal_order_id = $2, capture_id = $3, order_id = $4 WHERE id = $1", [rb.id, order.id, cap.id, orderId]);
      await logEvent(q, a, "order", orderId, "repeat.paid", `Repeat buy paid on your saved PayPal: ${rb.qty} × ${p.title} = ${money(rb.amount_cents)} (capture ${cap.id})`, "PayPal");
      await notify(q, a.id, "telegram", `🔁 Repeat buy done: ${rb.qty} × ${p.title} for ${money(rb.amount_cents)} on your saved PayPal.`);
    });
    await run.end("done");
    return { status: "paid", message: `Paid ${money(rb.amount_cents)} on your saved PayPal.` };
  } catch (e) {
    const unknown = e instanceof UnknownOutcomeError || (e instanceof PayPalError && e.status >= 500);
    await run.step({ actor: "paypal", tool: "orders.create+capture (vault)", args: { request_id: rb.request_id }, gate: "allowed", result: { error: (e as Error).message.slice(0, 200), outcome_unknown: unknown }, pp_request_id: rb.request_id });
    await run.end("failed");
    await db.query("UPDATE repeat_buys SET status = $2, note = note || ' | ' || $3 WHERE id = $1", [rb.id, unknown ? "planned" : "failed", (e as Error).message.slice(0, 160)]);
    if (unknown) await enqueue(db, "repeat_buy", { repeatId: rb.id }, new Date(Date.now() + 60_000), `repeat-retry:${rb.id}:${Date.now()}`);
    return { status: unknown ? "retrying" : "failed", message: unknown ? "PayPal did not answer; the same request id is retried, so it cannot charge twice." : `PayPal refused it: ${(e as Error).message}` };
  }
}

// ---------- Tracking ----------

export async function addTrackingForLine(lineId: string, carrier: string, trackingNumber: string) {
  const db = await getDb();
  const l = (await db.query<any>("SELECT l.*, o.paypal_order_id, o.capture_id, o.number, o.account_id FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.id = $1", [lineId])).rows[0];
  if (!l) throw new GtError("Line not found", "not_found", 404);
  if (!l.capture_id || !l.paypal_order_id) throw new GtError("This order has no PayPal payment to attach tracking to.", "bad_state", 409);
  const clean = { carrier: carrier.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 40) || "OTHER", number: trackingNumber.trim().slice(0, 64) };
  if (!clean.number) throw new GtError("Tracking number is required.", "invalid");
  const id = newId("trk");
  const requestId = `track:${lineId}:${clean.number}`;
  const run = await startRun({ actor: "owner", subject: `tracking ${clean.carrier} ${clean.number} on ${l.number}`, entity: "order", entityId: l.order_id });
  await gate({ action: "tracking", ownerId: "merchant", agentScope: "merchant", entity: "order", entityId: l.order_id, cents: 0, trustedCents: [] }, run);
  await db.query("INSERT INTO trackers (id, order_id, line_id, carrier, tracking_number, request_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (request_id) DO NOTHING", [id, l.order_id, lineId, clean.carrier, clean.number, requestId]);
  try {
    const r = await paypal().addTracking(l.paypal_order_id, { captureId: l.capture_id, carrier: clean.carrier, trackingNumber: clean.number, status: "SHIPPED", items: [{ name: l.title, sku: l.product_id, quantity: l.qty }] }, requestId);
    await db.query("UPDATE trackers SET paypal_status = $2 WHERE request_id = $1", [requestId, r.status]);
    await run.step({ actor: "paypal", tool: "orders.track", args: { request_id: requestId, carrier: clean.carrier }, gate: "allowed", result: r, pp_request_id: requestId });
    await run.end("done");
    const a = await accountById(db, l.account_id);
    await logEvent(db, a, "order", l.order_id, "line.tracking", `${l.title}: ${clean.carrier} ${clean.number} attached to the PayPal order`, "Northlight Supply");
  } catch (e) {
    await db.query("UPDATE trackers SET paypal_status = 'FAILED' WHERE request_id = $1", [requestId]);
    await run.step({ actor: "paypal", tool: "orders.track", args: { request_id: requestId }, gate: "allowed", result: { error: (e as Error).message.slice(0, 200) }, pp_request_id: requestId });
    await run.end("failed");
    throw new GtError(`PayPal did not accept the tracking: ${(e as Error).message}`, "paypal", 502);
  }
}

// ---------- Disputes ----------

export async function syncDisputes(): Promise<number> {
  const db = await getDb();
  const list = await paypal().listDisputes();
  let n = 0;
  for (const d of list) {
    const capId = d.disputed_transactions?.[0]?.seller_transaction_id ?? null;
    const o = capId ? (await db.query<any>("SELECT id, account_id, number FROM orders WHERE capture_id = $1", [capId])).rows[0] : null;
    const r = await db.query("INSERT INTO disputes (id, paypal_id, capture_id, order_id, status, reason, amount_cents, due_at, synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT (paypal_id) DO UPDATE SET status = EXCLUDED.status, due_at = EXCLUDED.due_at, synced_at = now() RETURNING (xmax = 0) AS inserted", [newId("dsp"), d.dispute_id, capId, o?.id ?? null, d.status, d.reason ?? null, d.dispute_amount ? toCents(d.dispute_amount) : null, d.seller_response_due_date ? new Date(d.seller_response_due_date) : null]);
    n++;
    if ((r.rows[0] as any)?.inserted && o) {
      const a = await accountById(db, o.account_id);
      await logEvent(db, a, "order", o.id, "dispute.opened", `PayPal dispute ${d.dispute_id} (${d.reason ?? "no reason"}) on ${o.number}; evidence pack ready for the merchant`, "PayPal");
    }
  }
  return n;
}

export async function evidencePack(disputeId: string) {
  const db = await getDb();
  const d = (await db.query<any>("SELECT * FROM disputes WHERE id = $1", [disputeId])).rows[0];
  if (!d) throw new GtError("Dispute not found", "not_found", 404);
  const o = d.order_id ? (await db.query<any>("SELECT * FROM orders WHERE id = $1", [d.order_id])).rows[0] : null;
  const quote = o ? (await db.query<any>("SELECT hash, body, created_at FROM quotes WHERE id = $1", [o.quote_id])).rows[0] : null;
  const lines = o ? (await db.query<any>("SELECT title, qty, unit_cents, status, eta, delivered_at FROM order_lines WHERE order_id = $1", [o.id])).rows : [];
  const cases = o ? (await db.query<any>("SELECT number, issue, status, requested, refund_cents, resolved_at FROM cases WHERE order_id = $1", [o.id])).rows : [];
  const tracks = o ? (await db.query<any>("SELECT carrier, tracking_number, paypal_status FROM trackers WHERE order_id = $1", [o.id])).rows : [];
  const events = o ? (await db.query<any>("SELECT type, summary, at AS created_at FROM events WHERE entity_id = $1 ORDER BY id", [o.id])).rows : [];
  const pack = {
    dispute: { paypal_id: d.paypal_id, reason: d.reason, status: d.status, amount_cents: d.amount_cents },
    order: o ? { number: o.number, paid_cents: o.gross_cents, refunded_cents: o.refunded_cents, capture_id: o.capture_id, paid_at: o.paid_at, policy_version: J<any>(o.policy)?.version ?? null } : null,
    agreed_quote: quote ? { hash: quote.hash, approved_at: quote.created_at, total_cents: J<any>(quote.body).total_cents } : null,
    lines,
    tracking: tracks,
    cases,
    timeline: events.map((e: any) => `${new Date(e.created_at).toISOString()} ${e.type}: ${e.summary}`),
    note: "Built from records the shopper agreed to (quote hash and return policy version) and from PayPal's own ids. Nothing in it was written by a model.",
  };
  await db.query("UPDATE disputes SET evidence_pack = $2 WHERE id = $1", [d.id, JSON.stringify(pack)]);
  return { dispute: d, pack };
}

export async function sendEvidence(disputeId: string) {
  const db = await getDb();
  const { dispute: d, pack } = await evidencePack(disputeId);
  const run = await startRun({ actor: "owner", subject: `dispute evidence ${d.paypal_id}`, entity: "dispute", entityId: d.id });
  await gate({ action: "evidence", ownerId: "merchant", agentScope: "merchant", entity: "dispute", entityId: d.id, cents: 0, trustedCents: [] }, run);
  const notes = [`Order ${pack.order?.number ?? "?"} paid ${pack.order ? money(pack.order.paid_cents) : "?"} (capture ${pack.order?.capture_id ?? "?"}).`, pack.agreed_quote ? `Shopper approved quote hash ${pack.agreed_quote.hash.slice(0, 16)} on ${new Date(pack.agreed_quote.approved_at).toISOString().slice(0, 10)}.` : "", ...pack.lines.map((l: any) => `${l.title} × ${l.qty}: ${l.status}${l.delivered_at ? `, delivered ${l.delivered_at}` : ""}`), ...pack.tracking.map((t: any) => `Tracking ${t.carrier} ${t.tracking_number}`), ...pack.cases.map((c: any) => `Case ${c.number}: ${c.issue}, ${c.status}${c.refund_cents ? `, refund ${money(c.refund_cents)}` : ""}`)].filter(Boolean).join(" ");
  const requestId = `dispute-evidence:${d.id}`;
  try {
    const r = await paypal().provideDisputeEvidence(d.paypal_id, { notes, evidenceType: "PROOF_OF_FULFILLMENT" }, requestId);
    await db.query("UPDATE disputes SET evidence_sent_at = now(), status = 'UNDER_REVIEW' WHERE id = $1", [d.id]);
    await run.step({ actor: "paypal", tool: "disputes.provide-evidence", args: { request_id: requestId }, gate: "allowed", result: r, pp_request_id: requestId });
    await run.end("done");
    await appendAudit("dispute.evidence_sent", "dispute", d.id, { paypal_id: d.paypal_id, notes_len: notes.length }, db);
  } catch (e) {
    await run.step({ actor: "paypal", tool: "disputes.provide-evidence", args: { request_id: requestId }, gate: "allowed", result: { error: (e as Error).message.slice(0, 200) }, pp_request_id: requestId });
    await run.end("failed");
    throw new GtError(`PayPal did not accept the evidence: ${(e as Error).message}`, "paypal", 502);
  }
}

export async function acceptDispute(disputeId: string, note: string) {
  const db = await getDb();
  const d = (await db.query<any>("SELECT * FROM disputes WHERE id = $1", [disputeId])).rows[0];
  if (!d) throw new GtError("Dispute not found", "not_found", 404);
  const run = await startRun({ actor: "owner", subject: `accept dispute ${d.paypal_id}`, entity: "dispute", entityId: d.id });
  // Accepting a claim refunds the disputed amount through PayPal: a refund under the merchant's mandate. The merchant
  // clicked it by hand, which is the person the mandate asks for; the kill switch and provenance still apply.
  await preApprove("merchant", "dispute", d.id, "refund", Number(d.amount_cents ?? 0), "Northlight Supply (merchant console)");
  try {
    await gate({ action: "refund", ownerId: "merchant", agentScope: "merchant", entity: "dispute", entityId: d.id, cents: Number(d.amount_cents ?? 0), trustedCents: [Number(d.amount_cents ?? 0)] }, run);
  } catch (e) {
    await run.end(e instanceof HeldForApproval ? "held" : "failed");
    if (e instanceof HeldForApproval) throw new GtError(`Accepting this claim waits for an approval (${e.approvalId}).`, "held", 409);
    if (e instanceof GateDenied) throw new GtError(`Refused before PayPal: ${e.message}`, "denied", 409);
    throw e;
  }
  const requestId = `dispute-accept:${d.id}`;
  try {
    const r = await paypal().acceptDisputeClaim(d.paypal_id, note || "Accepted by the merchant in Everyday", requestId);
    await db.query("UPDATE disputes SET status = 'RESOLVED' WHERE id = $1", [d.id]);
    await run.step({ actor: "paypal", tool: "disputes.accept-claim", args: { request_id: requestId }, gate: "allowed", result: r, pp_request_id: requestId });
    await run.end("done");
    await appendAudit("dispute.accepted", "dispute", d.id, { paypal_id: d.paypal_id, cents: d.amount_cents }, db);
  } catch (e) {
    await run.end("failed");
    throw new GtError(`PayPal did not accept the claim: ${(e as Error).message}`, "paypal", 502);
  }
}

// ---------- Transaction Search reconcile ----------

export async function reconcileTransactions(days = 30) {
  const db = await getDb();
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const txs = await paypal().searchTransactions({ startDate: start, endDate: end });
  const ours = (await db.query<any>("SELECT o.number, o.capture_id, o.gross_cents, o.refunded_cents FROM orders o WHERE o.capture_id IS NOT NULL")).rows;
  const byCap = new Map(ours.map((o: any) => [o.capture_id, o]));
  const rows = txs.map((t) => {
    const info = t.transaction_info;
    const cents = Math.round(Number(info.transaction_amount?.value ?? 0) * 100);
    const match = byCap.get(info.transaction_id);
    return { id: info.transaction_id, code: info.transaction_event_code ?? "", status: info.transaction_status ?? "", cents, when: info.transaction_initiation_date ?? null, order: match?.number ?? null, agrees: match ? Number(match.gross_cents) === cents : cents < 0 ? "refund" : false };
  });
  const unmatched = rows.filter((r) => r.cents > 0 && !r.order).length;
  const disagree = rows.filter((r) => r.order && r.agrees === false).length;
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), rows, unmatched, disagree, note: "PayPal's Transaction Search against Everyday's orders table. A capture PayPal has that Everyday lacks is a repair candidate; a different amount is a mismatch for a person." };
}

/** Sandbox negative test: ask PayPal to refuse the next write so the UI's failure path is exercised honestly. */
export async function negativeTest(code: string) {
  const db = await getDb();
  const o = (await db.query<any>("SELECT * FROM orders WHERE capture_id IS NOT NULL ORDER BY created_at DESC LIMIT 1")).rows[0];
  if (!o) throw new GtError("Pay one order first; the test refunds one cent against its capture.", "bad_state", 409);
  const run = await startRun({ actor: "owner", subject: `negative test ${code}`, entity: "order", entityId: o.id });
  const requestId = `negtest:${code}:${Date.now()}`;
  // Even a one-cent test refund goes through the gate: kill switch, provenance and the merchant's mandate apply.
  try {
    await gate({ action: "refund", ownerId: "merchant", agentScope: "merchant", entity: "order", entityId: o.id, cents: 1, trustedCents: [1], captureId: o.capture_id, customerInitiated: true }, run);
  } catch (e) {
    await run.end(e instanceof HeldForApproval ? "held" : "failed");
    throw new GtError(`Refused before PayPal: ${(e as Error).message}`, "denied", 409);
  }
  try {
    await paypal().withMockResponse({ mock_application_codes: code }, () => paypal().refundCapture(o.capture_id, 1, "USD", `negative test ${code}`, requestId));
    await run.step({ actor: "paypal", tool: "captures.refund (mock)", args: { code, request_id: requestId }, gate: "allowed", result: { unexpected: "PayPal accepted the mocked call" }, pp_request_id: requestId });
    await run.end("done");
    return { code, outcome: "accepted", message: "PayPal accepted the call: the mock code did not apply (the fake client only simulates some codes)." };
  } catch (e) {
    const pe = e instanceof PayPalError ? e : null;
    await run.step({ actor: "paypal", tool: "captures.refund (mock)", args: { code, request_id: requestId }, gate: "allowed", result: { refused: true, name: pe?.name_ ?? null, status: pe?.status ?? null, message: (e as Error).message.slice(0, 200) }, pp_request_id: requestId, pp_debug_id: pe?.debugId ?? null });
    await run.end("done");
    return { code, outcome: "refused", message: `PayPal refused as asked: ${(e as Error).message}`, debug_id: pe?.debugId ?? null };
  }
}
