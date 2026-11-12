import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { t } from "@/i18n";
import { accuracyPx, CAL_DOTS, CHECK_DOTS, fit, predict, Snapper, type Box, type Pt, type Sample } from "./math";

/**
 * A9: a SIMULATION of hands-free, with no camera: a made-up gaze path (fixations with jitter, and quick jumps between
 * buttons) goes through the real snapping and dwell code the site uses. It shows how the point picks a button and how
 * the ring fills; it says nothing about how well a real person's eyes are read. Starts only when asked.
 */
const BUTTONS = [
  { id: "a", label: "Plan it", x: 0.12 },
  { id: "b", label: "Ask for $7.00 back", x: 0.42 },
  { id: "c", label: "Skip", x: 0.78 },
];
const DWELL = 1000;

export function SimulatedGaze() {
  const box = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [fill, setFill] = useState(0);
  const [pressed, setPressed] = useState<string[]>([]);
  useEffect(() => {
    if (!on || !box.current) return;
    const el = box.current;
    const snap = new Snapper();
    let raf = 0;
    let seed = 11;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
    const t0 = performance.now();
    let dwellFrom = 0;
    let last: string | null = null;
    const done = new Set<string>();
    const frame = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const boxes: Box[] = Array.from(el.querySelectorAll<HTMLElement>("[data-sim]")).map((b) => ({ id: b.dataset.sim!, x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight }));
      // 2.2 s on each button in turn, with 18 px of jitter; a short wander between them.
      const now = performance.now() - t0;
      const k = Math.floor(now / 2200) % (BUTTONS.length + 1);
      const target = k < BUTTONS.length ? boxes.find((b) => b.id === BUTTONS[k].id) : null;
      const p: Pt = target ? { x: target.x + target.w / 2 + rnd() * 18, y: target.y + target.h / 2 + rnd() * 18 } : { x: w * 0.5 + rnd() * 60, y: h * 0.85 + rnd() * 10 };
      if (dot.current) dot.current.style.transform = `translate(${p.x - 8}px, ${p.y - 8}px)`;
      const c = snap.push(p, boxes);
      if (c !== last) {
        dwellFrom = c ? performance.now() : 0;
        last = c;
        setChosen(c);
      }
      const f = c && dwellFrom && !done.has(`${c}${Math.floor(now / 2200)}`) ? Math.min(1, (performance.now() - dwellFrom) / DWELL) : 0;
      setFill(f);
      if (c && f >= 1) {
        done.add(`${c}${Math.floor(now / 2200)}`);
        setPressed((xs) => [...xs.slice(-3), BUTTONS.find((b) => b.id === c)!.label]);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-rule px-3 text-sm font-semibold" onClick={() => setOn(!on)} aria-pressed={on} data-testid="sim-gaze">
          {on ? <Square className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {on ? t("Stop the simulation") : t("Play the simulation")}
        </button>
        <span className="rounded-full bg-wait-bg px-2 py-0.5 text-xs font-semibold text-wait">{t("Simulated: no camera, made-up eye movements")}</span>
      </div>
      <div ref={box} className="relative h-44 overflow-hidden rounded-lg border border-rule bg-sunk" aria-hidden={!on}>
        {BUTTONS.map((b) => (
          <span key={b.id} data-sim={b.id} className={`absolute top-10 inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold ${chosen === b.id ? "border-accent bg-card" : "border-rule bg-card/70"}`} style={{ left: `${b.x * 100}%` }} data-no-i18n>
            {b.label}
            {chosen === b.id && (
              <svg viewBox="0 0 36 36" className="ml-2 size-5 -rotate-90" aria-hidden>
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(0,0,0,.2)" strokeWidth="4" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="100" strokeDashoffset={100 - fill * 100} pathLength={100} />
              </svg>
            )}
          </span>
        ))}
        {on && <div ref={dot} className="pointer-events-none absolute top-0 left-0 size-4 rounded-full border-2 border-white bg-accent/80" />}
        <p className="absolute bottom-2 left-3 text-xs text-ink-2" role="status" aria-live="polite">
          {pressed.length ? t("Pressed (simulated): {0}", pressed.join(" → ")) : on ? t("Watching where the point rests…") : t("Not running.")}
        </p>
      </div>
    </div>
  );
}

/** The calibration maths on simulated eyes (a made-up eye with noise), run here in the browser: a number for the maths, not for people. */
export function simulatedAccuracy(): { cv_px: number; check_px: number } | null {
  const W = 1440;
  const H = 900;
  let seed = 7;
  const r = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const eye = (p: Pt) => {
    const n = () => (r() - 0.5) * 0.008;
    const u = p.x / W;
    const v = p.y / H;
    const lx = 0.35 + 0.3 * u + 0.04 * u * u + n();
    const ly = 0.4 + 0.22 * v + n();
    return [lx, ly, lx + 0.01 + n(), ly + n(), 0.01 + n() / 4, -0.02 + n() / 4];
  };
  const samples: Sample[] = CAL_DOTS.flatMap((d, i) => Array.from({ length: 12 }, () => ({ f: eye({ x: d.x * W, y: d.y * H }), target: { x: d.x * W, y: d.y * H }, dot: i })));
  const m = fit(samples);
  if (!m) return null;
  const check = accuracyPx(CHECK_DOTS.map((d) => ({ truth: { x: d.x * W, y: d.y * H }, said: predict(m, eye({ x: d.x * W, y: d.y * H })) })));
  return { cv_px: m.cv_px, check_px: check ?? 0 };
}
