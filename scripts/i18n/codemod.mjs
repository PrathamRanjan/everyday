// B2: one-off codemod that wraps the web app's English text in t() so it can be translated.
// Usage: node scripts/i18n/codemod.mjs web/src/pages/Plan.tsx [...more files]
// What it wraps:
//  - JSX text, merged with its simple {expressions} into one sentence with numbered blanks: "Last run {0} on {1}."
//  - text-bearing props (title, sub, label, placeholder, aria-label, …): strings, template strings, a ? "x" : "y"
//  - toast(), announce(), confirm() messages and document.title
//  - label/title/description/… fields of object literals (inside components: t(); at module level: a getter, so
//    the text is looked up when it is read, in the language of that moment)
// It never touches classNames, keys, routes, ids or values code compares against. Run it once; review the diff.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const ts = require("../../web/node_modules/typescript");

const ATTRS = new Set(["lede", "who", "ai", "code", "paypal", "title", "sub", "label", "placeholder", "aria-label", "alt", "eyebrow", "needs", "next", "description", "hint", "empty", "help", "caption", "summary", "heading", "confirmLabel", "cancelLabel", "tooltip", "legend", "text", "note", "lead", "action", "actionLabel", "subtitle", "body", "detail", "question", "prompt", "emptyText", "loadingText", "aria-description", "aria-roledescription", "aria-valuetext"]);
const PROPS = new Set(["label", "title", "sub", "description", "hint", "placeholder", "help", "empty", "note", "body", "text", "detail", "subtitle", "lead", "question", "why", "caption", "heading", "summary", "tip", "success", "popover_title", "popover_description"]);
const CALLS = new Set(["setStatus", "setErr", "setError", "setMsg", "setNote", "setMessage", "bad", "manual", "fail", "toast", "toast.success", "toast.error", "toast.message", "toast.info", "toast.warning", "announce", "confirm", "window.confirm", "alert", "say", "speak"]);
// Text in JSX is always shown to people; a string elsewhere counts as text if it has a space or is a Capitalised word.
const jsxTextish = (s) => /[A-Za-z]{2,}/.test(s);
const textish = (s, loose = false) => {
  const v = s.trim();
  if (!/[A-Za-z]{2,}/.test(v)) return false;
  if (/\s/.test(v)) return !/^(https?:|mailto:)\S*$/.test(v);
  if (/^(https?:|mailto:|\/|#|\.|@)/.test(v) || /^[\w-]+\.(tsx?|json|png|svg|jpe?g|webp)$/.test(v)) return false;
  // One word: shown to people when it's in JSX (loose) or Capitalised; lowercase-with-dashes is a class or a code.
  return loose ? /^[A-Za-z][a-z’']+[.!?…]?$/.test(v) : /^[A-Z][a-z’']+[.!?…]?$/.test(v);
};
const ENT = { nbsp: "\u00a0", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…", times: "×", rarr: "→", larr: "←", middot: "·", copy: "©", bull: "•", deg: "°", rsaquo: "›", lsaquo: "‹" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
const q = (s) => JSON.stringify(s);
// Tailwind class lists (\"flex items-center gap-2\") are not sentences.
const classy = (s) => s.trim().split(/\s+/).every((w) => /^[a-z0-9:[\]\/.%!-]+$/.test(w)) && s.split(/\s+/).some((w) => /[-:]/.test(w));

function jsxNormalize(raw) {
  // React/Babel: lines are trimmed except the first line's start and the last line's end; empty lines dropped.
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return raw;
  const out = [];
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, " ");
    if (i !== 0) l = l.replace(/^\s+/, "");
    if (i !== lines.length - 1) l = l.replace(/\s+$/, "");
    if (l) out.push(l);
  });
  return out.join(" ");
}

