import { expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

test("judge tour: starts from the link, survives navigation and a reload, and stops at the live PayPal step", async ({ page }) => {
  await resetDemo(page);
  await page.goto("/?tour=judge");
  const pop = page.locator(".driver-popover");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".driver-popover-progress-text")).toHaveText(/1 of \d+/);
  const titles: string[] = [];
  for (let i = 0; i < 5; i++) {
    titles.push((await pop.locator(".driver-popover-title").innerText()).trim());
    await pop.locator(".driver-popover-next-btn").click();
    await expect(pop.locator(".driver-popover-progress-text")).toHaveText(new RegExp(`${i + 2} of`));
  }
  // A reload mid-tour picks up the same step.
  const before = await pop.locator(".driver-popover-title").innerText();
  await page.reload();
  await expect(page.locator(".driver-popover .driver-popover-title")).toHaveText(before);
  expect(before).toMatch(/PayPal/);
  expect(titles.length).toBe(5);
  const state = await page.evaluate(() => JSON.parse(sessionStorage.getItem("ev-tour") ?? "{}"));
  expect(state.kind).toBe("judge");
});

test("take the tour button starts the shopper tour", async ({ page }) => {
  await resetDemo(page);
  await page.goto("/login");
  await page.getByRole("button", { name: /Continue as Maya/ }).click();
  await page.waitForURL(/\/today$/);
  await page.getByRole("button", { name: /Take the tour/ }).first().click();
  await expect(page.locator(".driver-popover")).toBeVisible();
});
