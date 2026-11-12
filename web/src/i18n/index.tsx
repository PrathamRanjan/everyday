/**
 * B: the web app in four languages: English, हिन्दी, Bahasa Indonesia and Português (Brasil).
 *
 * English is the source text. `t("Pay {0} now", amount)` looks the sentence up in the current language's dictionary
 * (locales/<lang>.json, loaded when the language is chosen) and fills the numbered blanks; `tn()` is the same for a
 * sentence with parts that are themselves on-screen elements. Switching language re-renders every screen in place:
 * nothing reloads and no form loses what was typed (the root re-renders; nothing remounts).
 *
 * The choice: `?lang=` in a link, else what this browser chose before, else the browser's own language list. It is
 * remembered in localStorage and in the `ev_lang` cookie, so the server words its own sentences, the AI's replies,
 * emails and messages the same way. `?lang=xx` is a pseudo-language for testing: every translated string is marked
 * ⟦like this⟧, so anything on screen without the marks was missed (the CI check walks every page looking for it).
 */
import { createElement, Fragment, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "hi" | "id" | "pt";
type AnyLang = Lang | "xx";
export const LANGS: { code: Lang; name: string; english: string; tag: string; paypal: string; speech: string }[] = [
  { code: "en", name: "English", english: "English", tag: "en-US", paypal: "en_US", speech: "en-US" },
  { code: "hi", name: "हिन्दी", english: "Hindi", tag: "hi-IN", paypal: "en_IN", speech: "hi-IN" },
  { code: "id", name: "Bahasa Indonesia", english: "Indonesian", tag: "id-ID", paypal: "id_ID", speech: "id-ID" },
  { code: "pt", name: "Português (Brasil)", english: "Brazilian Portuguese", tag: "pt-BR", paypal: "pt_BR", speech: "pt-BR" },
];
const CODES = ["en", "hi", "id", "pt", "xx"] as const;
const norm = (x: unknown): AnyLang | null => {
  const s = String(x ?? "").trim().toLowerCase().slice(0, 2);
  if (s === "in") return "id";
  return (CODES as readonly string[]).includes(s) ? (s as AnyLang) : null;
};

const LOADERS: Record<Exclude<Lang, "en">, () => Promise<{ default: Record<string, string> }>> = {
  hi: () => import("./locales/hi.json"),
  id: () => import("./locales/id.json"),
  pt: () => import("./locales/pt.json"),
};
const dicts: Partial<Record<Lang, Record<string, string>>> = { en: {} };

function initial(): AnyLang {
  try {
    const q = norm(new URLSearchParams(location.search).get("lang"));
    if (q) return q;
    const saved = norm(localStorage.getItem("ev-lang"));
    if (saved) return saved;
  } catch {
    /* storage blocked: fall through to the browser's languages */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const n = norm(l);
    if (n && n !== "xx") return n;
  }
  return "en";
}

let current: AnyLang = "en";
export const getLang = (): Lang => (current === "xx" ? "en" : current);
/** What the server should word its sentences in ("xx" too, so server text shows its marks in the pseudo-language). */
export const wireLang = (): string => current;
export const langTag = () => (current === "xx" ? "en-US" : LANGS.find((l) => l.code === current)!.tag);
export const langInfo = () => LANGS.find((l) => l.code === getLang())!;

const pseudo = (s: string) =>
  `⟦${s.replace(/\{(\d+)\}|([a-zA-Z])/g, (m, n, c) => (n !== undefined ? m : ({ a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", O: "Ó", c: "ç", n: "ñ" } as Record<string, string>)[c] ?? c))}⟧`;
function look(text: string): string {
  if (current === "xx") return pseudo(text);
  if (current === "en") return text;
  return dicts[current]?.[text] ?? text;
}
const prim = (x: unknown) => (x === null || x === undefined || x === false || x === true ? "" : String(x));

/** A sentence in the current language, with {0}, {1}… filled in. Always a string. */
export function t(text: string, ...args: unknown[]): string {
  return look(text).replace(/\{(\d+)\}/g, (m, n) => (Number(n) < args.length ? String(args[Number(n)] ?? "") : m));
}
/** Like t(), for sentences whose blanks may be elements (links, numbers with styling, icons). */
export function tn(text: string, ...args: ReactNode[]): ReactNode {
  if (args.every((a) => a === null || a === undefined || typeof a !== "object")) return t(text, ...args.map(prim));
  const parts = look(text).split(/(\{\d+\})/);
  return createElement(Fragment, null, ...parts.map((p, i) => {
    const m = p.match(/^\{(\d+)\}$/);
    return createElement(Fragment, { key: i }, m ? args[Number(m[1])] : p);
  }));
}
/** Whether a sentence has a translation (machine translations are labelled as such in the language menu). */
export const translated = (text: string) => current === "en" || current === "xx" || Boolean(dicts[current]?.[text]);

function applyDocument() {
  const tag = langTag();
  document.documentElement.lang = current === "xx" ? "en" : tag.slice(0, 2);
  document.documentElement.dataset.lang = current;
}

async function load(l: AnyLang) {
  // B7.1: Hindi gets Noto Sans Devanagari, fetched only when Hindi is chosen.
  if (l === "hi") void import("@fontsource-variable/noto-sans-devanagari").catch(() => undefined);
  if (l === "en" || l === "xx" || dicts[l]) return;
  dicts[l] = (await LOADERS[l]()).default;
}

/** Call once before the first render. */
export async function initLang() {
  const l = initial();
  try {
    await load(l);
    current = l;
  } catch {
    current = "en";
  }
  remember();
  applyDocument();
}
function remember() {
  try {
    localStorage.setItem("ev-lang", current);
  } catch {
    /* blocked storage: the cookie still carries it */
  }
  document.cookie = `ev_lang=${current}; path=/; max-age=31536000; samesite=lax`;
}

/** Switch language in place: loads the dictionary, then every screen re-renders and refetches its data. */
export async function setLang(l: AnyLang) {
  await load(l);
  current = l;
  remember();
  applyDocument();
  window.dispatchEvent(new CustomEvent("ev:lang", { detail: l }));
  // B6: saved on the account (when signed in as a shopper), so messages sent later are worded in it too.
  if (l !== "xx") void fetch("/api/ui/lang", { method: "POST", headers: { "content-type": "application/json", "x-everyday-ui": "1" }, credentials: "same-origin", body: JSON.stringify({ lang: l }) }).catch(() => undefined);
}

/** Re-renders the caller when the language changes. The root uses it, so the whole tree follows. */
export function useLang(): AnyLang {
  const [l, setL] = useState<AnyLang>(current);
  useEffect(() => {
    const on = () => setL(current);
    window.addEventListener("ev:lang", on);
    return () => window.removeEventListener("ev:lang", on);
  }, []);
  return l;
}

/** Marks English text kept in a list for later: the extractor collects it; t() translates it where it is shown. */
export const N_ = <T extends string>(s: T): T => s;
