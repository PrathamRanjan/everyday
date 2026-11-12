import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

/**
 * The taste model in a real browser gives the lab's numbers: the browser embeds the same four listings (English,
 * Hindi, Indonesian, Portuguese) with transformers.js and must match the lab's raw embeddings (cosine ≥ 0.99) and
 * final scores (within 0.03), and put the four in the same order. Not exact: the 8-bit model runs on onnxruntime-web
 * here and onnxruntime-node in the lab, whose int8 kernels differ (measured 12 Nov: cosine 0.995–0.997, scores
 * within 0.016). Downloads ~118 MB from Hugging Face the first time, so it runs only when asked:
 * TASTE_PARITY=1 npx playwright test taste-parity
 */
const parity = JSON.parse(readFileSync(new URL("../../src/taste/parity.json", import.meta.url), "utf8"));
test.skip(!process.env.TASTE_PARITY, "set TASTE_PARITY=1 to download the model and check browser parity");

test("taste: the browser's embeddings and scores match the lab's", async ({ page }) => {
  test.setTimeout(600_000);
  await resetDemo(page);
  await signIn(page, "shopper");
  await page.goto("/plans");
  await page.locator('a[href^="/plans/"]').first().click();
  await page.waitForFunction(() => Boolean((window as any).__evTaste), null, { timeout: 30_000 });
  const got = await page.evaluate(async (p) => {
    const T = (window as any).__evTaste;
    const m = await T.loadTaste();
    const raw: number[][] = await T.embed(p.texts);
    const cos = raw.map((v: number[], i: number) => v.reduce((s: number, x: number, k: number) => s + x * p.raw[i][k], 0));
    const taste = T.tasteVec(m, p.history.map((h: any) => ({ v: raw[h.text], stars: h.stars })));
    const scores = raw.map((v: number[]) => T.dot(taste, T.itemVec(m, v)));
    return { cos, scores };
  }, parity);
  console.log("browser vs lab cosine", got.cos.map((x: number) => x.toFixed(5)).join(" "), "scores", got.scores.map((x: number) => x.toFixed(4)).join(" "), "lab", parity.scores.map((x: number) => x.toFixed(4)).join(" "));
  for (const c of got.cos) expect(c).toBeGreaterThan(0.99);
  got.scores.forEach((s: number, i: number) => expect(Math.abs(s - parity.scores[i])).toBeLessThan(0.03));
  const order = (xs: number[]) => xs.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]).join();
  expect(order(got.scores)).toBe(order(parity.scores));
});
