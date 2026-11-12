/**
 * A1–A9: "Look and Say", hands-free control for the whole site. Loaded only when someone switches it on.
 *
 *   Eyes + voice: a 9-dot calibration fits where you look; the point snaps to the button you mean; hold your look
 *                 (a ring fills), wink, or say "click" to press it.
 *   Head + voice: no calibration; turn your head to move the point. For glasses, low light, or when the eyes mode
 *                 isn't accurate enough.
 *   Voice only:   no camera at all.
 *
 * Safety: Esc, a stop word, or looking away for two seconds stops it; a real mouse or touch takes over at once; both
 * eyes closed freezes the point (blinks never click); money waits for "confirm" said back (the server checks it).
 * Privacy: the camera is read on this device; nothing from it is sent or kept. A red "Camera on" chip shows while it
 * runs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { Eye, Mic, MicOff, ScanFace, Square, Bug, Crosshair } from "lucide-react";
import { getLang, langTag, t } from "@/i18n";
import { announce } from "@/lib/announce";
import { accuracyPx, CAL_DOTS, CHECK_DOTS, centre, correctDrift, fit, headPoint, OneEuro, predict, Snapper, TOPUP_DOTS, type Box, type Model, type Pt, type Sample, type Vec } from "./math";
import { matchName, type Spoken } from "./speech";
import { startTracker, type Frame, type Tracker } from "./tracker";
import { speak, startVoice, voiceSupported, type Heard, type Voice } from "./voice";

export type Mode = "eyes" | "head" | "voice";
type Saved = { w: number; h: number; dpr: number; model: Pick<Model, "wx" | "wy" | "lambda" | "cv_px">; acc_px: number | null; at: string; offset: Pt };
const CAL_KEY = "ev-hf-cal";
const SETTINGS_KEY = "ev-hf-settings";
type Settings = { dwell_ms: number; wink: boolean; speak: boolean };
const DEFAULTS: Settings = { dwell_ms: 1000, wink: true, speak: true };

const store = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage blocked: it just isn't remembered */
    }
  },
};
const savedFor = () => {
  const s = store.get<Saved>(CAL_KEY);
  return s && s.w === window.innerWidth && s.h === window.innerHeight && s.dpr === window.devicePixelRatio ? s : null;
};

const CLICKABLE = 'a[href], button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], input[type="checkbox"], input[type="radio"], input[type="submit"], select, summary, [data-hf]';
const ids = new WeakMap<Element, string>();
let nextId = 0;
const idOf = (el: Element) => {
  let id = ids.get(el);
  if (!id) ids.set(el, (id = `hf${++nextId}`));
  return id;
};
/** What can be pressed on screen now (visible, enabled, not this tool's own controls). */
function targets(): { boxes: Box[]; els: Map<string, HTMLElement>; names: { id: string; name: string }[] } {
  const els = new Map<string, HTMLElement>();
  const boxes: Box[] = [];
  const names: { id: string; name: string }[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(CLICKABLE))) {
    if (el.closest("[data-hf-ui]") || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.pointerEvents === "none" || Number(s.opacity) < 0.1) continue;
    const id = idOf(el);
    els.set(id, el);
    boxes.push({ id, x: r.left, y: r.top, w: r.width, h: r.height });
    names.push({ id, name: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim().slice(0, 80) });
  }
  return { boxes, els, names };
}

type Pending = { token: string; amount_cents: number; action: string; until: number };

