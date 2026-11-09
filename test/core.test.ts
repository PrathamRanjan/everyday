import { describe, expect, it } from "vitest";
import { recallMatches, repairOrReplace, returnEligibility } from "../src/core/after.js";
import { check } from "../src/core/constraints.js";
import { report } from "../src/core/experiment.js";
import { plan } from "../src/core/planner.js";
import { changes, featurize, mask, update, zeros, FEATURES, PRICE } from "../src/core/prefs.js";
import { hybrid } from "../src/core/retrieve.js";
import { normalizeLink } from "../src/core/url.js";
import { NORTHLIGHT } from "../src/services/catalog-data.js";

describe("links", () => {
  it.each([
    ["https://www.instagram.com/reel/Cz9DeskReel/?igsh=x", "instagram", "https://www.instagram.com/reel/Cz9DeskReel/"],
    ["https://www.tiktok.com/@deskdays/video/7300000000000000001?lang=en", "tiktok", "https://www.tiktok.com/video/7300000000000000001"],
    ["https://youtube.com/shorts/dSk7Setup01?si=abc", "youtube", "https://youtube.com/shorts/dSk7Setup01"],
    ["https://www.youtube.com/watch?v=dSk7Setup01", "youtube", "https://youtube.com/shorts/dSk7Setup01"],
    ["https://youtu.be/dSk7Setup01", "youtube", "https://youtube.com/shorts/dSk7Setup01"],
  ])("%s", (url, platform, canonical) => {
    expect(normalizeLink(url)).toMatchObject({ platform, canonical });
  });
  it("flags TikTok short links as needing resolution and rejects junk", () => {
    expect(normalizeLink("https://vm.tiktok.com/ZMabc123/")).toMatchObject({ platform: "tiktok", short_link: true });
    expect(normalizeLink("not a link")).toBeNull();
  });
});

const docs = NORTHLIGHT.map((p) => ({ id: p.sku, model: p.model, text: `${p.title} ${p.brand} ${p.model} ${p.category.replace("_", " ")} ${p.description} ${p.attrs.finish ?? ""} ${p.attrs.material ?? ""} ${(p.attrs.style ?? []).join(" ")}` }));
/** Authored judged queries: model numbers, paraphrases, typos. */
const JUDGED: [string, string[]][] = [
  ["P2422H", ["NL-MON-P2422H"]],
  ["EM-500", ["NL-CHAIR-ERGO"]],
  ["LD-7 dock", ["NL-DOCK-7IN1"]],
  ["oak desk lamp", ["NL-LAMP-HALDEN-OAK", "NL-LAMP-ORBIT"]],
  ["warm wooden light for my desk", ["NL-LAMP-HALDEN-OAK"]],
  ["mesh office chair with lumbar support", ["NL-CHAIR-ERGO", "NL-CHAIR-ERGO-LITE", "NL-CHAIR-AERO"]],
  ["ergonmic chiar", ["NL-CHAIR-ERGO", "NL-CHAIR-ERGO-LITE", "NL-CHAIR-AERO"]],
  ["usb c hub with hdmi", ["NL-DOCK-7IN1", "NL-DOCK-PRO"]],
  ["thunderbolt docking station", ["NL-DOCK-TB4"]],
  ["quiet keyboard", ["NL-KB-QUIET", "NL-KB-OAK"]],
  ["silent wireless mouse", ["NL-MOUSE-OAK"]],
  ["vertical mouse for wrist pain", ["NL-MOUSE-VERT"]],
  ["monitor arm vesa 100", ["NL-ARM-LIFT", "NL-ARM-OAK"]],
  ["cork mat", ["NL-MAT-CORK"]],
  ["noise cancelling headphones", ["NL-HP-QUIET"]],
  ["webcam with privacy shutter", ["NL-CAM-HD"]],
  ["colourful rgb light", ["NL-LAMP-PIXEL"]],
  ["clamp lamp for small desk", ["NL-LAMP-BRITE"]],
  ["27 inch usb-c monitor", ["NL-MON-VIEW27"]],
  ["keybaord oak", ["NL-KB-OAK"]],
];

function recallAt(k: number, f: (q: string) => { id: string }[]) {
  let hit = 0;
  for (const [q, rel] of JUDGED) {
    const top = f(q).slice(0, k).map((x) => x.id);
    hit += rel.filter((r) => top.includes(r)).length / rel.length;
  }
  return Math.round((hit / JUDGED.length) * 1000) / 1000;
}

