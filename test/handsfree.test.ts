import { describe, expect, it } from "vitest";
import { accuracyPx, CAL_DOTS, CHECK_DOTS, correctDrift, fit, headPoint, OneEuro, predict, Snapper, type Sample } from "../web/src/handsfree/math.js";
import { afterWake, isStop, matchName, understand } from "../web/src/handsfree/speech.js";

// A1–A4: the camera-free parts of hands-free control. Eye data here is SIMULATED (a made-up eye with noise),
// so the numbers say the maths works, not how well a real person's eyes are read.
const W = 1440;
const H = 900;
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
/** A simulated eye: iris position is a slightly curved function of where it looks, plus noise. */
function eye(p: { x: number; y: number }, r: () => number, noise = 0.004) {
  const u = p.x / W;
  const v = p.y / H;
  const n = () => (r() - 0.5) * 2 * noise;
  const lx = 0.35 + 0.3 * u + 0.04 * u * u + n();
  const ly = 0.4 + 0.22 * v + n();
  return [lx, ly, lx + 0.01 + n(), ly + n(), 0.01 + n() / 4, -0.02 + n() / 4];
}

describe("gaze: calibration fit, accuracy, smoothing, snapping, drift", () => {
  it("fits nine dots with cross-validated ridge regression and lands the check dots within ~40 px", () => {
    const r = rng(7);
    const samples: Sample[] = CAL_DOTS.flatMap((d, i) => Array.from({ length: 12 }, () => ({ f: eye({ x: d.x * W, y: d.y * H }, r), target: { x: d.x * W, y: d.y * H }, dot: i })));
    const m = fit(samples)!;
    expect(m).not.toBeNull();
    expect(m.cv_px).toBeLessThan(60);
    const pairs = CHECK_DOTS.map((d) => ({ truth: { x: d.x * W, y: d.y * H }, said: predict(m, eye({ x: d.x * W, y: d.y * H }, r)) }));
    expect(accuracyPx(pairs)!).toBeLessThan(40);
  });

  it("refuses to fit on too few dots", () => {
    const r = rng(1);
    expect(fit(CAL_DOTS.slice(0, 3).flatMap((d, i) => Array.from({ length: 12 }, () => ({ f: eye(d, r), target: d, dot: i }))))).toBeNull();
  });

  it("steadies a still point and follows a fast move (One Euro)", () => {
    const f = new OneEuro();
    const r = rng(3);
    let out = 0;
    for (let t = 0; t < 60; t++) out = f.next(500 + (r() - 0.5) * 40, t * 33);
    expect(Math.abs(out - 500)).toBeLessThan(12);
    for (let t = 60; t < 75; t++) out = f.next(1200, t * 33);
    expect(out).toBeGreaterThan(1100);
  });

  it("snaps only after most recent frames agree, keeps the target through jitter, and resets on a saccade", () => {
    const s = new Snapper();
    const boxes = [
      { id: "a", x: 100, y: 100, w: 120, h: 44 },
      { id: "b", x: 900, y: 600, w: 120, h: 44 },
    ];
    let got: string | null = null;
    for (let i = 0; i < 6; i++) got = s.push({ x: 150, y: 120 }, boxes);
    expect(got).toBeNull(); // 6 of 12 frames is not yet enough
    for (let i = 0; i < 3; i++) got = s.push({ x: 150, y: 120 }, boxes);
    expect(got).toBe("a");
    for (let i = 0; i < 3; i++) got = s.push({ x: 330, y: 200 }, boxes); // drifts off for a moment
    expect(got).toBe("a");
    got = s.push({ x: 950, y: 620 }, boxes); // a jump across the screen clears the votes
    expect(got).toBeNull();
    for (let i = 0; i < 8; i++) got = s.push({ x: 950, y: 620 }, boxes);
    expect(got).toBe("b");
  });

  it("folds part of the error back into the offset, never more than the cap", () => {
    expect(correctDrift({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 140, y: 80 })).toEqual({ x: 10, y: -5 });
    expect(correctDrift({ x: 110, y: 0 }, { x: 0, y: 0 }, { x: 900, y: 0 }).x).toBe(120);
  });

  it("head mode: still head, still point; a turn moves it the right way", () => {
    const rest = [0.5, 0.5, 0.5, 0.5, 0, 0];
    expect(headPoint(rest, rest, { w: W, h: H })).toEqual({ x: W / 2, y: H / 2 });
    expect(headPoint([0.5, 0.5, 0.5, 0.5, -0.05, 0], rest, { w: W, h: H }).x).toBeGreaterThan(W / 2);
  });
});

describe("speech: wake word, stop words, look-and-say, four languages", () => {
  it("stop always wins, in every language, with or without the wake word", () => {
    for (const s of ["stop", "Peek stop", "रुको", "berhenti", "pare", "parar"]) expect(understand(s, false)).toEqual({ kind: "stop" });
    expect(isStop("rolar para baixo")).toBe(false); // "para" alone is "to" in Portuguese
  });

  it("ignores talk without the wake word unless push-to-talk is held", () => {
    expect(understand("click plan it", false).kind).toBe("ignored");
    expect(understand("Peek, click Plan it", false)).toEqual({ kind: "click", name: "plan it" });
    expect(understand("click plan it", true)).toEqual({ kind: "click", name: "plan it" });
    expect(afterWake("peek")).toBe("");
  });

  it("reads look-and-say, scrolling, pages and confirm in each language", () => {
    expect(understand("peek click this", false)).toEqual({ kind: "click", name: null });
    expect(understand("इसे दबाओ", true)).toEqual({ kind: "click", name: null });
    expect(understand("klik ini", true)).toEqual({ kind: "click", name: null });
    expect(understand("clique no botão", true).kind).toBe("click");
    expect(understand("नीचे", true)).toEqual({ kind: "scroll", dir: "down" });
    expect(understand("rolar para baixo", true)).toEqual({ kind: "scroll", dir: "down" });
    expect(understand("go to plans", true)).toEqual({ kind: "go", to: "/plans" });
    expect(understand("hari ini", true)).toEqual({ kind: "go", to: "/today" });
    expect(understand("हाँ", true)).toEqual({ kind: "confirm" });
    expect(understand("não", true)).toEqual({ kind: "cancel" });
    expect(understand("claim my price drop", true)).toEqual({ kind: "server", text: "claim my price drop" });
  });

  it("matches a spoken name to what is on screen", () => {
    const names = [
      { id: "1", name: "Plan it" },
      { id: "2", name: "Pay $61.00 with PayPal" },
      { id: "3", name: "Ask for $7.00 back" },
    ];
    expect(matchName("plan it", names)).toBe("1");
    expect(matchName("pay with paypal", names)).toBe("2");
    expect(matchName("ask for", names)).toBe("3");
    expect(matchName("weather", names)).toBeNull();
  });
});
