import { afterEach, beforeEach, expect, it } from "vitest";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { setProviderFetch } from "../src/ai/provider.js";
import { seedAll } from "../src/services/seed.js";
import { readReceipt, SAMPLE_RECEIPT, saveReceipt } from "../src/services/receipts.js";
import { accountById } from "../src/store.js";

// B6: receipts in. The model reads; code keeps only values it can find on the receipt and works out the dates.
let db: Db;
const saved = { provider: config.ai.provider, key: config.ai.openaiKey };
const fake = (output: unknown) =>
  setProviderFetch((async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: body.model, usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }), { status: 200 });
  }) as typeof fetch);
beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  config.ai.provider = "openai";
  config.ai.openaiKey = "test-key";
});
afterEach(async () => {
  setProviderFetch(null);
  config.ai.provider = saved.provider;
  config.ai.openaiKey = saved.key;
  await db.close();
});

it("keeps what the receipt says and drops what it doesn't", async () => {
  fake({
    transcript: "",
    merchant: "BrightDesk", merchant_quote: "BrightDesk order BD-20419",
    purchase_date: "2026-11-03", date_quote: "placed 3 November 2026",
    return_days: 30, return_quote: "within 30 days of delivery",
    lines: [
      { title: "Keyron K3 Wireless Mechanical Keyboard", title_quote: "Keyron K3 Wireless Mechanical Keyboard", category: null, price_seen: 74.99, price_quote: "$74.99", warranty_years: 2, warranty_quote: "2-year manufacturer warranty" },
      { title: "Lumio Clip-on Monitor Light Bar", title_quote: "Lumio Clip-on Monitor Light Bar", category: null, price_seen: 39, price_quote: "$39.00", warranty_years: 3, warranty_quote: "3-year warranty" },
      { title: "Free mouse", title_quote: "Free wireless mouse included", category: null, price_seen: null, price_quote: null, warranty_years: null, warranty_quote: null },
    ],
  });
  const r = await readReceipt({ text: SAMPLE_RECEIPT });
  expect(r).toMatchObject({ merchant: "BrightDesk", purchase_date: "2026-11-03", return_days: 30 });
  expect(r.lines.map((l) => l.title)).toEqual(["Keyron K3 Wireless Mechanical Keyboard", "Lumio Clip-on Monitor Light Bar"]);
  expect(r.lines[0]).toMatchObject({ price_cents: 7499, warranty_years: 2 });
  // The light bar's "3-year warranty" isn't on the receipt, so it is dropped, as is the invented mouse.
  expect(r.lines[1]).toMatchObject({ price_cents: 3900, warranty_years: null });
  expect(r.dropped).toBe(2);
});

it("says so when there is no model, and saves typed lines with their dates", async () => {
  config.ai.openaiKey = "";
  await expect(readReceipt({ text: "1 x lamp $20" })).rejects.toThrow(/Fill in the item yourself/);
  const s = await seedAll();
  const a = await accountById(db, s.account);
  const out = await saveReceipt(a, [{ title: "Desk lamp", category: null, price_cents: 2000, purchase_date: "2026-11-01", merchant: "Elsewhere", return_days: 30, warranty_years: 2 }], "manual");
  expect(out.items[0]).toEqual({ title: "Desk lamp", return_until: "2026-12-01", warranty_until: "2028-11-01" });
  const row = (await db.query<any>("SELECT source, category, price_cents FROM owned_items WHERE id = $1", [out.ids[0]])).rows[0];
  expect(row).toMatchObject({ source: "receipt (typed by you)", category: "other", price_cents: 2000 });
  await expect(saveReceipt(a, [{ title: "Later", category: null, price_cents: null, purchase_date: "2099-01-01", merchant: null, return_days: null, warranty_years: null }], "manual")).rejects.toThrow(/not in the future/);
});
