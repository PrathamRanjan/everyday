// Step 3: learn a projection W (384 → 32) so that a person's past purchases point at what they buy next, and check it
// on purchases it never saw. Score = cosine(W·taste, W·item). Loss: BPR (the next buy should beat 4 random items from
// the same category), on the training history only (leave-one-out inside it). Early stopping on validation NDCG@10.
// Evaluation: leave-last-out, the true item among 99 negatives from the same category, against four baselines:
// random order, popularity, raw cosine (the plain multilingual embedding) and PCA-32 cosine (the starting point).
import { writeFileSync } from "node:fs";
import { load, negatives, rng, row, tasteOf } from "./data.mjs";

const D = load();
const { E, users, dim } = D;
const K = Number(process.env.K ?? 32);
const CENTER = process.env.CENTER === "1";
const TAG = `k${K}${CENTER ? "-centred" : ""}`;
// Centring: the multilingual embedding has a large part every text shares (all cosines sit near 0.9). Subtracting the
// mean item and re-normalising spreads the scores; the mean is exported so the browser does the same.
const MEAN = new Float32Array(dim);
if (CENTER) {
  for (let i = 0; i < D.ids.length; i++) for (let k = 0; k < dim; k++) MEAN[k] += E[i * dim + k] / D.ids.length;
  for (let i = 0; i < D.ids.length; i++) {
    let n = 0;
    for (let k = 0; k < dim; k++) n += (E[i * dim + k] -= MEAN[k]) ** 2;
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < dim; k++) E[i * dim + k] /= n;
  }
}
console.log("users", users.length, "items", D.ids.length);

// --- projection helpers
const project = (W, x) => {
  const a = new Float32Array(K);
  for (let r = 0; r < K; r++) {
    let s = 0;
    const o = r * dim;
    for (let k = 0; k < dim; k++) s += W[o + k] * x[k];
    a[r] = s;
  }
  return a;
};
const norm = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1e-9;
const cos = (a, b) => {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s / (norm(a) * norm(b));
};

// --- PCA-32 start (power iteration with deflation on a 20k-item sample)
function pca() {
  const r = rng(5);
  const n = 20000;
  const S = Array.from({ length: n }, () => row(E, Math.floor(r() * D.ids.length), dim));
  const mean = new Float64Array(dim);
  for (const s of S) for (let k = 0; k < dim; k++) mean[k] += s[k] / n;
  const C = new Float64Array(dim * dim);
  for (const s of S) for (let i = 0; i < dim; i++) {
    const si = s[i] - mean[i];
    for (let j = i; j < dim; j++) C[i * dim + j] += (si * (s[j] - mean[j])) / n;
  }
  for (let i = 0; i < dim; i++) for (let j = 0; j < i; j++) C[i * dim + j] = C[j * dim + i];
  const W = new Float32Array(K * dim);
  for (let c = 0; c < K; c++) {
    let v = Float64Array.from({ length: dim }, () => r() - 0.5);
    for (let it = 0; it < 200; it++) {
      const nv = new Float64Array(dim);
      for (let i = 0; i < dim; i++) {
        let s = 0;
        for (let j = 0; j < dim; j++) s += C[i * dim + j] * v[j];
        nv[i] = s;
      }
      const l = Math.sqrt(nv.reduce((s, x) => s + x * x, 0));
      v = nv.map((x) => x / l);
    }
    let lam = 0;
    for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) lam += v[i] * C[i * dim + j] * v[j];
    for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) C[i * dim + j] -= lam * v[i] * v[j];
    for (let k = 0; k < dim; k++) W[c * dim + k] = v[k];
  }
  return W;
}