describe("retrieval (20 judged queries)", () => {
  it("fusion is at least as good as either retriever and exact model numbers rank first", () => {
    const h = hybrid(docs);
    const r = { bm25: recallAt(5, h.bm25), trigram: recallAt(5, h.trigram), fused: recallAt(5, (q) => h.fused(q)) };
    console.log(`retrieval Recall@5 over ${JUDGED.length} judged queries:`, r);
    expect(r.fused).toBeGreaterThanOrEqual(Math.max(r.bm25, r.trigram) - 0.02);
    expect(r.fused).toBeGreaterThanOrEqual(0.85);
    expect(h.fused("P2422H")[0].id).toBe("NL-MON-P2422H");
    expect(h.fused("ergonmic chiar").slice(0, 3).map((x) => x.id)).toContain("NL-CHAIR-ERGO");
  });
});

describe("preference model", () => {
  const oak = NORTHLIGHT.find((p) => p.sku === "NL-LAMP-HALDEN-OAK")!;
  const black = NORTHLIGHT.find((p) => p.sku === "NL-LAMP-HALDEN-BLK")!;
  const x = (p: typeof oak) => featurize({ attrs: p.attrs, price_cents: p.price * 100 }, 4900);
  it("a style choice moves the right features and is bounded", () => {
    const w = update(zeros(), zeros(), x(oak), x(black), 1, mask("style")!);
    expect(w[FEATURES.indexOf("finish:wood")]).toBeGreaterThan(0);
    expect(w[FEATURES.indexOf("finish:black")]).toBeLessThan(0);
    expect(Math.max(...w.map(Math.abs))).toBeLessThanOrEqual(0.8);
    expect(changes(zeros(), w)[0]).toMatch(/weight on (wood|black)|real wood|metal/);
  });
  it("'too expensive' only teaches price; 'already own' teaches nothing", () => {
    const w = update(zeros(), zeros(), x(oak), x(black), 1, mask("too_expensive")!);
    expect(w.filter((v, i) => i !== PRICE && v !== 0)).toEqual([]);
    expect(mask("already_own")).toBeNull();
    expect(mask("wrong_recipient")).toBeNull();
  });
  it("evaluation: personalisation beats global and popularity beyond seed noise (synthetic shoppers)", () => {
    const r = report([1, 2, 3]);
    console.log("NDCG@3", { popularity: r.popularity, global: r.global, personal: r.personal, gain_at_5: r.gain_at_5 });
    expect(r.personal[5].mean).toBeGreaterThan(r.global.mean);
    expect(r.global.mean).toBeGreaterThan(r.popularity.mean - 0.05);
    expect(r.promote_personal).toBe(true);
    expect(r.data).toMatch(/SYNTHETIC/);
  });
});

const ctx = { laptop_port: "usb-c-dp" as const, monitor: { title: "Dell P2422H", inputs: ["hdmi", "dp"], vesa: 100 }, require_ergonomic: true, owned_categories: new Map([["monitor", "Dell P2422H"]]), replace_categories: new Set<string>() };
const P = (sku: string) => NORTHLIGHT.find((p) => p.sku === sku)!;
const C = (sku: string, c = ctx as any) => check({ category: P(sku).category, attrs: P(sku).attrs, stock: P(sku).stock, checkout: true }, c);

describe("constraints", () => {
  it("explains each exclusion and keeps unknowns unknown", () => {
    expect(C("NL-HUB-4IN1").reasons).toEqual(["no video output, so it cannot drive your monitor"]);
    expect(C("NL-DOCK-TB4").reasons[0]).toMatch(/needs Thunderbolt; your laptop has USB-C with video/);
    expect(C("NL-DOCK-7IN1").ok).toBe(true);
    expect(C("NL-ARM-MINI").reasons).toEqual(["fits VESA 75; your monitor is VESA 100"]);
    expect(C("NL-CHAIR-NORDIC").reasons).toEqual(["no adjustable lumbar support (you asked for comfort)"]);
    expect(C("NL-MON-VIEW27").reasons).toEqual(["you already own Dell P2422H"]);
    expect(C("NL-DOCK-7IN1", { ...ctx, laptop_port: null })).toMatchObject({ ok: false, reasons: [], unknown: ["which port your laptop has"] });
  });
});

