/**
 * A1: a private demo workspace for every visitor.
 *
 * - `startWorkspace` (POST /demo/start): rate limited (5 per address per hour), at most 300 live at once (when full,
 *   the oldest idle visitor workspace is wiped and its slot reused). It builds the workspace's rows at once (Maya,
 *   her own Northlight shop and catalog, the labelled sample history, both mandates), so it is usable in a second or
 *   two, and then runs the real money in the background through the app's own executor ("seeding through the real
 *   path"): orders quoted by the planner, approved by hash and paid from the demo's saved sandbox wallet, read back
 *   from PayPal. Progress is on the workspace row ("1 of 2 payments confirmed by PayPal").
 * - `resetWorkspace`: "Reset my demo" rebuilds only the visitor's own workspace.
 * - `expireWorkspaces`: 48 hours after the last visit, the workspace's rows are deleted. Everyday only creates
 *   intent-CAPTURE orders, so there is no open authorization to void; an approved-but-unpaid PayPal order simply
 *   lapses at PayPal.
 * - The showcase workspace (kind 'showcase') is built through the same path and feeds the landing preview.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import { getDb, type Queryable } from "../db.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { accountById, type Account } from "../store.js";
import { merchantOwner, withSeeding, withWs } from "../ws.js";
import { seedAll } from "./seed.js";
import { demoWallet, walletUsable } from "./demowallet.js";
import { approveQuoteFromDemoWallet, quotePlan, deliverLine, shipLine } from "./orders.js";
import { createIntent } from "./plans.js";

export const WS_LIMIT = 300;
export const WS_PER_ADDRESS_PER_HOUR = 5;
export const WS_IDLE_HOURS = 48;
export const SEED_VERSION = 2;

export interface Workspace {
  id: string;
  account_id: string | null;
  merchant_id: string | null;
  kind: "visitor" | "showcase";
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  seed_state: "seeding" | "ready" | "failed";
  seed_detail: string | null;
  join_token: string | null;
  progress: Progress;
}

/** The background payments of the seed, as the page shows them. */
export interface Progress {
  payments_planned?: number;
  payments_confirmed?: number;
  payments_failed?: number;
  /** Set when no payment could be made at all (for example the saved wallet is off): the page says so. */
  note?: string | null;
  steps?: { label: string; state: "waiting" | "done" | "failed"; detail?: string | null; capture_id?: string | null; order?: string | null }[];
  finished?: boolean;
}

export const ipHash = (ip: string) => createHash("sha256").update(`ev-ws:${ip}`).digest("hex").slice(0, 32);
const J = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));
const row = (r: any): Workspace => ({ ...r, progress: J<Progress>(r.progress ?? {}) });

export async function workspaceById(id: string, q?: Queryable): Promise<Workspace | null> {
  const db = q ?? (await getDb());
  const r = (await db.query<any>("SELECT * FROM workspaces WHERE id = $1", [id])).rows[0];
  return r ? row(r) : null;
}

export async function workspaceByToken(token: string): Promise<Workspace | null> {
  const db = await getDb();
  const r = (await db.query<any>("SELECT * FROM workspaces WHERE join_token = $1 AND expires_at > now()", [token])).rows[0];
  return r ? row(r) : null;
}

/** Every visit pushes the idle expiry back (at most once a minute per workspace). */
const lastTouch = new Map<string, number>();
export async function touchWorkspace(id: string) {
  const now = Date.now();
  if ((lastTouch.get(id) ?? 0) > now - 60_000) return;
  lastTouch.set(id, now);
  if (lastTouch.size > 2000) lastTouch.clear();
  await (await getDb()).query(`UPDATE workspaces SET last_seen_at = now(), expires_at = now() + interval '${WS_IDLE_HOURS} hours' WHERE id = $1 AND kind = 'visitor'`, [id]);
}

