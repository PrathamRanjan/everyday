import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { resetDemo, signIn } from "./helpers";

const scan = async (page: import("@playwright/test").Page, label: string) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`);
  return bad;
};

for (const scheme of ["light", "dark"] as const) {
  test(`axe: no serious or critical WCAG 2.2 AA issues (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await resetDemo(page);
    const bad: string[] = [];
    for (const p of ["/", "/login", "/judge"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      bad.push(...(await scan(page, p)));
    }
    await signIn(page, "shopper");
    const plans = await (await page.request.get("/api/ui/plans")).json();
    for (const p of ["/today", "/discover", "/plans", plans.plans[0] ? `/plans/${plans.plans[0].id}` : "/plans", "/purchases", "/you", "/guard", "/passport", "/safety", "/channels", "/traces"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      bad.push(...(await scan(page, p)));
    }
    await page.request.post("/logout", { headers: { "x-everyday-ui": "1" } });
    await signIn(page, "merchant");
    for (const p of ["/merchant", "/merchant/money", "/merchant/approvals"]) {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      bad.push(...(await scan(page, p)));
    }
    expect(bad).toEqual([]);
  });
}
