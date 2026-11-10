// Lighthouse, mobile preset, on the public pages and a signed-in screen. Uses Playwright's Chromium.
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import { writeFileSync, mkdirSync } from "node:fs";

const base = process.env.E2E_URL ?? "http://localhost:4111";
const pages = (process.argv[2] ?? "/,/login,/judge,/today").split(",");
const browser = await chromium.launch({ args: ["--remote-debugging-port=9333"] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(base + "/login");
const p = await (await page.request.get(base + "/api/ui/personas")).json();
const out = {};
for (const path of pages) {
  const signIn = !["/", "/login", "/judge"].includes(path);
  const headers = {};
  if (signIn && p.accounts?.[0]) {
    const r = await fetch(base + "/login", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", "x-everyday-ui": "1" }, body: `as=acc:${p.accounts[0].id}` });
    headers.Cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }
  const r = await lighthouse(base + path, { port: 9333, output: "json", logLevel: "error", extraHeaders: headers, formFactor: "mobile", screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false } }, undefined);
  const c = r.lhr.categories;
  out[path] = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v.score * 100)]));
  out[path].fcp = r.lhr.audits["first-contentful-paint"].displayValue;
  out[path].lcp = r.lhr.audits["largest-contentful-paint"].displayValue;
  out[path].tbt = r.lhr.audits["total-blocking-time"].displayValue;
  out[path].cls = r.lhr.audits["cumulative-layout-shift"].displayValue;
  out[path].failing = Object.values(r.lhr.audits).filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode === "binary").map((a) => a.id).slice(0, 8);
}
await browser.close();
mkdirSync("../docs/lighthouse", { recursive: true });
writeFileSync(`../docs/lighthouse/${process.env.LH_LABEL ?? "local"}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