/** Creates a visitor workspace, builds its rows, and starts the real payments in the background. */
export async function startWorkspace(opts: { ip: string; kind?: "visitor" | "showcase"; background?: boolean; unlimited?: boolean }): Promise<Workspace> {
  const db = await getDb();
  const kind = opts.kind ?? "visitor";
  const h = ipHash(opts.ip);
  if (kind === "visitor" && !opts.unlimited) {
    const recent = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM workspaces WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'", [h])).rows[0].n;
    if (recent >= WS_PER_ADDRESS_PER_HOUR) throw new GtError(`You've started ${recent} demos in the last hour from this address. Use one of them (it stays for ${WS_IDLE_HOURS} hours after your last visit), or try again later.`, "rate_limited", 429);
    const live = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM workspaces WHERE kind = 'visitor' AND expires_at > now()")).rows[0].n;
    if (live >= WS_LIMIT) {
      // Full: wipe the visitor workspace idle the longest and reuse its slot.
      const oldest = (await db.query<{ id: string }>("SELECT id FROM workspaces WHERE kind = 'visitor' ORDER BY last_seen_at LIMIT 1")).rows[0];
      if (oldest) await deleteWorkspace(oldest.id);
    }
  }
  const id = newId("ws");
  const token = randomBytes(18).toString("base64url");
  await db.query("INSERT INTO workspaces (id, kind, ip_hash, seed_version, seed_state, join_token, expires_at) VALUES ($1,$2,$3,$4,'seeding',$5, now() + ($6 || ' hours')::interval)", [id, kind, h, SEED_VERSION, token, String(kind === "showcase" ? 24 * 365 : WS_IDLE_HOURS)]);
  await buildRows(id);
  const run = seedMoney(id)
    .then(async () => {
      // A3.2: the showcase is asked a few real questions so /ai and /paypal have real rows.
      if (kind === "showcase") await (await import("./showcase-ai.js")).showcaseAi(id);
    })
    .catch((e) => console.error("[everyday] workspace seed", id, (e as Error).message));
  if (opts.background === false) await run;
  return (await workspaceById(id))!;
}

/** The fast part of the seed: every row of the workspace, in one go. */
async function buildRows(id: string) {
  const db = await getDb();
  try {
    const s = await seedAll({ ws: id });
    await db.query("UPDATE workspaces SET account_id = $2, merchant_id = $3, seeded = $4, seed_state = 'ready', seed_detail = NULL, progress = '{}' WHERE id = $1", [id, s.account, s.merchant, JSON.stringify({ account: s.account, merchant: s.merchant, merchant_owner: merchantOwner(id) })]);
  } catch (e) {
    await db.query("UPDATE workspaces SET seed_state = 'failed', seed_detail = $2 WHERE id = $1", [id, (e as Error).message.slice(0, 300)]);
    throw new GtError(`The demo could not be built: ${(e as Error).message.slice(0, 160)}`, "seed_failed", 500);
  }
}

/** The goals the seed buys for real. Each runs the planner, the quote (by hash) and the saved-wallet payment. */
const SEED_BUYS: { text: string; then: "delivered" | "shipped"; label: string }[] = [
  { text: "a desk lamp under $80", then: "delivered", label: "Desk lamp, paid and delivered" },
  { text: "a wireless mouse under $60", then: "shipped", label: "Mouse, paid and on its way" },
];
/** One goal left at the quote for the visitor to approve: the thing that needs them now. */
const SEED_WAITING = "an ergonomic chair under $400";

async function setProgress(id: string, p: Progress) {
  await (await getDb()).query("UPDATE workspaces SET progress = $2 WHERE id = $1", [id, JSON.stringify(p)]);
}

/**
 * The slow part of the seed: real sandbox money through the app's own executor. Nothing here is invented: an order
 * counts as confirmed only after `settle` read its capture back from PayPal. With the saved wallet unavailable, no
 * payment is attempted and the progress line says so.
 */
const seedRuns = new Map<string, Promise<Progress>>();
/** One seed run per workspace at a time; a second call waits for the running one instead of paying twice. */
export function seedMoney(id: string): Promise<Progress> {
  const running = seedRuns.get(id);
  if (running) return running;
  const run = seedMoneyOnce(id).finally(() => seedRuns.delete(id));
  seedRuns.set(id, run);
  return run;
}

async function seedMoneyOnce(id: string): Promise<Progress> {
  const db = await getDb();
  const ws = await workspaceById(id);
  if (!ws?.account_id) return {};
  // Once per build: a finished (or started) seed is never paid again.
  if (ws.progress.finished || ws.progress.steps?.length || ws.progress.note) return ws.progress;
  return withSeeding(id, async () => {
    const a = await accountById(db, ws.account_id!);
    const steps: NonNullable<Progress["steps"]> = SEED_BUYS.map((b) => ({ label: b.label, state: "waiting" as const }));
    const p: Progress = { payments_planned: SEED_BUYS.length, payments_confirmed: 0, payments_failed: 0, steps, note: null, finished: false };
    const w = await demoWallet(db);
    if (!config.demoMode || !walletUsable(w)) {
      p.payments_planned = 0;
      p.steps = [];
      p.note = config.demoMode ? "The demo's saved sandbox wallet isn't available right now, so this demo starts with no PayPal payments. Pay for a plan on PayPal's own page to see one." : "Not in demo mode: no seed payments.";
    } else {
      await setProgress(id, p);
      for (let i = 0; i < SEED_BUYS.length; i++) {
        const b = SEED_BUYS[i];
        try {
          const intentId = await createIntent(a, { text: b.text, channel: "app" });
          const quoteId = await quotePlan(a, intentId);
          const qu = (await db.query<{ hash: string }>("SELECT hash FROM quotes WHERE id = $1", [quoteId])).rows[0];
          const out = await approveQuoteFromDemoWallet(a, quoteId, qu.hash);
          const o = (await db.query<any>("SELECT id, number, status, capture_id FROM orders WHERE quote_id = $1", [quoteId])).rows[0];
          if (out.status !== "paid" || !o?.capture_id) throw new Error(`PayPal has not confirmed ${o?.number ?? "the order"} yet (${out.status}).`);
          const lines = (await db.query<{ id: string }>("SELECT id FROM order_lines WHERE order_id = $1 AND status = 'ordered'", [o.id])).rows;
          for (const l of lines) {
            await shipLine(l.id);
            if (b.then === "delivered") await deliverLine(l.id, "seeded");
          }
          steps[i] = { label: b.label, state: "done", capture_id: o.capture_id, order: o.number };
          p.payments_confirmed!++;
        } catch (e) {
          steps[i] = { label: b.label, state: "failed", detail: (e as Error).message.slice(0, 200) };
          p.payments_failed!++;
        }
        await setProgress(id, p);
      }
    }
    // The goal waiting on the visitor: planned and quoted, not paid.
    try {
      const intentId = await createIntent(a, { text: SEED_WAITING, channel: "app" });
      await quotePlan(a, intentId).catch(() => undefined);
    } catch {
      /* the visitor can still make the plan themselves */
    }
    p.finished = true;
    await setProgress(id, p);
    return p;
  });
}

