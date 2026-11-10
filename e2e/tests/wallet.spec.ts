import { expect, test } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { resetDemo, signIn } from "./helpers";

// A2.1 acceptance: with no PayPal login, the demo shopper pays an exact quote from the demo's saved sandbox wallet and
// the order shows the real PayPal capture, read back. The ids are written out so scripts/pp-check.mts can confirm
// them against PayPal itself.
test("no-login payment: the demo shopper pays from the saved sandbox wallet and sees the PayPal capture", async ({ page }) => {
  await resetDemo(page);
  await signIn(page, "shopper");
  await page.goto("/plans");
  await page.getByLabel("What do you need?").fill("a wireless keyboard under $80 by Friday");
  await page.getByRole("button", { name: "Plan it" }).click();
  await page.waitForURL(/\/plans\/int_/);
  await page.getByRole("button", { name: "Get the exact quote" }).click();
  const wallet = page.getByRole("button", { name: /^Pay \$[\d.]+ as the demo shopper$/ });
  await expect(wallet).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay on PayPal's own page instead" })).toBeVisible();
  await expect(page.getByText(/pays at once from the demo's saved sandbox PayPal/)).toBeVisible();
  await wallet.click();
  await page.waitForURL(/\/orders\/ord_/, { timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/^Paid \$[\d.]+$/, { timeout: 30_000 });
  await expect(page.getByText(/Paid from the demo's saved sandbox wallet, with no PayPal login/)).toBeVisible();
  const capture = (await page.locator('[data-tour="order-status"] .id').first().textContent())?.trim() ?? "";
  expect(capture).toMatch(/^[A-Z0-9]{10,}$/);
  const orderId = new URL(page.url()).pathname.split("/").pop()!;
  const order = await (await page.request.get(`/api/ui/orders/${orderId}`)).json();
  expect(order.order).toMatchObject({ status: "paid", paid_via: "demo_wallet", capture_id: capture });
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/wallet-ids.json", JSON.stringify({ base: page.url(), order: order.order.paypal_order_id, capture }, null, 1));
});