// --- evaluation
function evaluate(split, scorer, { cold = false } = {}) {
  let hr = 0, ndcg = 0, auc = 0, n = 0;
  for (const u of users) {
    const truth = u[split];
    if (cold && D.pop[truth.i] > 0) continue;
    const hist = split === "test" ? [...u.train, u.val] : u.train;
    const negs = negatives(D, u, 99, (split === "test" ? 7 : 3) * 1e5 + n * 31 + u.user.length);
    const s = scorer(hist, [truth.i, ...negs], u);
    const t = s[0];
    let above = 0, below = 0;
    for (let k = 1; k < s.length; k++) s[k] > t ? above++ : s[k] < t ? below++ : (above += 0.5, below += 0.5);
    const rank = above; // 0 = top
    if (rank < 10) {
      hr++;
      ndcg += 1 / Math.log2(rank + 2);
    }
    auc += below / (s.length - 1);
    n++;
  }
  return { cases: n, hr_at_10: +(hr / n).toFixed(4), ndcg_at_10: +(ndcg / n).toFixed(4), auc: +(auc / n).toFixed(4) };
}
const R = rng(99);
const scorers = {
  random: () => (hist, c) => c.map(() => R()),
  popularity: () => (hist, c) => c.map((i) => D.pop[i] + R() * 1e-3),
  raw_cosine: () => (hist, c) => {
    const t = tasteOf(E, hist, dim);
    return c.map((i) => cos(t, row(E, i, dim)));
  },
  projected: (W) => {
    const P = new Float32Array(D.ids.length * K);
    for (let i = 0; i < D.ids.length; i++) {
      const a = project(W, row(E, i, dim));
      const n = norm(a);
      for (let k = 0; k < K; k++) P[i * K + k] = a[k] / n;
    }
    return (hist, c) => {
      const t = project(W, tasteOf(E, hist, dim));
      const nt = norm(t);
      return c.map((i) => {
        let s = 0;
        for (let k = 0; k < K; k++) s += t[k] * P[i * K + k];
        return s / nt;
      });
    };
  },
};

