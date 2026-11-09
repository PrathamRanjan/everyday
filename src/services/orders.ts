import { config } from "../config.js";
import { getDb, type Queryable } from "../db.js";
import { scanText } from "../ai/scan.js";
import { addMonths, returnEligibility, type ReturnPolicy } from "../core/after.js";
import { check } from "../core/constraints.js";
import { canonicalJson } from "./util.js";
import { addWorkDays, wall, wallIso } from "../core/time.js";
import { newId } from "../lib/ids.js";
import { GtError, sha256Hex } from "../lib/util.js";
import { paypal, PayPalError, toCents, UnknownOutcomeError, type PPCapture } from "../paypal/index.js";
import { accountById, J, logEvent, notify, nowIso, nowOf, type Account } from "../store.js";
import { catalog } from "./catalog.js";
import { currentPlan, intentRow, ownedOf, type Reqs, type SlotView } from "./plans.js";
import { gate, GateDenied, HeldForApproval, preApprove, type MoneyMove } from "../guard/dryrun.js";
import { MERCHANT } from "../guard/policy.js";
import { startRun } from "../trace.js";

/** Runs the money gate and turns its outcomes into the errors the web layer already understands. */
async function gated(m: MoneyMove, run?: Awaited<ReturnType<typeof startRun>> | null) {
  try {
    return await gate(m, run);
  } catch (e) {
    if (e instanceof HeldForApproval) throw new GtError(`Waiting for a person to approve this ${m.action.replace("_", " ")} of ${money(m.cents)} (approval ${e.approvalId}).`, "held", 409);
    if (e instanceof GateDenied) throw new GtError(`Refused before PayPal: ${e.message}`, e.gate === "denied" ? "denied" : "dry_run_refused", 409);
    throw e;
  }
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
export const QUOTE_MINUTES = 15;

async function merchantRow(q: Queryable, id: string) {
  const m = (await q.query<any>("SELECT * FROM merchants WHERE id = $1", [id])).rows[0];
  return { ...m, caps: J<any>(m.caps), shipping: J<any>(m.shipping), return_policy: J<ReturnPolicy & { partial_pct: number; swap: boolean }>(m.return_policy) };
}

// ---------- Spending ----------

export async function spending(q: Queryable, a: Account) {
  const month = nowIso(a).slice(0, 7);
  const spent = (await q.query<{ s: number }>("SELECT COALESCE(SUM(gross_cents - refunded_cents),0)::int AS s FROM orders WHERE account_id = $1 AND status NOT IN ('created','cancelled') AND to_char(created_at, 'YYYY-MM') = $2", [a.id, month])).rows[0].s;
  const reserved = (await q.query<{ s: number }>("SELECT COALESCE(SUM(total_cents),0)::int AS s FROM orders WHERE account_id = $1 AND status = 'created'", [a.id])).rows[0].s;
  return { limit_cents: a.monthly_limit_cents, spent_cents: spent, reserved_cents: reserved, left_cents: a.monthly_limit_cents - spent - reserved, note: "Your stated monthly limit, not a verified bank balance." };
}

// ---------- Quote and approval ----------

/** An immutable quote for the plan's buyable picks from the test merchant, with a hash and 15-minute expiry. */
export async function quotePlan(a: Account, intentId: string) {
  const db = await getDb();
  return db.tx(async (q) => {
    const i = await intentRow(q, a, intentId);
    const p = await currentPlan(q, intentId);
    if (!p || p.status !== "current") throw new GtError("There is no current plan to quote.", "bad_state", 409);
    if (p.body.questions.length) throw new GtError(`Answer first: ${p.body.questions[0].text}`, "questions", 409);
    if (!p.body.feasible) throw new GtError(p.body.gap ?? "This plan does not fit yet.", "infeasible", 409);
    const cat = await catalog(q);
    const picks = (p.body.slots as SlotView[]).filter((s) => s.pick && s.outcome === "buy").map((s) => ({ slot: s.key, p: cat.byId.get(s.pick!.id)! }));
    if (picks.some((x) => !x.p.checkout)) throw new GtError("A pick is not available for checkout here.", "invalid");
    const merchantId = picks[0].p.merchant_id;
    const m = await merchantRow(q, merchantId);
    const items = picks.reduce((s, x) => s + x.p.price_cents, 0);
    const express = p.body.shipping === "express";
    const ship = express ? m.shipping.express_cents : items >= m.shipping.free_over_cents ? 0 : m.shipping.standard_cents;
    const now = nowOf(a);
    const body = {
      merchant: { id: m.id, name: m.name, payee: "PayPal sandbox merchant (Everyday test merchant account)" },
      lines: picks.map((x) => ({ slot: x.slot, product_id: x.p.id, sku: x.p.sku, title: x.p.title, qty: 1, unit_cents: x.p.price_cents, eta: wallIso(addWorkDays(now, (x.p.stock > 0 ? 0 : x.p.backorder_days) + (express ? m.shipping.express_days : m.shipping.standard_days))).slice(0, 10) })),
      shipping: { method: express ? "express" : "standard", cents: ship },
      items_cents: items,
      total_cents: items + ship,
      currency: "USD",
      address: a.address,
      return_policy: m.return_policy.version,
      policy: m.return_policy,
      plan_version: p.version,
      intent_version: i.version,
    };
    const hash = sha256Hex(canonicalJson(body));
    await q.query("UPDATE quotes SET status = 'superseded' WHERE plan_id = $1 AND status = 'open'", [p.id]);
    const id = newId("quo");
    await q.query("INSERT INTO quotes (id, plan_id, merchant_id, body, total_cents, hash, expires_at, status) VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' minutes')::interval, 'open')", [id, p.id, m.id, JSON.stringify(body), body.total_cents, hash, String(QUOTE_MINUTES)]);
    await logEvent(q, a, "intent", i.id, "quote.created", `Quote ${money(body.total_cents)} from ${m.name} for plan v${p.version} (expires in ${QUOTE_MINUTES} min)`);
    return id;
  });
}

/** Approve the exact quote by hash, re-check prices/stock/plan/spending, create the PayPal order, return the approval link. */
export async function approveQuote(a: Account, quoteId: string, hash: string) {
  const db = await getDb();
  const order = await db.tx(async (q) => {
    const qu = (await q.query<any>("SELECT q.*, p.intent_id, p.status AS plan_status, p.version AS plan_version FROM quotes q JOIN plans p ON p.id = q.plan_id JOIN intents i ON i.id = p.intent_id WHERE q.id = $1 AND i.account_id = $2 FOR UPDATE", [quoteId, a.id])).rows[0];
    if (!qu) throw new GtError("Quote not found", "not_found", 404);
    const existing = (await q.query<any>("SELECT * FROM orders WHERE quote_id = $1", [qu.id])).rows[0];
    if (existing) return existing;
    if (qu.hash !== hash) throw new GtError("This quote changed. Review the new one before approving.", "stale", 409);
    if (qu.status !== "open") throw new GtError("This quote is no longer open. Get a fresh quote.", "stale", 409);
    if (new Date(qu.expires_at) < new Date()) {
      await q.query("UPDATE quotes SET status = 'expired' WHERE id = $1", [qu.id]);
      throw new GtError("This quote expired. Get a fresh quote: prices and stock are re-checked.", "expired", 409);
    }
    if (qu.plan_status !== "current") throw new GtError("Your plan changed after this quote. Get a fresh quote.", "stale", 409);
    const body = J<any>(qu.body);
    const cat = await catalog(q);
    for (const l of body.lines) {
      const p = cat.byId.get(l.product_id);
      if (!p || p.price_cents !== l.unit_cents) throw new GtError(`${l.title} changed price since the quote. Get a fresh quote.`, "price_changed", 409);
      if (p.stock <= 0 && p.backorder_days <= 0) throw new GtError(`${l.title} sold out since the quote.`, "stock", 409);
    }
    const sp = await spending(q, a);
    if (body.total_cents > sp.left_cents) throw new GtError(`This would exceed your monthly limit: ${money(sp.left_cents)} left of ${money(sp.limit_cents)}. Change the limit under You, or trim the plan.`, "limit", 409);
    await q.query("UPDATE quotes SET status = 'approved', approved_at = now() WHERE id = $1", [qu.id]);
    const n = (await q.query<{ c: number }>("SELECT count(*)::int AS c FROM orders")).rows[0].c + 1;
    const id = newId("ord");
    // The policy bound to the order is the one in the quote the shopper approved (it is part of the quote's hash).
    await q.query("INSERT INTO orders (id, number, account_id, intent_id, quote_id, merchant_id, status, total_cents, shipping_cents, policy) VALUES ($1,$2,$3,$4,$5,$6,'created',$7,$8,COALESCE($9::jsonb, (SELECT return_policy FROM merchants WHERE id = $6)))", [id, `EV-${4000 + n}`, a.id, qu.intent_id, qu.id, qu.merchant_id, body.total_cents, body.shipping.cents, body.policy ? JSON.stringify(body.policy) : null]);
    for (const l of body.lines) await q.query("INSERT INTO order_lines (id, order_id, product_id, slot, title, qty, unit_cents, status, eta) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)", [newId("oln"), id, l.product_id, l.slot, l.title, l.qty, l.unit_cents, l.eta]);
    await logEvent(q, a, "order", id, "quote.approved", `${a.name} approved quote ${money(body.total_cents)} (hash ${hash.slice(0, 12)}…)`, a.name);
    return (await q.query<any>("SELECT * FROM orders WHERE id = $1", [id])).rows[0];
  });
  return checkoutLink(a, order.id);
}

export async function checkoutLink(a: Account, orderId: string): Promise<string> {
  const db = await getDb();
  const o = (await db.query<any>("SELECT * FROM orders WHERE id = $1 AND account_id = $2", [orderId, a.id])).rows[0];
  if (!o) throw new GtError("Order not found", "not_found", 404);
  if (o.status !== "created") throw new GtError("This order is already paid.", "paid", 409);
  if (o.exception) throw new GtError("A payment on this order needs the merchant to check it before anything else happens. Please don't pay again.", "exception", 409);
  if (o.paypal_order_id) {
    const existing = await paypal().getOrder(o.paypal_order_id).catch(() => null);
    if (existing?.status === "APPROVED" || existing?.status === "COMPLETED") {
      const out = await settle(o.id, "checkout");
      if (out === "paid") throw new GtError("Your earlier PayPal approval went through; nothing more to pay.", "paid", 409);
      // A refused capture clears the PayPal order (possibly by the reconciler at the same moment): then pay afresh.
      const after = (await db.query<any>("SELECT paypal_order_id, exception FROM orders WHERE id = $1", [o.id])).rows[0];
      if (after?.exception) throw new GtError("A payment on this order needs the merchant to check it before anything else happens. Please don't pay again.", "exception", 409);
      const still = after?.paypal_order_id;
      if (out === "waiting" && still) throw new GtError("Your earlier PayPal payment is still being confirmed by PayPal. Check back shortly.", "pending", 409);
    }
  }
  const q = (await db.query<any>("SELECT body FROM quotes WHERE id = $1", [o.quote_id])).rows[0];
  const body = J<any>(q.body);
  const attempt = o.attempt + 1;
  const requestId = `order:${o.id}:${attempt}`;
  const run = await startRun({ actor: "customer", subject: `checkout ${o.number} ${money(o.total_cents)}`, entity: "order", entityId: o.id });
  await run.step({ actor: "code", tool: "quote.lookup", args: { quote: o.quote_id }, gate: "n/a", result: { total_cents: body.total_cents, lines: body.lines.length } });
  try {
    await gated({ action: "order", ownerId: a.id, agentScope: "shopper", entity: "order", entityId: o.id, cents: o.total_cents, trustedCents: [body.total_cents, o.total_cents], merchantName: body.merchant?.name ?? null, customerInitiated: true }, run);
  } catch (e) {
    await run.end("held");
    throw e;
  }
  await db.query("INSERT INTO payment_ops (id, order_id, kind, status, amount_cents, request_id) VALUES ($1,$2,'order','pending',$3,$4) ON CONFLICT (request_id) DO NOTHING", [newId("pop"), o.id, o.total_cents, requestId]);
  const pp = await paypal().createOrder(
    { amountCents: o.total_cents, currency: "USD", customId: o.id, invoiceId: `${o.number}-${attempt}-${o.id.slice(-5)}`, description: `Everyday ${o.number}: ${body.lines.length} items from ${body.merchant.name}`, brand: "Everyday (test merchant)", items: body.lines.map((l: any) => ({ name: l.title, sku: l.sku, quantity: l.qty, unitCents: l.unit_cents })), shippingCents: body.shipping.cents, returnUrl: `${config.appUrl}/orders/${o.id}/paypal/return`, cancelUrl: `${config.appUrl}/orders/${o.id}?err=${encodeURIComponent("Payment cancelled")}` },
    requestId,
  );
  await run.step({ actor: "paypal", tool: "orders.create", args: { request_id: requestId, cents: o.total_cents }, gate: "allowed", result: { paypal_order_id: pp.id, status: pp.status }, pp_request_id: requestId });
  if (!pp.approveUrl) {
    await run.end("failed");
    throw new GtError("PayPal did not return an approval link.", "paypal", 502);
  }
  await db.query("UPDATE orders SET paypal_order_id = $2, attempt = $3, run_id = $4 WHERE id = $1", [o.id, pp.id, attempt, run.id]);
  await db.query("UPDATE payment_ops SET status = 'succeeded', paypal_id = $2, paypal_status = $3, attempts = attempts + 1 WHERE request_id = $1", [requestId, pp.id, pp.status]);
  await run.end("done");
  return pp.approveUrl;
}

export async function paypalReturn(a: Account, orderId: string, token: string) {
  const db = await getDb();
  const o = (await db.query<any>("SELECT * FROM orders WHERE id = $1 AND account_id = $2", [orderId, a.id])).rows[0];
  if (!o) throw new GtError("Order not found", "not_found", 404);
  if (o.paypal_order_id !== token) throw new GtError("This PayPal approval does not match the order.", "mismatch", 409);
  if (config.demoMode && (await db.query("DELETE FROM demo_faults WHERE id = (SELECT id FROM demo_faults WHERE method = 'paypal_return' ORDER BY id LIMIT 1) RETURNING id")).rows.length) {
    await logEvent(db, a, "order", o.id, "demo.fault", "Demo: the PayPal return was dropped before Everyday saw it");
    return "dropped";
  }
  return settle(o.id, "return");
}

/** Capture (or find the capture of) an approved order; never pays twice. */
export async function settle(orderId: string, via: "return" | "reconcile" | "checkout"): Promise<"paid" | "waiting" | "failed"> {
  const db = await getDb();
  const o = (await db.query<any>("SELECT * FROM orders WHERE id = $1", [orderId])).rows[0];
  if (!o || o.status !== "created") return o ? "paid" : "failed";
  if (!o.paypal_order_id) return "waiting";
  const pp = paypal();
  let order = await pp.getOrder(o.paypal_order_id);
  let cap: PPCapture | null = order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
  const repaired = via !== "return";
  if (!cap && order.status === "APPROVED") {
    const requestId = `capture:${o.paypal_order_id}`;
    const run = await startRun({ actor: via === "reconcile" ? "worker" : "customer", subject: `capture ${o.number} ${money(o.total_cents)} (${via})`, entity: "order", entityId: o.id });
    try {
      await gated({ action: "capture", ownerId: o.account_id, agentScope: via === "reconcile" ? "worker" : "shopper", entity: "order", entityId: o.id, cents: o.total_cents, trustedCents: [o.total_cents], orderId: o.paypal_order_id, customerInitiated: true }, run);
    } catch (e) {
      await run.end("held");
      throw e;
    }
    await db.query("INSERT INTO payment_ops (id, order_id, kind, status, amount_cents, request_id) VALUES ($1,$2,'capture','pending',$3,$4) ON CONFLICT (request_id) DO UPDATE SET attempts = payment_ops.attempts + 1", [newId("pop"), o.id, o.total_cents, requestId]);
    try {
      order = await pp.captureOrder(o.paypal_order_id, requestId);
      await run.step({ actor: "paypal", tool: "orders.capture", args: { request_id: requestId }, gate: "allowed", result: { status: order.status, capture: order.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null }, pp_request_id: requestId });
      await run.end("done");
    } catch (e) {
      await run.step({ actor: "paypal", tool: "orders.capture", args: { request_id: requestId }, gate: "allowed", result: { error: (e as Error).message.slice(0, 200) }, pp_request_id: requestId });
      await run.end("failed");
      if (e instanceof UnknownOutcomeError || (e instanceof PayPalError && (e.status >= 500 || e.name_ === "ORDER_ALREADY_CAPTURED"))) {
        await db.query("UPDATE payment_ops SET error = $2 WHERE request_id = $1", [requestId, (e as Error).message]);
        const a = await accountById(db, o.account_id);
        await logEvent(db, a, "order", o.id, "payment.unknown", `PayPal capture outcome unknown (${(e as Error).message}); reconciling by reading PayPal back`);
        return "waiting";
      }
      await db.query("UPDATE payment_ops SET status = 'failed', error = $2 WHERE request_id = $1", [requestId, (e as Error).message]);
      // A refused capture (e.g. INSTRUMENT_DECLINED: the buyer's balance or card can't cover it) charged nothing.
      // Say why, stop the reconciler retrying it, and let the shopper pay again on a fresh PayPal order.
      const issue = (e instanceof PayPalError && (Array.isArray(e.details) ? (e.details as any[])[0]?.issue : null)) || (e instanceof PayPalError ? e.name_ : null) || "refused";
      const a = await accountById(db, o.account_id);
      await logEvent(db, a, "order", o.id, "payment.declined", `PayPal refused the payment (${issue}). Nothing was charged. Pay again and choose another way to pay in PayPal.`, "PayPal", { issue });
      await db.query("UPDATE orders SET paypal_order_id = NULL WHERE id = $1 AND status = 'created'", [o.id]);
      return "failed";
    }
    cap = order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
  }
  if (!cap) return "waiting";
  const full = await pp.getCapture(cap.id).catch(() => cap!);
  const a = await accountById(db, o.account_id);
  const once = async (type: string, summary: string) => {
    if (!(await db.query("SELECT 1 FROM events WHERE entity_id = $1 AND type = $2 AND data->>'capture' = $3", [o.id, type, full.id])).rows.length) await logEvent(db, a, "order", o.id, type, summary, "PayPal", { capture: full.id });
  };
  if (full.status === "PENDING") {
    // Not money yet: the order stays unpaid and no stock is taken; the reconciler reads it again.
    await once("payment.capture_pending", `PayPal shows capture ${full.id} as PENDING. ${o.number} counts as paid only when PayPal completes it.`);
    return "waiting";
  }
  if (full.status !== "COMPLETED") {
    await once("payment.failed", `PayPal reports capture ${full.id} as ${full.status}: ${o.number} is not paid. You can pay again.`);
    await db.query("UPDATE orders SET paypal_order_id = NULL WHERE id = $1 AND status = 'created'", [o.id]);
    return "failed";
  }
  if (toCents(full.amount) !== o.total_cents || full.amount?.currency_code !== "USD") {
    await db.query("UPDATE orders SET exception = $2 WHERE id = $1 AND exception IS NULL", [o.id, `PayPal captured ${money(toCents(full.amount))} ${full.amount?.currency_code ?? ""} (capture ${full.id}) but ${money(o.total_cents)} USD was due.`]);
    await once("payment.mismatch", `PayPal captured ${money(toCents(full.amount))} ${full.amount?.currency_code} but ${money(o.total_cents)} USD was due: not recorded as paid. Needs a person; no new checkout is offered.`);
    return "failed";
  }
  await db.tx(async (q) => {
    const cur = (await q.query<any>("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [o.id])).rows[0];
    if (cur.status !== "created") return;
    const gross = toCents(full.amount);
    const fee = full.seller_receivable_breakdown?.paypal_fee ? toCents(full.seller_receivable_breakdown.paypal_fee) : null;
    const net = full.seller_receivable_breakdown?.net_amount ? toCents(full.seller_receivable_breakdown.net_amount) : gross - (fee ?? 0);
    await q.query("UPDATE orders SET status = 'paid', capture_id = $2, gross_cents = $3, fee_cents = $4, net_cents = $5, paid_at = now(), repaired = $6 WHERE id = $1", [o.id, full.id, gross, fee, net, repaired && via === "reconcile"]);
    await q.query("INSERT INTO payment_ops (id, order_id, kind, status, amount_cents, request_id, paypal_id, paypal_status) VALUES ($1,$2,'capture','succeeded',$3,$4,$5,$6) ON CONFLICT (request_id) DO UPDATE SET status = 'succeeded', paypal_id = EXCLUDED.paypal_id, paypal_status = EXCLUDED.paypal_status", [newId("pop"), o.id, gross, `capture:${o.paypal_order_id}`, full.id, full.status]);
    // The merchant accepts the paid order; stock is taken now.
    const lines = (await q.query<any>("SELECT * FROM order_lines WHERE order_id = $1", [o.id])).rows;
    for (const l of lines) {
      const r = await q.query("UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING id", [l.product_id, l.qty]);
      await q.query("UPDATE order_lines SET status = $2 WHERE id = $1", [l.id, r.rows.length ? "ordered" : "backordered"]);
    }
    await q.query("UPDATE plans SET status = 'ordered' WHERE intent_id = $1 AND status = 'current'", [o.intent_id]);
    await q.query("UPDATE intents SET status = 'purchased' WHERE id = $1", [o.intent_id]);
    await logEvent(q, a, "order", o.id, via === "reconcile" ? "payment.repaired" : "payment.captured", via === "reconcile" ? `Repaired: PayPal shows ${o.number} paid (${money(gross)}, capture ${full.id}); recorded without paying again` : `Paid ${money(gross)} on PayPal (capture ${full.id}, fee ${fee === null ? "—" : money(fee)}); ${o.number} accepted by the merchant`, "PayPal");
    await notify(q, a.id, "telegram", `✅ ${o.number} paid: ${money(gross)} on PayPal. Track it in Everyday → Purchases.`);
  });
  return "paid";
}

export async function reconcile() {
  const db = await getDb();
  const rows = (await db.query<{ id: string }>("SELECT id FROM orders WHERE status = 'created' AND paypal_order_id IS NOT NULL")).rows;
  let n = 0;
  for (const r of rows) if ((await settle(r.id, "reconcile").catch(() => "waiting")) === "paid") n++;
  return n;
}

// ---------- Refunds (no transaction is held during the PayPal call) ----------

export async function refund(orderId: string, amount: number, requestId: string, note: string, caseId: string | null) {
  const db = await getDb();
  const o = (await db.query<any>("SELECT * FROM orders WHERE id = $1", [orderId])).rows[0];
  if (!o?.capture_id) throw new GtError("This order has no PayPal payment to refund.", "no_capture", 409);
  const prior = (await db.query<any>("SELECT * FROM payment_ops WHERE request_id = $1", [requestId])).rows[0];
  if (prior?.status === "succeeded") return { refund_id: prior.paypal_id, status: prior.paypal_status };
  // A re-send of a request already on record is checked by PayPal (same request id, applied at most once).
  if (amount <= 0 || (!prior && amount > (o.gross_cents ?? 0) - o.refunded_cents)) throw new GtError(`Only ${money((o.gross_cents ?? 0) - o.refunded_cents)} is left to refund on ${o.number}.`, "too_much", 409);
  // The merchant's mandate governs refunds. Trusted amounts: what was paid, what the case or swap offer stated.
  const trusted: number[] = [o.gross_cents ?? o.total_cents, (o.gross_cents ?? 0) - o.refunded_cents];
  if (caseId) {
    const c = (await db.query<any>("SELECT refund_cents FROM cases WHERE id = $1", [caseId])).rows[0];
    if (c) trusted.push(Number(c.refund_cents));
  } else if (requestId.startsWith("swap:")) {
    const l = (await db.query<any>("SELECT swap_offer FROM order_lines WHERE id = $1", [requestId.slice(5)])).rows[0];
    const diff = l?.swap_offer ? Number(J<any>(l.swap_offer).diff_cents) : NaN;
    if (Number.isFinite(diff)) trusted.push(diff);
  }
  const run = await startRun({ actor: caseId ? "owner" : "customer", subject: `refund ${money(amount)} on ${o.number}: ${note.slice(0, 60)}`, entity: "order", entityId: o.id });
  try {
    // A refund the merchant approved by hand carries a pre-approval; a swap difference is the shopper's own choice.
    await gated({ action: "refund", ownerId: MERCHANT, agentScope: caseId ? "merchant" : "shopper", entity: caseId ? "case" : "order", entityId: caseId ?? o.id, cents: amount, trustedCents: trusted, captureId: prior ? null : o.capture_id, customerInitiated: !caseId }, run);
  } catch (e) {
    await run.end("held");
    throw e;
  }
  await db.query("INSERT INTO payment_ops (id, order_id, case_id, kind, status, amount_cents, request_id, reason) VALUES ($1,$2,$3,'refund','pending',$4,$5,$6) ON CONFLICT (request_id) DO NOTHING", [newId("pop"), o.id, caseId, amount, requestId, note]);
  let r;
  try {
    r = await paypal().refundCapture(o.capture_id, amount, "USD", note, requestId);
    await run.step({ actor: "paypal", tool: "captures.refund", args: { request_id: requestId, cents: amount }, gate: "allowed", result: { refund: r.id, status: r.status }, pp_request_id: requestId });
    await run.end("done");
  } catch (e) {
    await run.step({ actor: "paypal", tool: "captures.refund", args: { request_id: requestId, cents: amount }, gate: "allowed", result: { error: (e as Error).message.slice(0, 200) }, pp_request_id: requestId });
    await run.end("failed");
    await db.query("UPDATE payment_ops SET error = $2, attempts = attempts + 1 WHERE request_id = $1", [requestId, (e as Error).message]);
    // PayPal still processing an earlier request on this capture, or rate limiting, is not a refusal:
    // the refund stays pending and is retried with the same request id.
    const busy = e instanceof PayPalError && (e.status === 429 || /PREVIOUS_REQUEST_IN_PROGRESS|RATE_LIMIT/.test(`${e.name_ ?? ""} ${e.message}`));
    if (e instanceof UnknownOutcomeError || busy || (e instanceof PayPalError && e.status >= 500)) throw new GtError(`PayPal did not confirm the refund (${(e as Error).message}). Trying again is safe.`, "retry", 502);
    // A definite refusal from PayPal for this request: only now may a later attempt use a new request id.
    await db.query("UPDATE payment_ops SET status = 'failed', refusal_confirmed = true WHERE request_id = $1", [requestId]);
    throw new GtError(`PayPal refused the refund: ${(e as Error).message}`, "paypal", 502);
  }
  const a = await accountById(db, o.account_id);
  await db.tx(async (q) => {
    const moved = await q.query("UPDATE payment_ops SET status = 'succeeded', paypal_id = $2, paypal_status = $3, attempts = attempts + 1 WHERE request_id = $1 AND status = 'pending' RETURNING id", [requestId, r.id, r.status]);
    if (moved.rows.length) {
      // Only money PayPal has returned counts as refunded; a PENDING refund is counted when it completes.
      if (r.status === "COMPLETED") await q.query("UPDATE orders SET refunded_cents = refunded_cents + $2 WHERE id = $1", [o.id, amount]);
      await logEvent(q, a, "order", o.id, "refund.sent", `Refund ${money(amount)} on PayPal capture ${o.capture_id}: ${r.id} ${r.status} (${note})`, "Northlight Supply");
    }
  });
  return { refund_id: r.id, status: r.status };
}

/**
 * A case marked refunding whose every refund call PayPal refused (none pending, none sent) would wait forever:
 * it goes back to the merchant to retry or decide again.
 */
async function releaseRefusedCases(q: Queryable, caseId?: string) {
  // A refund recorded as failed without a confirmed refusal (recorded before 9 Nov, when a "request in progress"
  // answer counted as a refusal) may have gone through: re-send it once with its own request id. PayPal applies a
  // request id at most once, so this records a refund that happened and never pays a second time.
  for (const op of (await q.query<any>("SELECT * FROM payment_ops WHERE kind = 'refund' AND status = 'failed' AND NOT refusal_confirmed AND ($1::text IS NULL OR case_id = $1)", [caseId ?? null])).rows) {
    await q.query("UPDATE payment_ops SET status = 'pending' WHERE id = $1 AND status = 'failed'", [op.id]);
    await refund(op.order_id, op.amount_cents, op.request_id, op.reason ?? "Refund", op.case_id).catch(() => null);
  }
  const stuck = (
    await q.query<any>(
      `UPDATE cases c SET status = 'awaiting_merchant', merchant_decision = NULL
       WHERE c.status = 'refunding' AND ($1::text IS NULL OR c.id = $1)
         AND EXISTS (SELECT 1 FROM payment_ops p WHERE p.case_id = c.id AND p.kind = 'refund' AND p.status = 'failed' AND p.refusal_confirmed)
         AND NOT EXISTS (SELECT 1 FROM payment_ops p WHERE p.case_id = c.id AND p.kind = 'refund' AND p.status IN ('pending','succeeded'))
       RETURNING c.*, (SELECT account_id FROM orders o WHERE o.id = c.order_id) AS account_id`,
      [caseId ?? null],
    )
  ).rows;
  for (const c of stuck) {
    const acct = await accountById(q, c.account_id);
    await logEvent(q, acct, "order", c.order_id, "refund.failed", `PayPal refused the ${money(c.refund_cents)} refund for ${c.number}: nothing was returned. Back with the merchant to retry or decide again.`, "PayPal");
    await notify(q, acct.id, "telegram", `⚠️ ${c.number}: PayPal could not send your ${money(c.refund_cents)} refund. The merchant has been asked to retry.`);
  }
  return stuck.length;
}

/** Reads refunds back until PayPal reports COMPLETED; closes cases whose refund is confirmed. */
export async function verifyRefunds() {
  const db = await getDb();
  await releaseRefusedCases(db);
  // A refund whose call failed or lost its response is retried with the same request id: PayPal applies it at most once.
  for (const op of (await db.query<any>("SELECT * FROM payment_ops WHERE kind = 'refund' AND status = 'pending'")).rows) {
    await refund(op.order_id, op.amount_cents, op.request_id, op.reason ?? "Refund", op.case_id).catch(() => null);
  }
  const ops = (await db.query<any>("SELECT * FROM payment_ops WHERE kind = 'refund' AND status = 'succeeded' AND paypal_status NOT IN ('COMPLETED','FAILED','CANCELLED')")).rows;
  for (const op of ops) {
    const r = await paypal().getRefund(op.paypal_id).catch(() => null);
    if (!r || r.status === op.paypal_status) continue;
    await db.tx(async (q) => {
      // Conditional on the status it had: two checks at once post a completion (or a failure) once.
      const moved = (await q.query("UPDATE payment_ops SET paypal_status = $2, status = CASE WHEN $2 IN ('FAILED','CANCELLED') THEN 'failed' ELSE status END, refusal_confirmed = refusal_confirmed OR $2 IN ('FAILED','CANCELLED') WHERE id = $1 AND paypal_status = $3 RETURNING id", [op.id, r.status, op.paypal_status])).rows.length;
      if (!moved) return;
      if (r.status === "COMPLETED") await q.query("UPDATE orders SET refunded_cents = refunded_cents + $2 WHERE id = $1", [op.order_id, op.amount_cents]);
      if ((r.status === "FAILED" || r.status === "CANCELLED") && op.case_id) {
        const c = (await q.query<any>("SELECT c.*, o.account_id FROM cases c JOIN orders o ON o.id = c.order_id WHERE c.id = $1", [op.case_id])).rows[0];
        if (c?.status === "refunding") {
          await q.query("UPDATE cases SET status = 'awaiting_merchant', merchant_decision = NULL WHERE id = $1", [c.id]);
          const acct = await accountById(q, c.account_id);
          await logEvent(q, acct, "order", c.order_id, "refund.failed", `PayPal reports the ${money(op.amount_cents)} refund for ${c.number} as ${r.status}: nothing was returned. Back with the merchant to retry or decide again.`, "PayPal");
          await notify(q, acct.id, "telegram", `⚠️ ${c.number}: PayPal could not complete your ${money(op.amount_cents)} refund. The merchant has been asked to retry.`);
        }
      }
    });
  }
  const done = (await db.query<any>("SELECT DISTINCT c.*, o.account_id FROM cases c JOIN orders o ON o.id = c.order_id JOIN payment_ops p ON p.case_id = c.id AND p.kind = 'refund' WHERE c.status = 'refunding' AND p.paypal_status = 'COMPLETED'")).rows;
  for (const c of done) {
    // Only the check that moves the case resolves it: side effects (ownership cost, messages) happen once.
    const moved = (await db.query("UPDATE cases SET status = 'resolved', resolved_at = now() WHERE id = $1 AND status = 'refunding' RETURNING id", [c.id])).rows.length;
    if (!moved) continue;
    if (c.issue === "price_drop") await db.query("UPDATE owned_items SET price_cents = price_cents - $2 WHERE order_line_id = $1", [c.line_id, Math.floor(c.refund_cents / Math.max(1, (await db.query<any>("SELECT qty FROM order_lines WHERE id = $1", [c.line_id])).rows[0]?.qty ?? 1))]);
    const a = await accountById(db, c.account_id);
    await logEvent(db, a, "order", c.order_id, "case.resolved", `${c.number}: PayPal confirms the ${money(c.refund_cents)} refund. Case resolved.`, "PayPal");
    await notify(db, a.id, "telegram", `💸 ${c.number}: PayPal confirmed your ${money(c.refund_cents)} refund.`);
  }
}

// ---------- Merchant updates (Northlight console) ----------

async function lineWithOrder(q: Queryable, lineId: string) {
  const l = (await q.query<any>("SELECT l.*, o.account_id, o.number, o.intent_id, o.merchant_id, o.id AS oid FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.id = $1", [lineId])).rows[0];
  if (!l) throw new GtError("Line not found", "not_found", 404);
  return l;
}

export async function shipLine(lineId: string) {
  const db = await getDb();
  const l = await lineWithOrder(db, lineId);
  if (l.status !== "ordered") throw new GtError(`This line is ${l.status}.`, "bad_state", 409);
  const a = await accountById(db, l.account_id);
  await db.query("UPDATE order_lines SET status = 'shipped' WHERE id = $1", [lineId]);
  await logEvent(db, a, "order", l.oid, "line.shipped", `${l.title} shipped (ETA ${l.eta})`, "Northlight Supply");
}

/** Delivery turns a line into an owned item with return and warranty dates. Idempotent per line. */
export async function deliverLine(lineId: string, note = "") {
  const db = await getDb();
  await db.tx(async (q) => {
    const l = await lineWithOrder(q, lineId);
    if (l.status === "delivered") return;
    if (!["shipped", "ordered"].includes(l.status)) throw new GtError(`This line is ${l.status}.`, "bad_state", 409);
    const a = await accountById(q, l.account_id);
    const now = nowOf(a);
    const m = await merchantRow(q, l.merchant_id);
    const cat = await catalog(q);
    const p = cat.byId.get(l.product_id)!;
    const i = (await q.query<any>("SELECT recipient_id FROM intents WHERE id = $1", [l.intent_id])).rows[0];
    await q.query("UPDATE order_lines SET status = 'delivered', delivered_at = $2 WHERE id = $1", [lineId, wallIso(now)]);
    await q.query("INSERT INTO owned_items (id, account_id, recipient_id, product_id, title, brand, model, category, attrs, price_cents, acquired, order_line_id, return_until, warranty_until, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Everyday order') ON CONFLICT (order_line_id) DO NOTHING", [
      newId("own"), a.id, i.recipient_id, p.id, p.title, p.brand, p.model, p.category, JSON.stringify(p.attrs), l.unit_cents - Math.floor((await q.query<{ s: number }>("SELECT COALESCE(SUM(refund_cents),0)::int AS s FROM cases WHERE line_id = $1 AND issue = 'price_drop' AND status = 'resolved'", [lineId])).rows[0].s / l.qty), wallIso(now).slice(0, 10), lineId,
      new Date(now.getTime() + m.return_policy.window_days * 864e5).toISOString().slice(0, 10), addMonths(now, p.warranty_months).toISOString().slice(0, 10),
    ]);
    const open = (await q.query("SELECT 1 FROM order_lines WHERE order_id = $1 AND status NOT IN ('delivered','swapped','cancelled','returned')", [l.oid])).rows.length;
    if (!open) await q.query("UPDATE orders SET status = 'delivered' WHERE id = $1", [l.oid]);
    await logEvent(q, a, "order", l.oid, "line.delivered", `${l.title} delivered${note ? ` (${note})` : ""}; added to your possessions with returns until ${new Date(now.getTime() + m.return_policy.window_days * 864e5).toISOString().slice(0, 10)}`, "Northlight Supply");
    // A delivered replacement closes the case that asked for it.
    const rc = (await q.query<any>("UPDATE cases SET status = 'resolved', resolved_at = now() WHERE replacement_line_id = $1 AND status = 'replacing' RETURNING number", [lineId])).rows[0];
    if (rc) await logEvent(q, a, "order", l.oid, "case.resolved", `${rc.number}: replacement delivered. Case resolved.`, "Northlight Supply");
    await notify(q, a.id, "telegram", `📦 ${l.title} delivered.`);
  });
}

/** The merchant reports a backorder; Everyday checks the plan deadline and prepares a swap offer. */
export async function backorderLine(lineId: string, days: number) {
  const db = await getDb();
  return db.tx(async (q) => {
    const l = await lineWithOrder(q, lineId);
    if (!["ordered", "pending"].includes(l.status)) throw new GtError(`This line is ${l.status}.`, "bad_state", 409);
    const a = await accountById(q, l.account_id);
    const i = await intentRow(q, a, l.intent_id);
    const now = nowOf(a);
    const m = await merchantRow(q, l.merchant_id);
    const eta = wallIso(addWorkDays(now, days + m.shipping.standard_days)).slice(0, 10);
    await q.query("UPDATE order_lines SET status = 'backordered', eta = $2 WHERE id = $1", [lineId, eta]);
    const cat = await catalog(q);
    const orig = cat.byId.get(l.product_id)!;
    const reqs = J<Reqs>(i.reqs);
    const owned = await ownedOf(q, a.id, i.recipient_id);
    const mon = owned.find((o) => o.category === "monitor");
    const ctx = { laptop_port: reqs.laptop_port, monitor: mon ? { title: mon.title, inputs: mon.attrs.inputs ?? [], vesa: mon.attrs.vesa_mount ?? null } : null, require_ergonomic: reqs.require_ergonomic, owned_categories: new Map<string, string>(), replace_categories: new Set<string>() };
    const swap = m.return_policy.swap
      ? cat.products.filter((p) => p.category === orig.category && p.id !== orig.id && p.checkout && p.stock > 0 && p.price_cents <= orig.price_cents && check({ category: p.category, attrs: p.attrs, stock: p.stock, checkout: p.checkout }, ctx).ok).sort((x, y) => y.price_cents - x.price_cents)[0]
      : undefined;
    const late = i.deadline && eta > i.deadline;
    const offer = swap ? { product_id: swap.id, title: swap.title, price_cents: swap.price_cents, diff_cents: orig.price_cents - swap.price_cents, eta: wallIso(addWorkDays(now, m.shipping.standard_days)).slice(0, 10) } : null;
    await q.query("UPDATE order_lines SET swap_offer = $2 WHERE id = $1", [lineId, offer ? JSON.stringify(offer) : null]);
    await logEvent(q, a, "order", l.oid, "line.backordered", `${l.title} is backordered; new ETA ${eta}${late ? ` — after your ${i.deadline} deadline` : ""}.${offer ? ` Northlight offers ${offer.title} (in stock, ${money(offer.price_cents)}${offer.diff_cents ? `, ${money(offer.diff_cents)} back to you` : ""}).` : ""}`, "Northlight Supply");
    await notify(q, a.id, "telegram", `⚠️ ${l.title} is delayed to ${eta}${late ? `, after your ${i.deadline} deadline` : ""}.${offer ? ` In-stock option: ${offer.title}${offer.diff_cents ? ` (${money(offer.diff_cents)} refunded)` : ""}. Review in Everyday.` : ""}`);
    return { eta, late, offer };
  });
}

/** The shopper accepts an equal-or-cheaper in-stock swap: line replaced, difference refunded on the same capture. */
export async function acceptSwap(a: Account, lineId: string) {
  const db = await getDb();
  const prep = await db.tx(async (q) => {
    const l = await lineWithOrder(q, lineId);
    if (l.account_id !== a.id) throw new GtError("Line not found", "not_found", 404);
    if (l.status === "swapped") return { l, offer: J<any>(l.swap_offer), already: true };
    const offer = J<any>(l.swap_offer);
    if (l.status !== "backordered" || !offer) throw new GtError("There is no swap offer on this line.", "bad_state", 409);
    const r = await q.query("UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock >= 1 RETURNING id", [offer.product_id]);
    if (!r.rows.length) throw new GtError("The swap item just sold out.", "stock", 409);
    const newLine = newId("oln");
    await q.query("INSERT INTO order_lines (id, order_id, product_id, slot, title, qty, unit_cents, status, eta) VALUES ($1,$2,$3,$4,$5,1,$6,'ordered',$7)", [newLine, l.oid, offer.product_id, l.slot, offer.title, offer.price_cents, offer.eta]);
    await q.query("UPDATE order_lines SET status = 'swapped', replaced_by = $2 WHERE id = $1", [lineId, newLine]);
    await q.query("UPDATE products SET stock = stock + 1 WHERE id = $1", [l.product_id]);
    await logEvent(q, a, "order", l.oid, "line.swapped", `${a.name} accepted ${offer.title} instead of ${l.title} (arrives ${offer.eta})`, a.name);
    return { l, offer, already: false };
  });
  if (prep.offer.diff_cents > 0) await refund(prep.l.oid, prep.offer.diff_cents, `swap:${lineId}`, `Price difference: ${prep.offer.title} instead of ${prep.l.title}`, null);
  return prep.offer;
}

// ---------- Cases ----------

export async function openCase(a: Account, lineId: string, issue: "damaged" | "wrong" | "late" | "change_of_mind" | "defective", claim: string, hasPhoto: boolean) {
  const db = await getDb();
  return db.tx(async (q) => {
    const l = await lineWithOrder(q, lineId);
    if (l.account_id !== a.id) throw new GtError("Line not found", "not_found", 404);
    const m = await merchantRow(q, l.merchant_id);
    const cat = await catalog(q);
    const p = cat.byId.get(l.product_id)!;
    const now = nowOf(a);
    const el = returnEligibility(m.return_policy, { category: p.category, price_cents: l.unit_cents, delivered_at: l.delivered_at ? wall(l.delivered_at) : null, opened: l.opened }, issue, now);
    const observations = [l.delivered_at ? `Delivered ${l.delivered_at.replace("T", " ")} (merchant record).` : "Not delivered yet (merchant record).", `Paid ${money(l.unit_cents)} in ${l.number}.`];
    const missing = issue === "damaged" && !hasPhoto ? [{ key: "photo", question: "Add a photo of the damage." }] : [];
    const partial = Math.round((l.unit_cents * m.return_policy.partial_pct) / 100 / 100) * 100;
    const options = el.eligible
      ? [
          ...(issue === "damaged" && partial > 0 ? [{ key: "partial", label: `Keep it and get ${money(partial)} back`, refund_cents: partial }] : []),
          { key: "return", label: `Return it for ${money(l.unit_cents - el.fee_cents)}${el.fee_cents ? ` (after a ${money(el.fee_cents)} fee)` : ""}`, refund_cents: l.unit_cents - el.fee_cents },
          ...(issue !== "change_of_mind" ? [{ key: "replace", label: "Send a replacement", refund_cents: 0 }] : []),
        ]
      : [];
    const n = (await q.query<{ c: number }>("SELECT count(*)::int AS c FROM cases WHERE order_id = $1", [l.oid])).rows[0].c + 1;
    const id = newId("cas");
    const flags = scanText(claim);
    await q.query("INSERT INTO cases (id, number, order_id, line_id, issue, claim, observations, missing, eligibility, options, status, flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [id, `${l.number}-C${n}`, l.oid, lineId, issue, claim.slice(0, 1000), JSON.stringify(observations), JSON.stringify(missing), JSON.stringify(el), JSON.stringify(options), missing.length ? "needs_info" : el.eligible ? "choose" : "not_eligible", JSON.stringify(flags)]);
    await logEvent(q, a, "order", l.oid, "case.opened", `${a.name} reported ${l.title} ${issue.replace(/_/g, " ")}: ${el.eligible ? `eligible until ${el.until?.toISOString().slice(0, 10)}, ${options.length} remedy option(s)` : el.reasons.join(" ")}${flags.length ? "; instruction-like text ignored" : ""}`, a.name);
    return id;
  });
}

export async function requestRemedy(a: Account, caseId: string, key: string) {
  const db = await getDb();
  await db.tx(async (q) => {
    const c = (await q.query<any>("SELECT c.*, o.account_id FROM cases c JOIN orders o ON o.id = c.order_id WHERE c.id = $1 FOR UPDATE", [caseId])).rows[0];
    if (!c || c.account_id !== a.id) throw new GtError("Case not found", "not_found", 404);
    if (c.requested) return;
    if (c.status !== "choose") throw new GtError("This case is not ready for a remedy.", "bad_state", 409);
    const opt = J<any[]>(c.options).find((o) => o.key === key);
    if (!opt) throw new GtError("Choose one of the options.", "invalid");
    await q.query("UPDATE cases SET requested = $2, refund_cents = $3, status = 'awaiting_merchant' WHERE id = $1", [c.id, key, opt.refund_cents]);
    await logEvent(q, a, "order", c.order_id, "case.requested", `${a.name} asked for: ${opt.label}`, a.name);
  });
}

/** The connected test merchant decides; an approved refund runs on PayPal and is verified before the case closes. */
export async function merchantDecide(caseId: string, approve: boolean, note: string) {
  const db = await getDb();
  const c = (await db.query<any>("SELECT c.*, o.account_id FROM cases c JOIN orders o ON o.id = c.order_id WHERE c.id = $1", [caseId])).rows[0];
  if (!c) throw new GtError("Case not found", "not_found", 404);
  if (c.status !== "awaiting_merchant") throw new GtError(`This case is ${c.status.replace("_", " ")}.`, "bad_state", 409);
  const a = await accountById(db, c.account_id);
  if (!approve) {
    await db.query("UPDATE cases SET status = 'declined', merchant_decision = $2, resolved_at = now() WHERE id = $1", [c.id, JSON.stringify({ approve, note })]);
    await logEvent(db, a, "order", c.order_id, "case.declined", `Northlight declined ${c.number}: ${note}`, "Northlight Supply");
    return;
  }
  if (c.requested === "replace") {
    await db.tx(async (q) => {
      const l = await lineWithOrder(q, c.line_id);
      if ((await q.query("SELECT 1 FROM order_lines WHERE replaces_line_id = $1", [l.id])).rows.length) return;
      const m = await merchantRow(q, l.merchant_id);
      const now = nowOf(a);
      const inStock = (await q.query("UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock >= 1 RETURNING id", [l.product_id])).rows.length > 0;
      const newLine = newId("oln");
      const eta = wallIso(addWorkDays(now, (inStock ? 0 : 5) + m.shipping.standard_days)).slice(0, 10);
      await q.query("INSERT INTO order_lines (id, order_id, product_id, slot, title, qty, unit_cents, status, eta, replaces_line_id) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9)", [newLine, l.oid, l.product_id, l.slot, `${l.title} (replacement)`, l.unit_cents, inStock ? "ordered" : "backordered", eta, l.id]);
      await q.query("UPDATE cases SET merchant_decision = $2, status = 'replacing', replacement_line_id = $3 WHERE id = $1", [c.id, JSON.stringify({ approve, note }), newLine]);
      await q.query("UPDATE owned_items SET status = 'returned' WHERE order_line_id = $1", [l.id]);
      await q.query("UPDATE orders SET status = 'paid' WHERE id = $1 AND status = 'delivered'", [l.oid]);
      await logEvent(q, a, "order", c.order_id, "case.approved", `Northlight approved ${c.number} (replace)${note ? `: ${note}` : ""}; replacement ${inStock ? "ordered" : "backordered"}, ETA ${eta}. The case closes when it is delivered.`, "Northlight Supply");
      await notify(q, a.id, "telegram", `📦 ${c.number}: a replacement ${l.title} is on its way (ETA ${eta}).`);
    });
    return;
  }
  await db.query("UPDATE cases SET merchant_decision = $2, status = $3 WHERE id = $1", [c.id, JSON.stringify({ approve, note }), c.refund_cents > 0 ? "refunding" : "resolved"]);
  await logEvent(db, a, "order", c.order_id, "case.approved", `Northlight approved ${c.number} (${c.requested})${note ? `: ${note}` : ""}`, "Northlight Supply");
  if (c.requested === "return") await db.query("UPDATE owned_items SET status = 'returned' WHERE order_line_id = $1", [c.line_id]);
  if (c.refund_cents > 0) {
    await preApprove(MERCHANT, "case", c.id, "refund", c.refund_cents, "Northlight Supply (merchant console)");
    const failed = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM payment_ops WHERE case_id = $1 AND kind = 'refund' AND status = 'failed'", [c.id])).rows[0].n;
    try {
      await refund(c.order_id, c.refund_cents, failed ? `case:${c.id}:r${failed + 1}` : `case:${c.id}`, `${c.number}: ${c.requested} remedy`, c.id);
    } catch (e) {
      // PayPal refused it outright: nothing was returned, so the case goes back to the merchant to retry or decide again.
      if (e instanceof GtError && e.code === "paypal") await releaseRefusedCases(db, c.id);
      throw e;
    }
    await verifyRefunds();
  }
}
