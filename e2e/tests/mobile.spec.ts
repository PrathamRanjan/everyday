import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The React Native app, through its browser build (react-native-web): `npm --prefix mobile run export:web` first.
// It talks to the real Everyday server this suite runs against, with a phone key from the demo sign-in. Native-only
// parts (Face ID, the secure PayPal browser, reminders) can't run here; see mobile/README.md.

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../mobile");
const APP = "http://localhost:8081";
const BASE = process.env.E2E_URL ?? "http://localhost:4111";
const LIVE = BASE.includes("onrender.com");
let server: ChildProcess | null = null;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeAll(async () => {
  test.skip(!existsSync(path.join(MOBILE, "dist/index.html")), "Run npm --prefix mobile run export:web first.");
  const up = await fetch(APP).then((r) => r.ok).catch(() => false);
  if (!up) {
    server = spawn(process.execPath, [path.join(MOBILE, "scripts/serve-web.mjs")], { env: { ...process.env, PORT: "8081" }, stdio: "ignore" });
    for (let i = 0; i < 50 && !(await fetch(APP).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  }
});
test.afterAll(() => {
  server?.kill();
});

async function signIn(page: Page) {
  const r = await page.request.post(`${BASE}/demo/reset`, { headers: { "x-everyday-ui": "1" } });
  expect(r.ok()).toBeTruthy();
  await page.goto(APP);
  await expect(page.getByRole("heading", { name: "Your purchases, after the sale." })).toBeVisible();
  await page.getByRole("radio", { name: LIVE ? "Live demo" : "This computer" }).click();
  await expect(page.getByText(`Connected to ${new URL(BASE).host}`)).toBeVisible();
  await page.getByRole("button", { name: "Continue as Maya" }).click();
  await expect(page.getByRole("heading", { name: /, Maya\.$/ })).toBeVisible();
}

async function shoot(page: Page, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `../docs/screenshots/mobile-${name}-${scheme}.jpg`, type: "jpeg", quality: 82 });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

test("phone app: demo sign-in, Today, a plan from the phone with an exact quote, and its PayPal button", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This month" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await shoot(page, "today");

  await page.getByRole("tab", { name: /Plans/ }).click();
  await page.getByLabel("What do you need?").fill("a desk lamp under $80 by Friday");
  await page.getByRole("button", { name: "Plan it" }).click();
  await expect(page.getByRole("heading", { name: /desk lamp under \$80 by Friday/ })).toBeVisible();
  await expect(page.getByText(/from the phone/)).toBeVisible();
  await expect(page.getByText("What Everyday understood")).toBeVisible();
  await page.getByRole("button", { name: "Get the exact quote" }).click();
  await expect(page.getByRole("button", { name: /^Pay \$[\d.]+ as the demo shopper$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay on PayPal's own page instead" })).toBeVisible();
  await expect(page.getByText(/this exact total is what PayPal will show/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await shoot(page, "plan");

  // Pay: the server creates the PayPal order and PayPal's sandbox approval page opens (a popup in the browser
  // build; the secure in-app browser on a phone). Nothing is approved or charged here.
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Pay on PayPal's own page instead" }).click();
  const paypal = await popup;
  await paypal.waitForURL(/paypal\.com/, { timeout: 30_000 });
  expect(new URL(paypal.url()).host).toMatch(/sandbox\.paypal\.com$/);
  await paypal.close();

  // Back on the plan, which now links its order; the order is also listed under Bought.
  await page.getByRole("button", { name: "Open the order" }).click();
  await expect(page.getByRole("heading", { name: "Not paid yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Payment record" })).toBeVisible();
  await expect(page.getByText(/PAYER_ACTION_REQUIRED/).first()).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await shoot(page, "order");
  // The same unpaid order, paid from the demo's saved sandbox wallet with no PayPal login.
  await page.getByRole("button", { name: /^Pay \$[\d.]+ as the demo shopper$/ }).click();
  await expect(page.getByText("Paid from the demo's saved sandbox wallet, with no PayPal login.")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/^PayPal capture [A-Z0-9]{10,}$/)).toBeVisible();
  await page.goto(`${APP}/bought`);
  await expect(page.getByRole("button", { name: /^Order EV-/ }).first()).toBeVisible();
});

test("phone app: approvals with the kill switch, Find from the phone, and sign-out", async ({ page }) => {
  await signIn(page);

  await page.getByRole("tab", { name: /Approvals/ }).click();
  await expect(page.getByRole("heading", { name: "Kill switch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your rules" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Stop all assistants" }).click();
  await expect(page.getByRole("button", { name: "Release the kill switch" })).toBeVisible();
  await shoot(page, "approvals");
  await page.getByRole("button", { name: "Release the kill switch" }).click();
  await expect(page.getByRole("button", { name: "Stop all assistants" })).toBeVisible();

  await page.getByRole("tab", { name: /Find/ }).click();
  await page.getByLabel("Or describe it").fill("The walnut desk lamp from the video, about $50");
  await page.getByRole("button", { name: "Save to Find" }).click();
  await expect(page.getByRole("heading", { name: "Which item do you mean?" })).toBeVisible();
  await expect(page.getByText(/saved from the phone/)).toBeVisible();

  // Sign out: the phone's key is disconnected on the server.
  await page.goto(`${APP}/settings`);
  await page.getByRole("button", { name: "Sign out of this phone" }).click();
  await expect(page.getByRole("heading", { name: "Your purchases, after the sale." })).toBeVisible();
  const key = await page.evaluate(() => localStorage.getItem("everyday.key"));
  expect(key).toBeNull();
});
