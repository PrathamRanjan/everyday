// The scoring recipe, identical in the lab, the server (src/taste/taste.ts) and the browser (web/src/taste/taste.ts).
// A raw embedding → centred (minus the mean item) → unit length → projected by W (if the model has one) → unit length.
// A taste is the weighted mean of centred history items (liked 1, "fine" 0.3, disliked −0.5), then the same projection.
export function prep(model, v) {
  const d = model.dim;
  const c = new Float32Array(d);
  let n = 0;
  for (let k = 0; k < d; k++) n += (c[k] = v[k] - (model.centred ? model.mean[k] : 0)) ** 2;
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < d; k++) c[k] /= n;
  return c;
}
export function finish(model, c) {
  let a = c;
  if (model.W) {
    a = new Float32Array(model.k);
    for (let r = 0; r < model.k; r++) {
      let s = 0;
      for (let q = 0; q < model.dim; q++) s += model.W[r * model.dim + q] * c[q];
      a[r] = s;
    }
  }
  let n = 0;
  for (const x of a) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(a, (x) => x / n);
}
export const itemVec = (model, v) => finish(model, prep(model, v));
export function tasteVec(model, hist /* [{v, stars}] */) {
  const s = new Float32Array(model.dim);
  for (const h of hist) {
    const w = h.stars >= 4 ? 1 : h.stars === 3 ? 0.3 : -0.5;
    const c = prep(model, h.v);
    for (let k = 0; k < model.dim; k++) s[k] += w * c[k];
  }
  let n = 0;
  for (const x of s) n += x * x;
  n = Math.sqrt(n) || 1;
  return finish(model, Float32Array.from(s, (x) => x / n));
}
export const dot = (a, b) => a.reduce((s, x, k) => s + x * b[k], 0);
