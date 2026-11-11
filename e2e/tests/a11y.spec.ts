import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

/**
 * A7: the accessibility checks published on /accessibility. Each test records what it checked and what it found;
 * afterAll writes eval/accessibility.json (the page reads that file). A failed check is recorded as failed.
 */
type Check = { id: string; title: string; how: string; ok: boolean; detail: string; pages?: number };
const checks: Check[] = [];
const target = process.env.E2E_URL ?? "http://localhost:4111";

const PUBLIC = ["/", "/login", "/judge", "/proof", "/ai", "/paypal", "/who-can-move-money", "/accessibility", "/agents"];
const SHOPPER = ["/today", "/ask", "/discover", "/plans", "/purchases", "/receipts", "/you", "/guard", "/passport", "/safety", "/channels", "/traces"];
const MERCHANT = ["/merchant", "/merchant/money", "/merchant/approvals"];

const scan = async (page: Page, label: string) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`);
};
const open = async (page: Page, p: string) => {
  await page.goto(p);
  await page.waitForLoadState("networkidle");
};
const sideways = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
const record = (c: Check) => {
  const i = checks.findIndex((x) => x.id === c.id);
  if (i >= 0) checks[i] = c;
  else checks.push(c);
};

test.afterAll(() => {
  if (!checks.length) return;
  writeFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../eval/accessibility.json"),
    JSON.stringify(
      {
        run_on: new Date().toISOString(),
        target,
        checks,
        not_tested: [
          "A VoiceOver or NVDA pass by a person: only automated checks and a scripted keyboard pass ran.",
          "The phone app (Expo) on a real device: it was checked as a web build only.",
          "Windows high-contrast mode and forced colours.",
          "Speech input (Voice Control, Dragon).",
          "Screen magnifiers beyond 200% text.",
          "Languages other than English.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe: no serious or critical WCAG 2.2 AA issues (${scheme})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await resetDemo(page);
    const bad: string[] = [];
    for (const p of PUBLIC) {
      await open(page, p);
      bad.push(...(await scan(page, p)));
    }
    await signIn(page, "shopper");
    const plans = await (await page.request.get("/api/ui/plans")).json();
    const extra = plans.plans[0] ? [`/plans/${plans.plans[0].id}`] : [];
    for (const p of [...SHOPPER, ...extra]) {
      await open(page, p);
      bad.push(...(await scan(page, p)));
    }
    await page.request.post("/logout", { headers: { "x-everyday-ui": "1" } });
    await signIn(page, "merchant");
    for (const p of MERCHANT) {
      await open(page, p);
      bad.push(...(await scan(page, p)));
    }
    const n = PUBLIC.length + SHOPPER.length + extra.length + MERCHANT.length;
    record({
      id: `axe-${scheme}`,
      title: `No serious or critical WCAG 2.2 AA issues, ${scheme} theme`,
      how: "axe-core (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) on every primary page, signed out, as the shopper and as the shop. It includes colour contrast and a name for every button, link and form control.",
      ok: bad.length === 0,
      detail: bad.length ? bad.slice(0, 8).join("; ") : `${n} pages, no serious or critical issue.`,
      pages: n,
    });
    expect(bad).toEqual([]);
  });
}

test("reflow: no sideways scroll at 320 px wide or at 200% text", async ({ page }) => {
  test.setTimeout(180_000);
  await resetDemo(page);
  await signIn(page, "shopper");
  const bad: string[] = [];
  const pages = ["/", "/today", "/ask", "/plans", "/purchases", "/safety", "/judge", "/proof"];
  await page.setViewportSize({ width: 320, height: 760 });
  for (const p of pages) {
    await open(page, p);
    const over = await sideways(page);
    if (over > 1) bad.push(`${p} at 320 px: ${over} px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const p of pages) {
    await open(page, p);
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page.waitForTimeout(150);
    const over = await sideways(page);
    if (over > 1) bad.push(`${p} at 200% text: ${over} px`);
  }
  record({ id: "reflow", title: "Reflow at 320 px wide and at 200% text", how: "Each page is measured for sideways scroll (page width minus window width) at 320 by 760, then at 1280 wide with the root text size at 200%.", ok: bad.length === 0, detail: bad.length ? bad.join("; ") : `${pages.length} pages, no sideways scroll either way.`, pages: pages.length });
  expect(bad).toEqual([]);
});

test("reduced motion: nothing keeps moving", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "/");
  const moving = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>("*")].filter((el) => {
        const s = getComputedStyle(el);
        const dur = Math.max(...s.animationDuration.split(",").map((x) => parseFloat(x) || 0));
        return s.animationName !== "none" && dur > 0.011 && s.animationIterationCount !== "1";
      }).length,
  );
  record({ id: "reduced-motion", title: "Reduced motion", how: "With prefers-reduced-motion set, count the elements still running a repeating animation on the landing page.", ok: moving === 0, detail: moving ? `${moving} elements still animate` : "Nothing repeats." });
  expect(moving).toBe(0);
});

test("keyboard only: make a plan, get the quote and pay", async ({ page }) => {
  test.setTimeout(180_000);
  await resetDemo(page);
  await signIn(page, "shopper");
  await open(page, "/plans?text=a%20wireless%20keyboard%20under%20%2480");
  const tabTo = async (name: RegExp, max = 120) => {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el ? `${el.getAttribute("aria-label") ?? ""} ${el.innerText ?? ""}`.trim() : "";
      });
      if (name.test(label)) return label;
    }
    throw new Error(`Couldn't reach ${name} with Tab`);
  };
  const steps: string[] = [];
  try {
    await tabTo(/^Plan it/i);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/plans\/[\w-]+/, { timeout: 60_000 });
    // A keyboard user waits for the plan to appear too; how long it took is recorded.
    const t0 = Date.now();
    await page.getByRole("button", { name: /Get the exact quote/i }).first().waitFor({ timeout: 60_000 });
    steps.push(`made a plan (shown after ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await tabTo(/Get the exact quote/i);
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");
    steps.push("got the quote");
    await tabTo(/^Pay \$[\d.]+ as the demo shopper/i);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/orders\/[\w-]+/, { timeout: 90_000 });
    await expect(page.locator("#ev-announce")).not.toBeEmpty({ timeout: 15_000 });
    const said = ((await page.locator("#ev-announce").textContent()) ?? "").trim();
    steps.push(`paid, and the live region said "${said.slice(0, 90)}"`);
    record({ id: "keyboard-pay", title: "Keyboard only: plan, quote and pay", how: "Only Tab and Enter, from a typed request to a paid order on the demo's saved sandbox wallet. The payment result must be announced in the page's one live region.", ok: true, detail: `${steps.join(", ")}.` });
  } catch (e) {
    record({ id: "keyboard-pay", title: "Keyboard only: plan, quote and pay", how: "Only Tab and Enter, from a typed request to a paid order on the demo's saved sandbox wallet.", ok: false, detail: `${steps.join(", ") || "nothing done"}; then: ${(e as Error).message.slice(0, 160)}` });
    throw e;
  }
});
