/**
 * A1/A2: the pure parts of hands-free control, kept apart so they can be tested without a camera.
 *   - features(): what the camera sees, as numbers (iris position inside each eye, head turn and tilt).
 *   - Ridge regression from features to a point on the screen, fitted on the calibration dots, with the strength of
 *     the ridge chosen by leave-one-dot-out cross-validation.
 *   - A One Euro filter to steady the point without lag on fast moves.
 *   - Snapping: the point picks a target only after it has voted for it in most recent frames, keeps it a little
 *     longer than it took to win (hysteresis), and forgets the votes on a jump across the screen (a saccade).
 *   - Drift correction: when a target is chosen, the small gap between the estimate and the target's centre is
 *     folded back into an offset, so a slow drift (head moved, light changed) wears off as you use it.
 * No imports: the tests read this file directly.
 */

export type Vec = number[];
export type Pt = { x: number; y: number };

/** Landmarks MediaPipe Face Landmarker gives (478 points, normalised 0..1). Indices from its face mesh. */
const L = { leftIris: 468, rightIris: 473, lOuter: 33, lInner: 133, lTop: 159, lBottom: 145, rOuter: 263, rInner: 362, rTop: 386, rBottom: 374, nose: 1, chin: 152, forehead: 10, lCheek: 234, rCheek: 454 };

/** Numbers for one frame: iris position inside each eye (x, y in 0..1 of the eye's box), plus head yaw and pitch. */
export function features(lm: { x: number; y: number; z?: number }[]): Vec | null {
  if (!lm || lm.length < 478) return null;
  const eye = (iris: number, a: number, b: number, top: number, bottom: number) => {
    const x0 = Math.min(lm[a].x, lm[b].x);
    const x1 = Math.max(lm[a].x, lm[b].x);
    const w = x1 - x0;
    const h = Math.abs(lm[bottom].y - lm[top].y);
    if (w <= 1e-6) return null;
    return [(lm[iris].x - x0) / w, (lm[iris].y - Math.min(lm[top].y, lm[bottom].y)) / Math.max(h, w * 0.15)];
  };
  const le = eye(L.leftIris, L.lOuter, L.lInner, L.lTop, L.lBottom);
  const re = eye(L.rightIris, L.rInner, L.rOuter, L.rTop, L.rBottom);
  if (!le || !re) return null;
  const faceW = Math.abs(lm[L.rCheek].x - lm[L.lCheek].x) || 1e-6;
  const faceH = Math.abs(lm[L.chin].y - lm[L.forehead].y) || 1e-6;
  const yaw = (lm[L.nose].x - (lm[L.lCheek].x + lm[L.rCheek].x) / 2) / faceW;
  const pitch = (lm[L.nose].y - (lm[L.forehead].y + lm[L.chin].y) / 2) / faceH;
  return [le[0], le[1], re[0], re[1], yaw, pitch];
}

/** Second-order terms help with the curve of the eye: [1, f, f²] per feature, plus the yaw×iris cross terms. */
export function expand(f: Vec): Vec {
  const out = [1, ...f, ...f.map((v) => v * v)];
  out.push(f[0] * f[4], f[2] * f[4], f[1] * f[5], f[3] * f[5]);
  return out;
}

/** Solves (XᵀX + λI)w = Xᵀy by Gaussian elimination. The bias (first column) is not penalised. */
export function ridge(X: Vec[], y: number[], lambda: number): Vec {
  const n = X[0].length;
  const A: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j && i > 0 ? lambda : 0)));
  const b: number[] = Array.from({ length: n }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const m = A[r][c] / d;
      if (!m) continue;
      for (let k = c; k < n; k++) A[r][k] -= m * A[c][k];
      b[r] -= m * b[c];
    }
  }
  return b.map((v, i) => v / (A[i][i] || 1e-12));
}
const dot = (w: Vec, x: Vec) => w.reduce((s, v, i) => s + v * x[i], 0);

export type Sample = { f: Vec; target: Pt; dot: number };
export type Model = { wx: Vec; wy: Vec; lambda: number; cv_px: number; n: number };
const LAMBDAS = [1e-4, 1e-3, 1e-2, 0.03, 0.1, 0.3, 1, 3];

/** Fits the screen mapping. The ridge strength is the one with the lowest leave-one-dot-out error (in pixels). */
export function fit(samples: Sample[]): Model | null {
  const dots = [...new Set(samples.map((s) => s.dot))];
  if (dots.length < 5 || samples.length < 20) return null;
  const train = (rows: Sample[], lambda: number) => {
    const X = rows.map((s) => expand(s.f));
    return { wx: ridge(X, rows.map((s) => s.target.x), lambda), wy: ridge(X, rows.map((s) => s.target.y), lambda) };
  };
  let best: { lambda: number; err: number } | null = null;
  for (const lambda of LAMBDAS) {
    let err = 0;
    let n = 0;
    for (const d of dots) {
      const m = train(samples.filter((s) => s.dot !== d), lambda);
      for (const s of samples.filter((s) => s.dot === d)) {
        const x = expand(s.f);
        err += Math.hypot(dot(m.wx, x) - s.target.x, dot(m.wy, x) - s.target.y);
        n++;
      }
    }
    const mean = err / Math.max(n, 1);
    if (!best || mean < best.err) best = { lambda, err: mean };
  }
  const m = train(samples, best!.lambda);
  return { ...m, lambda: best!.lambda, cv_px: Math.round(best!.err), n: samples.length };
}

