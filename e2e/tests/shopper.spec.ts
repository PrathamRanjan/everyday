import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

test("shopper: a sentence becomes a checked plan with an exact quote, ready for PayPal", async ({ page }) => {
  await resetDemo(page);
  await signIn(page, "shopper");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Maya");
  await expect(page.locator('[data-tour="lifeline"]')).toBeVisible();

  await page.goto("/plans");
  await page.getByLabel("What do you need?").fill("A quiet mouse under $45 by Thursday");
  await page.getByRole("button", { name: "Plan it" }).click();
  await page.waitForURL(/\/plans\/int_/);
  // The budget holds, and the plan says plainly that the quiet option is over it, by how much.
  await expect(page.getByText(/Nothing quiet fits the budget/)).toBeVisible();
  await page.getByText(/Other options/).click();
  await expect(page.getByText(/over budget with shipping/).first()).toBeVisible();
  await page.getByRole("button", { name: "Get the exact quote" }).click();
  await expect(page.getByRole("button", { name: /PayPal/ })).toBeVisible();
  await expect(page.locator('[data-tour="plan-quote"]')).toContainText(/\$\d+\.\d\d/);

  // Every main screen opens without an error state.
  for (const [path, heading] of [["/discover", /Show it, or say it/], ["/purchases", /What you bought/], ["/you", /What you have/], ["/guard", /Your rules for money/], ["/passport", /Your PayPal/], ["/safety", /second pair of eyes/i], ["/channels", /Messages/], ["/traces", /Every step/]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }), path).toContainText(heading);
    await expect(page.getByText(/Couldn.t load/), path).toHaveCount(0);
  }
});

test("display and help: larger text and higher contrast stick across pages and reloads", async ({ page }) => {
  await signIn(page, "shopper");
  await page.getByRole("button", { name: "Display and help" }).first().click();
  await page.getByRole("button", { name: "130%" }).click();
  await page.getByLabel("Higher contrast").click();
  await page.keyboard.press("Escape");
  await page.goto("/guard");
  await page.reload();
  const html = await page.evaluate(() => ({ contrast: document.documentElement.dataset.a11yContrast, size: getComputedStyle(document.documentElement).fontSize }));
  expect(html.contrast).toBe("high");
  expect(parseFloat(html.size)).toBeGreaterThan(16);
  await page.evaluate(() => localStorage.removeItem("a11y"));
});
