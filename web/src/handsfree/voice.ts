/**
 * A4: listening, in the language the page is in (hi-IN, id-ID, pt-BR or en-US), with the browser's own speech
 * recognition. Chrome and Edge send the audio to their speech service to turn it into words; Safari may do it on the
 * device. The page says so before the microphone starts. Words are then read by speech.ts, in code.
 *
 * Gates, so the room doesn't press buttons:
 *   - Wake word ("Peek") unless push-to-talk is held; for 8 seconds after the wake word, no need to repeat it.
 *   - Noise gate: a result the recogniser is unsure of (confidence under 0.45, when it says) is dropped.
 *   - Playback gate: while the page is speaking or playing audio or video (and 700 ms after), results are dropped,
 *     except a stop word.
 */
import { isStop, understand, WAKE, type Spoken } from "./speech";

type Rec = { start(): void; stop(): void; abort(): void; lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number; onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null };
export const voiceSupported = () => typeof window !== "undefined" && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export type Heard = { text: string; meaning: Spoken; confidence: number | null; dropped?: string };
export type Voice = { stop: () => void; hold: (on: boolean) => void; awakeUntil: () => number };

let quietUntil = 0;
/** The page itself is about to make a sound (speech or a clip): ignore what the microphone hears meanwhile. */
export function selfSound(ms: number) {
  quietUntil = Math.max(quietUntil, performance.now() + ms);
}
const playing = () => {
  if (window.speechSynthesis?.speaking) return true;
  return Array.from(document.querySelectorAll("audio,video")).some((m) => {
    const el = m as HTMLMediaElement;
    return !el.paused && !el.muted && el.volume > 0 && el.readyState > 2;
  });
};

/** Says a sentence aloud (in the page's language) and keeps the microphone from hearing it. */
export function speak(text: string, lang: string) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  selfSound(600 + text.length * 70);
  u.onend = () => selfSound(700);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function startVoice(lang: string, onHeard: (h: Heard) => void, onState: (s: "listening" | "off" | "error", why?: string) => void): Voice {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) throw new Error("This browser has no speech recognition.");
  let held = false;
  let awake = 0;
  let stopped = false;
  const rec: Rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e: any) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r.isFinal) continue;
      const text = String(r[0]?.transcript ?? "").trim();
      const confidence = typeof r[0]?.confidence === "number" && r[0].confidence > 0 ? r[0].confidence : null;
      if (!text) continue;
      if (isStop(text)) {
        onHeard({ text, meaning: { kind: "stop" }, confidence });
        continue;
      }
      if (performance.now() < quietUntil || playing()) {
        onHeard({ text, meaning: { kind: "ignored", why: "the page was making a sound" }, confidence, dropped: "playback" });
        continue;
      }
      if (confidence !== null && confidence < 0.45) {
        onHeard({ text, meaning: { kind: "ignored", why: "not sure what was said" }, confidence, dropped: "noise" });
        continue;
      }
      const lower = text.toLowerCase();
      const woke = WAKE.some((w) => lower === w || lower.startsWith(`${w} `) || lower.startsWith(`${w},`));
      const isAwake = held || performance.now() < awake;
      if (woke) awake = performance.now() + 8000;
      const meaning = understand(text, isAwake);
      if (meaning.kind !== "ignored") awake = performance.now() + 8000;
      onHeard({ text, meaning, confidence });
    }
  };
  rec.onerror = (e: any) => {
    if (e?.error === "no-speech" || e?.error === "aborted") return;
    onState("error", e?.error === "not-allowed" ? "The microphone isn't allowed for this site." : `Speech recognition stopped (${e?.error ?? "unknown"}).`);
  };
  // Browsers end continuous recognition now and then; it is restarted until switched off.
  rec.onend = () => {
    if (stopped) return onState("off");
    try {
      rec.start();
    } catch {
      onState("off");
    }
  };
  rec.start();
  onState("listening");
  return {
    stop: () => {
      stopped = true;
      try {
        rec.abort();
      } catch {
        /* not running */
      }
    },
    hold: (on: boolean) => {
      held = on;
      if (!on) awake = performance.now() + 1500;
    },
    awakeUntil: () => awake,
  };
}
