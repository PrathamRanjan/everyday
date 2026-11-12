import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

/**
 * A: hands-free in a real browser, with Chromium's fake camera (a test pattern, no face). What this proves: the face
 * tracker's runtime and model load from this site, the camera chip shows, no face for two seconds stops it, Esc and
 * the Stop button stop it, voice-only needs no camera, and targets grow to 44 px. What it can't: how well a real
 * person's eyes are read (no face here), and real speech.
 */
test.use({ launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }, permissions: ["camera", "microphone"] });

test("hands-free: tracker loads, the camera chip shows, and every stop works", async ({ page }) => {
  test.setTimeout(180_000);
  // What the page showed, recorded as it happens (the tracker's start-up can keep the page busy for a moment).
  await page.addInitScript(() => {
    const seen: string[] = ((window as any).__hf = []);
    new MutationObserver(() => {
      const mode = document.documentElement.getAttribute("data-handsfree");
      const cam = document.querySelector("[data-testid=camera-on]") ? "camera" : "";
      const k = `${mode ?? ""}|${cam}`;
      if (seen[seen.length - 1] !== k) seen.push(k);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-handsfree"] });
  });
  const stops: string[] = [];
  page.on("console", (m) => m.text().startsWith("[hands-free] stopped:") && stops.push(m.text()));
  await resetDemo(page);
  await signIn(page, "shopper");
  const wasm = page.waitForResponse((r) => r.url().includes("/mediapipe/") && r.url().endsWith(".wasm"), { timeout: 60_000 });
  const model = page.waitForResponse((r) => r.url().includes("/models/face_landmarker.task"), { timeout: 60_000 });
  await page.getByTestId("handsfree-toggle").click();
  await page.getByTestId("handsfree-head").click();
  expect((await wasm).status()).toBe(200);
  expect((await model).status()).toBe(200);
  // The fake camera shows no face: after two seconds it stops by itself, and the camera goes off.
  await expect.poll(() => stops.join(" "), { timeout: 30_000 }).toMatch(/no face in view for two seconds/);
  expect(await page.evaluate(() => (window as any).__hf)).toContain("head|camera");
  await expect(page.getByTestId("camera-on")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-handsfree", /.+/);

  // Voice only: no camera chip; targets grow; Esc stops.
  await page.getByTestId("handsfree-toggle").click();
  await page.getByTestId("handsfree-voice").click();
  await expect(page.getByTestId("handsfree-stop")).toBeVisible();
  await expect(page.getByTestId("camera-on")).toHaveCount(0);
  const h = await page.getByRole("link").first().evaluate((el) => parseFloat(getComputedStyle(el).minHeight));
  expect(h).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("handsfree-stop")).toHaveCount(0);

  // The Stop button, and the shortcut.
  await page.keyboard.press("Alt+Shift+KeyH");
  await expect(page.getByTestId("handsfree-stop")).toBeVisible();
  await page.getByTestId("handsfree-stop").click();
  await expect(page.getByTestId("handsfree-stop")).toHaveCount(0);
});

test("hands-free: a voice step that moves money asks for confirm first (server router)", async ({ page }) => {
  await resetDemo(page);
  await signIn(page, "shopper");
  const say = (body: Record<string, unknown>) => page.request.post("/api/ui/handsfree/command", { data: { run: "e2e", ...body }, headers: { "x-everyday-ui": "1" } });
  const first = await (await say({ text: "claim my price drop" })).json();
  // The demo starts with one price drop to claim.
  expect(first.confirm?.action).toBe("claim");
  expect(first.say).toMatch(/Say “confirm”/);
  expect((await say({ text: "maybe", confirm_token: first.confirm.token })).status()).toBe(400);
  const done = await (await say({ text: "confirm", confirm_token: first.confirm.token })).json();
  expect(done.done).toBe("claim");
  expect((await say({ text: "confirm", confirm_token: first.confirm.token })).status()).toBe(403);
});
