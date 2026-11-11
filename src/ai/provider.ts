/**
 * AI provider layer (roadmap B.1, spec A5.1/A5.4). OpenAI Responses API with strict JSON-schema outputs and image
 * input. A call goes to the primary model; output that doesn't parse gets one repair attempt; then the backup model;
 * then it stops with AiFailed, which the page shows as the honest failure state (A5.5). No replayed or made-up answer
 * ever stands in for a model. Every call is audited, and every caller uses the two guard helpers: forbidden-field
 * schema checks and grounding.
 *
 * Money and PayPal ids never come out of a model. `assertSafeSchema` enforces that at call time and the
 * structural test enforces it at build time. In Everyday the model reads a shared frame into a product signal, reads requests, drafts the
 * shopper's mandate and answers shopper questions; prices, the plan, the quote and every PayPal call come
 * from code.
 */
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { currentWs } from "../ws.js";

export type Purpose = "capture_frame" | "read_request" | "plan_question" | "compile_policy" | "shopper_question" | "classify" | "eval";

export interface ImagePart {
  type: "image";
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: Buffer;
}
export interface TextPart {
  type: "text";
  text: string;
}
export type Part = ImagePart | TextPart;

export interface StructuredCall<T> {
  purpose: Purpose;
  /** Which chain to use: "vision" for photos, "read" for documents and judging, "classify" for cheap labels. */
  tier: "vision" | "read" | "classify";
  system: string;
  parts: Part[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  /** Attach to an agent run for the trace. */
  runId?: string | null;
  parse?: (raw: unknown) => T;
}

export interface CallResult<T> {
  output: T;
  model: string;
  via: "primary" | "repair" | "backup";
  inputHash: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  auditId: number | null;
}

export class NoModelError extends Error {
  constructor(msg = "No model available") {
    super(msg);
  }
}

/** A5.5: the sentence a person sees when the model couldn't do its job. The detail stays in the audit log. */
export const AI_FAILED_SENTENCE = "I couldn't read that. Try again, or fill it in below.";
export class AiFailed extends GtError {
  constructor(public detail: string, sentence = AI_FAILED_SENTENCE) {
    super(sentence, "ai_failed", 503);
  }
}

let fetchImpl: typeof fetch = (i, init) => fetch(i, init);
/** Tests can intercept model calls. */
export function setProviderFetch(f: typeof fetch | null) {
  fetchImpl = f ?? ((i, init) => fetch(i, init));
}

/** The fetch the model calls use (the tests swap it); shared with the Decisions client and the agent loop. */
export const providerFetch = () => fetchImpl;
export const hasOpenAI = () => config.ai.provider === "openai" && Boolean(config.ai.openaiKey);
export const providerLabel = () => (hasOpenAI() ? `openai (${config.ai.models.read}, backup ${config.ai.models.backup}, small jobs ${config.ai.models.classify})` : "no model key (tests or offline evaluation only)");

/** Fields a model output schema may never contain. Money and PayPal identifiers are produced by code. */
export const FORBIDDEN_FIELDS = [/^amount/i, /_cents$/i, /^fee$/i, /^fee_/i, /^price_to_pay$/i, /^payout/i, /^capture/i, /^refund/i, /^authorization_id$/i, /^order_id$/i, /^payment_token/i, /^payer_id$/i, /^receiver_email$/i, /^invoice_id$/i];
/** Fields a schema may contain even though they look like money: read-only observations, not instructions. */
export const ALLOWED_OBSERVATIONS = new Set(["price_seen", "total_seen", "severity"]);

export function assertSafeSchema(schema: Record<string, unknown>, path = "$"): void {
  const props = (schema.properties ?? {}) as Record<string, any>;
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_OBSERVATIONS.has(k) && FORBIDDEN_FIELDS.some((re) => re.test(k))) throw new Error(`Unsafe model schema: field ${path}.${k} looks like a money or PayPal id field`);
    if (v && typeof v === "object") {
      if (v.properties) assertSafeSchema(v, `${path}.${k}`);
      if (v.items?.properties) assertSafeSchema(v.items, `${path}.${k}[]`);
    }
  }
}

