/**
 * Dry run and the money gate (roadmap B.6). Every PayPal write is simulated against live PayPal state and the owner's
 * mandate before PayPal is called. In Everyday the writes are: the checkout order (shopper approves on PayPal), the
 * capture after approval (payer-initiated), refunds (merchant side: swap difference, case remedy, price protection),
 * repeat buys on the saved PayPal (merchant-initiated on the shopper's behalf: the one that most needs a gate), and
 * tracking/evidence writes which carry no money.
 */
import { createHash } from "node:crypto";
import { config } from "../config.js";
import type { Queryable } from "../db.js";
import { getDb } from "../db.js";
import { newId } from "../lib/ids.js";
import { paypal } from "../paypal/index.js";
import type { Run } from "../trace.js";
import { notifyParty } from "../channels/index.js";
import { appendAudit } from "./audit.js";
import { isKilled } from "./kill.js";
import { categoryBlocked, MERCHANT, rulesFor } from "./policy.js";
import { moneyArgumentOk } from "./provenance.js";

export type MoneyAction = "order" | "capture" | "refund" | "repeat_buy" | "tracking" | "evidence";

export interface MoneyMove {
  action: MoneyAction;
  /** Whose mandate applies: the shopper's account id for orders and repeat buys, MERCHANT for refunds. */
  ownerId: string;
  /** Kill-switch scope for the actor: "agent:<id>", "shopper", "merchant", "worker". The owner's own scope is always checked too. */
  agentScope: string;
  entity: string;
  entityId: string;
  cents: number;
  /** Amounts code or PayPal derived this move from (quote total, line price, case option). */
  trustedCents: number[];
  captureId?: string | null;
  orderId?: string | null;
  merchantName?: string | null;
  category?: string | null;
  /** The shopper approves this exact amount on PayPal themselves: the approval threshold does not apply. */
  customerInitiated?: boolean;
}

export type GateVerdict = { gate: "allowed"; checks: string[] } | { gate: "dry_run_refused" | "denied"; reason: string; checks: string[] } | { gate: "held"; approvalId: string; reason: string; checks: string[] };

export class HeldForApproval extends Error {
  constructor(readonly approvalId: string, msg: string) {
    super(msg);
  }
}
export class GateDenied extends Error {
  constructor(readonly gate: "dry_run_refused" | "denied", msg: string) {
    super(msg);
  }
}

