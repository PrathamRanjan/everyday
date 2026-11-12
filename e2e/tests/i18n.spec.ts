import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

/**
 * B8: languages, in a real browser.
 *  1. Pseudo-language crawl (?lang=xx): every sentence the app translates is marked ⟦like this⟧, by the web app and by
 *     the server. Any visible text (or label) without the marks was missed. Product, shop and person names, numbers,
 *     dates and the shopper's own words are allowed through. Writes eval/i18n-untranslated.json; fails above a budget.
 *  2. A screenshot of every main screen in all four languages (docs/screenshots/i18n/).
 *  3. Switching language keeps what is typed in a form (no reload, no lost state).
 */
const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = ["/", "/login", "/proof", "/ai", "/paypal", "/who-can-move-money", "/accessibility", "/agents"];
const SHOPPER = ["/today", "/ask", "/discover", "/plans", "/purchases", "/receipts", "/you", "/guard", "/passport", "/safety", "/channels", "/traces"];
const MERCHANT = ["/merchant", "/merchant/money", "/merchant/approvals"];

// Names and data that are not translated: brands, shops, people, products, codes.
const ALLOW = /^(Everyday|PayPal|Channel3|Telegram|Northlight( Supply)?|Maya( Chen)?|MCP|TikTok|YouTube|OpenAI|Render|Decisions|ScamShield|Singlish|TechJam|EN|HI|ID|PT|English|हिन्दी|Bahasa Indonesia|Português \(Brasil\)|AI|OK|USD|INR|IDR|BRL|VESA|USB-C|HDMI|DisplayPort|Thunderbolt|ANC|IPX\d|WCAG.*|axe|404|v\d+|gpt-[\w.-]+|claude-[\w.-]+)$/;
const DATA = /^([\d\s.,:%$€₹+×x/#()–—-]+|[A-Z0-9]{8,}|[\w.-]+@[\w.-]+|https?:\/\/\S+|\/[\w/.-]*|[a-z_]+(\.[a-z_]+)+|[\w-]+_[\w-]+|.*\b(Lamp|Chair|Mouse|Keyboard|Monitor|Dock|Hub|Webcam|Headphones|Earbuds|Mat|Arm|Stand|Desk)\b.*)$/;

async function untranslated(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && (el as HTMLElement).offsetParent !== null;
    };
    const walker = document.createTreeWalker(document.querySelector("#root") ?? document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el || ["SCRIPT", "STYLE", "CODE", "PRE", "KBD", "SAMP", "TEXTAREA", "OPTION"].includes(el.tagName) || el.closest("code,pre,kbd,samp,[data-no-i18n],input,textarea,[contenteditable]") || !visible(el)) continue;
      const text = (n.textContent ?? "").trim();
      if (!/[A-Za-z]{2,}/.test(text)) continue;
      // Inside a marked sentence (the marks may be on a neighbouring text node of the same element).
      const block = el.closest("p,li,h1,h2,h3,h4,button,a,label,td,th,dt,dd,span,div,summary,figcaption") ?? el;
      if (/⟦/.test(text) || (block.textContent ?? "").includes("⟦")) continue;
      out.push(text.slice(0, 140));
    }
    for (const el of Array.from(document.querySelectorAll("[aria-label],[placeholder],[title]"))) {
      for (const a of ["aria-label", "placeholder", "title"]) {
        const v = el.getAttribute(a);
        if (v && /[A-Za-z]{2,}/.test(v) && !v.includes("⟦")) out.push(`@${a}: ${v.slice(0, 120)}`);
      }
    }
    return out;
  });
}

// Dates and times as the browser writes them ("Mon 16 Nov 09:00", "Mar 16, 2027", "Nov 16, 9:00 AM"), order numbers, shop lines.
const DATEISH = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|[ap]m|[\d\s.,:\/–-])+$/i;
const CODEISH = /^(EV-\d+(-C\d+)?|[\w.-]+ · [\w.-]+\.[a-z]{2,}( · [\d.]+★ \(\d+\))?|[\w-]+:[\w-]+(:\d+)?)$/;
// The shopper's own data, read from the API after signing in: their requests, people, products and clip titles.
const known: string[] = [];
const keep = (s: string) => {
  let v = s.replace(/^@[\w-]+: /, "").trim().replace(/^[“"]|[”"]$/g, "");
  if (ALLOW.test(v) || DATA.test(v) || DATEISH.test(v) || CODEISH.test(v)) return false;
  if (known.some((k) => k.includes(v))) return false;
  for (const k of known) if (k.length > 2 && v.includes(k)) v = v.split(k).join(" ");
  return /[A-Za-z]{3,}/.test(v.replace(/\b(Everyday|PayPal|Northlight|Maya|Ari)\b/g, ""));
};
const collect = (v: unknown, keys: RegExp, key = ""): void => {
  if (typeof v === "string") {
    if (keys.test(key) && v.length < 160) known.push(v);
  } else if (Array.isArray(v)) v.forEach((x) => collect(x, keys, key));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) collect(x, keys, k);
};