const ship = { standard_cents: 1200, free_over_cents: 30000, standard_days: 2, express_cents: 1500, express_days: 1 };
describe("planner", () => {
  const c = (id: string, slot: string, price: number, utility: number, delay = 0) => ({ id, slot, title: id, price_cents: price, utility, delay_days: delay });
  const slots = [{ key: "lamp", label: "Lamp", required: true }, { key: "chair", label: "Chair", required: true }];
  it("picks the best complete bundle, not the best item per slot", () => {
    const r = plan({ slots, cands: { lamp: [c("L1", "lamp", 8900, 1.0), c("L2", "lamp", 4900, 0.8)], chair: [c("C1", "chair", 18900, 1.0), c("C2", "chair", 16900, 0.2)] }, budget_cents: 25000, days_available: 4, shipping: ship });
    expect([r.picks.lamp?.id, r.picks.chair?.id]).toEqual(["L2", "C1"]);
    expect(r.total_cents).toBe(4900 + 18900 + 1200);
  });
  it("uses express only when standard would miss the deadline, and explains a gap", () => {
    const r = plan({ slots, cands: { lamp: [c("L2", "lamp", 4900, 0)], chair: [c("C1", "chair", 18900, 0)] }, budget_cents: 30000, days_available: 1, shipping: ship });
    expect(r).toMatchObject({ feasible: true, shipping: "express", days: 1 });
    const g = plan({ slots, cands: { lamp: [c("L2", "lamp", 4900, 0)], chair: [c("C1", "chair", 18900, 0)] }, budget_cents: 20000, days_available: 4, shipping: ship });
    expect(g.gap).toMatch(/short \$50.00/);
    const late = plan({ slots, cands: { lamp: [c("L2", "lamp", 4900, 0)], chair: [c("C1", "chair", 18900, 0, 5)] }, budget_cents: 40000, days_available: 3, shipping: ship });
    expect(late.gap).toMatch(/needs 6 working day/);
  });
});

describe("after purchase", () => {
  const pol = { window_days: 30, restock_pct: 10, final_sale_when_opened: ["headphones"], version: "v" };
  const d = new Date("2026-11-13T10:00:00Z");
  it("return eligibility: window, fees and exceptions", () => {
    expect(returnEligibility(pol, { category: "lamp", price_cents: 4900, delivered_at: d, opened: true }, "damaged", new Date("2026-11-20T00:00:00Z"))).toMatchObject({ eligible: true, fee_cents: 0 });
    expect(returnEligibility(pol, { category: "lamp", price_cents: 4900, delivered_at: d, opened: true }, "change_of_mind", new Date("2026-11-20T00:00:00Z"))).toMatchObject({ eligible: true, fee_cents: 490 });
    expect(returnEligibility(pol, { category: "headphones", price_cents: 9900, delivered_at: d, opened: true }, "change_of_mind", new Date("2026-11-20T00:00:00Z")).eligible).toBe(false);
    expect(returnEligibility(pol, { category: "lamp", price_cents: 4900, delivered_at: d, opened: false }, "damaged", new Date("2026-12-20T00:00:00Z")).eligible).toBe(false);
  });
  it("repair or replace, and recall matching", () => {
    const now = new Date("2027-06-01T00:00:00Z");
    expect(repairOrReplace({ category: "chair", price_cents: 18900, acquired: new Date("2026-11-13T00:00:00Z"), warranty_until: new Date("2029-11-13T00:00:00Z"), repair_quote_cents: 5000, now }).decision).toBe("warranty");
    expect(repairOrReplace({ category: "mouse", price_cents: 2900, acquired: new Date("2024-01-01T00:00:00Z"), warranty_until: null, repair_quote_cents: 2000, now }).decision).toBe("replace");
    expect(repairOrReplace({ category: "chair", price_cents: 18900, acquired: new Date("2025-01-01T00:00:00Z"), warranty_until: null, repair_quote_cents: 3000, now }).decision).toBe("repair");
    expect(recallMatches([{ brand: "Hush", model: "H-ANC", title: "x" }], [{ brand: "Hush", model: "H-ANC", title: "r", remedy: "m", url: "u" }])).toHaveLength(1);
  });
});
