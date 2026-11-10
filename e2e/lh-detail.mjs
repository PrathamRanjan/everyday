import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
const base = process.env.E2E_URL ?? "http://localhost:4111";
const browser = await chromium.launch({ args: ["--remote-debugging-port=9334"] });
const r = await lighthouse(base + (process.argv[2] ?? "/"), { port: 9334, output: "json", logLevel: "error", formFactor: "mobile", screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false } });
const a = r.lhr.audits;
const pick = (id) => a[id] && { id, score: a[id].score, value: a[id].displayValue, items: (a[id].details?.items ?? []).slice(0, 6).map((x) => ({ url: x.url, node: x.node?.snippet?.slice(0, 120), score: x.score, wasted: x.wastedMs, total: x.totalBytes, items: x.items?.slice?.(0, 3)?.map((y) => y.node?.snippet?.slice(0, 100)) })) };
console.log(JSON.stringify(["speed-index", "largest-contentful-paint-element", "layout-shifts", "render-blocking-resources", "render-blocking-insight", "network-dependency-tree-insight", "font-display-insight", "lcp-breakdown-insight", "cls-culprits-insight"].map(pick).filter(Boolean), null, 1));
await browser.close();