test("pseudo-language: nothing visible is left untranslated", async ({ page, context }) => {
  test.setTimeout(600_000);
  const base = process.env.E2E_URL ?? "http://localhost:4111";
  const lang = async (l: string) => {
    await context.addCookies([{ name: "ev_lang", value: l, url: base }]);
    await page.goto("/404-lang", { waitUntil: "domcontentloaded" });
    await page.evaluate((x) => localStorage.setItem("ev-lang", x), l);
  };
  // Signing in uses the English button names; every page is then read in the pseudo-language.
  const as = async (who: "shopper" | "merchant") => {
    await lang("en");
    await signIn(page, who);
    await lang("xx");
  };
  await resetDemo(page);
  await lang("xx");
  const found: Record<string, string[]> = {};
  const save = () => writeFileSync(resolve(here, "../../eval/i18n-untranslated.json"), JSON.stringify({ run_on: new Date().toISOString(), target: process.env.E2E_URL ?? "http://localhost:4111", total: Object.values(found).reduce((n, xs) => n + xs.length, 0), pages: found }, null, 2) + "\n");
  mkdirSync(resolve(here, "../../eval"), { recursive: true });
  const visit = async (p: string) => {
    await page.goto(p, { waitUntil: "domcontentloaded" });
    await page.locator("main, #main").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const xs = [...new Set((await untranslated(page)).filter(keep))];
    if (xs.length) found[p] = xs;
    save();
  };
  for (const p of PUBLIC) await visit(p);
  await as("shopper");
  const en = { headers: { "x-everyday-lang": "en" } };
  const plans = await (await page.request.get("/api/ui/plans", en)).json();
  const orders = await (await page.request.get("/api/ui/purchases", en)).json().catch(() => ({}));
  const extra = [...(plans.plans?.[0] ? [`/plans/${plans.plans[0].id}`] : []), ...(orders.orders?.[0] ? [`/orders/${orders.orders[0].id}`] : [])];
  const sources: [string, RegExp][] = [
    ["/api/ui/plans", /^(text|recipient)$/],
    ["/api/ui/you", /^(title|name|relation)$/],
    ["/api/ui/discover", /^title$/],
    ...(plans.plans?.[0] ? ([[`/api/ui/plans/${plans.plans[0].id}`, /^(title|finish|style|material|brand)$/]] as [string, RegExp][]) : []),
  ];
  for (const [path, keys] of sources) collect(await (await page.request.get(path, en)).json().catch(() => null), keys);
  known.sort((a, b) => b.length - a.length);
  for (const p of [...SHOPPER, ...extra]) await visit(p);
  await page.request.post("/logout", { headers: { "x-everyday-ui": "1" } });
  await as("merchant");
  for (const p of MERCHANT) await visit(p);
  save();
  // The budget: the pages people use (shopper flow) must be clean; the operator console may lag behind.
  const flow = ["/", "/login", "/today", "/plans", "/purchases", "/receipts", ...extra];
  expect(flow.flatMap((p) => (found[p] ?? []).map((x) => `${p}: ${x}`))).toEqual([]);
});

test("switching language keeps what is typed, and every main screen renders in all four languages", async ({ page }) => {
  test.setTimeout(300_000);
  await resetDemo(page);
  await signIn(page, "shopper");
  await page.goto("/receipts");
  const box = page.getByRole("textbox").first();
  await box.fill("1 x Desk lamp $20.00");
  await page.getByTestId("lang-picker").click();
  await page.getByRole("button", { name: "Português (Brasil)" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt");
  await expect(box).toHaveValue("1 x Desk lamp $20.00");
  const dir = resolve(here, "../../docs/screenshots/i18n");
  mkdirSync(dir, { recursive: true });
  for (const lang of ["en", "hi", "id", "pt"]) {
    await page.evaluate((l) => localStorage.setItem("ev-lang", l), lang);
    for (const p of ["/", "/today", "/plans", "/receipts", "/ask"]) {
      await page.goto(p, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: resolve(dir, `${lang}${p === "/" ? "-landing" : p.replace(/\//g, "-")}.png`), fullPage: false });
    }
  }
});
