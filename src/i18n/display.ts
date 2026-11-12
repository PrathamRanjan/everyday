/**
 * B3.3: server sentences in the shopper's language, at the moment they are shown. Everything the server stores
 * (plans, cases, notes, events) stays in English, the record's own language; code decides on codes and numbers, never
 * on this text. On the way out, each sentence is matched against the templates the server can produce (harvested
 * from the code by `npm run i18n:extract`; "{0} is over your {1} budget") and re-worded with the same blanks filled.
 * A sentence that matches nothing stays as it was: product names, shop names and the shopper's own words.
 *
 * Only display fields are touched (a fixed list of keys); ids, codes, statuses and anything compared in code are left.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentWireLang, dayIn, moneyIn, type Lang } from "./index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../i18n/server");
type Compiled = { exact: Map<string, string>; templates: { re: RegExp; to: string; n: number }[] };
const cache: Partial<Record<Lang | "xx", Compiled>> = {};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pseudo = (s: string) => `⟦${s}⟧`;

function compiled(l: Lang | "xx"): Compiled {
  if (cache[l]) return cache[l]!;
  let dict: Record<string, string> = {};
  try {
    // The pseudo-language marks every sentence the server knows (with its English words), to find the ones it doesn't.
    const src = l === "xx" ? "hi" : l;
    dict = JSON.parse(readFileSync(resolve(root, `${src}.json`), "utf8"));
    if (l === "xx") dict = Object.fromEntries(Object.keys(dict).map((k) => [k, pseudo(k)]));
  } catch {
    dict = {};
  }
  const exact = new Map<string, string>();
  const templates: Compiled["templates"] = [];
  for (const [en, to] of Object.entries(dict)) {
    if (!/\{\d+\}/.test(en)) {
      exact.set(en, to);
      continue;
    }
    // A template needs real words of its own, or "{0} {1}" would match anything.
    const literal = en.replace(/\{\d+\}/g, "");
    if ((literal.match(/[A-Za-z]/g) ?? []).length < 4) continue;
    const order: number[] = [];
    const body = en.split(/(\{\d+\})/).map((part) => {
      const m = part.match(/^\{(\d+)\}$/);
      if (!m) return esc(part);
      order.push(Number(m[1]));
      return "(.+?)";
    });
    const needle = en.split(/\{\d+\}/).sort((a, b) => b.length - a.length)[0];
    templates.push({ re: new RegExp(`^${body.join("")}$`, "s"), to, n: literal.length, ...{ order, needle } } as any);
  }
  // Most specific first.
  templates.sort((a, b) => b.n - a.n);
  return (cache[l] = { exact, templates });
}
export const resetDisplayCache = () => Object.keys(cache).forEach((k) => delete cache[k as Lang]);

/** One sentence in a language (the request's, unless given). */
export function display(text: string, l: Lang | "xx" = currentLangOrPseudo()): string {
  if (l === "en" || !text || text.length > 2000 || text.startsWith("⟦")) return text;
  const c = compiled(l);
  const hit = c.exact.get(text);
  if (hit !== undefined) return hit;
  // A trailing full stop or space the template didn't have is kept as it was.
  for (const t of c.templates) {
    if (!text.includes((t as any).needle)) continue;
    const m = text.match(t.re);
    if (!m) continue;
    const order: number[] = (t as any).order;
    const args: string[] = [];
    order.forEach((n, i) => (args[n] = m[i + 1]));
    return t.to.replace(/\{(\d+)\}/g, (all, n) => (args[Number(n)] !== undefined ? blank(args[Number(n)], l) : all));
  }
  // Reasons joined into one line ("ergonomic, as you asked; you tend to like black finishes"): each part on its own.
  if (text.includes("; ")) {
    const parts = text.split("; ");
    const out = parts.map((x) => display(x, l));
    if (out.some((x, i) => x !== parts[i])) return out.join("; ");
  }
  return text;
}

/** A blank's value: a day or a dollar amount is written the language's way (the amount itself never changes). */
function blank(v: string, l: Lang | "xx"): string {
  if (l !== "xx" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return dayIn(l, v);
  const usd = v.match(/^\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
  if (l !== "xx" && usd) return moneyIn(l, Number(usd[1].replace(/,/g, "")) * 100 + Number(usd[2]));
  return display(v, l);
}
const currentLangOrPseudo = (): Lang | "xx" => currentWireLang();

/** Keys whose string values are sentences for people. */
const TEXT_KEYS = new Set(["who", "can", "cannot", "rule", "api", "when", "text", "source", "status_text", "issue_label", "note", "gap", "why", "reasons", "message", "headline", "hint", "summary", "detail", "label", "title", "answer", "shipping", "avoided", "sub", "explain", "explanation", "sentence", "question", "warning", "next", "needs", "remedy", "lede", "err", "ok", "excluded_reason", "line", "caption", "reason", "unknown", "checks", "notes", "lines", "how", "what", "say", "tip", "advice", "body", "error_text", "status_label", "description", "steps_text", "verdict_text", "until_text", "promise", "terms", "policy_text"]);

/** Walks a response and re-words the display fields. Returns a new value; never changes the stored object. */
export function displayDeep<T>(v: T, l: Lang | "xx" = currentLangOrPseudo(), key = "", depth = 0): T {
  if (l === "en" || depth > 12) return v;
  if (typeof v === "string") return (TEXT_KEYS.has(key) ? display(v, l) : v) as T;
  if (Array.isArray(v)) return v.map((x) => displayDeep(x, l, key, depth + 1)) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = displayDeep(x, l, k, depth + 1);
    return out as T;
  }
  return v;
}
