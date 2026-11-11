import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

/**
 * Wave 5: the robot judge. Walks every /judge path the way a judge would, in a fresh private demo, using only the
 * buttons on screen, then reads /api/ui/judge to see which steps ticked themselves. Writes eval/robot-judge.json;
 * with ROBOT_POST=1 and the operator key it also stores the run on the site, where /proof shows it.
 * A failed step is recorded as failed with what was on screen; the run goes on to the next path.
 */
type StepResult = { key: string; label: string; done: boolean };
type PathResult = { id: string; title: string; ok: boolean; seconds: number; steps: StepResult[]; error: string | null };
const target = process.env.E2E_URL ?? "http://localhost:4111";
const results: PathResult[] = [];

const judgeState = async (page: Page) => (await (await page.request.get("/api/ui/judge")).json()).paths as { id: string; title: string; steps: { key: string; label: string; done: boolean }[] }[];
const waitTicks = async (page: Page, id: string, keys: string[], ms = 60_000) => {
  const until = Date.now() + ms;
  for (;;) {
    const p = (await judgeState(page)).find((x) => x.id === id)!;
    if (keys.every((k) => p.steps.find((s) => s.key === k)?.done) || Date.now() > until) return p;
    await page.waitForTimeout(1500);
  }
};
const login = async (page: Page, who: "shopper" | "merchant") => {
  await page.request.post("/logout", { headers: { "x-everyday-ui": "1" } });
  await page.goto("/login");
  await page.getByRole("button", { name: who === "shopper" ? /Continue as Maya/ : /Open the merchant console/ }).click();
  await page.waitForURL(who === "shopper" ? /\/today$/ : /\/merchant$/);
};

const WALKS: Record<string, (page: Page) => Promise<void>> = {
  money: async (page) => {
    await page.goto("/today");
    await page.getByRole("button", { name: /^Ask for \$[\d.]+ back/ }).first().click();
    await waitTicks(page, "money", ["price_drop_claimed"], 20_000);
    await login(page, "merchant");
    await page.getByRole("button", { name: /^Approve \$[\d.]+ refund/ }).first().click();
    await waitTicks(page, "money", ["refund_confirmed"], 90_000);
    await login(page, "shopper");
    await page.goto("/ask?q=Did%20PayPal%20confirm%20my%20refund%3F&go=1");
    await waitTicks(page, "money", ["ask_answered"], 120_000);
  },
  buy: async (page) => {
    await page.goto("/plans?text=a%20wireless%20keyboard%20under%20%2480");
    await page.getByRole("button", { name: /^Plan it/ }).first().click();
    await page.waitForURL(/\/plans\/[\w-]+/, { timeout: 90_000 });
    await page.getByRole("button", { name: /Get the exact quote/ }).first().click();
    await page.getByRole("button", { name: /^Pay \$[\d.]+ as the demo shopper/ }).first().click({ timeout: 30_000 });
    await page.waitForURL(/\/orders\/[\w-]+/, { timeout: 120_000 });
  },
  scam: async (page) => {
    await page.goto("/safety");
    await page.getByRole("button", { name: "Paste the demo scam" }).first().click();
    await page.getByRole("button", { name: "Check this message" }).first().click();
    await expect(page.getByText(/Hold/).first()).toBeVisible({ timeout: 45_000 });
  },
  receipt: async (page) => {
    await page.goto("/receipts");
    await page.getByRole("button", { name: "Use the sample receipt" }).click();
    await page.getByRole("button", { name: "Read it" }).click();
    await page.getByRole("button", { name: /^Save \d+ to what I own/ }).click({ timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible({ timeout: 20_000 });
  },
};

test.afterAll(async ({ request }) => {
  if (!results.length) return;
  const body = { run_on: new Date().toISOString(), target, by: "robot (Playwright, buttons on screen only)", ok: results.every((r) => r.ok), paths: results };
  writeFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../eval/robot-judge.json"), JSON.stringify(body, null, 2) + "\n");
  if (process.env.ROBOT_POST === "1" && process.env.EV_ADMIN_KEY) {
    const r = await request.post(`${target}/admin/robot-judge`, { data: body, headers: { "x-everyday-operator": process.env.EV_ADMIN_KEY } });
    if (!r.ok()) console.log(`Couldn't store the run on the site: ${r.status()}`);
  }
});

test("robot judge: every /judge path, from a fresh demo, with the buttons on screen", async ({ page }) => {
  test.setTimeout(900_000);
  await resetDemo(page);
  const paths = await judgeState(page);
  for (const p of paths) {
    const t = Date.now();
    let error: string | null = null;
    try {
      if (!WALKS[p.id]) throw new Error(`The robot has no walk for the path "${p.id}"`);
      await login(page, "shopper");
      await WALKS[p.id](page);
    } catch (e) {
      error = (e as Error).message.split("\n")[0].slice(0, 240);
    }
    const after = (await waitTicks(page, p.id, p.steps.map((s) => s.key), error ? 1 : 30_000));
    const steps = after.steps.map((s) => ({ key: s.key, label: s.label, done: s.done }));
    results.push({ id: p.id, title: p.title, ok: !error && steps.every((s) => s.done), seconds: Math.round((Date.now() - t) / 1000), steps, error });
  }
  expect(results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.error ?? r.steps.filter((s) => !s.done).map((s) => s.key).join(", ")}`)).toEqual([]);
});