export function HandsFree({ mode, onStop }: { mode: Mode; onStop: (why: string) => void }) {
  const nav = useNavigate();
  const loc = useLocation();
  const locRef = useRef(loc.pathname);
  locRef.current = loc.pathname;
  const [settings, setSettings] = useState<Settings>({ ...DEFAULTS, ...(store.get<Settings>(SETTINGS_KEY) ?? {}) });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [status, setStatus] = useState<string>(t("Starting…"));
  const [camera, setCamera] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<Heard | null>(null);
  const [calib, setCalib] = useState<null | { phase: "cal" | "check" | "topup"; i: number; dots: Pt[] }>(null);
  const [result, setResult] = useState<null | { acc: number | null; cv: number | null }>(null);
  const [debug, setDebug] = useState(false);
  const [debugText, setDebugText] = useState("");
  const [offerRecal, setOfferRecal] = useState(false);
  const [paused, setPaused] = useState<string | null>(null);
  const pointRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const ringBox = useRef<HTMLDivElement>(null);

  // Live state the frame loop reads (refs, so 30 frames a second don't re-render the page).
  const s = useRef({
    model: (savedFor()?.model ?? null) as Saved["model"] | null,
    offset: savedFor()?.offset ?? ({ x: 0, y: 0 } as Pt),
    rest: null as Vec | null,
    fx: new OneEuro(),
    fy: new OneEuro(),
    snap: new Snapper(),
    point: null as Pt | null,
    raw: null as Pt | null,
    chosen: null as string | null,
    dwellFrom: 0,
    cooldown: new Map<string, number>(),
    noFaceSince: 0,
    winkSince: 0,
    winkEye: "" as "" | "L" | "R",
    mouseUntil: 0,
    samples: [] as Sample[],
    collecting: null as null | { dot: number; target: Pt; from: number; to: number; out: Vec[] },
    tg: { boxes: [] as Box[], els: new Map<string, HTMLElement>(), names: [] as { id: string; name: string }[] },
    tgAt: 0,
    lastFrame: null as Frame | null,
    pending: null as Pending | null,
    run: Math.random().toString(36).slice(2),
    stopped: false,
  });

  const say = useCallback((text: string) => {
    setStatus(text);
    announce(text);
    if (settingsRef.current.speak) speak(text, langTag());
  }, []);

  const stop = useCallback(
    (why: string) => {
      if (s.current.stopped) return;
      s.current.stopped = true;
      onStop(why);
    },
    [onStop],
  );

  const press = useCallback((id: string | null, how: string) => {
    const st = s.current;
    if (!id) return say(t("Look at a button first, then say “click”."));
    const el = st.tg.els.get(id);
    if (!el || !el.isConnected) return say(t("That button has gone; look at it again."));
    // Drift correction: the estimate was a little off from the centre of what was meant.
    const b = st.tg.boxes.find((x) => x.id === id);
    if (b && st.raw && mode === "eyes") st.offset = correctDrift(st.offset, st.raw, centre(b));
    st.cooldown.set(id, performance.now() + 1500);
    st.dwellFrom = 0;
    el.focus({ preventScroll: true });
    el.click();
    announce(t("Pressed {0} ({1})", (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 60), how));
  }, [mode, say]);

  // The server's half of a phrase: plans, reads, and money (which waits for "confirm").
  const ask = useCallback(
    async (text: string, confirm_token?: string) => {
      if (!navigator.onLine) return say(t("You're offline. Clicking, scrolling and moving between pages still work by voice."));
      const order = locRef.current.match(/^\/orders\/([^/]+)/)?.[1];
      try {
        const r = await fetch("/api/ui/handsfree/command", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "x-everyday-ui": "1", "x-everyday-lang": getLang() },
          credentials: "same-origin",
          body: JSON.stringify({ text, run: s.current.run, confirm_token, context: { path: locRef.current, order_id: order } }),
        });
        const j = await r.json().catch(() => null);
        if (r.status === 401) return say(t("Sign in first; then voice can do more than move around."));
        if (!r.ok) {
          s.current.pending = null;
          return say(j?.message ?? t("That didn't work."));
        }
        s.current.pending = j.confirm ? { token: j.confirm.token, amount_cents: j.confirm.amount_cents, action: j.confirm.action, until: performance.now() + 60_000 } : null;
        say(j.say);
        if (j.navigate && j.navigate !== locRef.current) nav(j.navigate);
        if (j.reload) window.dispatchEvent(new Event("ev:reload"));
      } catch {
        say(t("Couldn't reach Everyday."));
      }
    },
    [nav, say],
  );

  const act = useCallback(
    (m: Spoken, text: string) => {
      const st = s.current;
      switch (m.kind) {
        case "stop":
          return stop(t("Stopped by voice."));
        case "click": {
          if (m.name) {
            const id = matchName(m.name, st.tg.names);
            return id ? press(id, t("by name")) : say(t("No button called “{0}” on this screen.", m.name));
          }
          return press(st.chosen, t("look and say"));
        }
        case "scroll":
          window.scrollBy({ top: (m.dir === "down" ? 1 : -1) * window.innerHeight * 0.7, behavior: "smooth" });
          return;
        case "back":
          return void history.back();
        case "go":
          return nav(m.to);
        case "calibrate":
          return mode === "eyes" ? startCal("cal") : say(t("Calibration is for the eyes mode."));
        case "confirm":
          if (!st.pending || performance.now() > st.pending.until) return say(t("There's nothing waiting for a confirmation."));
          return void ask(text, st.pending.token);
        case "cancel":
          st.pending = null;
          return say(t("Cancelled. Nothing was done."));
        case "server":
          return void ask(m.text);
        default:
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ask, mode, nav, press, say, stop],
  );

  // Calibration: each dot shows for 0.6 s to settle the eye, then 0.9 s of frames are collected.
  const startCal = useCallback((phase: "cal" | "check" | "topup") => {
    const dots = phase === "cal" ? CAL_DOTS : phase === "check" ? CHECK_DOTS : TOPUP_DOTS;
    if (phase === "cal") s.current.samples = [];
    setResult(null);
    setCalib({ phase, i: 0, dots });
  }, []);
  const checks = useRef<{ said: Pt; truth: Pt }[]>([]);
  useEffect(() => {
    if (!calib) return;
    const st = s.current;
    const d = calib.dots[calib.i];
    const target = { x: d.x * window.innerWidth, y: d.y * window.innerHeight };
    const start = performance.now() + 600;
    st.collecting = { dot: calib.i, target, from: start, to: start + 900, out: [] };
    const timer = window.setTimeout(() => {
      const got = st.collecting?.out ?? [];
      st.collecting = null;
      if (calib.phase === "cal") got.forEach((f) => st.samples.push({ f, target, dot: calib.i }));
      else if (st.model && got.length) {
        const mean = got[0].map((_, k) => got.reduce((a, f) => a + f[k], 0) / got.length);
        const p = predict(st.model, mean);
        checks.current.push({ said: { x: p.x + st.offset.x, y: p.y + st.offset.y }, truth: target });
      }
      if (calib.i + 1 < calib.dots.length) return setCalib({ ...calib, i: calib.i + 1 });
      // A phase ended.
      if (calib.phase === "cal") {
        const m = fit(st.samples);
        if (!m) {
          setCalib(null);
          return say(t("Calibration didn't get enough looks at the dots (is your face lit and in view?). Try again, or use the head mode."));
        }
        st.model = m;
        st.offset = { x: 0, y: 0 };
        checks.current = [];
        setResult({ acc: null, cv: m.cv_px });
        return setCalib({ phase: "check", i: 0, dots: CHECK_DOTS });
      }
      const acc = accuracyPx(checks.current);
      if (calib.phase === "topup" && acc !== null && checks.current.length) {
        // The top-up only moves the offset: the mean gap at three dots.
        const dx = checks.current.reduce((a, c) => a + (c.truth.x - c.said.x), 0) / checks.current.length;
        const dy = checks.current.reduce((a, c) => a + (c.truth.y - c.said.y), 0) / checks.current.length;
        st.offset = { x: st.offset.x + dx, y: st.offset.y + dy };
      }
      checks.current = [];
      setCalib(null);
      setResult({ acc, cv: (st.model as Model).cv_px ?? null });
      const prev = savedFor();
      store.set(CAL_KEY, { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio, model: st.model!, acc_px: acc ?? prev?.acc_px ?? null, at: new Date().toISOString(), offset: st.offset } satisfies Saved);
      say(acc !== null ? t("Calibrated: on the check dots, about {0} px off.", String(acc)) : t("Calibrated."));
      setOfferRecal(acc !== null && acc > 90);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [calib, say]);

  // Camera and the frame loop.
  useEffect(() => {
    if (mode === "voice") return;
    let tracker: Tracker | null = null;
    let cancelled = false;
    const st = s.current;
    startTracker((fr) => {
      st.lastFrame = fr;
      const now = fr.t;
      if (st.collecting && fr.f && now >= st.collecting.from && now <= st.collecting.to && !(fr.blinkL > 0.5 && fr.blinkR > 0.5)) st.collecting.out.push(fr.f);
      // Looking away for two seconds is a stop.
      if (!fr.face) {
        if (!st.noFaceSince) st.noFaceSince = now;
        if (now - st.noFaceSince > 2000 && !calibRef.current) return stop(t("Stopped: no face in view for two seconds."));
        return;
      }
      st.noFaceSince = 0;
      if (!fr.f || calibRef.current) return;
      // Both eyes closed: a blink. The point stays where it was and nothing fills.
      if (fr.blinkL > 0.5 && fr.blinkR > 0.5) {
        st.dwellFrom = 0;
        return;
      }
      if (performance.now() < st.mouseUntil) return;
      if (!st.rest) st.rest = fr.f;
      let p: Pt | null = null;
      if (mode === "eyes" && st.model) {
        const raw = predict(st.model, fr.f);
        st.raw = { x: raw.x + st.offset.x, y: raw.y + st.offset.y };
        p = st.raw;
      } else if (mode === "head") {
        p = headPoint(fr.f, st.rest, { w: window.innerWidth, h: window.innerHeight });
        st.raw = p;
      }
      if (!p) return;
      const sx = Math.max(0, Math.min(window.innerWidth, st.fx.next(p.x, now)));
      const sy = Math.max(0, Math.min(window.innerHeight, st.fy.next(p.y, now)));
      st.point = { x: sx, y: sy };
      if (now - st.tgAt > 250) {
        st.tg = targets();
        st.tgAt = now;
      }
      const prevChosen = st.chosen;
      st.chosen = st.snap.push(st.point, st.tg.boxes);
      if (st.chosen !== prevChosen) st.dwellFrom = st.chosen ? now : 0;
      // Wink (one eye shut, the other open, for a quarter to most of a second) presses what is chosen.
      if (settingsRef.current.wink) {
        const eyeShut = fr.blinkL > 0.6 && fr.blinkR < 0.25 ? "L" : fr.blinkR > 0.6 && fr.blinkL < 0.25 ? "R" : "";
        if (eyeShut && st.winkEye === eyeShut) {
          if (now - st.winkSince > 250 && now - st.winkSince < 900 && st.chosen) {
            st.winkEye = "";
            press(st.chosen, t("wink"));
          }
        } else {
          st.winkEye = eyeShut;
          st.winkSince = now;
        }
      }
      // Dwell: hold the look until the ring fills.
      const cool = st.chosen ? (st.cooldown.get(st.chosen) ?? 0) : 0;
      let progress = 0;
      if (st.chosen && st.dwellFrom && now > cool) {
        progress = Math.min(1, (now - st.dwellFrom) / settingsRef.current.dwell_ms);
        if (progress >= 1) press(st.chosen, t("held look"));
      }
      draw(st.point, st.chosen ? st.tg.boxes.find((b) => b.id === st.chosen) ?? null : null, progress);
    })
      .then((tr) => {
        if (cancelled) return tr.stop();
        tracker = tr;
        setCamera(true);
        const saved = savedFor();
        if (mode === "eyes" && !st.model) {
          say(t("Look at each dot until it moves on."));
          startCal("cal");
        } else if (mode === "eyes" && saved) {
          say(t("Using this device's calibration. Three dots to top it up."));
          startCal("topup");
        } else say(mode === "head" ? t("Head mode: turn your head to move the point; hold still on a button to press it.") : t("Hands-free is on."));
      })
      .catch((e: Error) => {
        // No camera (or it was refused): voice keeps working, and the page says why.
        setCamera(false);
        setPaused(t("No camera: {0} Voice still works.", e.message));
        say(t("No camera: {0} Voice still works.", e.message));
      });
    return () => {
      cancelled = true;
      tracker?.stop();
      setCamera(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const calibRef = useRef(calib);
  calibRef.current = calib;

  const draw = (p: Pt, box: Box | null, progress: number) => {
    const el = pointRef.current;
    if (el) el.style.transform = `translate(${p.x - 9}px, ${p.y - 9}px)`;
    const rb = ringBox.current;
    const ring = ringRef.current;
    if (rb && ring) {
      if (box) {
        const size = Math.max(36, Math.min(64, Math.min(box.w, box.h) + 16));
        rb.style.display = "block";
        rb.style.transform = `translate(${box.x + box.w / 2 - size / 2}px, ${box.y + box.h / 2 - size / 2}px)`;
        rb.style.width = rb.style.height = `${size}px`;
        ring.style.strokeDashoffset = String(100 - progress * 100);
      } else rb.style.display = "none";
    }
  };

  // Voice.
  useEffect(() => {
    if (!voiceSupported()) {
      setStatus(t("This browser has no speech recognition; looking and holding still works."));
      return;
    }
    let v: Voice | null = null;
    try {
      v = startVoice(
        langTag(),
        (h) => {
          setHeard(h);
          if (h.meaning.kind !== "ignored") act(h.meaning, h.text);
        },
        (state, why) => {
          setListening(state === "listening");
          if (why) setStatus(why);
        },
      );
    } catch (e) {
      setStatus((e as Error).message);
    }
    voiceRef.current = v;
    return () => v?.stop();
  }, [act]);
  const voiceRef = useRef<Voice | null>(null);

  // A real mouse or touch takes over at once (for three seconds after it last moved); Esc stops everything.
  useEffect(() => {
    const st = s.current;
    const real = (e: PointerEvent) => {
      if (!e.isTrusted || (e.pointerType === "mouse" && Math.abs(e.movementX) + Math.abs(e.movementY) < 2)) return;
      st.mouseUntil = performance.now() + 3000;
      st.dwellFrom = 0;
      ringBox.current && (ringBox.current.style.display = "none");
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop(t("Stopped with Esc."));
      if (e.altKey && e.code === "Space") voiceRef.current?.hold(true);
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "Alt") voiceRef.current?.hold(false);
    };
    window.addEventListener("pointermove", real, { passive: true });
    window.addEventListener("pointerdown", real, { passive: true });
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("pointermove", real);
      window.removeEventListener("pointerdown", real);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", keyUp);
    };
  }, [stop]);

  // Bigger targets while hands-free is on (44 px at least), and a new page re-reads what can be pressed.
  useEffect(() => {
    document.documentElement.dataset.handsfree = mode;
    return () => {
      delete document.documentElement.dataset.handsfree;
    };
  }, [mode]);
  useEffect(() => {
    s.current.tgAt = 0;
    s.current.snap.reset();
  }, [loc.pathname]);

  // The debug panel, a few times a second.
  useEffect(() => {
    if (!debug) return;
    const id = window.setInterval(() => {
      const st = s.current;
      const f = st.lastFrame;
      setDebugText(
        [
          `mode ${mode} · fps ${f?.fps ?? 0} · face ${f?.face ? "yes" : "no"} · blink ${f ? `${f.blinkL.toFixed(2)}/${f.blinkR.toFixed(2)}` : "-"}`,
          `features ${f?.f ? f.f.map((x) => x.toFixed(3)).join(" ") : "-"}`,
          `point ${st.point ? `${Math.round(st.point.x)},${Math.round(st.point.y)}` : "-"} · offset ${Math.round(st.offset.x)},${Math.round(st.offset.y)} · chosen ${st.chosen ?? "-"}`,
          `model ${st.model ? `λ=${(st.model as Model).lambda ?? "?"} cv=${(st.model as Model).cv_px ?? "?"}px` : "none"} · targets ${st.tg.boxes.length} · steps run ${st.run}`,
          `mouse ${performance.now() < st.mouseUntil ? "in use" : "idle"} · pending ${st.pending ? `${st.pending.action} ${st.pending.amount_cents}` : "-"}`,
        ].join("\n"),
      );
    }, 300);
    return () => window.clearInterval(id);
  }, [debug, mode]);

  const setSetting = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    store.set(SETTINGS_KEY, next);
  };

  // On <body>: the header's blur would otherwise pin "fixed" parts to the header instead of the screen.
  return createPortal(
    <div data-hf-ui>
      {/* The point and the dwell ring: drawn over everything, never in the way of a real click. */}
      {mode !== "voice" && (
        <>
          <div ref={pointRef} aria-hidden className="pointer-events-none fixed top-0 left-0 z-[90] size-[18px] rounded-full border-2 border-white bg-accent/80 shadow-[0_0_0_2px_rgba(0,0,0,.45)]" style={{ transform: "translate(-40px,-40px)" }} />
          <div ref={ringBox} aria-hidden className="pointer-events-none fixed top-0 left-0 z-[89]" style={{ display: "none" }}>
            <svg viewBox="0 0 36 36" className="size-full -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(0,0,0,.25)" strokeWidth="3" />
              <circle ref={ringRef} cx="18" cy="18" r="15.9" fill="none" stroke="var(--color-accent, #2563eb)" strokeWidth="3" strokeDasharray="100" strokeDashoffset="100" pathLength={100} />
            </svg>
          </div>
        </>
      )}

      {/* Calibration dots. */}
      {calib && (
        <div className="fixed inset-0 z-[95] bg-paper/95" role="dialog" aria-modal="true" aria-label={t("Calibrating hands-free")}>
          <p className="absolute top-1/2 left-1/2 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 text-center text-sm text-ink-2">
            {calib.phase === "cal" ? t("Look at the dot until it moves ({0} of {1}). Keep your head still.", String(calib.i + 1), String(calib.dots.length)) : calib.phase === "check" ? t("Checking: look at the dot ({0} of {1}).", String(calib.i + 1), String(calib.dots.length)) : t("Top-up: look at the dot ({0} of {1}).", String(calib.i + 1), String(calib.dots.length))}
            <br />
            {t("Esc stops.")}
          </p>
          <span
            key={`${calib.phase}-${calib.i}`}
            className="absolute size-6 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-4 border-white bg-stop shadow-lg"
            style={{ left: `${calib.dots[calib.i].x * 100}%`, top: `${calib.dots[calib.i].y * 100}%` }}
          />
        </div>
      )}

      {/* The chip: always there while hands-free runs; says what the camera and microphone are doing; Stop. */}
      <div className="fixed right-3 bottom-3 z-[96] w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-rule bg-card p-3 text-sm shadow-lg" role="region" aria-label={t("Hands-free")}>
        <div className="flex flex-wrap items-center gap-2">
          {camera && (
            <span className="inline-flex items-center gap-1 rounded-full bg-stop/10 px-2 py-0.5 text-xs font-semibold text-stop" data-testid="camera-on">
              <span className="size-2 animate-pulse rounded-full bg-stop" aria-hidden />
              {t("Camera on")}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-0.5 text-xs">
            {listening ? <Mic className="size-3" aria-hidden /> : <MicOff className="size-3" aria-hidden />}
            {listening ? t("Listening for “Peek”") : t("Not listening")}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-ink-2">
            {mode === "eyes" ? <Eye className="size-3" aria-hidden /> : mode === "head" ? <ScanFace className="size-3" aria-hidden /> : <Mic className="size-3" aria-hidden />}
            {mode === "eyes" ? t("Eyes + voice") : mode === "head" ? t("Head + voice") : t("Voice only")}
          </span>
          <button type="button" className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-full bg-stop px-3 font-semibold text-white" onClick={() => stop(t("Stopped."))} data-testid="handsfree-stop">
            <Square className="size-3.5" aria-hidden />
            {t("Stop")}
          </button>
        </div>
        <p className="mt-2 text-ink" role="status" aria-live="polite">{paused ?? status}</p>
        {heard && (
          <p className="mt-1 text-xs text-ink-2">
            {t("Heard: “{0}”", heard.text)}
            {heard.dropped ? ` · ${heard.meaning.kind === "ignored" ? heard.meaning.why : ""}` : ""}
          </p>
        )}
        {result && (
          <p className="mt-1 text-xs text-ink-2" data-testid="calibration-result">
            {result.acc !== null ? t("Accuracy on the check dots: about {0} px.", String(result.acc)) : null} {result.cv !== null ? t("(Cross-validated on the nine dots: {0} px.)", String(result.cv)) : null}
          </p>
        )}
        {offerRecal && (
          <p className="mt-1 text-xs">
            {t("That's not very accurate.")}{" "}
            <button type="button" className="font-semibold underline" onClick={() => startCal("cal")}>{t("Calibrate again")}</button>
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-full border border-rule px-3" onMouseDown={() => voiceRef.current?.hold(true)} onMouseUp={() => voiceRef.current?.hold(false)} onTouchStart={() => voiceRef.current?.hold(true)} onTouchEnd={() => voiceRef.current?.hold(false)} title={t("Hold to talk without saying “Peek” (or hold Alt+Space)")}>
            <Mic className="size-3.5" aria-hidden />
            {t("Hold to talk")}
          </button>
          {mode === "eyes" && camera && (
            <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-full border border-rule px-3" onClick={() => startCal("cal")}>
              <Crosshair className="size-3.5" aria-hidden />
              {t("Calibrate")}
            </button>
          )}
          <button type="button" aria-pressed={debug} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-rule px-3" onClick={() => setDebug(!debug)}>
            <Bug className="size-3.5" aria-hidden />
            {t("Debug")}
          </button>
        </div>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-ink-2">{t("Settings")}</summary>
          <label className="mt-2 flex items-center gap-2">
            {t("Hold look for")}
            <input type="range" min={500} max={2500} step={100} value={settings.dwell_ms} onChange={(e) => setSetting({ dwell_ms: Number(e.target.value) })} aria-valuetext={`${settings.dwell_ms} ms`} />
            <span className="num">{(settings.dwell_ms / 1000).toFixed(1)} s</span>
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={settings.wink} onChange={(e) => setSetting({ wink: e.target.checked })} />
            {t("A wink presses")}
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={settings.speak} onChange={(e) => setSetting({ speak: e.target.checked })} />
            {t("Read answers aloud")}
          </label>
          <p className="mt-2 text-ink-2">{t("Say “Peek” first: “Peek, click Plan it”, “Peek, scroll down”, “Peek, what needs me?”. “Stop” works any time. Money always waits for you to say “confirm”.")}</p>
        </details>
        {debug && <pre className="mt-2 max-h-40 overflow-auto rounded bg-sunk p-2 text-[11px] leading-snug whitespace-pre-wrap" data-testid="handsfree-debug">{debugText}</pre>}
      </div>
    </div>,
    document.body,
  );
}
