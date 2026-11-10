/**
 * Kill switches (roadmap B.6): global and per agent. Checked by the guard before any money move.
 *
 * A1: inside a demo workspace every scope is namespaced ("ws_x|global", "ws_x|merchant", ...), so the "stop
 * everything" switch a visitor pulls stops their own demo only. The bare "global" scope (outside any workspace, or
 * set by the operator) stops every workspace.
 */
import type { Queryable } from "../db.js";
import { getDb } from "../db.js";
import { currentWs, unScope, wsScope } from "../ws.js";
import { appendAudit } from "./audit.js";

export async function isKilled(scope: string, q?: Queryable, ws: string | null = currentWs()): Promise<{ engaged: boolean; reason: string | null; scope: string } | null> {
  const db = q ?? (await getDb());
  const wanted = Array.from(new Set(["global", wsScope("global", ws), wsScope(scope, ws)]));
  const rows = (await db.query<{ scope: string; engaged: boolean; reason: string | null }>("SELECT scope, engaged, reason FROM kill_switches WHERE scope = ANY($1::text[]) AND engaged", [wanted])).rows;
  const hit = rows.find((r) => r.scope === "global") ?? rows.find((r) => unScope(r.scope) === "global") ?? rows[0];
  return hit ? { ...hit, scope: unScope(hit.scope) } : null;
}

export async function setKill(scope: string, engaged: boolean, reason: string | null, by: string, ws: string | null = currentWs()) {
  const db = await getDb();
  const s = wsScope(scope, ws);
  await db.query("INSERT INTO kill_switches (scope, engaged, reason, at) VALUES ($1,$2,$3,now()) ON CONFLICT (scope) DO UPDATE SET engaged = EXCLUDED.engaged, reason = EXCLUDED.reason, at = now()", [s, engaged, reason]);
  await appendAudit(engaged ? "kill.engaged" : "kill.released", "kill_switch", scope, { reason, by });
}

/** This workspace's switches, with their plain scope names. */
export async function listKills(ws: string | null = currentWs()) {
  const db = await getDb();
  const rows = ws
    ? (await db.query<{ scope: string; engaged: boolean; reason: string | null; at: Date }>("SELECT * FROM kill_switches WHERE starts_with(scope, $1) ORDER BY scope", [`${ws}|`])).rows
    : (await db.query<{ scope: string; engaged: boolean; reason: string | null; at: Date }>("SELECT * FROM kill_switches WHERE scope !~ '^ws_[a-z0-9]+[|]' ORDER BY scope")).rows;
  return rows.map((r) => ({ ...r, scope: unScope(r.scope) }));
}
