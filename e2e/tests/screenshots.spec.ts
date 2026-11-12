import { mkdirSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

/** docs/screenshots/<screen>-<width>-<scheme>.jpg for the main screens. Run on a freshly reset demo. */
const OUT = "../docs/screenshots";
const WIDTHS = [375, 768, 1440] as const;
const SCHEMES = ["light", "dark"] as const;

async function as(page: Page, who: "acc" | "mer") {
  const p = await (await page.request.get("/api/ui/personas")).json();
  const id = who === "acc" ? p.accounts[0].id : p.merchants[0].id;
  await page.request.post("/login", { form: { as: `${who}:${id}` }, headers: { "x-everyday-ui": "1" } });
}

test("screenshots", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  await resetDemo(page);
  // One realistic plan to show: the seeded desk-setup request, its one question answered.
  await as(page, "acc");
  const r = await page.request.post("/plans", { form: { text: "Help me set up a comfortable study desk by Friday for $350. I already own a monitor." }, headers: { "x-everyday-ui": "1" } });
  const planPath = (await r.json()).to as string;
  await page.request.post(`${planPath}/answer`, { form: { key: "laptop_port", value: "usb-c-dp" }, headers: { "x-everyday-ui": "1" } });
  const shopper = [["today", "/today"], ["plan", planPath], ["guard", "/guard"], ["you", "/you"], ["safety", "/safety"]] as const;
  const merchant = [["merchant", "/merchant"], ["merchant-approvals", "/merchant/approvals"]] as const;
  const open = [["landing", "/"], ["login", "/login"]] as const;

  for (const scheme of SCHEMES) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w < 600 ? 812 : w < 1000 ? 1024 : 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      const shot = async (name: string, path: string) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${name}-${w}-${scheme}.jpg`, type: "jpeg", quality: 78, animations: "disabled" });
      };
      await page.context().clearCookies();
      for (const [n, p] of open) await shot(n, p);
      await as(page, "acc");
      for (const [n, p] of shopper) await shot(n, p);
      await page.context().clearCookies();
      await as(page, "mer");
      for (const [n, p] of merchant) await shot(n, p);
    }
  }
  // The landing page in full, phone and desktop, light.
  await page.context().clearCookies();
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  for (const w of [375, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/landing-full-${w}-light.jpg`, type: "jpeg", quality: 72, fullPage: true, animations: "disabled" });
  }
});