/** "Reset my demo": rebuilds only this visitor's workspace, keeping its id, join link and cookie. */
export async function resetWorkspace(id: string): Promise<Workspace> {
  const db = await getDb();
  const ws = await workspaceById(id);
  if (!ws) throw new GtError("That demo has expired. Start a new one.", "not_found", 404);
  await deleteRows(db, id);
  await db.query("UPDATE workspaces SET seed_state = 'seeding', account_id = NULL, merchant_id = NULL, progress = '{}', seed_version = $2, last_seen_at = now() WHERE id = $1", [id, SEED_VERSION]);
  await buildRows(id);
  void seedMoney(id).catch((e) => console.error("[everyday] workspace reseed", id, (e as Error).message));
  return (await workspaceById(id))!;
}

/** Deletes a workspace and all of its rows. */
export async function deleteWorkspace(id: string) {
  const db = await getDb();
  await deleteRows(db, id);
  await db.query("DELETE FROM workspaces WHERE id = $1", [id]);
}

/**
 * Every row that belongs to the workspace. The hash-chained audit log keeps its rows (it is append-only by design:
 * deleting from the middle would break the chain for everyone); they hold ids and amounts only.
 */
async function deleteRows(db: Awaited<ReturnType<typeof getDb>>, id: string) {
  await db.tx(async (q) => {
    const acc = (await q.query<{ id: string }>("SELECT id FROM accounts WHERE ws_id = $1", [id])).rows.map((r) => r.id);
    const mer = (await q.query<{ id: string }>("SELECT id FROM merchants WHERE ws_id = $1", [id])).rows.map((r) => r.id);
    const owners = [...acc, merchantOwner(id)];
    const A = "ANY($1::text[])";
    const orders = `(SELECT id FROM orders WHERE account_id = ${A})`;
    const intents = `(SELECT id FROM intents WHERE account_id = ${A})`;
    const recips = `(SELECT id FROM recipients WHERE account_id = ${A})`;
    const runs = "(SELECT id FROM agent_runs WHERE ws_id = $1)";
    const steps: [string, unknown[]][] = [
      [`DELETE FROM agent_trace WHERE run_id IN ${runs}`, [id]],
      ["DELETE FROM agent_runs WHERE ws_id = $1", [id]],
      ["DELETE FROM channel_messages WHERE ws_id = $1", [id]],
      ["DELETE FROM demo_faults WHERE ws_id = $1", [id]],
      ["DELETE FROM purchase_history WHERE ws_id = $1", [id]],
      ["DELETE FROM agent_requests WHERE ws_id = $1", [id]],
      ["DELETE FROM paypal_refs WHERE ws_id = $1", [id]],
      ["DELETE FROM ai_calls WHERE ws_id = $1", [id]],
      ["DELETE FROM ws_checklist WHERE ws_id = $1", [id]],
      ["DELETE FROM kill_switches WHERE starts_with(scope, $1)", [`${id}|`]],
      [`DELETE FROM approvals WHERE owner_id = ${A}`, [owners]],
      [`DELETE FROM policies WHERE owner_id = ${A}`, [owners]],
      [`DELETE FROM passkeys WHERE owner_id = ${A}`, [owners]],
      [`DELETE FROM party_links WHERE party_id = ${A}`, [owners]],
      [`DELETE FROM push_subscriptions WHERE party_id = ${A}`, [owners]],
      [`DELETE FROM trackers WHERE order_id IN ${orders}`, [acc]],
      [`DELETE FROM disputes WHERE order_id IN ${orders}`, [acc]],
      [`DELETE FROM payment_ops WHERE order_id IN ${orders}`, [acc]],
      [`DELETE FROM cases WHERE order_id IN ${orders}`, [acc]],
      [`DELETE FROM owned_items WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM order_lines WHERE order_id IN ${orders}`, [acc]],
      [`DELETE FROM repeat_buys WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM orders WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM quotes WHERE plan_id IN (SELECT id FROM plans WHERE intent_id IN ${intents})`, [acc]],
      [`DELETE FROM plans WHERE intent_id IN ${intents}`, [acc]],
      [`DELETE FROM pref_events WHERE recipient_id IN ${recips}`, [acc]],
      [`DELETE FROM pref_models WHERE recipient_id IN ${recips}`, [acc]],
      [`DELETE FROM intents WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM captures WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM price_watches WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM inbox WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM events WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM vault_tokens WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM profile_facts WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM link_codes WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM channel_links WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM device_keys WHERE account_id = ${A}`, [acc]],
      [`DELETE FROM recipients WHERE account_id = ${A}`, [acc]],
      ["DELETE FROM settings WHERE key = ANY($1::text[])", [acc.map((x) => `protected:${x}`)]],
      [`DELETE FROM price_history WHERE product_id IN (SELECT id FROM products WHERE merchant_id = ${A})`, [mer]],
      [`DELETE FROM products WHERE merchant_id = ${A}`, [mer]],
      ["DELETE FROM accounts WHERE ws_id = $1", [id]],
      ["DELETE FROM merchants WHERE ws_id = $1", [id]],
    ];
    for (const [sql, params] of steps) await q.query(sql, params);
  });
}

