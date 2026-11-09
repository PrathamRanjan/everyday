/**
 * Safety layer for Everyday (SAFETY_ACCESSIBILITY_SPEC §4, §6 Everyday row). Rules (A) and the synthetic-data risk
 * model (C) are tied to the shopper's own records: is this the first payment to this seller, is the seller a
 * marketplace discovery rather than the test merchant, how does the amount compare with the shopper's history, how
 * many new sellers in the last ten minutes, and what do inbound messages ask for. Protected mode turns the
 * first-payment-to-a-new-seller caution into a hold that waits for the shopper's trusted contact to see it.
 * The browser text model (B) explains messages on /safety; its scores never reach the gate.
 *
 * Reads the database only; never imports the PayPal client or the services.
 */
import type { Queryable } from "../db.js";
import { getDb } from "../db.js";
import { nowOf, putSetting, setting, type Account } from "../store.js";
import { maxLevel, payeeRules, scanText, TACTIC_WORDS, type Level, type RuleResult, type Tactic } from "./rules.js";
import { riskLevel, riskScore } from "./risk.js";

export interface Assessment {
  level: Level;
  rule: string | null;
  reasons: string[];
  risk: number;
  tactics: Tactic[];
  summary: string;
}

const median = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

/** Assess a purchase (order or repeat buy) for a shopper's account. */
export async function assessPurchase(accountId: string, merchantId: string | null, cents: number, q?: Queryable): Promise<Assessment> {
  const db = q ?? (await getDb());
  const a = (await db.query<Account>("SELECT * FROM accounts WHERE id = $1", [accountId])).rows[0];
  const m = merchantId ? (await db.query<any>("SELECT * FROM merchants WHERE id = $1", [merchantId])).rows[0] : null;
  const history = (await db.query<any>("SELECT coalesce(gross_cents, total_cents) AS c FROM orders WHERE account_id = $1 AND status NOT IN ('created','cancelled')", [accountId])).rows.map((r: any) => Number(r.c));
  const withSeller = merchantId ? (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM orders WHERE account_id = $1 AND merchant_id = $2 AND status NOT IN ('created','cancelled')", [accountId, merchantId])).rows[0]?.n ?? 0 : 0;
  const recentNew = (await db.query<{ n: number }>("SELECT count(DISTINCT merchant_id)::int AS n FROM orders o WHERE o.account_id = $1 AND o.created_at > now() - interval '10 minutes' AND NOT EXISTS (SELECT 1 FROM orders p WHERE p.account_id = o.account_id AND p.merchant_id = o.merchant_id AND p.status NOT IN ('created','cancelled') AND p.created_at < o.created_at)", [accountId])).rows[0]?.n ?? 0;
  const day = (await db.query<{ s: number }>("SELECT coalesce(sum(total_cents),0)::int AS s FROM orders WHERE account_id = $1 AND created_at > now() - interval '24 hours' AND status <> 'cancelled'", [accountId])).rows[0]?.s ?? 0;
  const prot = await protectedMode(accountId, db);
  const firstPayment = Boolean(m) && Number(withSeller) === 0;
  const res = payeeRules({
    // A seller the shopper has paid before is established; a first payment is a "new payee" (age 0) only for marketplace discoveries, which carry the scam risk.
    payeeAgeDays: firstPayment && m?.kind === "discovery" ? 0 : null,
    detailsChangedDaysAgo: null,
    detailsChangeSource: null,
    amountCents: cents,
    historyMedianCents: median(history),
    velocity10m: Number(recentNew),
    velocity24hSumRatio: (Number(day) + cents) / Math.max(1, median(history) ?? cents),
    requestChannelUntrusted: false,
    hourLocal: a ? nowOf(a).getUTCHours() : 12,
    text: null,
  });
  const out = combine(res);
  // A shopper approves every checkout on PayPal, so an amount above their own cross-seller history is a caution to read, not a hold; holds come from new web-found sellers, velocity, message tactics and protected mode.
  if (out.level === "hold" && out.rule === "amount_vs_history") {
    out.level = "caution";
    out.summary = `caution: ${out.reasons[0]} (risk ${(out.risk * 100).toFixed(0)}%)`;
  }
  out.reasons = out.reasons.map((r) => r.replace("this payee's usual payment", "your usual order"));
  if (firstPayment && m) {
    const why = `First payment to ${m.name}${m.kind === "discovery" ? ", a seller found on the open web" : ""}.`;
    if (!out.reasons.includes(why)) out.reasons.unshift(why);
    if (prot.on && out.level !== "hold") {
      out.level = "hold";
      out.rule = "protected_first_payment";
      out.reasons.unshift("Protected mode is on: the first payment to any new seller waits for your approval.");
    } else if (out.level === "clear") {
      out.level = "caution";
      out.rule = out.rule ?? "first_payment";
    }
    out.summary = `${out.level}: ${out.reasons[0]} (risk ${(out.risk * 100).toFixed(0)}%)`;
  }
  return out;
}

function combine(res: RuleResult): Assessment {
  const risk = safeRisk(res.features);
  const level = maxLevel(res.level, riskLevel(risk));
  const reasons = res.reasons.slice();
  const rule = res.rule ?? (level !== "clear" ? "risk_model" : null);
  if (res.level === "clear" && level !== "clear") reasons.push(`The payment-risk model scores this ${(risk * 100).toFixed(0)}% (synthetic training data; a ranking signal, not a fraud rate).`);
  const summary = level === "clear" ? `no scam signals; risk ${(risk * 100).toFixed(0)}%` : `${level}: ${reasons[0]} (risk ${(risk * 100).toFixed(0)}%)`;
  return { level, rule, reasons, risk, tactics: res.scan.fired, summary };
}

function safeRisk(features: Record<string, number>): number {
  try {
    return riskScore(features);
  } catch {
    return 0;
  }
}

/** A pasted or inbound seller message on its own. Rules only on the server; the browser adds the text model. */
export function assessMessage(text: string): Assessment & { words: string[] } {
  const scan = scanText(text);
  const res = payeeRules({ payeeAgeDays: null, detailsChangedDaysAgo: null, detailsChangeSource: null, amountCents: 1, historyMedianCents: null, velocity10m: 0, velocity24hSumRatio: 1, requestChannelUntrusted: true, hourLocal: 12, text });
  const out = combine(res);
  out.reasons = out.reasons.filter((r) => !r.startsWith("The request to pay arrived"));
  if (out.reasons.length === 0) out.level = "clear";
  return { ...out, words: scan.fired.map((t) => TACTIC_WORDS[t]) };
}

/** Protected mode (§4.5) per shopper account. */
export async function protectedMode(accountId: string, q?: Queryable): Promise<{ on: boolean; contacts: string[] }> {
  const db = q ?? (await getDb());
  const v = await setting(db, `protected:${accountId}`);
  if (!v) return { on: false, contacts: [] };
  try {
    return JSON.parse(v);
  } catch {
    return { on: false, contacts: [] };
  }
}
export async function setProtectedMode(accountId: string, on: boolean, contacts: string[], q?: Queryable) {
  const db = q ?? (await getDb());
  await putSetting(db, `protected:${accountId}`, JSON.stringify({ on, contacts: contacts.filter(Boolean).slice(0, 2) }));
}

/** Holds the safety layer created for this shopper, newest first. */
export async function safetyHolds(accountId: string, q?: Queryable) {
  const db = q ?? (await getDb());
  return (await db.query<any>("SELECT * FROM approvals WHERE owner_id = $1 AND payload->>'safety_rule' IS NOT NULL ORDER BY created_at DESC LIMIT 20", [accountId])).rows.map((r) => ({ ...r, payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload }));
}
