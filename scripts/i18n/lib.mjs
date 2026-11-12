// B2/B8: shared helpers for the translation scripts. English is the source; every other language is a JSON map
// from the English sentence to its translation, with the same numbered blanks ({0}, {1}…).
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const LANGS = ["hi", "id", "pt"];
export const TARGETS = {
  web: { dirs: ["web/src"], exts: [".ts", ".tsx"], fns: ["t", "tn", "N_"], out: "web/src/i18n/locales" },
  server: { dirs: ["src"], exts: [".ts"], fns: ["tr", "N_"], out: "i18n/server" },
};

function walk(dir, exts, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "node_modules" || f === "locales" || f === "dist") continue;
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => f.endsWith(e))) out.push(p);
  }
  return out;
}

const require = createRequire(import.meta.url);
const SERVER_PROPS = new Set(["who", "can", "cannot", "rule", "api", "when", "note", "gap", "why", "headline", "hint", "summary", "detail", "message", "label", "reason", "title", "answer", "shipping", "description", "sub", "explain", "explanation", "sentence", "question", "warning", "next", "needs", "what", "how", "remedy", "lede", "err", "ok", "status_label", "excluded_reason", "line", "body", "caption", "unknown_reason", "result_text", "say", "tip", "advice"]);
const PUSHERS = /^(reasons|checks|why|notes|failed|unexpressed|gaps|missing|avoided|lines|parts|says|steps|warnings|out)$/;
const SKIP_FILES = /catalog-data\.ts$|\/i18n\/(index|display|parse)\.ts$|\/eval\/|\/ai\/|safety\/model|\.test\.ts$/;

/** Server sentences: string and template literals in places shown to people (errors, flash messages, notes, reasons, labels). */
function harvestServer() {
  const ts = require(join(ROOT, "web/node_modules/typescript"));
  const keys = new Map();
  let force = false;
  const add = (s, file) => {
    if (!/[A-Za-z]{2,}/.test(s.replace(/\{\d+\}/g, ""))) return;
    // A single lowercase word is a code unless it is marked on purpose with N_("…").
    if (!force && !/\s/.test(s.trim()) && !/^[A-Z][a-z]+$/.test(s.trim())) return;
    if (/^(https?:|\/|SELECT|INSERT|UPDATE|DELETE|CREATE)/.test(s.trim())) return;
    if (!keys.has(s)) keys.set(s, file);
  };
  for (const file of walk(join(ROOT, "src"), [".ts"])) {
    if (SKIP_FILES.test(file)) continue;
    const src = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const rel = file.replace(ROOT + "/", "");
    const lits = (e) => {
      if (!e) return;
      if (ts.isParenthesizedExpression(e)) return lits(e.expression);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return add(e.text, rel);
      if (ts.isTemplateExpression(e)) {
        let msg = e.head.text;
        e.templateSpans.forEach((sp, i) => {
          msg += `{${i}}` + sp.literal.text;
          lits(sp.expression);
        });
        return add(msg, rel);
      }
      if (ts.isConditionalExpression(e)) return lits(e.whenTrue), lits(e.whenFalse);
      if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken].includes(e.operatorToken.kind)) return lits(e.left), lits(e.right);
      if (ts.isArrayLiteralExpression(e)) return e.elements.forEach(lits);
      if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && ["trim", "join", "slice"].includes(e.expression.name.text)) return lits(e.expression.expression);
    };
    const visit = (n) => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression.getText(sf);
        if (["tr", "N_"].includes(callee)) {
          force = callee === "N_";
          lits(n.arguments[0]);
          force = false;
        }
        else if (callee === "trIn") lits(n.arguments[1]);
        else if (callee === "back") lits(n.arguments[2]);
        else if (callee === "refuse") lits(n.arguments[0]);
        else if (callee === "row") n.arguments.forEach(lits);
        else if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "push" && PUSHERS.test(n.expression.expression.getText(sf).split(".").pop())) n.arguments.forEach(lits);
      }
      if (ts.isNewExpression(n) && /^(GtError|AiFailed)$/.test(n.expression.getText(sf)) && n.arguments?.length) lits(n.arguments[0]);
      if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && SERVER_PROPS.has(n.name.text)) lits(n.initializer);
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && SERVER_PROPS.has(n.left.name.text)) lits(n.right);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && SERVER_PROPS.has(n.name.text) && n.initializer) lits(n.initializer);
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "logEvent" && n.arguments.length > 5) lits(n.arguments[5]);
      // Small sentence builders: const caseLine = (…) => cond ? `…` : `…`.
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /(Line|Sentence)$/.test(n.name.text) && n.initializer && ts.isArrowFunction(n.initializer) && !ts.isBlock(n.initializer.body)) lits(n.initializer.body);
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /^[A-Z][A-Z0-9_]*$/.test(n.name.text) && n.initializer && ts.isObjectLiteralExpression(n.initializer))
        n.initializer.properties.forEach((p) => ts.isPropertyAssignment(p) && lits(p.initializer));
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return keys;
}

/** Every English sentence the code passes to the translator, with where it was found. */
export function extract(target) {
  if (target === "server") return harvestServer();
  const cfg = TARGETS[target];
  const keys = new Map();
  const fn = cfg.fns.join("|");
  // t("…"), tn("…"), N_("…"), tr("…") and trIn(lang, "…"): a double-quoted JSON-style string as the text.
  const re = new RegExp(`(?<![\\w.])(?:(?:${fn})\\(\\s*|trIn\\([^,()]+,\\s*)("(?:[^"\\\\\\n]|\\\\.)*")`, "g");
  for (const d of cfg.dirs)
    for (const file of walk(join(ROOT, d), cfg.exts)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) {
        let s;
        try {
          s = JSON.parse(m[1]);
        } catch {
          continue;
        }
        if (!/[A-Za-z]/.test(s)) continue;
        if (!keys.has(s)) keys.set(s, file.replace(ROOT + "/", ""));
      }
    }
  return keys;
}

export const blanks = (s) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(",");
export const localePath = (target, lang) => join(ROOT, TARGETS[target].out, `${lang}.json`);
export function readLocale(target, lang) {
  const p = localePath(target, lang);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}
export function writeLocale(target, lang, map) {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(localePath(target, lang), JSON.stringify(sorted, null, 1) + "\n");
}

/** Missing sentences and broken blanks, per language. Stale entries (no longer in the code) are reported, not fatal. */
export function check(target) {
  const keys = extract(target);
  const problems = [];
  for (const l of LANGS) {
    const loc = readLocale(target, l);
    for (const k of keys.keys()) {
      if (!(k in loc)) problems.push({ lang: l, key: k, problem: "missing", where: keys.get(k) });
      else if (blanks(loc[k]) !== blanks(k)) problems.push({ lang: l, key: k, problem: `blanks differ: ${blanks(k)} vs ${blanks(loc[k])}`, where: keys.get(k) });
    }
  }
  return { keys: keys.size, problems };
}
