import { afterEach, beforeEach, expect, it } from "vitest";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { parseGoal } from "../src/services/plans.js";
import { searchProducts, setChannel3Fetch } from "../src/services/channel3.js";

// QC final pass: the planner plans what was asked for, and Channel3 v1 results are read correctly.
it("named items are planned, not replaced by the desk template", () => {
  const g = parseGoal("I need a keyboard and mouse for my desk, under $150", new Date("2026-11-10T00:00:00Z"));
  expect(g.goal).toBe("single");
  expect(g.categories).toEqual(expect.arrayContaining(["keyboard", "mouse"]));
  expect(g.categories).not.toContain("lamp");
  expect(parseGoal("help me set up my desk for long study sessions", new Date()).goal).toBe("desk_setup");
});

let db: Db;
const savedKey = config.channel3.apiKey;
beforeEach(async () => { db = await openDb({ memory: true }); setDb(db); config.channel3.apiKey = "test"; });
afterEach(async () => { setChannel3Fetch(null); config.channel3.apiKey = savedKey; await db.close(); });

it("Channel3 v1: calls /v1/search and reads brand, offer price, merchant domain and hero image", async () => {
  let calledUrl = "";
  setChannel3Fetch((async (url: string) => {
    calledUrl = url;
    return new Response(JSON.stringify({ products: [{ id: "x", title: "Logitech K585", brands: [{ id: "b", name: "Logitech" }], images: [{ url: "https://cdn.example/a.jpg", is_main_image: true }, { url: "https://cdn.example/b.jpg", cleaned_url: "https://cdn.example/b-clean.jpg", shot_type: "hero" }], offers: [{ url: "https://buy.example/k585", domain: "staples.com", price: { price: 29.99, currency: "USD" }, availability: "InStock" }] }] }), { status: 200 });
  }) as any);
  const r = await searchProducts("wireless keyboard", db);
  expect(calledUrl).toMatch(/\/v1\/search$/);
  expect(r.source).toBe("channel3");
  expect(r.results[0]).toMatchObject({ brand: "Logitech", price_cents: 2999, merchant: "staples.com", image: "https://cdn.example/b-clean.jpg", url: "https://buy.example/k585" });
});
