import { expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

test("judge page: a path ticks itself from what really happened, and no tour starts on its own", async ({ page }) => {
  await resetDemo(page);
  await page.goto("/?tour=judge");
  await page.waitForLoadState("networkidle");
  // A3.3: an old tour link just opens the page.
  await expect(page.locator(".driver-popover")).toHaveCount(0);
  await page.goto("/judge");
  const scam = page.locator("section", { has: page.getByRole("heading", { name: "Check a scam message" }) });
  await expect(scam).toContainText("0 of 2 done");
  // The buy path is not ticked by the demo's own seed purchases.
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Ask for something and buy it" }) })).toContainText("0 of 3 done");
  await scam.getByRole("link", { name: /Open/ }).first().click();
  await page.waitForURL(/\/safety$/);
  await page.getByRole("button", { name: "Paste the demo scam" }).first().click();
  await page.getByRole("button", { name: "Check this message" }).first().click();
  await expect(page.getByText(/Hold/).first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/judge");
  await expect(page.locator("section", { has: page.getByRole("heading", { name: "Check a scam message" }) })).toContainText("2 of 2 done", { timeout: 15_000 });
  await expect(page.getByRole("table").first()).toContainText(/PayPal orders and captures/);
});

test("take the tour button starts the shopper tour", async ({ page }) => {
  await resetDemo(page);
  await page.goto("/login");
  await page.getByRole("button", { name: /Continue as Maya/ }).click();
  await page.waitForURL(/\/today$/);
  await page.getByRole("button", { name: /Take the tour/ }).first().click();
  await expect(page.locator(".driver-popover")).toBeVisible();
});