/** Deletes every visitor workspace idle past its expiry. Run by the worker every 10 minutes. */
export async function expireWorkspaces(): Promise<number> {
  const db = await getDb();
  // A seed cut off by a restart (no run in this process, unfinished after 10 minutes) says so instead of "paying now".
  const stuck = (await db.query<any>("SELECT id, progress FROM workspaces WHERE seed_state = 'ready' AND created_at < now() - interval '10 minutes' AND coalesce((progress->>'finished')::boolean, false) = false AND progress ? 'steps'")).rows;
  for (const s of stuck) {
    if (seedRuns.has(s.id)) continue;
    const p = J<Progress>(s.progress);
    p.steps = (p.steps ?? []).map((x) => (x.state === "waiting" ? { ...x, state: "failed" as const, detail: "Interrupted by a server restart before PayPal was called or read back. Nothing was charged for this step unless it shows a capture." } : x));
    p.payments_failed = p.steps.filter((x) => x.state === "failed").length;
    p.finished = true;
    await setProgress(s.id, p);
  }
  const gone = (await db.query<{ id: string }>("SELECT id FROM workspaces WHERE kind = 'visitor' AND expires_at < now() ORDER BY expires_at LIMIT 20")).rows;
  for (const g of gone) await deleteWorkspace(g.id).catch((e) => console.error("[everyday] expire workspace", g.id, (e as Error).message));
  return gone.length;
}

/** The showcase workspace: built through the same path, rebuilt nightly, read-only to visitors. */
export async function showcase(): Promise<Workspace | null> {
  const db = await getDb();
  const r = (await db.query<any>("SELECT * FROM workspaces WHERE kind = 'showcase' AND seed_state = 'ready' ORDER BY created_at DESC LIMIT 1")).rows[0];
  return r ? row(r) : null;
}

export async function rebuildShowcase(opts: { background?: boolean } = {}): Promise<Workspace> {
  const db = await getDb();
  const old = (await db.query<{ id: string }>("SELECT id FROM workspaces WHERE kind = 'showcase'")).rows;
  const ws = await startWorkspace({ ip: "showcase", kind: "showcase", background: opts.background });
  // Keep the old one until the new one is built, so the landing page never reads an empty showcase.
  for (const o of old) await deleteWorkspace(o.id);
  return ws;
}

/** The progress line the page shows, in words, from the workspace row. */
export function progressLine(p: Progress): string | null {
  if (p.note) return p.note;
  if (!p.payments_planned) return null;
  const done = p.payments_confirmed ?? 0;
  const failed = p.payments_failed ?? 0;
  if (done + failed < p.payments_planned) return `${done} of ${p.payments_planned} payments confirmed by PayPal. The rest are being paid from the demo's saved sandbox wallet now.`;
  return `${done} of ${p.payments_planned} payments confirmed by PayPal${failed ? `; ${failed} did not go through (see each one below)` : ""}.`;
}

export const workspaceAccount = async (ws: Workspace): Promise<Account | null> => (ws.account_id ? await accountById(await getDb(), ws.account_id).catch(() => null) : null);
