import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

test("merchant: orders, money and the refund mandate", async ({ page }) => {
  await resetDemo(page);
  await signIn(page, "merchant");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Orders to look after");
  await page.goto("/merchant/money");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("What PayPal says");
  await page.goto("/merchant/approvals");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("refund mandate");
  // A shopper-only screen is not the merchant's.
  const r = await page.request.get("/api/ui/today");
  expect(r.status()).toBeGreaterThanOrEqual(400);
});
