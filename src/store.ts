import type { Queryable } from "./db.js";
import { wall, wallIso, wallNow } from "./core/time.js";
import { GtError } from "./lib/util.js";

export interface Account {
  id: string;
  name: string;
  tz: string;
  monthly_limit_cents: number;
  sim_now: string | null;
  address: string;
}

export const J = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));

export async function accountById(q: Queryable, id: string): Promise<Account> {
  const a = (await q.query<Account>("SELECT * FROM accounts WHERE id = $1", [id])).rows[0];
  if (!a) throw new GtError("Account not found", "not_found", 404);
  return a;
}

export const nowOf = (a: Account) => (a.sim_now ? wall(a.sim_now) : wallNow(a.tz));
export const nowIso = (a: Account) => wallIso(nowOf(a));

export async function selfRecipient(q: Queryable, accountId: string) {
  return (await q.query<{ id: string; name: string }>("SELECT * FROM recipients WHERE account_id = $1 AND is_self", [accountId])).rows[0];
}

export async function logEvent(q: Queryable, a: Account | null, entity: string | null, entityId: string | null, type: string, summary: string, actor = "Everyday", data: unknown = null) {
  await q.query("INSERT INTO events (account_id, entity, entity_id, type, summary, actor, data, wall) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [a?.id ?? null, entity, entityId, type, summary, actor, data === null ? null : JSON.stringify(data), a ? nowIso(a) : null]);
}

/** A message to the person on a channel (app inbox, Telegram). Telegram delivery happens in the adapter. */
export async function notify(q: Queryable, accountId: string, channel: "app" | "telegram", text: string, buttons: { text: string; data?: string; url?: string }[][] | null = null) {
  await q.query("INSERT INTO inbox (account_id, channel, text, buttons) VALUES ($1,$2,$3,$4)", [accountId, channel, text, buttons ? JSON.stringify(buttons) : null]);
}

export async function setting(q: Queryable, key: string) {
  return (await q.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key])).rows[0]?.value ?? null;
}
export async function putSetting(q: Queryable, key: string, value: string) {
  await q.query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, value]);
}
