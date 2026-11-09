/** eval_runs rows and per-suite summaries for the console and the markdown reports. */
import { getDb, type Queryable } from "../db.js";
import { newId } from "../lib/ids.js";

export interface EvalRowInput {
  suite: string;
  arm: string;
  caseId: string;
  expected: unknown;
  actual: unknown;
  correct: boolean;
  trap?: boolean;
  naivePaidCents?: number;
  oursPaidCents?: number;
  costUsd?: number;
  latencyMs?: number;
  detail?: unknown;
}

export async function recordEval(r: EvalRowInput, q?: Queryable) {
  const db = q ?? (await getDb());
  await db.query("INSERT INTO eval_runs (id, suite, arm, case_id, expected, actual, correct, trap, naive_paid_cents, ours_paid_cents, cost_usd, latency_ms, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [newId("ev"), r.suite, r.arm, r.caseId, JSON.stringify(r.expected), JSON.stringify(r.actual), r.correct, r.trap ?? false, r.naivePaidCents ?? 0, r.oursPaidCents ?? 0, r.costUsd ?? 0, r.latencyMs ?? 0, JSON.stringify(r.detail ?? null)]);
}

export async function clearSuite(suite: string, q?: Queryable) {
  const db = q ?? (await getDb());
  await db.query("DELETE FROM eval_runs WHERE suite = $1", [suite]);
}

export interface ArmSummary {
  arm: string;
  cases: number;
  correct: number;
  traps: number;
  traps_caught: number;
  naive_usd: number;
  paid_usd: number;
  cost_usd: number;
  p50_ms: number;
}

export async function summarise(suite: string, q?: Queryable): Promise<ArmSummary[]> {
  const db = q ?? (await getDb());
  const rows = (await db.query<any>("SELECT arm, case_id, correct, trap, naive_paid_cents, ours_paid_cents, cost_usd, latency_ms, detail FROM eval_runs WHERE suite = $1 ORDER BY arm, case_id", [suite])).rows;
  const by = new Map<string, any[]>();
  for (const r of rows) (by.get(r.arm) ?? by.set(r.arm, []).get(r.arm)!).push(r);
  const out: ArmSummary[] = [];
  for (const [arm, rs] of by) {
    const lat = rs.map((r) => Number(r.latency_ms)).sort((a, b) => a - b);
    const traps = rs.filter((r) => r.trap);
    out.push({
      arm,
      cases: rs.length,
      correct: rs.filter((r) => r.correct).length,
      traps: traps.length,
      traps_caught: traps.filter((r) => (typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail)?.trap_caught === true).length,
      naive_usd: rs.reduce((s, r) => s + Number(r.naive_paid_cents), 0) / 100,
      paid_usd: rs.reduce((s, r) => s + Number(r.ours_paid_cents), 0) / 100,
      cost_usd: rs.reduce((s, r) => s + Number(r.cost_usd), 0),
      p50_ms: lat.length ? lat[Math.floor(lat.length / 2)] : 0,
    });
  }
  return out;
}

export async function evalRows(suite: string, limit = 200, q?: Queryable) {
  const db = q ?? (await getDb());
  return (await db.query<any>("SELECT * FROM eval_runs WHERE suite = $1 ORDER BY arm, case_id LIMIT $2", [suite, limit])).rows.map((r: any) => ({ ...r, expected: typeof r.expected === "string" ? JSON.parse(r.expected) : r.expected, actual: typeof r.actual === "string" ? JSON.parse(r.actual) : r.actual, detail: typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail }));
}
