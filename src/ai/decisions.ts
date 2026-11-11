/**
 * A5.2: the Decisions client. Every yes/no, routing and rubric judgement about one piece of evidence goes out as one
 * request (up to 400 questions) to `POST /v1/decisions` on gpt-6-luna. The answer is a probability per question;
 * what counts as "yes" is decided here, from the thresholds table (calibrated on labelled data by
 * `scripts/calibrate.ts`), never by the model.
 *
 * `decide()` hides the vendor, so a second reader (Jev) could sit behind it later. A refusal is "not decided": the
 * caller routes it to a person. No silent fallback: with no key it throws NoModelError, and a failed call throws
 * AiFailed; callers say so on screen.
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { config } from "../config.js";
import { getDb, type Queryable } from "../db.js";
import { currentWs } from "../ws.js";
import { AiFailed, hasOpenAI, NoModelError, providerFetch, summaryOf } from "./provider.js";

export type InputPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string } | { type: "input_json"; data: unknown };
export type Question =
  | { type: "predicate"; name: string; instructions: string | InputPart[] }
  | { type: "choice"; name: string; instructions: string | InputPart[]; choices: { value: string; description: string }[] }
  | { type: "score"; name: string; instructions: string | InputPart[]; levels: { label: string; description: string }[] };
export interface Answer {
  probability?: number;
  choice?: string;
  score?: number;
  confidence?: number;
  /** The model declined to answer: "not decided", for a person. */
  refused?: boolean;
}
export interface Decided {
  answers: Record<string, Answer>;
  model: string;
  latency_ms: number;
  call_id: number | null;
  tokens_in: number;
}

export const DECISIONS_MODEL = process.env.AI_MODEL_DECISIONS || "gpt-6-luna";
/** $0.10 per million input tokens; output is free (OpenAI's Decisions guide, checked 10 Nov 2026). */
const PRICE_IN_PER_M = 0.1;

