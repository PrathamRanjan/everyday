import { expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

/**
 * The guided story from the home page, done the way a judge does it: every button pressed by hand, both sides of the
 * demo, real PayPal sandbox payment and refund. A waiting step has no Next button; it moves on only when the thing
 * really happened (the server accepted the action, the app moved to the new page, or PayPal confirmed the refund).
 */
const bubble = (page: Page) => page.locator(".driver-popover");
const title = (page: Page, s: string, timeout = 45_000) => expect(bubble(page).locator(".driver-popover-title")).toHaveText(s, { timeout });
const next = (page: Page) => bubble(page).getByRole("button", { name: /^(Next|Finish)$/ }).click();
const role = (page: Page, r: "shopper" | "shop") => expect(page.locator("html")).toHaveAttribute("data-role", r, { timeout: 20_000 });

test("guided story: shopper and shop, every step by hand, moving on only when it really happened", async ({ page }) => {
  test.setTimeout(600_000);
  await resetDemo(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Two people use Everyday: a shopper and a shop" })).toBeVisible();
  await page.locator("#demo").getByRole("button", { name: /Start the guided demo/ }).click();

  await title(page, "You're Maya, a shopper");
  await role(page, "shopper");
  // Each step names what it's built on, and why it matters to a judge.
  await expect(bubble(page).locator(".ev-tag").first()).toBeVisible();
  await expect(bubble(page).locator(".ev-why")).toContainText("Impact");
  await next(page);
  await title(page, "First, Maya's own rules");
  await expect(page).toHaveURL(/\/guard$/);
  await next(page);

  await title(page, "Ask for something in a sentence");
  await expect(bubble(page).getByRole("button", { name: "Next" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Plan it/ }).first().click();
  await title(page, "The AI reads, with receipts", 120_000);
  await next(page);
  await title(page, "Code decides, and says why");
  await next(page);

  await title(page, "Lock the exact total");
  await page.getByRole("button", { name: /Get the exact quote/ }).first().click();
  await title(page, "Pay with PayPal");
  await page.getByRole("button", { name: /^Pay \$[\d.]+ as the demo shopper/ }).first().click();
  await title(page, "PayPal moved the money", 120_000);
  await expect(page).toHaveURL(/\/orders\/[\w-]+$/);
  await next(page);
  await title(page, "Then it looks after it");
  await next(page);

  // Switching sides: the shop, in moss.
  await title(page, "Now you're the shop");
  await role(page, "shop");
  await page.locator("[data-tour=ship]").first().click();
  await expect(bubble(page).locator(".ev-done")).toBeVisible({ timeout: 30_000 });
  await next(page);

  await title(page, "Money she can still get back");
  await role(page, "shopper");
  await page.locator("[data-tour=claim-drop]").first().click();

  await title(page, "The claim reaches the shop");
  await role(page, "shop");
  await page.locator("[data-tour=approve-case]").first().click();
  await title(page, "The shop has rules too");
  await next(page);

  // Only PayPal's own confirmation of the refund moves this one on.
  // PayPal can confirm within a second, so the bubble may already have moved on; the server's record is the proof.
  await title(page, "A second pair of eyes", 150_000);
  await role(page, "shopper");
  const j = await page.evaluate(() => fetch("/api/ui/journey").then((r) => r.json()));
  expect(j.done).toContain("refund_confirmed");

  await page.getByRole("button", { name: "Paste the demo scam" }).first().click();
  await page.getByRole("button", { name: "Check this message" }).first().click();
  await expect(bubble(page).locator(".ev-done")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Hold/).first()).toBeVisible();
  await next(page);

  await title(page, "Agents shop inside the same rules");
  await expect(page).toHaveURL(/\/agents$/);
  await next(page);
  await expect(bubble(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ev-journey"))).toBeNull();
});

test("the home page stays the front door, the old judge page opens the guided demo, and the header switches sides", async ({ page }) => {
  await resetDemo(page);
  // Signed in, "/" is still the landing page (no jump to Today).
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Buy the right thing once.");
  await page.goto("/judge");
  await expect(page).toHaveURL(/#demo$/);
  await expect(page.getByRole("heading", { name: "Play both sides. Press every button yourself." })).toBeVisible();
  await page.goto("/today");
  await role(page, "shopper");
  await page.getByRole("group", { name: "Which side of the demo you're on" }).getByRole("button", { name: /Northlight/ }).click();
  await page.waitForURL(/\/merchant$/);
  await role(page, "shop");
  await page.getByRole("group", { name: "Which side of the demo you're on" }).getByRole("button", { name: /Maya/ }).click();
  await page.waitForURL(/\/today$/);
  await role(page, "shopper");
});
