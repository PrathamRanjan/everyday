import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The colour tokens in web/src/index.css meet WCAG 2.2 AA in both themes:
 * body and secondary text at 4.5:1 on every surface, each status colour at 4.5:1 on its own tint and on cards,
 * and the faint ink (icons, rules of thumb) at 3:1 as a non-text UI colour.
 */
const css = readFileSync("web/src/index.css", "utf8");

function block(selector: RegExp): Record<string, string> {
  const m = css.match(selector);
  if (!m) throw new Error(`No block for ${selector}`);
  const start = css.indexOf("{", m.index!) + 1;
  let depth = 1;
  let i = start;
  while (depth && i < css.length) depth += css[i] === "{" ? 1 : css[i++] === "}" ? -1 : 0, depth && i++;
  const body = css.slice(start, i);
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((x) => [x[1], x[2].toLowerCase()]));
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const themes = { light: block(/:root\s*\{/), dark: block(/:root\[data-theme="dark"\]\s*\{/) };

describe("design tokens meet WCAG AA contrast", () => {
  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: text on every surface`, () => {
      for (const fg of ["ink", "ink-2"]) for (const bg of ["paper", "card", "sunk"]) expect(ratio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const bg of ["paper", "card"]) expect(ratio(t["ink-3"], t[bg]), `ink-3 on ${bg}`).toBeGreaterThanOrEqual(3);
      expect(ratio(t.paper, t.ink), "primary button text").toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: money states on their tint and on cards`, () => {
      for (const s of ["now", "done", "wait", "stop"]) {
        expect(ratio(t[s], t[`${s}-bg`]), `${s} on ${s}-bg`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t[s], t.card), `${s} on card`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t[s], t.paper), `${s} on paper`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