export async function decide(input: string | InputPart[], questions: Question[], meta: { purpose: string; runId?: string | null }): Promise<Decided> {
  if (!hasOpenAI()) throw new NoModelError();
  if (!questions.length || questions.length > 400) throw new Error(`decide(): 1 to 400 questions, got ${questions.length}`);
  const body = {
    model: DECISIONS_MODEL,
    input: typeof input === "string" ? input : [{ role: "user", content: input }],
    questions,
  };
  const inputHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const t0 = Date.now();
  let status = 0;
  let data: any = null;
  let error: string | null = null;
  try {
    const res = await providerFetch()(`${config.ai.openaiBaseUrl}/v1/decisions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.ai.openaiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    status = res.status;
    const text = await res.text();
    if (!res.ok) error = `Decisions ${res.status}: ${text.slice(0, 200)}`;
    else data = JSON.parse(text);
  } catch (e) {
    error = `Decisions call failed: ${(e as Error).message.slice(0, 200)}`;
  }
  const latency = Date.now() - t0;
  const answers: Record<string, Answer> = {};
  if (data && Array.isArray(data.answers)) {
    for (const a of data.answers) {
      if (!a?.name) continue;
      if (a.type === "refusal") answers[a.name] = { refused: true };
      else if (a.type === "predicate") answers[a.name] = { probability: Number(a.probability) };
      else if (a.type === "choice") answers[a.name] = { choice: String(a.choice), confidence: a.confidence };
      else if (a.type === "score") answers[a.name] = { score: Number(a.score), confidence: a.confidence };
    }
  } else if (!error) error = "Decisions answer had no answers array";
  // A question the reply left out is not decided either.
  for (const q of questions) if (!answers[q.name] && !error) answers[q.name] = { refused: true };
  const tokensIn = Number(data?.usage?.input_tokens ?? 0);
  const summary = summaryOf(typeof input === "string" ? input : input.map((p) => (p.type === "input_text" ? p.text : p.type === "input_image" ? "[photo]" : "[data]")).join(" "));
  const callId = await log({ summary, purpose: meta.purpose, inputHash, ok: !error, error, latency, tokensIn, output: error ? null : { questions: questions.map((q) => q.name), answers }, runId: meta.runId ?? null });
  if (error) throw new AiFailed(`${meta.purpose}: ${error}`);
  return { answers, model: data?.model ?? DECISIONS_MODEL, latency_ms: latency, call_id: callId, tokens_in: tokensIn };
}

async function log(r: { summary: string; purpose: string; inputHash: string; ok: boolean; error: string | null; latency: number; tokensIn: number; output: unknown; runId: string | null }): Promise<number | null> {
  try {
    const db = await getDb();
    const row = await db.query<{ id: number }>(
      `INSERT INTO ai_calls (purpose, model, via, input_hash, tokens_in, tokens_out, cost_usd, latency_ms, ok, error, output, run_id, ws_id, input_summary)
       VALUES ($1,$2,'decisions',$3,$4,0,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [r.purpose, DECISIONS_MODEL, r.inputHash, r.tokensIn, (r.tokensIn * PRICE_IN_PER_M) / 1e6, r.latency, r.ok, r.error, r.output ? JSON.stringify(r.output) : null, r.runId, currentWs(), r.summary],
    );
    return row.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ---------- Thresholds: in code and data, not in the model ----------

export interface Threshold {
  name: string;
  /** Below this probability the answer is "no". */
  clear_below: number;
  /** At or above this probability the answer is "yes" (a hold, for a scam tactic). Between the two: "unsure". */
  hold_above: number;
  calibrated_on: string | null;
  n: number;
  precision_at_hold: number | null;
  recall_at_hold: number | null;
  set_at: string | null;
}

/** The committed calibration file (written by scripts/calibrate.ts); the table overrides it once a row is written. */
const FILE = "eval/decisions/thresholds.json";
let fileCache: Record<string, Threshold> | null = null;
function fromFile(): Record<string, Threshold> {
  if (fileCache) return fileCache;
  try {
    fileCache = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")).thresholds as Record<string, Threshold>) : {};
  } catch {
    fileCache = {};
  }
  return fileCache;
}
export function resetThresholdCache() {
  fileCache = null;
}

/** An uncalibrated question uses 0.3 / 0.6 and says so ("calibrated_on: null"). */
export const UNCALIBRATED = { clear_below: 0.3, hold_above: 0.6 };

export async function thresholdFor(name: string, q?: Queryable): Promise<Threshold> {
  const db = q ?? (await getDb());
  const row = (await db.query<any>("SELECT * FROM decision_thresholds WHERE name = $1", [name]).catch(() => ({ rows: [] as any[] }))).rows[0];
  if (row) return { ...row, clear_below: Number(row.clear_below), hold_above: Number(row.hold_above), n: Number(row.n) };
  const f = fromFile()[name];
  if (f) return f;
  return { name, ...UNCALIBRATED, calibrated_on: null, n: 0, precision_at_hold: null, recall_at_hold: null, set_at: null };
}

export async function allThresholds(q?: Queryable): Promise<Threshold[]> {
  const db = q ?? (await getDb());
  const rows = (await db.query<any>("SELECT * FROM decision_thresholds ORDER BY name").catch(() => ({ rows: [] as any[] }))).rows;
  const byName = new Map<string, Threshold>(Object.entries(fromFile()));
  for (const r of rows) byName.set(r.name, { ...r, clear_below: Number(r.clear_below), hold_above: Number(r.hold_above), n: Number(r.n) });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type Verdict = "yes" | "unsure" | "no" | "not_decided";
export function verdictOf(a: Answer | undefined, t: Pick<Threshold, "clear_below" | "hold_above">): Verdict {
  if (!a || a.refused || a.probability === undefined || !Number.isFinite(a.probability)) return "not_decided";
  if (a.probability >= t.hold_above) return "yes";
  if (a.probability < t.clear_below) return "no";
  return "unsure";
}
