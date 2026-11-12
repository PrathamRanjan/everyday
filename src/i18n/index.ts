/**
 * B: the shopper's language on the server. Four languages: English, Hindi, Bahasa Indonesia and Brazilian Portuguese.
 * The web app sends its choice in the `x-everyday-lang` header (and remembers it in the `ev_lang` cookie); a link may
 * carry `?lang=`; otherwise the browser's Accept-Language decides. English is the source text: tr(sentence, ...blanks)
 * looks the sentence up in i18n/server/<lang>.json and fills the numbered blanks. A sentence with no translation is
 * shown in English (the CI check `npm run i18n:check` fails when any sentence is missing, so that is a bug, not a
 * fallback anyone relies on). Code never compares translated text: decisions are made on codes, then worded here.
 *
 * Money is formatted for the language, but the amount and currency charged never change (USD in this demo).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Lang = "en" | "hi" | "id" | "pt";
export const LANG_CODES: Lang[] = ["en", "hi", "id", "pt"];
export const LANGS: Record<Lang, { tag: string; name: string; english: string; paypal: string; paypalNote: string | null; speech: string }> = {
  en: { tag: "en-US", name: "English", english: "English", paypal: "en-US", paypalNote: null, speech: "en-US" },
  hi: { tag: "hi-IN", name: "हिन्दी", english: "Hindi", paypal: "en-IN", paypalNote: "PayPal has no Hindi checkout page, so PayPal's own page opens in English (India).", speech: "hi-IN" },
  id: { tag: "id-ID", name: "Bahasa Indonesia", english: "Indonesian", paypal: "id-ID", paypalNote: null, speech: "id-ID" },
  pt: { tag: "pt-BR", name: "Português (Brasil)", english: "Brazilian Portuguese", paypal: "pt-BR", paypalNote: null, speech: "pt-BR" },
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../i18n/server");
const dicts: Partial<Record<Lang, Record<string, string>>> = {};
function dict(l: Lang): Record<string, string> {
  if (l === "en") return {};
  if (!dicts[l]) {
    try {
      dicts[l] = JSON.parse(readFileSync(resolve(root, `${l}.json`), "utf8"));
    } catch {
      dicts[l] = {};
    }
  }
  return dicts[l]!;
}
/** Tests and the translation script reload after writing the files. */
export const reloadDicts = () => LANG_CODES.forEach((l) => delete dicts[l]);

/** "xx" is the pseudo-language used by the untranslated-text check: English words, every known sentence marked. */
export type WireLang = Lang | "xx";
const als = new AsyncLocalStorage<WireLang>();
export const currentLang = (): Lang => { const l = als.getStore() ?? "en"; return l === "xx" ? "en" : l; };
export const currentWireLang = (): WireLang => als.getStore() ?? "en";
export const withLang = <T>(l: WireLang, fn: () => T): T => als.run(l, fn);
export const isLang = (x: unknown): x is Lang => typeof x === "string" && (LANG_CODES as string[]).includes(x);

/** "hi-IN", "pt_BR", "id" → the language; anything else → null. */
export function normLang(x: unknown): Lang | null {
  const s = String(x ?? "").trim().toLowerCase().slice(0, 2);
  if (s === "in") return "id"; // the old ISO code for Indonesian
  return isLang(s) ? s : null;
}

/** The language a request asks for: header, then ?lang=, then the cookie, then the browser's own list. */
export function langOfRequest(req: { get(h: string): string | undefined; query?: any; cookies?: any }): WireLang {
  if (String(req.get("x-everyday-lang") ?? req.cookies?.ev_lang ?? "") === "xx") return "xx";
  const h = normLang(req.get("x-everyday-lang"));
  if (h) return h;
  const q = normLang(req.query?.lang);
  if (q) return q;
  const c = normLang(req.cookies?.ev_lang);
  if (c) return c;
  for (const part of String(req.get("accept-language") ?? "").split(",")) {
    const l = normLang(part.split(";")[0]);
    if (l) return l;
  }
  return "en";
}

const fill = (s: string, args: (string | number)[]) => s.replace(/\{(\d+)\}/g, (m, n) => (args[Number(n)] !== undefined ? String(args[Number(n)]) : m));

/** A sentence in the current request's language. */
export const tr = (text: string, ...args: (string | number)[]) => {
  const out = fill(dict(currentLang())[text] ?? text, args);
  return currentWireLang() === "xx" ? `⟦${out}⟧` : out;
};
/** A sentence in a stated language (messages sent later, outside the request: email, Telegram, push). */
export const trIn = (l: Lang, text: string, ...args: (string | number)[]) => fill(dict(l)[text] ?? text, args);

/** Dollars (or any currency) written the way the language writes them. The amount itself is never converted. */
export const moneyIn = (l: Lang, cents: number, currency = "USD") => new Intl.NumberFormat(LANGS[l].tag, { style: "currency", currency }).format(cents / 100);
export const money = (cents: number, currency = "USD") => moneyIn(currentLang(), cents, currency);
/** A calendar day ("2026-11-14") in the language's own words. */
export const dayIn = (l: Lang, iso: string) => new Intl.DateTimeFormat(LANGS[l].tag, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
/** A line for every system prompt: the model answers in the shopper's language and keeps names as they are. */
export const replyLanguageLine = (l: Lang = currentLang()) =>
  l === "en" ? "Answer in English." : `Write every sentence meant for the shopper in ${LANGS[l].english} (${LANGS[l].tag}). Keep brand, product, shop and person names, prices and order numbers exactly as they are. Field names and codes stay in English.`;

/** Marks an English sentence for the translation harvest without translating it here (it is worded on the way out). */
export const N_ = <T extends string>(s: T): T => s;
