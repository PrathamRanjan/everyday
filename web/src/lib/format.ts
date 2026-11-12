import { langTag, t } from "@/i18n";

/**
 * B5: numbers, money and dates written the way the chosen language writes them (1.234,56 in pt-BR; lakh grouping in
 * hi-IN unless the shopper turns it off). The amount and currency charged never change: this is only how it's written.
 */
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
let lakh = true;
try {
  lakh = localStorage.getItem("ev-lakh") !== "off";
} catch {
  /* default on */
}
export const setLakh = (on: boolean) => {
  lakh = on;
  try {
    localStorage.setItem("ev-lakh", on ? "on" : "off");
  } catch {
    /* ignore */
  }
};
export const lakhOn = () => lakh;
const numTag = () => (langTag() === "hi-IN" && !lakh ? "hi-IN-u-nu-latn" : langTag());
function nf(currency: string) {
  const tag = numTag();
  const k = `n|${tag}|${currency}|${lakh}`;
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(tag === "hi-IN-u-nu-latn" ? "en-US" : tag, { style: "currency", currency }));
  return cache.get(k) as Intl.NumberFormat;
}
function df(kind: "D" | "DY" | "DT") {
  const tag = langTag();
  const k = `${kind}|${tag}`;
  if (!cache.has(k))
    cache.set(k, new Intl.DateTimeFormat(tag, kind === "D" ? { month: "short", day: "numeric", timeZone: "UTC" } : kind === "DY" ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  return cache.get(k) as Intl.DateTimeFormat;
}

/** Cents to "$1,234.56" (or "US$ 1.234,56" in pt-BR). Null shows as an em dash. */
export const money = (cents: number | null | undefined, currency = "USD") => (cents === null || cents === undefined || Number.isNaN(Number(cents)) ? "—" : nf(currency).format(Number(cents) / 100));
/** A plain number in the language's grouping. */
export const num = (n: number) => new Intl.NumberFormat(numTag() === "hi-IN-u-nu-latn" ? "en-US" : numTag()).format(n);
const D = { format: (d: Date) => df("D").format(d) };
const DY = { format: (d: Date) => df("DY").format(d) };
const DT = { format: (d: Date) => df("DT").format(d) };

/** "2026-11-13" → "Nov 13" (adds the year when it isn't `thisYear`). Dates in the data are wall dates. */
export function day(iso: string | null | undefined, thisYear = new Date().getUTCFullYear()) {
  if (!iso) return "—";
  const d = new Date(String(iso).length <= 10 ? `${iso}T12:00:00Z` : String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.getUTCFullYear() === thisYear ? D.format(d) : DY.format(d);
}
export function when(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : DT.format(d);
}
export const toDate = (iso: string) => new Date(String(iso).length <= 10 ? `${iso}T12:00:00Z` : iso);
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 864e5);
export const addDays = (iso: string, n: number) => new Date(toDate(iso).getTime() + n * 864e5).toISOString().slice(0, 10);
export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${t(n === 1 ? one : many)}`;
/** A code ("price_drop") as words, translated when it is one of the codes listed in i18n/codes.ts. */
export const words = (s: string | null | undefined) => {
  const w = String(s ?? "").replace(/_/g, " ");
  return w && /^[a-z][a-z ]*$/.test(w) ? t(w) : w;
};
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
