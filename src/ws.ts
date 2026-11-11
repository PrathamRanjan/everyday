/**
 * A1: the current demo workspace. Each visitor's workspace is a set of rows in Everyday's own schema: one shopper
 * account and its own copy of the shops and catalog (accounts.ws_id, merchants.ws_id); everything else hangs off the
 * account or a merchant, or carries ws_id itself (runs, audit rows, channel messages, demo faults, history). The web
 * middleware enters the workspace of whoever is signed in (or of the visitor's workspace cookie); the worker and
 * webhooks enter the workspace of the record they act on.
 *
 * `null` is the workspace-less world the unit tests and `npm run seed` use (ws_id IS NULL rows).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Queryable } from "./db.js";

const als = new AsyncLocalStorage<{ ws: string | null; seeding?: boolean }>();

export const currentWs = (): string | null => als.getStore()?.ws ?? null;
export const withWs = <T>(ws: string | null, fn: () => T): T => als.run({ ws }, fn);
/** The seed's own purchases run in the workspace but are not the visitor's doing (the judge checklist skips them). */
export const withSeeding = <T>(ws: string | null, fn: () => T): T => als.run({ ws, seeding: true }, fn);
export const isSeeding = (): boolean => als.getStore()?.seeding === true;
/** Switches the workspace for the rest of the current async context (used by middleware after sign-in is known). */
export const enterWs = (ws: string | null) => als.enterWith({ ws });

const PREFIX = /^(ws_[a-z0-9]+)\|/;

/** Kill-switch and other scope names are namespaced by workspace, so one visitor's switch never stops another's. */
export const wsScope = (scope: string, ws: string | null = currentWs()) => (ws ? `${ws}|${scope}` : scope);
export const unScope = (scope: string) => scope.replace(PREFIX, "");
export const wsOfScope = (scope: string): string | null => scope.match(PREFIX)?.[1] ?? null;

/**
 * The merchant side's owner id (mandate, approvals, channel links). Each workspace's shop has its own, so a refund
 * limit or a pending approval in one visitor's demo never shows in another's.
 */
export const merchantOwner = (ws: string | null = currentWs()) => wsScope("merchant", ws);
export const isMerchantOwner = (id: string | null | undefined) => Boolean(id) && unScope(id!) === "merchant";

/** SQL fragment for "this row is in the workspace $n" on a ws_id column. */
export const inWs = (col: string, n: number) => `${col} IS NOT DISTINCT FROM $${n}`;

/** The workspace an owner id belongs to: a shopper account, a merchant row, or a namespaced merchant owner id. */
export async function wsOfOwner(q: Queryable, ownerId: string): Promise<string | null> {
  if (isMerchantOwner(ownerId)) return wsOfScope(ownerId);
  const r = (await q.query<{ ws_id: string | null }>("SELECT ws_id FROM accounts WHERE id = $1 UNION ALL SELECT ws_id FROM merchants WHERE id = $1 LIMIT 1", [ownerId])).rows[0];
  return r ? r.ws_id : currentWs();
}

export async function wsOfOrder(q: Queryable, orderId: string): Promise<string | null> {
  return (await q.query<{ ws_id: string | null }>("SELECT a.ws_id FROM orders o JOIN accounts a ON a.id = o.account_id WHERE o.id = $1", [orderId])).rows[0]?.ws_id ?? null;
}

/** PayPal custom_id for an object this workspace creates: "<ws>:<record id>", or the bare id outside a workspace. */
export const customIdFor = (recordId: string, ws: string | null = currentWs()) => (ws ? `${ws}:${recordId}` : recordId);
export const wsOfCustomId = (customId: string | null | undefined): string | null => customId?.match(/^(ws_[a-z0-9]+):/)?.[1] ?? null;

export async function rememberPayPalRef(q: Queryable, resourceId: string | null | undefined, kind: string, ws: string | null = currentWs()) {
  if (!resourceId) return;
  await q.query("INSERT INTO paypal_refs (resource_id, ws_id, kind) VALUES ($1,$2,$3) ON CONFLICT (resource_id) DO NOTHING", [resourceId, ws, kind]);
}
