import { expect, type Page } from "@playwright/test";

/**
 * A1: start a fresh private demo workspace for this browser (signs in as its Maya) and wait for the seed's
 * sandbox payments to finish. The operator key, when set, lifts the per-address start limit for test runs.
 */
export async function resetDemo(page: Page) {
  const headers: Record<string, string> = { "x-everyday-ui": "1", ...(process.env.EV_ADMIN_KEY ? { "x-everyday-operator": process.env.EV_ADMIN_KEY } : {}) };
  const r = await page.request.post("/demo/start", { form: { fresh: "1" }, headers });
  expect(r.ok()).toBeTruthy();
  expect((await r.json()).err ?? null).toBeNull();
  for (let i = 0; i < 90; i++) {
    const w = (await (await page.request.get("/api/ui/workspace")).json()).workspace;
    if (w?.progress?.finished) return w;
    await page.waitForTimeout(1000);
  }
  throw new Error("The demo's seed payments did not finish in 90 seconds");
}

export async function signIn(page: Page, who: "shopper" | "merchant") {
  // The persona buttons only exist inside a private demo; a browser without one starts one first.
  if (!(await (await page.request.get("/api/ui/workspace")).json()).workspace) await resetDemo(page);
  await page.goto("/login");
  await page.getByRole("button", { name: who === "shopper" ? /Continue as Maya/ : /Open the merchant console/ }).click();
  await page.waitForURL(who === "shopper" ? /\/today$/ : /\/merchant$/);
}
