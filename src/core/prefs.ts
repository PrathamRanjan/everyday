import { FINISHES, MATERIALS, STYLES, type Attrs } from "../services/catalog-data.js";

/**
 * Pairwise logistic (Bradley-Terry) preference model. Pure.
 *   P(a over b) = sigmoid(w . (x_a - x_b))
 * Personal weights start at the global prior and move with bounded SGD steps on explicit choices, with an L2 pull
 * back toward the prior. Feedback reasons decide which features may learn.
 */
export const FEATURES = [...FINISHES.map((f) => `finish:${f}`), ...MATERIALS.map((m) => `material:${m}`), ...STYLES.map((s) => `style:${s}`), "price"] as const;
export type Weights = number[];
export const DIM = FEATURES.length;
export const PRICE = DIM - 1;

const LABEL: Record<string, string> = {
  "finish:wood": "wood finishes",
  "finish:black": "black finishes",
  "finish:white": "white finishes",
  "finish:silver": "silver finishes",
  "finish:grey": "grey finishes",
  "finish:colour": "colourful finishes",
  "finish:brass": "brass finishes",
  "material:wood": "real wood",
  "material:metal": "metal",
  "material:mesh": "mesh",
  "material:fabric": "fabric",
  "material:plastic": "plastic",
  "style:minimal": "minimal designs",
  "style:warm": "warm, cosy pieces",
  "style:industrial": "industrial looks",
  "style:playful": "playful designs",
  "style:ergonomic": "ergonomic comfort",
  "style:compact": "compact items",
  "style:premium": "premium builds",
  "style:quiet": "quiet operation",
  price: "spending more",
};
export const label = (i: number) => LABEL[FEATURES[i]] ?? FEATURES[i];

/** Features: one-hot finish/material, style tags, and log price relative to the slot's median price. */
export function featurize(a: { attrs: Attrs; price_cents: number }, slotMedianCents: number): number[] {
  const x = new Array(DIM).fill(0);
  if (a.attrs.finish) x[FEATURES.indexOf(`finish:${a.attrs.finish}` as any)] = 1;
  if (a.attrs.material) x[FEATURES.indexOf(`material:${a.attrs.material}` as any)] = 1;
  for (const s of a.attrs.style ?? []) {
    const i = FEATURES.indexOf(`style:${s}` as any);
    if (i >= 0) x[i] = 1;
  }
  x[PRICE] = slotMedianCents > 0 ? Math.log(a.price_cents / slotMedianCents) : 0;
  return x;
}

export const dot = (w: number[], x: number[]) => w.reduce((s, wi, i) => s + wi * x[i], 0);
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export const zeros = (): Weights => new Array(DIM).fill(0);

export type Reason = "style" | "too_expensive" | "already_own" | "wrong_recipient" | "defective";

/** Which features a choice may move. "Already own" and "wrong recipient" teach taste nothing. */
export function mask(reason: Reason): number[] | null {
  if (reason === "style") return new Array(DIM).fill(1);
  if (reason === "too_expensive") return FEATURES.map((_, i) => (i === PRICE ? 1 : 0));
  return null;
}

export interface UpdateOpts {
  eta?: number;
  lambda?: number;
  maxStep?: number;
}

/** One bounded SGD step on a pairwise choice (y = 1 means a was chosen over b). */
export function update(w: Weights, w0: Weights, xa: number[], xb: number[], y: 0 | 1, m: number[], o: UpdateOpts = {}): Weights {
  const eta = o.eta ?? 0.6;
  const lambda = o.lambda ?? 0.05;
  const maxStep = o.maxStep ?? 0.8;
  const d = xa.map((v, i) => v - xb[i]);
  const p = sigmoid(dot(w, d));
  return w.map((wi, i) => {
    if (!m[i]) return wi;
    const step = eta * (y - p) * d[i] - lambda * (wi - w0[i]);
    return wi + Math.max(-maxStep, Math.min(maxStep, step));
  });
}

