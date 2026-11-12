// Step 3b: the "nothing fits" line, at the level the app uses it (a whole list of listings). For each person:
//   a list WITH their real next buy (+9 random same-category items)   → should say "something fits";
//   a list of 10 items from ANOTHER category (off-taste, on purpose)   → should say "nothing fits";
//   a list of 10 random same-category items (no real buy)               → reported, but no target: many may suit them.
// τ is chosen on VALIDATION to maximise balanced accuracy (good lists kept vs other-category lists flagged), then
// reported once on test. The model's verdict is the list's best score.
import { readFileSync, writeFileSync } from "node:fs";
import { load, negatives, rng, row } from "./data.mjs";
import { dot, itemVec, tasteVec } from "./score.mjs";

const tag = process.argv[2];
const w = JSON.parse(readFileSync(`data/W-${tag}.json`, "utf8"));
const model = { dim: w.dim, k: w.k, centred: w.centred, mean: Float32Array.from(w.mean), W: w.ships === "raw_cosine" ? null : Float32Array.from(w.W) };
const D = load();
const cats = Object.keys(D.pool);
const P = new Map();
const iv = (i) => (P.has(i) ? P.get(i) : (P.set(i, itemVec(model, row(D.E, i))), P.get(i)));
function lists(split) {
  return D.users.map((u, n) => {
    const hist = (split === "test" ? [...u.train, u.val] : u.train).map((h) => ({ v: row(D.E, h.i), stars: h.stars }));
    const t = tasteVec(model, hist);
    const max = (ids) => Math.max(...ids.map((i) => dot(t, iv(i))));
    const negs = negatives(D, u, 19, (split === "test" ? 9e6 : 8e6) + n);
    const other = D.pool[cats[(cats.indexOf(u.cat) + 1 + (n % 2)) % cats.length]];
    const r = rng(n + (split === "test" ? 77 : 55));
    return { good: max([u[split].i, ...negs.slice(0, 9)]), same: max(negs.slice(9, 19)), cross: max(Array.from({ length: 10 }, () => other[Math.floor(r() * other.length)])) };
  });
}
const val = lists("val");
const rate = (L, tau) => ({ good_kept: L.filter((x) => x.good >= tau).length / L.length, cross_flagged: L.filter((x) => x.cross < tau).length / L.length, same_flagged: L.filter((x) => x.same < tau).length / L.length });
let best = { tau: 0, bal: 0 };
for (let tau = -0.2; tau <= 0.8; tau += 0.005) {
  const r = rate(val, tau);
  const bal = (r.good_kept + r.cross_flagged) / 2;
  if (bal > best.bal) best = { tau: +tau.toFixed(3), bal };
}
const test = lists("test");
const out = {
  tau: best.tau,
  chosen_on: "validation, best balanced accuracy between lists holding the real next buy and lists from another category",
  validation: rate(val, best.tau),
  test: rate(test, best.tau),
  test_balanced_accuracy: +((rate(test, best.tau).good_kept + rate(test, best.tau).cross_flagged) / 2).toFixed(4),
  reading: "good_kept = a list with the real next buy said 'something fits'; cross_flagged = a list from another category said 'nothing fits'; same_flagged = a random same-category list said 'nothing fits' (no right answer)",
};
for (const k of ["validation", "test"]) for (const m of Object.keys(out[k])) out[k][m] = +out[k][m].toFixed(4);
console.log(out);
const res = JSON.parse(readFileSync(`data/results-${tag}.json`, "utf8"));
res.nothing_fits_per_item = res.nothing_fits;
res.nothing_fits = out;
writeFileSync(`data/results-${tag}.json`, JSON.stringify(res, null, 2));
