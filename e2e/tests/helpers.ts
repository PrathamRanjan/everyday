import { expect, type Page } from "@playwright/test";

/** Reload the seeded demo (Maya, Northlight, catalog, history) and sign everyone out. */
export async function resetDemo(page: Page) {
  const r = await page.request.post("/demo/reset", { headers: { "x-everyday-ui": "1" } });
  expect(r.ok()).toBeTruthy();
}

export async function signIn(page: Page, who: "shopper" | "merchant") {
  await page.goto("/login");
  await page.getByRole("button", { name: who === "shopper" ? /Continue as Maya/ : /Open the merchant console/ }).click();
  await page.waitForURL(who === "shopper" ? /\/today$/ : /\/merchant$/);
}
