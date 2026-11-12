/**
 * The taste model, server side (trained in taste-lab/, exported to src/taste/model.json; the browser loads the same
 * file from /taste/model.json). The server does NOT turn text into numbers: the multilingual MiniLM is ~118 MB and runs
 * in the shopper's browser on request. What the server has is the scoring maths (checked against the lab's own
 * numbers in test/taste.test.ts) and the model card at GET /api/ui/taste, so the evidence travels with the model.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/taste/model.json");
export interface TasteModel {
  version: string;
  dim: number;
  k: number;
  centred: boolean;
  mean: number[];
  W: number[] | null;
  tau: number;
  weights: { liked: number; fine: number; disliked: number };
  [key: string]: unknown;
}
let cached: TasteModel | null | undefined;
export function tasteModel(): TasteModel | null {
  if (cached === undefined) cached = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as TasteModel) : null;
  return cached;
}

function unit(a: number[]): number[] {
  const n = Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1;
  return a.map((x) => x / n);
}
function prep(m: TasteModel, v: ArrayLike<number>): number[] {
  return unit(Array.from({ length: m.dim }, (_, k) => v[k] - (m.centred ? m.mean[k] : 0)));
}
function finish(m: TasteModel, c: number[]): number[] {
  if (!m.W) return unit(c);
  const W = m.W;
  return unit(
    Array.from({ length: m.k }, (_, r) => {
      let s = 0;
      for (let q = 0; q < m.dim; q++) s += W[r * m.dim + q] * c[q];
      return s;
    }),
  );
}
export const itemVec = (m: TasteModel, v: ArrayLike<number>) => finish(m, prep(m, v));
export function tasteVec(m: TasteModel, hist: { v: ArrayLike<number>; stars: number }[]): number[] {
  const s = new Array(m.dim).fill(0);
  for (const h of hist) {
    const w = h.stars >= 4 ? m.weights.liked : h.stars === 3 ? m.weights.fine : m.weights.disliked;
    prep(m, h.v).forEach((x, k) => (s[k] += w * x));
  }
  return finish(m, unit(s));
}
export const dot = (a: number[], b: number[]) => a.reduce((s, x, k) => s + x * b[k], 0);

/** The model card: what it is, how it was checked, and what it is not. No weights. */
export function tasteCard() {
  const m = tasteModel();
  if (!m) return { available: false, why: "No taste model has been exported to src/taste/model.json." };
  const { mean: _m, W: _w, ...card } = m;
  return {
    available: true,
    ...card,
    runs_where: "in your browser, only when you switch it on; the server never sees your listings as numbers",
    not_used_for: "deciding what fits your must-haves or budget (code does that), or any money step",
  };
}