export function payloadHash(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

export async function dryRun(m: MoneyMove, run?: Run | null, q?: Queryable): Promise<GateVerdict> {
  const db = q ?? (await getDb());
  const checks: string[] = [];
  const refuse = async (reason: string, gate: "dry_run_refused" | "denied" = "dry_run_refused"): Promise<GateVerdict> => {
    await run?.step({ actor: "guard", tool: `dry_run:${m.action}`, args: { cents: m.cents, entity: m.entity, entity_id: m.entityId }, gate, result: { reason, checks } });
    await appendAudit(`money.${gate}`, m.entity, m.entityId, { action: m.action, cents: m.cents, reason }, db);
    return { gate, reason, checks };
  };

  const ownerScope = m.ownerId === MERCHANT ? MERCHANT : `account:${m.ownerId}`;
  const killed = (await isKilled(ownerScope, db)) ?? (m.agentScope !== ownerScope ? await isKilled(m.agentScope, db) : null);
  if (killed) return refuse(`kill switch engaged (${killed.scope})${killed.reason ? `: ${killed.reason}` : ""}`, "denied");
  checks.push("kill switch clear");

  const moneyless = m.action === "tracking" || m.action === "evidence";
  if (!moneyless && (!Number.isInteger(m.cents) || m.cents <= 0)) return refuse(`amount ${m.cents} is not a positive whole number of cents`);
  if (!moneyless) {
    const prov = await moneyArgumentOk(m.entity, m.entityId, m.cents, m.trustedCents, db);
    if (!prov.ok) return refuse(prov.reason, "denied");
    checks.push(prov.reason);
  }

  const rules = await rulesFor(m.ownerId, db);
  if (m.action === "order" || m.action === "repeat_buy") {
    if (m.cents > rules.max_purchase_cents) return refuse(`${m.cents} cents exceeds the mandate's largest single purchase ${rules.max_purchase_cents}`, "denied");
    if (rules.allowed_merchants.length && m.merchantName && !rules.allowed_merchants.some((a) => m.merchantName!.toLowerCase().includes(a.toLowerCase()))) return refuse(`merchant ${m.merchantName} is not on the mandate's list`, "denied");
    if (categoryBlocked(rules, m.category)) return refuse(`category ${m.category} is blocked by the mandate`, "denied");
    const acct = (await db.query<any>("SELECT monthly_limit_cents FROM accounts WHERE id = $1", [m.ownerId])).rows[0];
    if (acct) {
      const month = new Date().toISOString().slice(0, 7);
      const spent = Number((await db.query<{ s: number }>("SELECT COALESCE(SUM(gross_cents - refunded_cents),0)::int AS s FROM orders WHERE account_id = $1 AND status NOT IN ('created','cancelled') AND to_char(created_at, 'YYYY-MM') = $2", [m.ownerId, month])).rows[0]?.s ?? 0);
      if (spent + m.cents > Number(acct.monthly_limit_cents)) return refuse(`${m.cents} cents would take this month past the stated limit (${spent} spent of ${acct.monthly_limit_cents})`, "denied");
      checks.push(`within the monthly limit (${spent} spent of ${acct.monthly_limit_cents})`);
    }
    if (m.action === "repeat_buy" && !rules.one_tap_repeat) return refuse("one-tap repeat buys are off in the mandate: the shopper approves each purchase on PayPal", "denied");
  }
  if (m.action === "refund" && m.ownerId === MERCHANT) {
    // What was paid for the thing being refunded: a line, a case's line, a dispute's order, or the order itself.
    const orderId = m.entity === "dispute" ? (await db.query<{ order_id: string }>("SELECT order_id FROM disputes WHERE id = $1", [m.entityId])).rows[0]?.order_id : m.entity === "case" ? (await db.query<{ order_id: string }>("SELECT order_id FROM cases WHERE id = $1", [m.entityId])).rows[0]?.order_id : m.entityId;
    const lineId = m.entity === "case" ? (await db.query<{ line_id: string }>("SELECT line_id FROM cases WHERE id = $1", [m.entityId])).rows[0]?.line_id : m.entityId;
    const line = lineId ? (await db.query<{ unit_cents: number; qty: number }>("SELECT unit_cents, qty FROM order_lines WHERE id = $1", [lineId])).rows[0] : null;
    const paid = line ? Number(line.unit_cents) * Number(line.qty) : orderId ? Number((await db.query<{ g: number }>("SELECT coalesce(gross_cents, total_cents) AS g FROM orders WHERE id = $1", [orderId])).rows[0]?.g ?? 0) : 0;
    if (paid > 0 && m.cents > Math.round((paid * rules.max_refund_pct) / 100) && !(await approvedFor(m.entity, m.entityId, m.action, m.cents, db))) return refuse(`refund ${m.cents} cents exceeds ${rules.max_refund_pct}% of the ${paid} cents paid and no person approved it`, "denied");
  }
  checks.push("within the mandate");

  // Live PayPal state. Read-only calls; nothing is written here.
  try {
    if (m.orderId && m.action === "capture") {
      const o = await paypal().getOrder(m.orderId);
      if (o.status !== "APPROVED") return refuse(`order ${m.orderId} is ${o.status}; the payer has not approved it`);
      const orderCents = Math.round(Number(o.purchase_units?.[0]?.amount?.value ?? 0) * 100);
      if (orderCents && m.cents !== orderCents) return refuse(`capture ${m.cents} does not match the order's ${orderCents}`);
      checks.push(`order ${o.status}, ${orderCents} cents`);
    }
    if (m.captureId && m.action === "refund") {
      const c = await paypal().getCapture(m.captureId);
      if (!["COMPLETED", "PARTIALLY_REFUNDED"].includes(c.status)) return refuse(`capture ${m.captureId} is ${c.status}; cannot refund`);
      const capCents = Math.round(Number(c.amount?.value ?? 0) * 100);
      if (m.cents > capCents) return refuse(`refund ${m.cents} exceeds capture ${capCents}`);
      checks.push(`capture ${c.status}, ${capCents} cents`);
    }
  } catch (e) {
    return refuse(`PayPal state could not be read: ${(e as Error).message.slice(0, 160)}`);
  }

  const needsPerson = !m.customerInitiated && (m.action === "repeat_buy" || m.action === "refund") && m.cents >= rules.approve_above_cents;
  if (needsPerson && !(await approvedFor(m.entity, m.entityId, m.action, m.cents, db))) {
    const payload = { action: m.action, entity: m.entity, entity_id: m.entityId, cents: m.cents };
    const existing = (await db.query<{ id: string }>("SELECT id FROM approvals WHERE owner_id = $1 AND payload_hash = $2 AND status = 'pending'", [m.ownerId, payloadHash(payload)])).rows[0];
    const approvalId = existing?.id ?? newId("apr");
    if (!existing) await db.query("INSERT INTO approvals (id, owner_id, action, payload_hash, payload) VALUES ($1,$2,$3,$4,$5)", [approvalId, m.ownerId, m.action, payloadHash(payload), JSON.stringify(payload)]);
    await run?.step({ actor: "guard", tool: `dry_run:${m.action}`, args: payload, gate: "held", result: { approval_id: approvalId, checks } });
    if (!existing) {
      await appendAudit("money.held", m.entity, m.entityId, { ...payload, approval_id: approvalId }, db);
      const big = m.cents > config.guard.countersignAboveCents;
      const party = m.ownerId === MERCHANT ? "merchant" : "shopper";
      await notifyParty(party, m.ownerId, `Everyday wants to ${m.action.replace("_", " ")} ${(m.cents / 100).toFixed(2)} on ${m.entity} ${m.entityId}. It is at or above your approval threshold.${big ? ` Above ${(config.guard.countersignAboveCents / 100).toFixed(2)} it needs your passkey.` : ""}`, big ? [{ id: `decline:${approvalId}`, label: "Decline" }] : [{ id: `approve:${approvalId}`, label: "Approve" }, { id: `decline:${approvalId}`, label: "Decline" }], "approval", approvalId, db).catch(() => undefined);
    }
    return { gate: "held", approvalId, reason: `${m.action} ${m.cents} cents is at or above the mandate's approval threshold ${rules.approve_above_cents}`, checks };
  }

  await run?.step({ actor: "guard", tool: `dry_run:${m.action}`, args: { cents: m.cents, entity: m.entity, entity_id: m.entityId }, gate: "allowed", result: { checks } });
  return { gate: "allowed", checks };
}

/** Runs the gate and throws when the move may not proceed; the caller maps HeldForApproval / GateDenied to its own states. */
export async function gate(m: MoneyMove, run?: Run | null, q?: Queryable): Promise<string[]> {
  const v = await dryRun(m, run, q);
  if (v.gate === "allowed") return v.checks;
  if (v.gate === "held") throw new HeldForApproval(v.approvalId, v.reason);
  throw new GateDenied(v.gate, v.reason);
}

/** Approval already granted for this exact payload? */
export async function approvedFor(entity: string, entityId: string, action: MoneyAction, cents: number, q?: Queryable): Promise<boolean> {
  const db = q ?? (await getDb());
  const h = payloadHash({ action, entity, entity_id: entityId, cents });
  const r = await db.query("SELECT 1 FROM approvals WHERE payload_hash = $1 AND status = 'approved' LIMIT 1", [h]);
  return r.rows.length > 0;
}

/** A person already decided this exact move (the merchant approved a case by hand): record it so the gate does not ask twice. */
export async function preApprove(ownerId: string, entity: string, entityId: string, action: MoneyAction, cents: number, by: string, q?: Queryable): Promise<void> {
  const db = q ?? (await getDb());
  const payload = { action, entity, entity_id: entityId, cents };
  const h = payloadHash(payload);
  const existing = (await db.query<{ id: string }>("SELECT id FROM approvals WHERE payload_hash = $1 AND status = 'approved'", [h])).rows[0];
  if (existing) return;
  await db.query("INSERT INTO approvals (id, owner_id, action, payload_hash, payload, status, method, decided_at) VALUES ($1,$2,$3,$4,$5,'approved','click',now())", [newId("apr"), ownerId, action, h, JSON.stringify({ ...payload, by })]);
  await appendAudit("money.preapproved", entity, entityId, { ...payload, by }, db);
}

export async function decideApproval(id: string, ownerId: string, approve: boolean, method: "passkey" | "click" | "agent-denied", q?: Queryable) {
  const db = q ?? (await getDb());
  const r = await db.query("UPDATE approvals SET status = $3, method = $4, decided_at = now() WHERE id = $1 AND owner_id = $2 AND status = 'pending' RETURNING payload", [id, ownerId, approve ? "approved" : "declined", method]);
  if (!r.rows.length) return null;
  await appendAudit(approve ? "approval.approved" : "approval.declined", "approval", id, { owner_id: ownerId, method, payload: r.rows[0].payload }, db);
  return r.rows[0].payload as { action: MoneyAction; entity: string; entity_id: string; cents: number };
}

export async function pendingApprovals(ownerId: string, q?: Queryable) {
  const db = q ?? (await getDb());
  return (await db.query("SELECT * FROM approvals WHERE owner_id = $1 AND status = 'pending' ORDER BY created_at", [ownerId])).rows as any[];
}

export const countersignThreshold = () => config.guard.countersignAboveCents;
