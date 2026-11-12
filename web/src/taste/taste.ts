/**
 * The taste model in the browser (trained in taste-lab/; the same /taste/model.json the server checks). Only when the
 * shopper switches it on: the multilingual MiniLM (~118 MB, from Hugging Face, kept in the browser's cache) turns
 * listing titles into numbers here, on this device. The maths below is the lab's (taste-lab/scripts/score.mjs) line
 * for line. It only reorders listings inside the verdict code already gave them; it never makes anything "fit".
 */
export interface TasteModel {
  version: string;
  embedding: { model_id: string; dtype: string; dim: number };
  dim: number;
  k: number;
  centred: boolean;
  mean: number[];
  W: number[] | null;
  tau: number;
  weights: { liked: number; fine: number; disliked: number };
  ships: string;
  test: Record<string, { all: { hr_at_10: number; ndcg_at_10: number; auc: number }; cold_items: { hr_at_10: number } }>;
  nothing_fits: Record<string, number | string>;
}

let model: TasteModel | null = null;
let extractor: ((texts: string[], o: object) => Promise<{ tolist(): number[][] }>) | null = null;

export const itemText = (title: string, brand: string | null) => [title.replace(/\s+/g, " ").trim().slice(0, 200), brand ? `by ${brand.trim()}` : ""].filter(Boolean).join(". ");

export async function loadModelCard(): Promise<TasteModel> {
  if (model) return model;
  const r = await fetch("/taste/model.json");
  if (!r.ok) throw new Error(`The taste model file didn't load (${r.status}).`);
  model = (await r.json()) as TasteModel;
  return model;
}

/** Loads the embedding model once; `progress` gets 0..1 while the files download. */
export async function loadTaste(progress?: (p: number) => void): Promise<TasteModel> {
  const m = await loadModelCard();
  if (extractor) return m;
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  const files = new Map<string, number>();
  const pipe = await pipeline("feature-extraction", m.embedding.model_id, {
    dtype: m.embedding.dtype as "q8",
    progress_callback: (e: any) => {
      if (e?.status === "progress" && e.file) {
        files.set(e.file, (e.progress ?? 0) / 100);
        progress?.([...files.values()].reduce((s, x) => s + x, 0) / Math.max(files.size, 1));
      }
    },
  });
  extractor = pipe as any;
  return m;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (!extractor) throw new Error("The taste model isn't loaded.");
  const out: number[][] = [];
  for (let k = 0; k < texts.length; k += 16) out.push(...(await extractor(texts.slice(k, k + 16), { pooling: "mean", normalize: true })).tolist());
  return out;
}

const unit = (a: number[]) => {
  const n = Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1;
  return a.map((x) => x / n);
};
const prep = (m: TasteModel, v: number[]) => unit(v.map((x, k) => x - (m.centred ? m.mean[k] : 0)));
const finish = (m: TasteModel, c: number[]) => {
  if (!m.W) return unit(c);
  const W = m.W;
  return unit(
    Array.from({ length: m.k }, (_, r) => {
      let s = 0;
      for (let q = 0; q < m.dim; q++) s += W[r * m.dim + q] * c[q];
      return s;
    }),
  );
};
export const itemVec = (m: TasteModel, v: number[]) => finish(m, prep(m, v));
export function tasteVec(m: TasteModel, hist: { v: number[]; stars: number }[]) {
  const s = new Array(m.dim).fill(0);
  for (const h of hist) {
    const w = h.stars >= 4 ? m.weights.liked : h.stars === 3 ? m.weights.fine : m.weights.disliked;
    prep(m, h.v).forEach((x, k) => (s[k] += w * x));
  }
  return finish(m, unit(s));
}
export const dot = (a: number[], b: number[]) => a.reduce((s, x, k) => s + x * b[k], 0);

/** Scores each listing against a history (titles with stars); `nothingFits` when every listing is under the line. */
export async function scoreListings(history: { text: string; stars: number }[], listings: string[]): Promise<{ scores: number[]; nothingFits: boolean; tau: number }> {
  const m = await loadTaste();
  const vs = await embed([...history.map((h) => h.text), ...listings]);
  const t = tasteVec(m, history.map((h, i) => ({ v: vs[i], stars: h.stars })));
  const scores = listings.map((_, j) => dot(t, itemVec(m, vs[history.length + j])));
  return { scores, nothingFits: scores.length > 0 && scores.every((s) => s < m.tau), tau: m.tau };
}

// For the browser parity check (e2e/tests/taste-parity.spec.ts): the same functions, reachable from the page. Read-only.
if (typeof window !== "undefined") (window as any).__evTaste = { loadTaste, embed, itemVec, tasteVec, dot, itemText };
