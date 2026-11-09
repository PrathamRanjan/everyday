import { NORTHLIGHT, type ProductDef } from "../services/catalog-data.js";
import { DIM, dot, featurize, fitPairs, gauss, mask, ndcgAt, pickPairs, rng, sigmoid, update, zeros, FEATURES, PRICE, type Weights } from "./prefs.js";

/**
 * Reproducible preference experiment on SYNTHETIC shoppers (clearly labeled). Each shopper has hidden taste weights
 * drawn around a population mean; choices are sampled from the logistic model over the catalog's real attributes.
 * We train the global prior on training shoppers and measure ranking quality on held-out shoppers.
 */
export const CATEGORIES = ["lamp", "chair", "mouse", "keyboard", "monitor_arm", "desk_mat"] as const;

const POP_MEAN: Record<string, number> = { "style:minimal": 0.6, "style:ergonomic": 0.8, "style:warm": 0.3, "style:playful": -0.4, "style:quiet": 0.3, "material:plastic": -0.3, price: -1.0 };

export interface Item {
  id: string;
  slot: string;
  x: number[];
}

export function catalogItems(products: ProductDef[] = NORTHLIGHT): Item[] {
  const out: Item[] = [];
  for (const c of CATEGORIES) {
    const ps = products.filter((p) => p.category === c);
    const prices = ps.map((p) => p.price * 100).sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    for (const p of ps) out.push({ id: p.sku, slot: c, x: featurize({ attrs: p.attrs, price_cents: p.price * 100 }, median) });
  }
  return out;
}

function shopper(r: () => number): Weights {
  return FEATURES.map((f) => (POP_MEAN[f] ?? 0) + 0.9 * gauss(r));
}

function choose(r: () => number, w: Weights, a: Item, b: Item): 0 | 1 {
  return r() < sigmoid(dot(w, a.x.map((v, i) => v - b.x[i]))) ? 1 : 0;
}

function randomPairs(r: () => number, items: Item[], n: number): [Item, Item][] {
  const out: [Item, Item][] = [];
  while (out.length < n) {
    const a = items[Math.floor(r() * items.length)];
    const same = items.filter((x) => x.slot === a.slot && x.id !== a.id);
    if (!same.length) continue;
    out.push([a, same[Math.floor(r() * same.length)]]);
  }
  return out;
}

function rankScore(items: Item[], score: (it: Item) => number, truth: Weights): number {
  let total = 0;
  let n = 0;
  for (const c of CATEGORIES) {
    const its = items.filter((i) => i.slot === c);
    if (its.length < 3) continue;
    const predicted = [...its].sort((a, b) => score(b) - score(a)).map((i) => i.id);
    total += ndcgAt(3, predicted, new Map(its.map((i) => [i.id, dot(truth, i.x)])));
    n++;
  }
  return total / n;
}

export interface ExperimentResult {
  seed: number;
  train_shoppers: number;
  test_shoppers: number;
  train_pairs: number;
  popularity: number;
  global: number;
  personal: Record<number, number>;
  prior: Weights;
}

export function runExperiment(seed: number, opts: { shoppers?: number; trainPairsPer?: number; ks?: number[] } = {}): ExperimentResult {
  const r = rng(seed);
  const items = catalogItems();
  const n = opts.shoppers ?? 200;
  const ks = opts.ks ?? [0, 3, 5, 10];
  const people = Array.from({ length: n }, () => shopper(r));
  const train = people.slice(0, Math.floor(n * 0.7));
  const test = people.slice(Math.floor(n * 0.7));
  const pairs: { d: number[]; y: 0 | 1 }[] = [];
  const wins = new Map<string, number>();
  const shown = new Map<string, number>();
  for (const w of train)
    for (const [a, b] of randomPairs(r, items, opts.trainPairsPer ?? 30)) {
      const y = choose(r, w, a, b);
      pairs.push({ d: a.x.map((v, i) => v - b.x[i]), y });
      const winner = y ? a : b;
      wins.set(winner.id, (wins.get(winner.id) ?? 0) + 1);
      shown.set(a.id, (shown.get(a.id) ?? 0) + 1);
      shown.set(b.id, (shown.get(b.id) ?? 0) + 1);
    }
  const prior = fitPairs(pairs);
  const pop = (it: Item) => (wins.get(it.id) ?? 0) / Math.max(1, shown.get(it.id) ?? 0);
  let popS = 0;
  let globS = 0;
  const pers: Record<number, number> = Object.fromEntries(ks.map((k) => [k, 0]));
  const all = mask("style")!;
  for (const truth of test) {
    popS += rankScore(items, pop, truth);
    globS += rankScore(items, (it) => dot(prior, it.x), truth);
    for (const k of ks) {
      let w = [...prior];
      const asked = new Set<string>();
      for (let step = 0; step < k; step++) {
        const [pair] = pickPairs(items.filter((i) => !asked.has(i.id)), w, 1);
        if (!pair) break;
        const [a, b] = pair;
        asked.add(a.id);
        asked.add(b.id);
        w = update(w, prior, a.x, b.x, choose(r, truth, a, b), all);
      }
      pers[k] += rankScore(items, (it) => dot(w, it.x), truth);
    }
  }
  const avg = (v: number) => Math.round((v / test.length) * 1000) / 1000;
  return { seed, train_shoppers: train.length, test_shoppers: test.length, train_pairs: pairs.length, popularity: avg(popS), global: avg(globS), personal: Object.fromEntries(Object.entries(pers).map(([k, v]) => [k, avg(v)])), prior };
}

/** Five seeds; promote personalisation only if its gain over the global model beats the seed-to-seed spread. */
export function report(seeds = [1, 2, 3, 4, 5]) {
  const runs = seeds.map((s) => runExperiment(s));
  const mean = (f: (r: ExperimentResult) => number) => Math.round((runs.reduce((a, r) => a + f(r), 0) / runs.length) * 1000) / 1000;
  const spread = (f: (r: ExperimentResult) => number) => Math.round((Math.max(...runs.map(f)) - Math.min(...runs.map(f))) * 1000) / 1000;
  const ks = Object.keys(runs[0].personal).map(Number);
  const gain5 = mean((r) => r.personal[5] - r.global);
  return {
    data: "SYNTHETIC shoppers (hidden taste weights around a population mean) choosing between real catalog attributes",
    seeds,
    train_shoppers: runs[0].train_shoppers,
    test_shoppers: runs[0].test_shoppers,
    train_pairs: runs[0].train_pairs,
    metric: "NDCG@3 within category, averaged over 6 categories",
    popularity: { mean: mean((r) => r.popularity), spread: spread((r) => r.popularity) },
    global: { mean: mean((r) => r.global), spread: spread((r) => r.global) },
    personal: Object.fromEntries(ks.map((k) => [k, { mean: mean((r) => r.personal[k]), spread: spread((r) => r.personal[k]) }])),
    gain_at_5: gain5,
    promote_personal: gain5 > spread((r) => r.global),
    prior: runs[0].prior,
  };
}

export const priorFrom = (seed = 1): Weights => runExperiment(seed).prior;
export { DIM, PRICE, zeros };