/** Full-batch logistic regression on pairs (the offline global prior). */
export function fitPairs(pairs: { d: number[]; y: 0 | 1 }[], o: { epochs?: number; lr?: number; l2?: number } = {}): Weights {
  let w = zeros();
  const epochs = o.epochs ?? 300;
  const lr = o.lr ?? 0.5;
  const l2 = o.l2 ?? 0.01;
  for (let e = 0; e < epochs; e++) {
    const g = zeros();
    for (const { d, y } of pairs) {
      const p = sigmoid(dot(w, d));
      for (let i = 0; i < DIM; i++) g[i] += (p - y) * d[i];
    }
    w = w.map((wi, i) => wi - lr * (g[i] / Math.max(1, pairs.length) + l2 * wi));
  }
  return w;
}

/** The two features that most raise this item's score relative to the slot average, in words. */
/** `personal` is false until the person has made a this-or-that choice: the weights are then still the population
 * prior (trained on synthetic shoppers), so the reason says so instead of claiming to know them. */
export function explain(w: Weights, x: number[], avg: number[], personal = true): string[] {
  const c = x.map((xi, i) => ({ i, v: w[i] * (xi - avg[i]) })).filter((z) => z.v > 0.05).sort((a, b) => b.v - a.v);
  return c.slice(0, 2).map((z) => (z.i === PRICE ? "good value for its price" : personal ? `you tend to like ${label(z.i)}` : `most shoppers like ${label(z.i)} (your own choices will tune this)`));
}

/** What changed between two weight vectors, in words (for the "your shortlist changed because" line). */
export function changes(before: Weights, after: Weights, n = 2): string[] {
  return after
    .map((v, i) => ({ i, d: v - before[i] }))
    .filter((z) => Math.abs(z.d) > 0.15)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, n)
    .map((z) => (z.i === PRICE ? (z.d < 0 ? "you leaned toward lower prices" : "you were happy to spend more for quality") : `${z.d > 0 ? "more" : "less"} weight on ${label(z.i)}`));
}

/** Picks informative this-or-that pairs: same slot, different features, model least sure. */
export function pickPairs<T extends { id: string; x: number[]; slot: string }>(items: T[], w: Weights, n = 5): [T, T][] {
  const cands: { a: T; b: T; u: number }[] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.slot !== b.slot) continue;
      const d = a.x.map((v, k) => v - b.x[k]);
      const diff = d.slice(0, PRICE).reduce((s, v) => s + Math.abs(v), 0);
      if (diff < 2) continue;
      const p = sigmoid(dot(w, d));
      cands.push({ a, b, u: Math.abs(p - 0.5) - 0.05 * diff });
    }
  cands.sort((x, y) => x.u - y.u);
  const out: [T, T][] = [];
  const used = new Set<string>();
  for (const c of cands) {
    if (out.length >= n) break;
    if (used.has(c.a.id) || used.has(c.b.id)) continue;
    out.push([c.a, c.b]);
    used.add(c.a.id);
    used.add(c.b.id);
  }
  return out;
}

// ---------- Evaluation helpers ----------

export function ndcgAt(k: number, predicted: string[], trueScore: Map<string, number>): number {
  const gains = [...trueScore.values()].sort((a, b) => b - a);
  const rel = (s: number, min: number, max: number) => (max === min ? 1 : (s - min) / (max - min));
  const min = Math.min(...gains);
  const max = Math.max(...gains);
  let dcg = 0;
  let idcg = 0;
  for (let i = 0; i < k && i < predicted.length; i++) dcg += rel(trueScore.get(predicted[i]) ?? min, min, max) / Math.log2(i + 2);
  for (let i = 0; i < k && i < gains.length; i++) idcg += rel(gains[i], min, max) / Math.log2(i + 2);
  return idcg ? dcg / idcg : 0;
}

/** Deterministic PRNG (mulberry32) so experiments are reproducible by seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
