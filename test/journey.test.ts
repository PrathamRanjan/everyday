import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { seed, type Seeded } from "../src/services/seed.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";
import { FOUNDATION_ROUTES } from "./foundation-routes.js";

// Acceptance journey: the shopper (app and Telegram) and the merchant end to end over HTTP: capture,
// compatible plan, taste, quote, PayPal, backorder swap, damage case, price protection, a dropped return
// repaired from the console, owned items and memory controls, the price watch and the demo controls.
// It fails if any route is never used or any request returns a 5xx.
let db: Db;
let fake: FakePayPal;
let srv: Awaited<ReturnType<typeof serveTracked>>;
let base: string;
let s: Seeded;
const SECRET = "test-webhook-secret";
const CHAT = 777001;

const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0];
const all = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows;
const ok = (r: { status: number; location: string | null }) => {
  expect(r.status, r.location ?? "").toBe(302);
  expect(decodeURIComponent(r.location ?? "")).not.toMatch(/[?&]err=/);
  return r;
};
const err = (r: { location: string | null }) => decodeURIComponent(new URL(r.location!, base).searchParams.get("err") ?? "");
const prod = (sku: string) => s.products[sku];
const tg = (body: unknown) => fetch(`${base}/c/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET }, body: JSON.stringify(body) });
const msg = (text: string) => ({ update_id: Date.now(), message: { message_id: 1, chat: { id: CHAT, type: "private" }, text } });
const plan = async (intentId: string) => (await one("SELECT body FROM plans WHERE intent_id = $1 AND status IN ('current','ordered') ORDER BY version DESC LIMIT 1", [intentId])).body;

beforeEach(async () => {
  config.telegram.webhookSecret = SECRET;
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  setPayPal(fake);
  s = await db.tx((q) => seed(q, { anchor: "2026-11-09T09:00" }));
  srv = await serveTracked(createApp());
  base = srv.base;
});
afterEach(async () => {
  await srv.close();
  setPayPal(null);
  await db.close();
});

describe("Everyday acceptance journey", () => {
  it("shopper and merchant through every feature, with no route unused and no server error", async () => {
    const anon = new Client(base);
    for (const u of ["/healthz", "/login", "/demo"]) expect((await anon.get(u)).status, u).toBe(200);
    expect((await anon.get("/")).status).toBeLessThan(400);
    // A shopper coming back from PayPal without a session signs in and lands where they were going.
    expect((await anon.get("/login?next=/purchases")).text).toMatch(/name="as" value="acc:[^"]+"><input type="hidden" name="next" value="\/purchases"/);
    const back = new Client(base);
    expect((await back.post("/login", { as: `acc:${s.account}`, next: "/purchases" })).location).toBe("/purchases");
    const maya = new Client(base);
    ok(await maya.post("/login", { as: `acc:${s.account}` }));
    const nl = new Client(base);
    ok(await nl.post("/login", { as: `mer:${s.merchant}` }));
    for (const u of ["/today", "/discover", "/plans", "/purchases", "/you", "/console", "/telegram"]) expect((await maya.get(u)).status, u).toBe(200);
    expect((await nl.get("/merchant")).status).toBe(200);

    // Telegram: link with a code from You, then share a clip through the simulator (same webhook a bot uses).
    const code = new URL((await maya.post("/you/telegram")).location!, base).searchParams.get("code")!;
    await tg(msg(`/start ${code}`));
    expect((await maya.post("/telegram/send", { chat: String(CHAT), text: "look at this https://youtube.com/shorts/dSk7Setup01?si=abc" })).status).toBe(302);
    const cap = await one("SELECT * FROM captures");
    expect(cap).toMatchObject({ platform: "youtube", channel: "telegram" });
    expect((await maya.get(`/telegram?chat=${CHAT}`)).text).toMatch(/Which item do you mean/);
    expect((await maya.get(`/captures/${cap.id}`)).text).toMatch(/Which item do you mean/);
    ok(await maya.post(`/captures/${cap.id}/select`, { key: "lamp" }));
    // An app capture of the same link is recognised as already saved.
    expect((await maya.post("/discover/capture", { url: "https://www.youtube.com/watch?v=dSk7Setup01" })).status).toBe(302);
    expect(await all("SELECT id FROM captures")).toHaveLength(1);

    // Goal → plan → the one question → taste choice → quote → PayPal.
    ok(await maya.post("/plans", { capture_id: cap.id, text: "Help me create this comfortable study setup by Friday for $350. I already own a monitor." }));
    const intent = await one("SELECT * FROM intents ORDER BY created_at DESC LIMIT 1");
    expect(intent).toMatchObject({ budget_cents: 35000, goal: "desk_setup" });
    expect((await maya.get(`/plans/${intent.id}`)).text).toMatch(/One question|How does your laptop connect/);
    ok(await maya.post(`/plans/${intent.id}/answer`, { key: "laptop_port", value: "usb-c-dp" }));
    ok(await maya.post(`/plans/${intent.id}/choose`, { a: prod("NL-CHAIR-ERGO"), b: prod("NL-CHAIR-ERGO-LITE"), chosen: "a" }));
    ok(await maya.post(`/plans/${intent.id}/choose`, { a: prod("NL-LAMP-HALDEN-OAK"), b: prod("NL-LAMP-ORBIT"), chosen: "a" }));
    ok(await maya.post(`/plans/${intent.id}/quote`));
    const quote = await one("SELECT * FROM quotes WHERE status = 'open'");
    const ap = await maya.post(`/quotes/${quote.id}/approve`, { hash: quote.hash });
    const token = new URL(ap.location!).searchParams.get("token")!;
    const order = await one("SELECT * FROM orders WHERE quote_id = $1", [quote.id]);
    // The browser closes before returning (failure lab); the console reconciler records the payment once.
    ok(await maya.post("/console/fault", { f: "drop_return" }));
    fake.approveOrder(token);
    await maya.get(`/orders/${order.id}/paypal/return?token=${token}`);
    expect((await one("SELECT status FROM orders WHERE id = $1", [order.id])).status).not.toBe("paid");
    ok(await maya.post("/console/run"));
    expect((await one("SELECT status FROM orders WHERE id = $1", [order.id])).status).toBe("paid");
    expect(fake.captures.size).toBe(1);
    // Paying again from the order page is refused: it is already paid.
    expect(err(await maya.post(`/orders/${order.id}/pay`))).toBeTruthy();
    expect((await maya.get(`/orders/${order.id}`)).status).toBe(200);

    // Merchant: the chair is backordered past Friday; Maya swaps to the in-stock equivalent and gets $20 back.
    const chair = await one("SELECT * FROM order_lines WHERE order_id = $1 AND slot = 'chair'", [order.id]);
    ok(await nl.post(`/merchant/lines/${chair.id}/backorder`, { days: "4" }));
    ok(await maya.post(`/lines/${chair.id}/swap`));
    expect([...fake.refunds.values()].map((r) => r.amount?.value)).toEqual(["20.00"]);
    for (const l of await all("SELECT * FROM order_lines WHERE order_id = $1 AND status = 'ordered'", [order.id])) {
      ok(await nl.post(`/merchant/lines/${l.id}/ship`));
      ok(await nl.post(`/merchant/lines/${l.id}/deliver`, { note: "left at front desk" }));
    }
    expect((await one("SELECT status FROM orders WHERE id = $1", [order.id])).status).toBe("delivered");

    // Damage: the lamp arrived scuffed; Maya keeps it for a partial refund the merchant approves.
    const lamp = await one("SELECT * FROM order_lines WHERE order_id = $1 AND slot = 'lamp'", [order.id]);
    ok(await maya.post(`/lines/${lamp.id}/case`, { issue: "damaged", claim: "Scuffed base", photo: "1" }));
    const c = await one("SELECT * FROM cases WHERE issue = 'damaged'");
    ok(await maya.post(`/cases/${c.id}/remedy`, { key: "partial" }));
    ok(await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "Sorry about that" }));
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("resolved");

    // Price protection: the dock's price drops; Maya claims the difference under the policy she bought with.
    const dock = await one("SELECT * FROM order_lines WHERE order_id = $1 AND slot = 'dock'", [order.id]);
    ok(await nl.post(`/merchant/products/${dock.product_id}/price`, { price: ((dock.unit_cents - 1000) / 100).toFixed(2) }));
    ok(await maya.post(`/lines/${dock.id}/price-protection`));
    const pp = await one("SELECT * FROM cases WHERE issue = 'price_drop'");
    expect(pp).toMatchObject({ status: "awaiting_merchant", refund_cents: 1000 });
    ok(await nl.post(`/merchant/cases/${pp.id}`, { approve: "1", note: "Price matched" }));
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [order.id])).refunded_cents).toBe(2000 + 1500 + 1000);

    // Owned items: add one, ask whether to repair it, then mark one given away.
    ok(await maya.post("/you/owned", { title: "Kettle", category: "kettle", brand_model: "Breville IQ", price: "120" }));
    const kettle = await one("SELECT id FROM owned_items WHERE title = 'Kettle'");
    expect(decodeURIComponent((await maya.post(`/you/owned/${kettle.id}/advice`, { quote: "90" })).location ?? "")).toMatch(/REPAIR|REPLACE|KEEP|[A-Z]{4,}/);
    ok(await maya.post(`/you/owned/${kettle.id}/status`, { status: "given" }));
    expect((await one("SELECT status FROM owned_items WHERE id = $1", [kettle.id])).status).toBe("given");

    // Price watch on a product Maya didn't buy.
    const other = await one("SELECT id, price_cents FROM products WHERE id <> ALL($1) AND stock > 0 ORDER BY price_cents DESC LIMIT 1", [[chair.product_id, lamp.product_id, dock.product_id]]);
    ok(await maya.post("/discover/watch", { product: other.id, target: ((other.price_cents - 100) / 100).toFixed(2) }));

    // Memory controls: undo the latest choice, forget one learned preference, delete the whole memory, limit.
    const last = await one("SELECT id FROM pref_events WHERE eligible AND NOT undone ORDER BY id DESC LIMIT 1");
    ok(await maya.post("/you/undo", { event: String(last.id) }));
    expect((await one("SELECT undone FROM pref_events WHERE id = $1", [last.id])).undone).toBe(true);
    ok(await maya.post("/you/forget", { recipient: s.self, feature: "price" }));
    ok(await maya.post("/you/delete-memory", { recipient: s.self }));
    ok(await maya.post("/you/limit", { limit: "500" }));
    expect((await one("SELECT monthly_limit_cents FROM accounts WHERE id = $1", [s.account])).monthly_limit_cents).toBe(50000);

    // Demo controls: the clock, the reconciler again, and a reset; then sign out.
    ok(await anon.post("/demo/clock", { step: "day" }));
    ok(await maya.post("/console/fault", { f: "refund_503" }));
    ok(await maya.post("/demo/reset"));
    expect((await one("SELECT COUNT(*)::int AS n FROM orders")).n).toBe(0);
    expect((await nl.post("/logout")).status).toBe(302);

    expect(srv.failures).toEqual([]);
    expect(srv.missed(FOUNDATION_ROUTES)).toEqual([]);
  });
});
