/**
 * B3.2: code reads a budget and a day in all four languages (and Hindi–English mixes), so a request in हिन्दी,
 * Bahasa Indonesia or Português gets the same code-decided budget and deadline as one in English. The model never
 * reads numbers. Budgets are in US dollars in this demo; a budget in rupees, rupiah or reais is reported, not guessed.
 */
const NUM = String.raw`(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;

/** "1.234,56" (pt/id), "1,234.56" (en), "80" → a number. */
export function numberOf(s: string): number | null {
  let v = s.replace(/\s/g, "");
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma > lastDot) {
    // Comma is the decimal mark when two digits or fewer follow it; otherwise it groups thousands.
    v = /,\d{1,2}$/.test(v) ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  } else if (lastDot > lastComma) {
    v = /\.\d{1,2}$/.test(v) ? v.replace(/,/g, "") : v.replace(/\./g, "").replace(/,/g, "");
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const USD_BEFORE = new RegExp(String.raw`(?:\bus\$|\bu\$s|(?<![a-z])\$|\busd)\s?${NUM}`, "i");
const USD_AFTER = new RegExp(String.raw`${NUM}\s?(?:dólares?|dolares?|dolar|डॉलर|usd|bucks)`, "i");
const FOREIGN = /(₹|रुपये|रुपए|\brs\.?\s?\d|\binr\b|\brupiah\b|\brp\.?\s?\d|\bidr\b|r\$|\breais\b|\bbrl\b)/i;

export function budgetCentsAnyLang(text: string): { cents: number | null; foreign: string | null } {
  const t = text.toLowerCase();
  const m = t.match(USD_BEFORE) ?? t.match(USD_AFTER);
  if (m) {
    const n = numberOf(m[1]);
    if (n) return { cents: Math.round(n * 100), foreign: null };
  }
  const f = t.match(FOREIGN);
  if (f) return { cents: null, foreign: /₹|रु|rs|inr/i.test(f[1]) ? "INR" : /rp|idr|rupiah/i.test(f[1]) ? "IDR" : "BRL" };
  return { cents: null, foreign: null };
}

// Sunday first, as Date.getUTCDay().
const DAY_WORDS: string[][] = [
  ["sunday", "रविवार", "minggu", "domingo"],
  ["monday", "सोमवार", "senin", "segunda", "segunda-feira"],
  ["tuesday", "मंगलवार", "selasa", "terça", "terca", "terça-feira", "terca-feira"],
  ["wednesday", "बुधवार", "rabu", "quarta", "quarta-feira"],
  ["thursday", "गुरुवार", "बृहस्पतिवार", "kamis", "quinta", "quinta-feira"],
  ["friday", "शुक्रवार", "jumat", "jum'at", "sexta", "sexta-feira"],
  ["saturday", "शनिवार", "sabtu", "sábado", "sabado"],
];
const TOMORROW = /\b(tomorrow|besok|amanhã|amanha)\b|कल तक|कल\s/i;
const NEXT = /(अगले|अगला|próxim[ao]|proxim[ao]|que vem|\bdepan\b|\bnext\b)/i;

/** The day a request names, as a weekday index (0 = Sunday), with "next" if it says next week. */
export function dayAnyLang(text: string): { day: number | "tomorrow"; next: boolean } | null {
  const t = text.toLowerCase();
  for (let d = 0; d < 7; d++)
    for (const w of DAY_WORDS[d]) {
      const re = /^[a-z'-]+$/.test(w) ? new RegExp(`\\b${w}\\b`, "i") : new RegExp(w.replace(/[-]/g, "\\-"), "i");
      // "minggu" alone also means "week": only "hari minggu" or "minggu ini" is Sunday.
      if (w === "minggu" && !/hari minggu|minggu ini/.test(t)) continue;
      if (re.test(t)) return { day: d, next: NEXT.test(t) };
    }
  if (TOMORROW.test(t)) return { day: "tomorrow", next: false };
  return null;
}

export function dateFromDay(d: { day: number | "tomorrow"; next: boolean }, now: Date): string {
  let delta = d.day === "tomorrow" ? 1 : (d.day - now.getUTCDay() + 7) % 7 || 7;
  if (d.day !== "tomorrow" && d.next && delta < 7) delta += 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta)).toISOString().slice(0, 10);
}
