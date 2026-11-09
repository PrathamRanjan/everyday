/**
 * Mandate backtest and earned autonomy (roadmap B.6). Replays a seeded year of the shopper's purchases through a
 * candidate mandate and reports what would have run, waited for a tap, or been refused; and the dollars that would
 * have moved without the shopper. Earned autonomy suggests limits the shopper's own approvals support.
 */
import type { Queryable } from "../db.js";
import { getDb } from "../db.js";
import { categoryBlocked, RulesSchema, type Rules } from "./policy.js";

export interface BacktestRow {
  id: string;
  at: Date;
  category: string;
  merchant: string;
  price_cents: number;
  refund_cents: number;
  repeat: boolean;
  outcome: "run" | "wait" | "deny";
  reason: string;
}

export interface Backtest {
  days: number;
  purchases: number;
  run: number;
  wait: number;
  deny: number;
  auto_cents: number;
  held_cents: number;
  recovered_cents: number;
  rows: BacktestRow[];
}

export async function backtest(rules: Rules, days = 365, q?: Queryable): Promise<Backtest> {
  const db = q ?? (await getDb());
  const hist = (await db.query<any>("SELECT * FROM purchase_history WHERE at > now() - ($1 || ' days')::interval ORDER BY at", [String(days)])).rows;
  const out: Backtest = { days, purchases: hist.length, run: 0, wait: 0, deny: 0, auto_cents: 0, held_cents: 0, recovered_cents: 0, rows: [] };
  for (const h of hist) {
    const price = Number(h.price_cents);
    const refund = Number(h.refund_cents ?? 0);
    const repeat = Boolean(h.repeat);
    let outcome: BacktestRow["outcome"] = "run";
    let reason = repeat ? "repeat buy within the mandate" : "shopper approves on PayPal; within the mandate";
    if (price > rules.max_purchase_cents) (outcome = "deny"), (reason = `price ${price} > largest single purchase ${rules.max_purchase_cents}`);
    else if (categoryBlocked(rules, String(h.category))) (outcome = "deny"), (reason = `category ${h.category} is blocked`);
    else if (rules.allowed_merchants.length && !rules.allowed_merchants.some((m) => String(h.merchant).toLowerCase().includes(m.toLowerCase()))) (outcome = "deny"), (reason = `merchant ${h.merchant} not on the list`);
    else if (repeat && !rules.one_tap_repeat) (outcome = "wait"), (reason = "repeat buys need a tap: one-tap is off");
    else if (repeat && price >= rules.approve_above_cents) (outcome = "wait"), (reason = `repeat buy ${price} >= approval threshold ${rules.approve_above_cents}`);
    out[outcome] += 1;
    if (outcome === "run" && repeat) out.auto_cents += price;
    else if (outcome === "wait") out.held_cents += price;
    out.recovered_cents += refund;
    out.rows.push({ id: h.id, at: h.at, category: h.category, merchant: h.merchant, price_cents: price, refund_cents: refund, repeat, outcome, reason });
  }
  return out;
}

export interface Suggestion {
  field: keyof Rules;
  current: number | boolean;
  suggested: number | boolean;
  basis: string;
}

/** Earned autonomy: limits the shopper's own decisions support. Never suggests past a declined value. */
export async function suggestAutonomy(ownerId: string, rules: Rules, q?: Queryable): Promise<Suggestion[]> {
  const db = q ?? (await getDb());
  const approvals = (await db.query<{ action: string; status: string; payload: any }>("SELECT action, status, payload FROM approvals WHERE owner_id = $1 ORDER BY created_at", [ownerId])).rows;
  const approved = approvals.filter((a) => a.status === "approved").map((a) => Number(a.payload?.cents ?? 0));
  const declined = approvals.filter((a) => a.status === "declined").map((a) => Number(a.payload?.cents ?? 0));
  const out: Suggestion[] = [];
  if (approved.length >= 3) {
    const sorted = [...approved].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    const ceiling = declined.length ? Math.min(...declined) - 1 : Infinity;
    const suggested = Math.min(p80, ceiling);
    if (suggested > rules.approve_above_cents) out.push({ field: "approve_above_cents", current: rules.approve_above_cents, suggested, basis: `${approved.length} repeat buys approved by hand; 80% were at or below this${declined.length ? "; never above the smallest you declined" : ""}` });
  }
  const repeats = (await db.query<{ n: string }>("SELECT count(*) AS n FROM purchase_history WHERE repeat AND approved_by_hand")).rows[0];
  const disputed = (await db.query<{ n: string }>("SELECT count(*) AS n FROM cases WHERE status IN ('awaiting_merchant','refunding')")).rows[0];
  if (Number(repeats?.n ?? 0) >= 6 && Number(disputed?.n ?? 0) === 0 && !rules.one_tap_repeat) out.push({ field: "one_tap_repeat", current: false, suggested: true, basis: `${repeats.n} repeat buys approved by hand with no open case` });
  return out;
}

export function applySuggestions(rules: Rules, picks: Suggestion[]): Rules {
  const next: any = { ...rules };
  for (const p of picks) next[p.field] = p.suggested;
  return RulesSchema.parse(next);
}
