import { getDb, type Queryable } from "../db.js";
import { wall } from "../core/time.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { accountById, J, logEvent, notify, nowIso, type Account } from "../store.js";

/**
 * Price protection: a merchant promise, not a PayPal feature. If the merchant's own recorded price for the same
 * item drops inside the window its policy (as it stood when the order was placed) allows, the shopper can claim the
 * difference. The merchant approves it, and the refund goes back on the original PayPal capture through the
 * existing case flow. Everyday only proposes; nothing is refunded without the merchant's approval and PayPal's
 * confirmation.
 */

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const OPEN = ["awaiting_merchant", "refunding"];
const COUNTED = ["awaiting_merchant", "refunding", "resolved"];

export interface Protection {
  line_id: string;
  order_id: string;
  order_number: string;
  title: string;
  paid_unit_cents: number;
  protected_unit_cents: number;
  now_cents: number;
  qty: number;
  eligible: boolean;
  amount_cents: number;
  reasons: string[];
  clause: string | null;
  policy_version: string | null;
  evidence: string | null;
  open_case: string | null;
}

/** Every paid line of this shopper whose product is now cheaper, with the decision and the reasons for it. */
export async function protectionsFor(q: Queryable, a: Account, lineId?: string): Promise<Protection[]> {
  const rows = (
    await q.query<any>(
      `SELECT l.*, o.number, o.status AS order_status, o.capture_id, o.policy, o.gross_cents, o.refunded_cents, m.return_policy AS current_policy,
              p.price_cents AS now_cents, p.stock, COALESCE((m.caps->>'checkout')::boolean, false) AS checkout, p.title AS product_title
         FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN merchants m ON m.id = o.merchant_id JOIN products p ON p.id = l.product_id
        WHERE o.account_id = $1 AND ($2::text IS NULL OR l.id = $2) AND p.price_cents < l.unit_cents`,
      [a.id, lineId ?? null],
    )
  ).rows;
  const today = nowIso(a).slice(0, 10);
  const out: Protection[] = [];
  for (const l of rows) {
    const policy = J<any>(l.policy) ?? null;
    const reasons: string[] = [];
    const daysAllowed = Number(policy?.price_protection_days ?? 0);
    if (!policy) reasons.push("The merchant's policy at the time of purchase wasn't recorded, so Everyday can't show the clause that applies.");
    else if (!daysAllowed) reasons.push(`${policy.version ?? "The merchant's policy"} has no price protection.`);
    if (["created", "cancelled"].includes(l.order_status) || !l.capture_id) reasons.push("This order isn't paid.");
    if (!["ordered", "shipped", "delivered"].includes(l.status)) reasons.push(`This item is ${l.status}, not something you still have on this order.`);
    const returned = (await q.query("SELECT 1 FROM owned_items WHERE order_line_id = $1 AND status = 'returned'", [l.id])).rows.length;
    if (returned) reasons.push("You returned this item.");
    if (daysAllowed && l.delivered_at) {
      const lastDay = new Date(wall(l.delivered_at.slice(0, 10)).getTime() + daysAllowed * 864e5).toISOString().slice(0, 10);
      if (today > lastDay) reasons.push(`The ${daysAllowed}-day window after delivery ended ${lastDay}.`);
    }
    if (!l.checkout || l.stock <= 0) reasons.push("The lower price isn't available to buy right now (out of stock), so it doesn't count.");
    // Evidence: the lower price must be one the merchant recorded, not a price seen elsewhere.
    const ev = (await q.query<any>("SELECT * FROM price_history WHERE product_id = $1 ORDER BY id DESC LIMIT 1", [l.product_id])).rows[0];
    if (!ev || ev.price_cents !== l.now_cents) reasons.push("There is no recorded merchant price change for the current price.");
    // Earlier claims on this line already brought the price down; only a further drop counts.
    const prior = (await q.query<any>("SELECT number, status, refund_cents FROM cases WHERE line_id = $1 AND issue = 'price_drop' AND status = ANY($2)", [l.id, COUNTED])).rows;
    const priorCents = prior.reduce((s, c) => s + (c.refund_cents ?? 0), 0);
    const protectedUnit = l.unit_cents - Math.floor(priorCents / l.qty);
    const open = prior.find((c) => OPEN.includes(c.status));
    if (open) reasons.push(`${open.number} is already with the merchant for this item.`);
    const amount = (protectedUnit - l.now_cents) * l.qty;
    if (amount <= 0 && !open) reasons.push(`You already got the difference down to ${money(protectedUnit)}.`);
    const left = (l.gross_cents ?? 0) - l.refunded_cents;
    if (amount > left) reasons.push(`Only ${money(left)} is left to refund on ${l.number}.`);
    out.push({
      line_id: l.id,
      order_id: l.order_id,
      order_number: l.number,
      title: l.title,
      paid_unit_cents: l.unit_cents,
      protected_unit_cents: protectedUnit,
      now_cents: l.now_cents,
      qty: l.qty,
      eligible: reasons.length === 0,
      amount_cents: Math.max(0, amount),
      reasons,
      clause: policy?.price_protection_clause ?? null,
      policy_version: policy?.version ?? null,
      evidence: ev ? `Merchant recorded ${money(ev.price_cents)} at ${String(ev.wall).replace("T", " ")}` : null,
      open_case: open?.number ?? null,
    });
  }
  return out;
}

