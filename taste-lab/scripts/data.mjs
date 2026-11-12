// Loading and splitting, shared by training, evaluation and the language test.
import { readFileSync } from "node:fs";
import { DIM } from "./embed-lib.mjs";

export function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** How much a past rating says about taste: liked counts fully, "fine" a little, disliked pushes away. */
export const weightOf = (stars) => (stars >= 4 ? 1 : stars === 3 ? 0.3 : -0.5);

export function load() {
  const ids = JSON.parse(readFileSync("data/emb-ids.json", "utf8"));
  const buf = readFileSync("data/emb.f32");
  const E = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const index = new Map(ids.map((id, i) => [id, i]));
  const items = readFileSync("data/items.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const users = readFileSync("data/ratings.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((u) => ({ ...u, ratings: u.ratings.filter((r) => index.has(r.item)).map((r) => ({ i: index.get(r.item), stars: r.stars, ts: r.ts })) })).filter((u) => u.ratings.length >= 6);
  // Leave-last-out: the last thing a person bought is the test, the one before it validation, the rest history.
  for (const u of users) {
    u.test = u.ratings[u.ratings.length - 1];
    u.val = u.ratings[u.ratings.length - 2];
    u.train = u.ratings.slice(0, -2);
    u.seen = new Set(u.ratings.map((r) => r.i));
  }
  const pool = {};
  for (const it of items) (pool[it.cat] ??= []).push(index.get(it.id));
  const pop = new Float64Array(ids.length);
  for (const u of users) for (const r of u.train) pop[r.i]++;
  return { ids, E, items, users, pool, pop, dim: DIM };
}

export const row = (E, i, dim = 384) => E.subarray(i * dim, (i + 1) * dim);

/** The taste vector of a history (raw 384 numbers, weighted mean, unit length). */
export function tasteOf(E, hist, dim = 384, skip = -1) {
  const v = new Float32Array(dim);
  for (const r of hist) {
    if (r.i === skip) continue;
    const w = weightOf(r.stars);
    const e = row(E, r.i, dim);
    for (let k = 0; k < dim; k++) v[k] += w * e[k];
  }
  let n = 0;
  for (let k = 0; k < dim; k++) n += v[k] * v[k];
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < dim; k++) v[k] /= n;
  return v;
}

/** Negatives for one user: from the same category, never something they bought. Seeded, so every method sees the same. */
export function negatives(d, u, n, seed) {
  const r = rng(seed);
  const p = d.pool[u.cat];
  const out = new Set();
  while (out.size < n) {
    const i = p[Math.floor(r() * p.length)];
    if (!u.seen.has(i)) out.add(i);
  }
  return [...out];
}