/** OpenAI strict mode needs every property required and additionalProperties:false at every level. */
export function strictify(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  const out: any = Array.isArray(schema) ? schema.map(strictify) : { ...schema };
  if (out.type === "object" || out.properties) {
    out.additionalProperties = false;
    out.properties = Object.fromEntries(Object.entries(out.properties ?? {}).map(([k, v]) => [k, strictify(v)]));
    out.required = Object.keys(out.properties);
  }
  if (out.items) out.items = strictify(out.items);
  if (out.anyOf) out.anyOf = out.anyOf.map(strictify);
  delete out.default;
  delete out.format;
  return out;
}

/**
 * Rough list prices per million tokens (input, output). Marked estimated on the evidence page. A model with no price
 * on file costs 0 here and the evidence page says its cost isn't counted: no price is made up.
 */
const PRICE: Record<string, [number, number]> = {
  "gpt-5.5": [5, 20],
  "gpt-5.5-pro": [15, 60],
  "gpt-5.4": [2.5, 10],
  "gpt-5.4-mini": [0.4, 1.6],
  "gpt-5.4-nano": [0.1, 0.4],
  "gpt-5.6-luna": [4, 16],
  "gpt-5.6-sol": [2, 8],
  "gpt-5.6-terra": [1, 4],
  "gpt-5.1": [1.25, 10],
  "gpt-5": [1.25, 10],
  "gpt-4.1": [2, 8],
};
export function estimateCost(model: string, tin: number, tout: number): number {
  const p = PRICE[model] ?? PRICE[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  return p ? (tin * p[0] + tout * p[1]) / 1e6 : 0;
}
export const hasPrice = (model: string) => Boolean(PRICE[model] ?? PRICE[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")]);

function chainFor(tier: StructuredCall<unknown>["tier"]): string[] {
  const m = config.ai.models;
  if (tier === "vision") return [m.vision, m.backup];
  if (tier === "read") return [m.read, m.backup];
  return [m.classify, m.backup];
}
/** A5.4: extraction gets room to finish (a cut-off answer is broken JSON) and low reasoning effort. */
export const MIN_OUTPUT_TOKENS = 4000;

/** Output that came back but isn't valid for the schema: worth one repair attempt with the same model. */
class BadOutput extends Error {
  constructor(public text: string, msg: string) {
    super(msg);
  }
}

export function hashInput(call: { system: string; parts: Part[]; schemaName: string }): string {
  const h = createHash("sha256");
  h.update(call.system).update("\u0000").update(call.schemaName).update("\u0000");
  for (const p of call.parts) {
    if (p.type === "text") h.update("t:").update(p.text);
    else h.update("i:").update(createHash("sha256").update(p.data).digest("hex"));
  }
  return h.digest("hex");
}

function toInput(parts: Part[]) {
  return parts.map((p) => (p.type === "text" ? { type: "input_text", text: p.text } : { type: "input_image", image_url: `data:${p.mediaType};base64,${Buffer.from(p.data).toString("base64")}`, detail: "high" }));
}

async function openaiStructured(model: string, call: StructuredCall<unknown>, schema: any, repairOf?: string): Promise<{ raw: unknown; text: string; tokensIn: number; tokensOut: number; model: string }> {
  let last: unknown;
  const input: unknown[] = [{ role: "user", content: toInput(call.parts) }];
  if (repairOf !== undefined) {
    input.push({ role: "assistant", content: [{ type: "output_text", text: repairOf.slice(0, 20_000) }] });
    input.push({ role: "user", content: [{ type: "input_text", text: "That answer was not valid JSON for the schema. Return valid JSON for this schema, and nothing else." }] });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(`${config.ai.openaiBaseUrl}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.ai.openaiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: call.system,
        input,
        text: { format: { type: "json_schema", name: call.schemaName, strict: true, schema } },
        max_output_tokens: Math.max(MIN_OUTPUT_TOKENS, call.maxOutputTokens ?? 0),
        reasoning: { effort: "low" },
        store: false,
      }),
    });
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      last = new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const msg = (data.output ?? []).find((o: any) => o.type === "message");
    const part = msg?.content?.find((c: any) => c.type === "output_text");
    if (!part?.text) {
      const refusal = msg?.content?.find((c: any) => c.type === "refusal");
      throw new Error(refusal ? `Model refused: ${String(refusal.refusal).slice(0, 200)}` : "Model returned no text");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(part.text);
    } catch (e) {
      throw new BadOutput(part.text, `Output was not valid JSON (${(e as Error).message.slice(0, 80)})${data.status === "incomplete" ? `; incomplete: ${data.incomplete_details?.reason ?? "unknown"}` : ""}`);
    }
    return { raw, text: part.text, tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0, model: data.model ?? model };
  }
  throw last;
}

/** The first words of what a call read, kept with the call so /ai can say what it was about. */
export const summaryOf = (s: string, n = 140) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const partsSummary = (parts: Part[]) => summaryOf(`${parts.some((p) => p.type === "image") ? "[photo] " : ""}${parts.filter((p): p is TextPart => p.type === "text").map((p) => p.text).join(" ")}`);

export async function recordAiCall(row: { purpose: string; model: string; via: string; inputHash: string; outputHash: string; tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number; ok: boolean; error: string | null; output: unknown; runId: string | null; summary?: string | null }): Promise<number | null> {
  return audit(row);
}

async function audit(row: { purpose: string; model: string; via: string; inputHash: string; outputHash: string; tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number; ok: boolean; error: string | null; output: unknown; runId: string | null; summary?: string | null }): Promise<number | null> {
  try {
    const db = await getDb();
    const r = await db.query<{ id: number }>(
      `INSERT INTO ai_calls (purpose, model, via, input_hash, output_hash, tokens_in, tokens_out, cost_usd, latency_ms, ok, error, output, run_id, ws_id, input_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [row.purpose, row.model, row.via, row.inputHash, row.outputHash, row.tokensIn, row.tokensOut, row.costUsd, row.latencyMs, row.ok, row.error, row.ok ? JSON.stringify(row.output) : null, row.runId, currentWs(), row.summary ?? null],
    );
    return r.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * One structured call: primary model, one repair attempt if its output doesn't parse, then the backup model, then
 * stop. Throws NoModelError when no model is configured (tests and offline evaluation) and AiFailed when every step
 * failed. Callers show the honest failure state; they never substitute rules for a reading.
 */
export async function structured<T>(call: StructuredCall<T>): Promise<CallResult<T>> {
  assertSafeSchema(call.schema);
  const schema = strictify(call.schema);
  const inputHash = hashInput(call);
  const parse = call.parse ?? ((x: unknown) => x as T);
  if (!hasOpenAI()) throw new NoModelError("AI_PROVIDER is not openai or OPENAI_API_KEY is unset");
  const [primary, backup] = chainFor(call.tier);
  const errors: string[] = [];
  let broken: string | undefined;
  const attempt = async (model: string, via: CallResult<T>["via"], repairOf?: string): Promise<CallResult<T> | null> => {
    const t0 = Date.now();
    try {
      const r = await openaiStructured(model, call, schema, repairOf);
      let output: T;
      try {
        output = parse(r.raw);
      } catch (e) {
        throw new BadOutput(r.text, `Output did not fit the schema (${(e as Error).message.slice(0, 80)})`);
      }
      const latencyMs = Date.now() - t0;
      const costUsd = estimateCost(r.model, r.tokensIn, r.tokensOut);
      const auditId = await audit({ purpose: call.purpose, model: r.model, via, inputHash, outputHash: createHash("sha256").update(JSON.stringify(r.raw)).digest("hex"), tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd, latencyMs, ok: true, error: null, output: r.raw, runId: call.runId ?? null, summary: partsSummary(call.parts) });
      return { output, model: r.model, via, inputHash, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd, latencyMs, auditId };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      broken = e instanceof BadOutput ? e.text : undefined;
      errors.push(`${model} (${via}): ${msg}`);
      await audit({ purpose: call.purpose, model, via, inputHash, outputHash: "", tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: Date.now() - t0, ok: false, error: msg, output: null, runId: call.runId ?? null, summary: partsSummary(call.parts) });
      return null;
    }
  };
  const first = await attempt(primary, "primary");
  if (first) return first;
  if (broken !== undefined) {
    const fixed = await attempt(primary, "repair", broken);
    if (fixed) return fixed;
  }
  if (backup && backup !== primary) {
    const b = await attempt(backup, "backup");
    if (b) return b;
  }
  throw new AiFailed(errors.join(" | "));
}

/** Voice notes: audio -> text through the transcription endpoint. The transcript is then read like any staff note. */
export async function transcribe(audio: Buffer, mime: string, filename = "note.webm"): Promise<{ text: string; model: string }> {
  if (!hasOpenAI()) throw new NoModelError("Transcription needs AI_PROVIDER=openai");
  // A5.1: gpt-transcribe (gpt-4o-mini-transcribe is deprecated and shuts down on 26 Feb 2027).
  const form = new FormData();
  form.append("model", config.ai.models.transcribe);
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), filename);
  const t0 = Date.now();
  const res = await fetchImpl(`${config.ai.openaiBaseUrl}/v1/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${config.ai.openaiKey}` }, body: form });
  const text = await res.text();
  if (!res.ok) {
    await audit({ purpose: "read_note", model: config.ai.models.transcribe, via: "primary", inputHash: createHash("sha256").update(audio).digest("hex"), outputHash: "", tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: Date.now() - t0, ok: false, error: text.slice(0, 300), output: null, runId: null });
    throw new Error(`Transcription failed: ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(text);
  const out = String(data.text ?? "");
  await audit({ purpose: "read_note", model: config.ai.models.transcribe, via: "primary", inputHash: createHash("sha256").update(audio).digest("hex"), outputHash: createHash("sha256").update(out).digest("hex"), tokensIn: 0, tokensOut: 0, costUsd: 0.006 * Math.max(1, audio.length / 500_000), latencyMs: Date.now() - t0, ok: true, error: null, output: { text: out }, runId: null });
  return { text: out, model: config.ai.models.transcribe };
}

/** Summary for the evidence page. */
export async function aiUsageSummary(): Promise<{ calls: number; ok: number; cost_usd: number; by_purpose: { purpose: string; calls: number; cost_usd: number; p50_ms: number }[] }> {
  const db = await getDb();
  const tot = (await db.query<{ calls: string; ok: string; cost: string }>("SELECT count(*) AS calls, count(*) FILTER (WHERE ok) AS ok, coalesce(sum(cost_usd),0) AS cost FROM ai_calls")).rows[0];
  const by = (
    await db.query<{ purpose: string; calls: string; cost: string; p50: string }>(
      "SELECT purpose, count(*) AS calls, coalesce(sum(cost_usd),0) AS cost, coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms),0) AS p50 FROM ai_calls WHERE ok GROUP BY purpose ORDER BY purpose",
    )
  ).rows;
  return {
    calls: Number(tot?.calls ?? 0),
    ok: Number(tot?.ok ?? 0),
    cost_usd: Number(tot?.cost ?? 0),
    by_purpose: by.map((r) => ({ purpose: r.purpose, calls: Number(r.calls), cost_usd: Number(r.cost), p50_ms: Math.round(Number(r.p50)) })),
  };
}
