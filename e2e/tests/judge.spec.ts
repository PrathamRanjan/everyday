import { expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

test("judge tour: starts from the link, survives navigation and a reload, and stops at the live PayPal step", async ({ page }) => {
  await resetDemo(page);
  await page.goto("/?tour=judge");
  const pop = page.locator(".driver-popover");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".driver-popover-progress-text")).toHaveText(/1 of \d+/);
  const titles: string[] = [];
  const next = async (n: number) => {
    titles.push((await pop.locator(".driver-popover-title").innerText()).trim());
    await pop.locator(".driver-popover-next-btn").click();
    await expect(pop.locator(".driver-popover-progress-text")).toHaveText(new RegExp(`^${n} of`));
  };
  await next(2);
  await next(3);
  // Stop 2 hands the judge the form and waits for a real plan.
  await expect(pop.locator(".driver-popover-title")).toHaveText(/Say it in a sentence/);
  await pop.locator(".driver-popover-next-btn").click();
  await expect(pop).toBeHidden();
  await page.getByLabel("What do you need?").fill("A quiet mouse under $45 by Thursday");
  await page.getByRole("button", { name: "Plan it" }).click();
  await page.waitForURL(/\/plans\/int_/);
  await expect(pop.locator(".driver-popover-progress-text")).toHaveText(/^4 of/);
  await expect(pop).not.toContainText(/isn't on screen yet/);
  await next(5);
  await next(6);
  // A reload mid-tour picks up the same step.
  const before = await pop.locator(".driver-popover-title").innerText();
  await page.reload();
  await expect(page.locator(".driver-popover .driver-popover-title")).toHaveText(before);
  expect(before).toMatch(/PayPal/);
  expect(titles.length).toBe(4);
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