// --- training (Adam, BPR with 4 negatives, temperature 0.05)
const W0 = pca();
const W = Float32Array.from(W0);
const T = 0.05, NEG = 4, LR = 2e-3, B = 128;
const m = new Float32Array(W.length), v2 = new Float32Array(W.length);
let step = 0;
const r = rng(42);
const trainUsers = users.filter((u) => u.train.some((x) => x.stars >= 4) && u.train.length >= 3);
function dcos(a, b, na, nb, c) {
  // ∂cos/∂a = (b/|b| − cos·a/|a|)/|a|
  const g = new Float32Array(K);
  for (let k = 0; k < K; k++) g[k] = (b[k] / nb - (c * a[k]) / na) / na;
  return g;
}
// The starting point (PCA) competes too: if training never beats it on validation, it is what ships.
let best = { ndcg: evaluate("val", scorers.projected(W0)).ndcg_at_10, W: Float32Array.from(W0), epoch: 0 };
console.log("start (PCA) val ndcg", best.ndcg);
const history = [];
const t0 = Date.now();
for (let epoch = 1; epoch <= 25; epoch++) {
  let loss = 0, count = 0;
  const G = new Float32Array(W.length);
  let inBatch = 0;
  const order = trainUsers.map((u) => [r(), u]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  for (const u of order) for (let rep = 0; rep < 4; rep++) {
    const liked = u.train.filter((x) => x.stars >= 4);
    const p = liked[Math.floor(r() * liked.length)];
    const x = tasteOf(E, u.train, dim, p.i);
    const a = project(W, x), na = norm(a);
    const pe = row(E, p.i, dim), b = project(W, pe), nb = norm(b);
    const cp = cos(a, b);
    const gA = new Float32Array(K);
    const pool = D.pool[u.cat];
    let gb = 0;
    const ns = [];
    for (let j = 0; j < NEG; j++) {
      let ni;
      do ni = pool[Math.floor(r() * pool.length)]; while (u.seen.has(ni));
      const ne = row(E, ni, dim), c = project(W, ne), nc = norm(c);
      const cn = cos(a, c);
      const z = (cp - cn) / T;
      const sig = 1 / (1 + Math.exp(z)); // σ(−z)
      loss += Math.log1p(Math.exp(-z));
      count++;
      const g = sig / T;
      gb += g;
      const dAp = dcos(a, b, na, nb, cp), dAn = dcos(a, c, na, nc, cn), dC = dcos(c, a, nc, na, cn);
      for (let k = 0; k < K; k++) gA[k] += -g * dAp[k] + g * dAn[k];
      // ∂L/∂W += (∂L/∂c) ⊗ n
      for (let k = 0; k < K; k++) {
        const gc = g * dC[k], o = k * dim;
        if (gc) for (let q = 0; q < dim; q++) G[o + q] += gc * ne[q];
      }
      ns.push(ni);
    }
    const dB = dcos(b, a, nb, na, cp);
    for (let k = 0; k < K; k++) {
      const ga = gA[k], gbk = -gb * dB[k], o = k * dim;
      for (let q = 0; q < dim; q++) G[o + q] += ga * x[q] + gbk * pe[q];
    }
    if (++inBatch === B) {
      step++;
      for (let k = 0; k < W.length; k++) {
        const g = G[k] / B + 1e-5 * (W[k] - W0[k]);
        m[k] = 0.9 * m[k] + 0.1 * g;
        v2[k] = 0.999 * v2[k] + 0.001 * g * g;
        const mh = m[k] / (1 - 0.9 ** step), vh = v2[k] / (1 - 0.999 ** step);
        W[k] -= (LR * mh) / (Math.sqrt(vh) + 1e-8);
      }
      G.fill(0);
      inBatch = 0;
    }
  }
  const val = evaluate("val", scorers.projected(W));
  history.push({ epoch, loss: +(loss / count).toFixed(4), val_ndcg_at_10: val.ndcg_at_10, val_hr_at_10: val.hr_at_10 });
  console.log(history.at(-1), `${Math.round((Date.now() - t0) / 1000)} s`);
  if (val.ndcg_at_10 > best.ndcg) best = { ndcg: val.ndcg_at_10, W: Float32Array.from(W), epoch };
  else if (epoch - best.epoch >= 3) break;
}

// --- final numbers (test split is touched only here)
const results = {};
for (const [name, mk] of Object.entries({ random: scorers.random(), popularity: scorers.popularity(), raw_cosine: scorers.raw_cosine(), [`pca${K}_start`]: scorers.projected(W0), trained_projection: scorers.projected(best.W) })) {
  results[name] = { val: evaluate("val", mk), test: evaluate("test", mk), test_cold_items: evaluate("test", mk, { cold: true }) };
  console.log(name, JSON.stringify(results[name]));
}

// The raw embedding competes with the projection; the better one on VALIDATION is what ships.
const useRaw = results.raw_cosine.val.ndcg_at_10 > results.trained_projection.val.ndcg_at_10;
// --- "nothing fits": τ from validation = the 10th percentile of the score the real next buy gets.
const proj = useRaw ? scorers.raw_cosine() : scorers.projected(best.W);
const trueScores = (split) => users.map((u) => proj(split === "test" ? [...u.train, u.val] : u.train, [u[split].i])[0]).sort((a, b) => a - b);
const vs = trueScores("val");
const tau = vs[Math.floor(vs.length * 0.1)];
const ts = trueScores("test");
let goodList = 0, badList = 0, randBelow = 0, randN = 0, crossBad = 0;
const cats = Object.keys(D.pool);
users.forEach((u, n) => {
  const hist = [...u.train, u.val];
  const negs = negatives(D, u, 19, 9e5 + n);
  const s = proj(hist, [u.test.i, ...negs]);
  if (Math.max(...s.slice(0, 10)) >= tau) goodList++; // the real buy + 9 others: "something fits"
  if (Math.max(...s.slice(10)) < tau) badList++; // 10 others, real buy absent: "nothing fits"
  for (const x of s.slice(1)) (randN++, x < tau && randBelow++);
  const other = D.pool[cats[(cats.indexOf(u.cat) + 1) % cats.length]];
  const rr = rng(n + 1);
  const cs = proj(hist, Array.from({ length: 10 }, () => other[Math.floor(rr() * other.length)]));
  if (Math.max(...cs) < tau) crossBad++;
});
const N = users.length;
const nothingFits = {
  tau: +tau.toFixed(4),
  chosen_on: "validation: 90% of real next buys score at or above it",
  test_real_next_buy_at_or_above: +(ts.filter((x) => x >= tau).length / ts.length).toFixed(4),
  test_random_same_category_item_below: +(randBelow / randN).toFixed(4),
  test_list_with_real_buy_says_something_fits: +(goodList / N).toFixed(4),
  test_list_of_10_random_same_category_says_nothing_fits: +(badList / N).toFixed(4),
  test_list_of_10_other_category_items_says_nothing_fits: +(crossBad / N).toFixed(4),
};
console.log(nothingFits);
writeFileSync(`data/W-${TAG}.json`, JSON.stringify({ k: K, dim, centred: CENTER, mean: Array.from(MEAN), W: Array.from(best.W), ships: useRaw ? "raw_cosine" : "trained_projection" }));
writeFileSync(`data/results-${TAG}.json`, JSON.stringify({ config: { K, centred: CENTER }, ships: useRaw ? "raw_cosine" : "trained_projection", trained_at: new Date().toISOString(), users: N, items: D.ids.length, best_epoch: best.epoch, training: history, results, nothing_fits: nothingFits, seconds: Math.round((Date.now() - t0) / 1000) }, null, 2));