function hasJsx(node) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return void (found = true);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}
const isTCall = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "t" || n.expression.text === "tn");
const inFunction = (n) => {
  for (let p = n.parent; p; p = p.parent) if (ts.isArrowFunction(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isMethodDeclaration(p) || ts.isGetAccessor(p)) return true;
  return false;
};

export function transform(file, src) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let changed = 0;
  // rewrite(node) → the node's source with every inner change applied.
  const text = (n) => src.slice(n.getStart(sf), n.end);
  function rewrite(node) {
    const special = transformNode(node);
    if (special !== null) return special;
    return splice(node);
  }
  function splice(node) {
    const start = node.getStart(sf);
    let out = "";
    let at = start;
    const kids = [];
    ts.forEachChild(node, (c) => void kids.push(c));
    for (const c of kids) {
      const cs = c.getStart(sf);
      if (cs < at) continue;
      out += src.slice(at, cs) + rewrite(c);
      at = c.end;
    }
    return out + src.slice(at, node.end);
  }
  // A string-valued expression → its translated form (or unchanged if it isn't text).
  function stringish(e, loose = false) {
    if (!e) return null;
    if (ts.isParenthesizedExpression(e)) {
      const inner = stringish(e.expression, loose);
      return inner === null ? null : `(${inner})`;
    }
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
      if (!textish(e.text, loose)) return null;
      changed++;
      return `t(${q(e.text)})`;
    }
    if (ts.isTemplateExpression(e)) {
      const lit = [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join("");
      if (!textish(lit)) {
        // `${a ? "Some text" : ""}${b}`: no text of its own, but its parts may be text.
        const parts = e.templateSpans.map((s) => stringish(s.expression, loose));
        if (parts.every((x) => x === null)) return null;
        return "`" + e.head.rawText + e.templateSpans.map((s, i) => "${" + (parts[i] ?? rewrite(s.expression)) + "}" + s.literal.rawText).join("") + "`";
      }
      let msg = e.head.text;
      const args = [];
      e.templateSpans.forEach((s, i) => {
        msg += `{${i}}` + s.literal.text;
        args.push(stringish(s.expression) ?? rewrite(s.expression));
      });
      changed++;
      return `t(${q(msg)}, ${args.join(", ")})`;
    }
    if (ts.isConditionalExpression(e)) {
      const a = stringish(e.whenTrue, loose);
      const b = stringish(e.whenFalse, loose);
      if (a === null && b === null) return null;
      return `${rewrite(e.condition)} ? ${a ?? rewrite(e.whenTrue)} : ${b ?? rewrite(e.whenFalse)}`;
    }
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(e.operatorToken.kind)) {
      const r = stringish(e.right, loose);
      if (r === null) return null;
      return `${rewrite(e.left)} ${e.operatorToken.getText(sf)} ${r}`;
    }
    return null;
  }
  function transformNode(node) {
    if (isTCall(node)) return text(node);
    // JSX children: merge runs of text and simple expressions into one sentence.
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node.openingFragment;
      const close = ts.isJsxElement(node) ? node.closingElement : node.closingFragment;
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(sf) : "";
      if (["code", "pre", "kbd", "samp", "style", "script"].includes(tag)) return splice(node);
      let out = rewrite(open);
      const kids = [...node.children];
      let i = 0;
      let prevEnd = open.end;
      while (i < kids.length) {
        const k = kids[i];
        const simple = (c) => ts.isJsxText(c) || (ts.isJsxExpression(c) && c.expression && !hasJsx(c.expression) && !isTCall(c.expression));
        if (!simple(k)) {
          out += src.slice(prevEnd, k.pos) + rewrite(k);
          prevEnd = k.end;
          i++;
          continue;
        }
        let j = i;
        while (j < kids.length && simple(kids[j])) j++;
        const run = kids.slice(i, j);
        const hasText = run.some((c) => ts.isJsxText(c) && jsxTextish(jsxNormalize(c.text)));
        if (!hasText) {
          for (const c of run) {
            out += src.slice(prevEnd, c.pos);
            if (ts.isJsxText(c)) out += c.getFullText(sf);
            else {
              const s = stringish(c.expression, true);
              out += s !== null ? `{${s}}` : rewrite(c);
            }
            prevEnd = c.end;
          }
          i = j;
          continue;
        }
        let msg = "";
        const args = [];
        for (const c of run) {
          if (ts.isJsxText(c)) msg += decode(jsxNormalize(c.getFullText(sf)));
          else if (ts.isStringLiteral(c.expression)) msg += c.expression.text;
          else {
            msg += `{${args.length}}`;
            args.push(stringish(c.expression, true) ?? rewrite(c.expression));
          }
        }
        const lead = /^\s/.test(msg) ? '{" "}' : "";
        const trail = /\s$/.test(msg) ? '{" "}' : "";
        const core = msg.trim();
        const first = run[0];
        out += src.slice(prevEnd, first.pos);
        // Keep the source's own line break before the run, if it had one.
        const ws = ts.isJsxText(first) ? first.getFullText(sf).match(/^\s*\n\s*/)?.[0] ?? "" : "";
        out += ws + lead + `{${args.length ? "tn" : "t"}(${q(core)}${args.length ? ", " + args.join(", ") : ""})}` + trail;
        const last = run[run.length - 1];
        const tailWs = ts.isJsxText(last) ? last.getFullText(sf).match(/\n\s*$/)?.[0] ?? "" : "";
        out += tailWs;
        changed++;
        prevEnd = last.end;
        i = j;
      }
      out += src.slice(prevEnd, close.getStart(sf)) + rewrite(close);
      return out;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (!ATTRS.has(name) || !node.initializer) return null;
      const init = node.initializer;
      if (ts.isStringLiteral(init)) {
        if (!textish(init.text)) return null;
        changed++;
        return `${name}={t(${q(init.text)})}`;
      }
      if (ts.isJsxExpression(init) && init.expression && !hasJsx(init.expression)) {
        const s = stringish(init.expression);
        if (s !== null) return `${name}={${s}}`;
      }
      return null;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (CALLS.has(callee) && node.arguments.length) {
        const args = node.arguments.map((a, n) => {
          if (n === 0) return stringish(a) ?? rewrite(a);
          return rewrite(a);
        });
        return `${rewrite(node.expression)}(${args.join(", ")})`;
      }
      return null;
    }
    if (ts.isNewExpression(node) && node.expression.getText(sf) === "Error" && node.arguments?.length) {
      const s0 = stringish(node.arguments[0]);
      return s0 === null ? null : `new Error(${[s0, ...node.arguments.slice(1).map(rewrite)].join(", ")})`;
    }
    const UIVARS = /^(needs|headline|label|title|msg|message|status|note|greeting|lede|sub|hint|text|why|line|sentence|err|error|summary|caption|placeholder|desc|description|next)$/;
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name) && UIVARS.test(node.name.text) && !hasJsx(node.initializer)) {
      const s0 = stringish(node.initializer);
      return s0 === null ? null : `${rewrite(node.name)}${node.type ? `: ${node.type.getText(sf)}` : ""} = ${s0}`;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && UIVARS.test(node.left.text) && !hasJsx(node.right)) {
      const s0 = stringish(node.right);
      return s0 === null ? null : `${node.left.text} = ${s0}`;
    }
    if (ts.isReturnStatement(node) && node.expression && inFunction(node) && !hasJsx(node.expression)) {
      const strs = [];
      const walk = (n) => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) strs.push(n.text);
        ts.forEachChild(n, walk);
      };
      walk(node.expression);
      if (strs.length && strs.every((x) => !x || /\s/.test(x.trim()) || /^[A-Z][a-z]+$/.test(x))) {
        const s0 = stringish(node.expression);
        if (s0 !== null) return `return ${s0};`;
      }
      return null;
    }
    // ["Items", money(x)] and ["too_expensive", "too expensive"] inside a component: the sentence elements.
    if (ts.isArrayLiteralExpression(node) && inFunction(node) && node.elements.some((e) => ts.isStringLiteral(e) && textish(e.text) && !classy(e.text))) {
      const parts = node.elements.map((e) => (ts.isStringLiteral(e) && textish(e.text) && !classy(e.text) ? stringish(e) ?? rewrite(e) : rewrite(e)));
      return `[${parts.join(", ")}]`;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText(sf) === "document.title") {
      const s = stringish(node.right);
      return s === null ? null : `document.title = ${s}`;
    }
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && PROPS.has(node.name.text) && !hasJsx(node.initializer)) {
      const s = stringish(node.initializer);
      if (s === null) return null;
      if (inFunction(node)) return `${node.name.getText(sf)}: ${s}`;
      return `get ${node.name.getText(sf)}() { return ${s}; }`;
    }
    return null;
  }
  let out = splice(sf);
  if (changed && !/from "@\/i18n"/.test(out)) {
    const m = [...out.matchAll(/^import[^;]*;\n/gm)].pop();
    const at = m ? m.index + m[0].length : 0;
    const names = ["t", ...(/\btn\(/.test(out) ? ["tn"] : [])];
    out = out.slice(0, at) + `import { ${names.join(", ")} } from "@/i18n";\n` + out.slice(at);
  }
  return { out, changed };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  for (const f of process.argv.slice(2)) {
    const src = readFileSync(f, "utf8");
    const { out, changed } = transform(f, src);
    if (changed) writeFileSync(f, out);
    console.log(`${f}: ${changed} wrapped`);
  }
}