/** The shopper asks for the difference. Re-checked inside the transaction; the merchant still has to approve. */
export async function claimPriceProtection(a: Account, lineId: string) {
  const db = await getDb();
  return db.tx(async (q) => {
    const locked = (await q.query<any>("SELECT l.id, o.account_id FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.id = $1 FOR UPDATE", [lineId])).rows[0];
    if (!locked || locked.account_id !== a.id) throw new GtError("Item not found", "not_found", 404);
    const pr = (await protectionsFor(q, a, lineId))[0];
    if (!pr) throw new GtError("This item isn't cheaper now than what you paid.", "not_cheaper", 409);
    if (!pr.eligible) throw new GtError(pr.reasons.join(" "), "not_eligible", 409);
    const n = (await q.query<{ c: number }>("SELECT count(*)::int AS c FROM cases WHERE order_id = $1", [pr.order_id])).rows[0].c + 1;
    const id = newId("cas");
    const number = `${pr.order_number}-C${n}`;
    const observations = [
      `Paid ${money(pr.paid_unit_cents)} each${pr.protected_unit_cents !== pr.paid_unit_cents ? ` (already protected down to ${money(pr.protected_unit_cents)})` : ""} × ${pr.qty}.`,
      `${pr.evidence}.`,
      `Policy ${pr.policy_version}: "${pr.clause}"`,
    ];
    const eligibility = { eligible: true, reasons: [`Same item from the same merchant, in stock, inside the window of ${pr.policy_version}.`] };
    await q.query(
      "INSERT INTO cases (id, number, order_id, line_id, issue, claim, observations, missing, eligibility, options, requested, refund_cents, status) VALUES ($1,$2,$3,$4,'price_drop',$5,$6,'[]',$7,$8,'price_protection',$9,'awaiting_merchant')",
      [id, number, pr.order_id, lineId, `Price protection: ${pr.title} is now ${money(pr.now_cents)}; asking for the ${money(pr.amount_cents)} difference.`, JSON.stringify(observations), JSON.stringify(eligibility), JSON.stringify([{ key: "price_protection", label: `Refund the ${money(pr.amount_cents)} difference`, refund_cents: pr.amount_cents }]), pr.amount_cents],
    );
    await logEvent(q, a, "order", pr.order_id, "case.price_protection", `${a.name} claimed price protection on ${pr.title}: ${money(pr.amount_cents)} (${pr.evidence}; ${pr.policy_version})`, a.name);
    return { id, number, amount_cents: pr.amount_cents };
  });
}

/** After a merchant price drop: tell each owner whose line is now eligible. Nothing is claimed for them. */
export async function announceProtections(productId: string) {
  const db = await getDb();
  const owners = (await db.query<any>("SELECT DISTINCT o.account_id FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.product_id = $1 AND o.capture_id IS NOT NULL", [productId])).rows;
  let n = 0;
  for (const { account_id } of owners) {
    const a = await accountById(db, account_id);
    for (const pr of (await protectionsFor(db, a)).filter((x) => x.eligible)) {
      const lines = (await db.query("SELECT 1 FROM order_lines WHERE id = $1 AND product_id = $2", [pr.line_id, productId])).rows.length;
      if (!lines) continue;
      await notify(db, a.id, "telegram", `💲 ${pr.title} is now ${money(pr.now_cents)}; you paid ${money(pr.protected_unit_cents)}. Under ${pr.policy_version} you can ask for the ${money(pr.amount_cents)} difference in Everyday.`);
      n++;
    }
  }
  return n;
}