export const predict = (m: Pick<Model, "wx" | "wy">, f: Vec): Pt => {
  const x = expand(f);
  return { x: dot(m.wx, x), y: dot(m.wy, x) };
};

/** Mean distance in pixels between where people looked and where the model put it (the check dots after calibration). */
export const accuracyPx = (pairs: { said: Pt; truth: Pt }[]) => (pairs.length ? Math.round(pairs.reduce((s, p) => s + Math.hypot(p.said.x - p.truth.x, p.said.y - p.truth.y), 0) / pairs.length) : null);

/** One Euro filter (Casiez et al. 2012): steady when still, quick when moving. */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(
    private minCutoff = 1.2,
    private beta = 0.015,
    private dCutoff = 1,
  ) {}
  reset() {
    this.x = null;
  }
  private alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  next(v: number, tMs: number): number {
    if (this.x === null) {
      this.x = v;
      this.t = tMs;
      return v;
    }
    const dt = Math.max((tMs - this.t) / 1000, 1 / 120);
    this.t = tMs;
    const d = (v - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

export type Box = { id: string; x: number; y: number; w: number; h: number };
/** Distance from a point to a box (0 inside it). */
export const boxDistance = (p: Pt, b: Box) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h)));
export const centre = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * Picks the target the gaze means. Each frame votes for the nearest box within `radius` px (or for nothing).
 * A box wins with `win` of the last `window` votes and stays chosen until it falls below `keep` (keep < win: hysteresis).
 * A jump longer than `saccade` px clears the votes, so the eye landing somewhere new isn't held back by the old place.
 */
export class Snapper {
  private votes: (string | null)[] = [];
  private last: Pt | null = null;
  chosen: string | null = null;
  constructor(
    private opts = { radius: 90, window: 12, win: 0.6, keep: 0.35, saccade: 260 },
  ) {}
  reset() {
    this.votes = [];
    this.chosen = null;
    this.last = null;
  }
  push(p: Pt, boxes: Box[]): string | null {
    if (this.last && Math.hypot(p.x - this.last.x, p.y - this.last.y) > this.opts.saccade) this.votes = [];
    this.last = p;
    let best: { id: string; d: number } | null = null;
    for (const b of boxes) {
      const d = boxDistance(p, b);
      if (d <= this.opts.radius && (!best || d < best.d)) best = { id: b.id, d };
    }
    this.votes.push(best?.id ?? null);
    if (this.votes.length > this.opts.window) this.votes.shift();
    const share = (id: string) => this.votes.filter((v) => v === id).length / this.opts.window;
    if (this.chosen && share(this.chosen) < this.opts.keep) this.chosen = null;
    if (!this.chosen && best && share(best.id) >= this.opts.win) this.chosen = best.id;
    return this.chosen;
  }
}

/** Folds part of the error at a chosen target back into the offset (bounded, so one bad pick can't throw it off). */
export function correctDrift(offset: Pt, estimate: Pt, target: Pt, rate = 0.25, max = 120): Pt {
  const nx = offset.x + rate * (target.x - estimate.x);
  const ny = offset.y + rate * (target.y - estimate.y);
  return { x: Math.max(-max, Math.min(max, nx)), y: Math.max(-max, Math.min(max, ny)) };
}

/**
 * Head mode (no calibration needed): head turn and tilt move the point from the pose held when it started.
 * `gain` is screen widths per unit of yaw; a small dead zone keeps the point still while the head is still.
 */
export function headPoint(f: Vec, rest: Vec, screen: { w: number; h: number }, gain = 5.5, dead = 0.008): Pt {
  const dz = (v: number) => (Math.abs(v) < dead ? 0 : v - Math.sign(v) * dead);
  const x = screen.w / 2 - dz(f[4] - rest[4]) * gain * screen.w;
  const y = screen.h / 2 + dz(f[5] - rest[5]) * gain * 1.6 * screen.h;
  return { x: Math.max(0, Math.min(screen.w, x)), y: Math.max(0, Math.min(screen.h, y)) };
}

/** Nine dots for calibration and four for the check, as fractions of the screen (kept off the very edge). */
export const CAL_DOTS: Pt[] = [0.08, 0.5, 0.92].flatMap((y) => [0.08, 0.5, 0.92].map((x) => ({ x, y })));
export const CHECK_DOTS: Pt[] = [
  { x: 0.3, y: 0.3 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.7 },
  { x: 0.7, y: 0.7 },
];
export const TOPUP_DOTS: Pt[] = [
  { x: 0.08, y: 0.08 },
  { x: 0.5, y: 0.5 },
  { x: 0.92, y: 0.92 },
];
