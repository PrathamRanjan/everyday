const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Cents to "$1,234.56". Null shows as an em dash. */
export const money = (cents: number | null | undefined) => (cents === null || cents === undefined || Number.isNaN(Number(cents)) ? "—" : usd.format(Number(cents) / 100));

const D = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const DY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const DT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const words = (s: string | null | undefined) => String(s ?? "").replace(/_/g, " ");
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
