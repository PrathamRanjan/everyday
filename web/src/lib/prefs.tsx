import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Display and help settings. Same storage key ("a11y") and the same data-* attributes on <html> as the earlier
 * accessibility kit, so a returning visitor keeps their settings. Theme is separate ("ev-theme").
 */
export interface Prefs {
  textScale: 1 | 1.15 | 1.3 | 1.5;
  contrast: "default" | "high";
  font: "default" | "hyperlegible";
  readAloud: boolean;
  voiceInput: boolean;
  simpleWords: boolean;
  reducedMotion: "system" | true;
  extraTime: boolean;
  bigTargets: boolean;
  theme: "system" | "light" | "dark";
}
const DEF: Prefs = { textScale: 1, contrast: "default", font: "default", readAloud: false, voiceInput: false, simpleWords: false, reducedMotion: "system", extraTime: false, bigTargets: false, theme: "system" };

function load(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem("a11y") || "{}");
    const t = localStorage.getItem("ev-theme");
    return { ...DEF, ...p, theme: t === "light" || t === "dark" ? t : "system" };
  } catch {
    return DEF;
  }
}

export function applyPrefs(p: Prefs) {
  const r = document.documentElement;
  r.dataset.a11yText = String(p.textScale);
  r.dataset.a11yContrast = p.contrast;
  r.dataset.a11yFont = p.font;
  r.dataset.a11yMotion = p.reducedMotion === true ? "off" : "system";
  r.dataset.a11yTargets = p.bigTargets ? "big" : "default";
  r.dataset.a11ySimple = p.simpleWords ? "on" : "off";
  r.dataset.a11yExtraTime = p.extraTime ? "on" : "off";
  if (p.theme === "system") delete r.dataset.theme;
  else r.dataset.theme = p.theme;
  const dark = p.theme === "dark" || (p.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#14120f" : "#f7f4ee"));
  if (p.font === "hyperlegible" && !document.getElementById("a11y-font")) {
    const l = document.createElement("link");
    l.id = "a11y-font";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap";
    document.head.appendChild(l);
  }
}

const Ctx = createContext<{ prefs: Prefs; set: (patch: Partial<Prefs>) => void; reset: () => void }>({ prefs: DEF, set: () => {}, reset: () => {} });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);
  useEffect(() => applyPrefs(prefs), [prefs]);
  const set = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const n = { ...p, ...patch };
      try {
        const { theme, ...rest } = n;
        localStorage.setItem("a11y", JSON.stringify({ ...rest, seen: true }));
        if (theme === "system") localStorage.removeItem("ev-theme");
        else localStorage.setItem("ev-theme", theme);
      } catch {
        /* private mode: settings last for this visit */
      }
      return n;
    });
  }, []);
  const reset = useCallback(() => set({ ...DEF }), [set]);
  return <Ctx.Provider value={{ prefs, set, reset }}>{children}</Ctx.Provider>;
}
export const usePrefs = () => useContext(Ctx);

/** Read the main content aloud (Web Speech). Returns a toggle and whether it is speaking. */
export function useReadAloud() {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const toggle = useCallback(() => {
    if (!supported) return;
    if (speaking) {
      speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const main = document.getElementById("main") || document.body;
    const u = new SpeechSynthesisUtterance(main.innerText.replace(/\s+/g, " ").slice(0, 6000));
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setSpeaking(true);
  }, [speaking, supported]);
  useEffect(() => () => void (supported && speechSynthesis.cancel()), [supported]);
  return { speaking, toggle, supported };
}

/** Dictation into a text field (Web Speech recognition, where the browser has it). Typing always works too. */
export function useDictation(onText: (t: string) => void) {
  const SR = typeof window !== "undefined" ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : null;
  const [on, setOn] = useState(false);
  const start = useCallback(() => {
    if (!SR) return;
    const r = new SR();
    r.lang = navigator.language || "en-US";
    r.interimResults = false;
    r.onresult = (e: any) => onText(String(e.results?.[0]?.[0]?.transcript ?? ""));
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    setOn(true);
    r.start();
  }, [SR, onText]);
  return { supported: Boolean(SR), on, start };
}
