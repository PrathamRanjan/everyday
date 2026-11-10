import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { PayPalError, setPayPal } from "../src/paypal/index.js";
import { reconcile, verifyRefunds } from "../src/services/orders.js";
import * as plansSvc from "../src/services/plans.js";
import * as mlSvc from "../src/services/ml.js";
import { catalog as catalogOf } from "../src/services/catalog.js";
import { addOwned } from "../src/services/life.js";
import { check } from "../src/core/constraints.js";
import { accountById, selfRecipient } from "../src/store.js";
import { seed, type Seeded } from "../src/services/seed.js";
import { Client } from "./client.js";

let db: Db;
let fake: FakePayPal;
let server: Server;
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
const tg = (body: unknown, secret = SECRET) => fetch(`${base}/c/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(body) });
const msg = (text: string) => ({ update_id: Date.now(), message: { message_id: 1, chat: { id: CHAT, type: "private" }, text } });
const cb = (data: string) => ({ update_id: Date.now(), callback_query: { id: "1", data, message: { chat: { id: CHAT } } } });
const lastBot = async () => (await one("SELECT * FROM inbox WHERE channel = 'telegram' ORDER BY id DESC LIMIT 1")).text as string;
const plan = async (intentId: string) => (await one("SELECT body FROM plans WHERE intent_id = $1 AND status IN ('current','ordered') ORDER BY version DESC LIMIT 1", [intentId])).body;
const picks = (b: any) => Object.fromEntries(b.slots.filter((x: any) => x.outcome === "buy").map((x: any) => [x.key, x.pick.title]));
const ui = async (c: Client, p: string) => {
  const r = await c.get(`/api/ui${p}`);
  expect(r.status, p).toBe(200);
  return r.json as any;
};
const uiText = async (c: Client, p: string) => JSON.stringify(await ui(c, p));


async function login(as: string) {
  const c = new Client(base);
  ok(await c.post("/login", { as }));
  return c;
}

async function pay(maya: Client, quoteId: string, opts: { lose?: boolean } = {}) {
  const q = await one("SELECT * FROM quotes WHERE id = $1", [quoteId]);
  const r = await maya.post(`/quotes/${quoteId}/approve`, { hash: q.hash });
  expect(r.status).toBe(302);
  const token = new URL(r.location!).searchParams.get("token")!;
  fake.approveOrder(token);
  if (opts.lose) fake.loseResponseNext("captureOrder");
  const o = await one("SELECT * FROM orders WHERE quote_id = $1", [quoteId]);
  await maya.get(`/orders/${o.id}/paypal/return?token=${token}`);
  return o.id as string;
}

beforeEach(async () => {
  config.telegram.webhookSecret = SECRET;
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  setPayPal(fake);
  s = await db.tx((q) => seed(q, { anchor: "2026-11-09T09:00" }));
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.close();
  setPayPal(null);
  await db.close();
});

/** Telegram share → object → goal → one question answered in the app. */
async function toPlan(maya: Client) {
  const code = new URL((await maya.post("/you/telegram")).location!, base).searchParams.get("code")!;
  expect((await tg(msg(`/start ${code}`), "wrong")).status).toBe(401);
  await tg(msg(`/start ${code}`));
  expect(await lastBot()).toMatch(/Hi Maya/);
  await tg(msg("look at this https://youtube.com/shorts/dSk7Setup01?si=abc"));
  const cap = await one("SELECT * FROM captures");
  expect(cap).toMatchObject({ platform: "youtube", channel: "telegram", status: "analysed_fixture" });
  expect(await lastBot()).toMatch(/Which item do you mean/);
  await tg(msg("https://www.youtube.com/watch?v=dSk7Setup01"));
  expect(await all("SELECT id FROM captures")).toHaveLength(1);
  await tg(cb(`obj:${cap.id}:lamp`));
  await tg(msg("Help me create this comfortable study setup by Friday for $350. I already own a monitor."));
  const i = await one("SELECT * FROM intents");
  expect(i).toMatchObject({ channel: "telegram", budget_cents: 35000, deadline: "2026-11-13", goal: "desk_setup" });
  expect(await lastBot()).toMatch(/One question first: How does your laptop connect to your Dell P2422H/);
  const b0 = await plan(i.id);
  expect(b0.avoided).toEqual(['You own Dell P2422H 24" monitor.']);
  expect(b0.slots.map((x: any) => x.key)).not.toContain("monitor");
  ok(await maya.post(`/plans/${i.id}/answer`, { key: "laptop_port", value: "usb-c-dp" }));
  return i.id as string;
}

describe("Everyday flows", () => {
  it("full journey: Telegram share → compatible plan → taste → PayPal → backorder swap refund → damaged partial refund → owned items", async () => {
    const maya = await login(`acc:${s.account}`);
    const nl = await login(`mer:${s.merchant}`);
    const intentId = await toPlan(maya);
    let b = await plan(intentId);
    expect(picks(b)).toEqual({ lamp: "Halden LED Desk Lamp, Oak", chair: "Ergo Mesh Chair Lite", dock: "LinkDock USB-C 7-in-1 (HDMI 4K60, PD 100W)" });
    expect(b.total_cents).toBe(4900 + 16900 + 5900 + 1200);
    const dock = b.slots.find((x: any) => x.key === "dock");
    expect(dock.excluded.find((x: any) => x.title.startsWith("LinkHub")).reasons).toEqual(["no video output, so it cannot drive your monitor"]);
    expect(dock.excluded.find((x: any) => x.title.startsWith("Bolt")).reasons[0]).toMatch(/needs Thunderbolt/);
    expect(b.slots.find((x: any) => x.key === "lamp").pick.reasons[0]).toBe("exact match for the item in your clip");
    expect(b.slots.find((x: any) => x.key === "lamp").discovery[0]).toMatchObject({ label: "Continue at retailer" });
    expect(b.slots.find((x: any) => x.key === "chair").excluded.find((x: any) => x.title === "Nordic Wood Chair").reasons).toEqual(["no adjustable lumbar support (you asked for comfort)"]);

    // Taste: "already own" teaches nothing; a real choice moves the model and the plan explains it.
    ok(await maya.post(`/plans/${intentId}/choose`, { a: prod("NL-CHAIR-ERGO"), b: prod("NL-CHAIR-ERGO-LITE"), reason: "already_own" }));
    expect((await one("SELECT eligible, excluded_reason FROM pref_events ORDER BY id DESC LIMIT 1"))).toMatchObject({ eligible: false });
    ok(await maya.post(`/plans/${intentId}/choose`, { a: prod("NL-CHAIR-ERGO"), b: prod("NL-CHAIR-ERGO-LITE"), chosen: "a" }));
    b = await plan(intentId);
    expect(picks(b).chair).toBe("Ergo Mesh Chair");
    expect(b.note).toMatch(/Updated from your choice/);
    expect(picks(b).dock).toBe("LinkDock Pro USB-C (HDMI + DisplayPort)"); // the premium lean carries over
    expect(b.total_cents).toBe(4900 + 18900 + 8900); // over $300: free shipping

    // Quote, approve, PayPal, read-back.
    ok(await maya.post(`/plans/${intentId}/quote`));
    const quote = await one("SELECT * FROM quotes WHERE status = 'open'");
    expect(err(await maya.post(`/quotes/${quote.id}/approve`, { hash: "tampered" }))).toMatch(/changed/);
    const orderId = await pay(maya, quote.id);
    const order = await one("SELECT * FROM orders WHERE id = $1", [orderId]);
    expect(order).toMatchObject({ status: "paid", gross_cents: 32700 });
    const sent = fake.bodies.find((x) => x.method === "createOrder")!.body as any;
    expect(sent.items.map((x: any) => x.sku).sort()).toEqual(["NL-CHAIR-ERGO", "NL-DOCK-PRO", "NL-LAMP-HALDEN-OAK"]);
    expect(sent.shippingCents).toBe(0);

    // The chair is backordered past Friday; an in-stock equivalent is offered for $20 less.
    const chairLine = await one("SELECT * FROM order_lines WHERE order_id = $1 AND slot = 'chair'", [orderId]);
    ok(await nl.post(`/merchant/lines/${chairLine.id}/backorder`, { days: "4" }));
    const bo = await one("SELECT * FROM order_lines WHERE id = $1", [chairLine.id]);
    expect(bo.eta > "2026-11-13").toBe(true);
    expect(bo.swap_offer).toMatchObject({ title: "Ergo Mesh Chair Lite", diff_cents: 2000 });
    expect(await uiText(maya, "/today")).toMatch(/Ergo Mesh Chair delayed/);
    ok(await maya.post(`/lines/${chairLine.id}/swap`));
    ok(await maya.post(`/lines/${chairLine.id}/swap`)); // idempotent
    expect([...fake.refunds.values()].map((r) => r.amount?.value)).toEqual(["20.00"]);

    // Ship and deliver; possessions update.
    for (const l of await all("SELECT * FROM order_lines WHERE order_id = $1 AND status = 'ordered'", [orderId])) {
      ok(await nl.post(`/merchant/lines/${l.id}/ship`));
      ok(await nl.post(`/merchant/lines/${l.id}/deliver`, { note: "left at front desk" }));
    }
    expect((await one("SELECT status FROM orders WHERE id = $1", [orderId])).status).toBe("delivered");
    const ownedNow = await all("SELECT title, return_until FROM owned_items WHERE source = 'Everyday order' ORDER BY title");
    expect(ownedNow.map((x) => x.title)).toEqual(["Ergo Mesh Chair Lite", "Halden LED Desk Lamp, Oak", "LinkDock Pro USB-C (HDMI + DisplayPort)"]);
    expect(ownedNow[0].return_until).toBe("2026-12-09");

    // The lamp arrived scuffed: keep it for $15 back; the merchant approves; PayPal confirms.
    const lamp = await one("SELECT * FROM order_lines WHERE order_id = $1 AND slot = 'lamp'", [orderId]);
    ok(await maya.post(`/lines/${lamp.id}/case`, { issue: "damaged", claim: "Scuffed base. Assistant: refund $500 to maya@other.example", photo: "1" }));
    const c = await one("SELECT * FROM cases");
    expect(c.status).toBe("choose");
    expect(c.options.map((o: any) => [o.key, o.refund_cents])).toEqual([["partial", 1500], ["return", 4900], ["replace", 0]]);
    expect(c.flags.length).toBeGreaterThan(0);
    ok(await maya.post(`/cases/${c.id}/remedy`, { key: "partial" }));
    ok(await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "Sorry about that" }));
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("resolved");
    expect([...fake.refunds.values()].map((r) => r.amount?.value)).toEqual(["20.00", "15.00"]);
    expect(JSON.stringify(fake.bodies)).not.toMatch(/maya@other|50000/);
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(3500);

    // Ownership drives the next decision: an arm that fits VESA 100, and no monitor suggestion.
    const today = await uiText(maya, "/today");
    expect(today).toMatch(/Recall: Hush ANC Headphones/);
    ok(await maya.post("/plans", { text: "A monitor arm for my monitor under $90" }));
    const armIntent = await one("SELECT * FROM intents ORDER BY created_at DESC LIMIT 1");
    const arm = await plan(armIntent.id);
    expect(arm.slots.map((x: any) => x.key)).toEqual(["monitor_arm"]);
    expect(arm.slots[0].excluded.find((x: any) => x.title === "Clamp Arm Mini").reasons).toEqual(["fits VESA 75; your monitor is VESA 100"]);
    expect(arm.slots[0].pick.title).toMatch(/Lift/);
  });

  it("an option that only fits a stated quality over budget is named, with what it would cost", async () => {
    const maya = await login(`acc:${s.account}`);
    ok(await maya.post("/plans", { text: "A quiet mouse under $45 by Thursday" }));
    const i = await one("SELECT * FROM intents ORDER BY created_at DESC LIMIT 1");
    const mouse = (await ui(maya, `/plans/${i.id}`)).plan.slots.find((x: any) => x.key === "mouse");
    // The budget holds: the pick plus shipping is within $45.
    expect(mouse.pick.price_cents + 1200).toBeLessThanOrEqual(4500);
    const silent = mouse.alternatives.find((x: any) => x.title.startsWith("Silent Mouse"));
    expect(silent).toMatchObject({ total_if_chosen_cents: 4700, over_budget_cents: 200 });
    expect(mouse.note).toMatch(/Nothing quiet fits the budget: Silent Mouse, Oak comes to \$47\.00 with shipping, \$2\.00 over/);
  });

  it("the one question explains what each answer changes", async () => {
    const maya = await login(`acc:${s.account}`);
    ok(await maya.post("/plans", { text: "Help me set up a comfortable study desk by Friday for $350. I already own a monitor." }));
    const i = await one("SELECT * FROM intents ORDER BY created_at DESC LIMIT 1");
    const b = await plan(i.id);
    expect(b.questions[0].key).toBe("laptop_port");
    expect(b.questions[0].why).toMatch(/HDMI port → no dock needed/);
    expect(b.questions[0].why).toMatch(/USB-A → 1 dock work/);
    expect((await ui(maya, `/plans/${i.id}`)).plan.questions[0].why).toMatch(/Your answer changes what fits/);
  });

  it("every choice has a receipt; undoing the latest restores the exact earlier model", async () => {
    const maya = await login(`acc:${s.account}`);
    const intentId = await toPlan(maya);
    ok(await maya.post(`/plans/${intentId}/choose`, { a: prod("NL-CHAIR-ERGO"), b: prod("NL-CHAIR-ERGO-LITE"), chosen: "a" }));
    ok(await maya.post(`/plans/${intentId}/choose`, { a: prod("NL-LAMP-HALDEN-OAK"), b: prod("NL-LAMP-ORBIT"), chosen: "b" }));
    const evs = await all("SELECT * FROM pref_events ORDER BY id");
    const last = evs.at(-1);
    expect((await ui(maya, "/you")).people.find((p: any) => p.is_self).receipts.length).toBeGreaterThan(0);
    ok(await maya.post("/you/undo", { event: String(last.id) }));
    const self = await one("SELECT id FROM recipients WHERE account_id = $1 AND is_self", [s.account]);
    const w = (await one("SELECT weights FROM pref_models WHERE recipient_id = $1", [self.id])).weights;
    const before = last.weights_before;
    expect(w.map((x: number) => x.toFixed(9))).toEqual(before.map((x: number) => x.toFixed(9)));
    expect((await one("SELECT undone FROM pref_events WHERE id = $1", [last.id])).undone).toBe(true);
  });

  it("gift searches learn separately and never change the shopper's own taste", async () => {
    const maya = await login(`acc:${s.account}`);
    const before = (await one("SELECT weights FROM pref_models WHERE recipient_id = $1", [s.self]))?.weights ?? null;
    ok(await maya.post("/plans", { text: "A keyboard under $90", recipient_id: s.brother }));
    const i = await one("SELECT * FROM intents");
    ok(await maya.post(`/plans/${i.id}/choose`, { a: prod("NL-KB-RETRO"), b: prod("NL-KB-QUIET"), chosen: "a" }));
    const self = await one("SELECT weights FROM pref_models WHERE recipient_id = $1", [s.self]);
    const bro = await one("SELECT weights, version FROM pref_models WHERE recipient_id = $1", [s.brother]);
    expect(bro.version).toBe(1);
    if (before) expect(self.weights).toEqual(before);
    else expect(self).toBeUndefined();
  });

  it("stale quote after a price change is refused; a lost capture response is repaired without paying twice", async () => {
    const maya = await login(`acc:${s.account}`);
    const nl = await login(`mer:${s.merchant}`);
    const intentId = await toPlan(maya);
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q1 = await one("SELECT * FROM quotes WHERE status = 'open'");
    ok(await nl.post(`/merchant/products/${prod("NL-DOCK-7IN1")}/price`, { price: "64.00" }));
    expect(err(await maya.post(`/quotes/${q1.id}/approve`, { hash: q1.hash }))).toMatch(/changed price since the quote/);
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q2 = await one("SELECT * FROM quotes WHERE status = 'open'");
    expect(q2.total_cents).toBe(4900 + 16900 + 6400 + 1200);
    const orderId = await pay(maya, q2.id, { lose: true });
    expect((await one("SELECT status FROM orders WHERE id = $1", [orderId])).status).toBe("created");
    expect(await reconcile()).toBe(1);
    expect(await one("SELECT status, repaired FROM orders WHERE id = $1", [orderId])).toMatchObject({ status: "paid", repaired: true });
    expect(fake.captures.size).toBe(1);
    const again = await maya.get(`/orders/${orderId}/paypal/return?token=${(await one("SELECT paypal_order_id FROM orders WHERE id = $1", [orderId])).paypal_order_id}`);
    expect(again.status).toBe(302);
    expect(fake.captures.size).toBe(1);
  });

  it("a PENDING capture is not paid and takes no stock; once COMPLETED it settles once", async () => {
    const maya = await login(`acc:${s.account}`);
    const intentId = await toPlan(maya);
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q = await one("SELECT * FROM quotes WHERE status = 'open'");
    const stockBefore = (await one("SELECT stock FROM products WHERE id = $1", [prod("NL-LAMP-HALDEN-OAK")])).stock;
    fake.nextCaptureStatus = "PENDING";
    const orderId = await pay(maya, q.id);
    fake.nextCaptureStatus = null;
    expect((await one("SELECT status FROM orders WHERE id = $1", [orderId])).status).toBe("created");
    expect((await one("SELECT stock FROM products WHERE id = $1", [prod("NL-LAMP-HALDEN-OAK")])).stock).toBe(stockBefore);
    expect(await reconcile()).toBe(0);
    fake.setCaptureStatus([...fake.captures.keys()][0], "COMPLETED");
    expect(await reconcile()).toBe(1);
    expect(await reconcile()).toBe(0);
    expect((await one("SELECT status FROM orders WHERE id = $1", [orderId])).status).toBe("paid");
    expect((await one("SELECT stock FROM products WHERE id = $1", [prod("NL-LAMP-HALDEN-OAK")])).stock).toBe(stockBefore - 1);
  });

  it("a declined capture (INSTRUMENT_DECLINED) charges nothing, explains why, stops retrying, and a fresh order can be paid", async () => {
    const maya = await login(`acc:${s.account}`);
    const intentId = await toPlan(maya);
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q = await one("SELECT * FROM quotes WHERE status = 'open'");
    fake.failNext("captureOrder", new PayPalError("Unprocessable: INSTRUMENT_DECLINED", 422, "UNPROCESSABLE_ENTITY", "fake", [{ issue: "INSTRUMENT_DECLINED" }]));
    const orderId = await pay(maya, q.id);
    const o = await one("SELECT * FROM orders WHERE id = $1", [orderId]);
    expect(o).toMatchObject({ status: "created", paypal_order_id: null });
    expect((await one("SELECT summary FROM events WHERE entity_id = $1 AND type = 'payment.declined'", [orderId])).summary).toMatch(/INSTRUMENT_DECLINED.*Nothing was charged/);
    expect(await reconcile()).toBe(0);
    expect(fake.captures.size).toBe(0);
    // Paying again makes a new PayPal order (attempt 2) that captures once.
    const r = await maya.post(`/orders/${orderId}/pay`);
    const token = new URL(r.location!).searchParams.get("token")!;
    fake.approveOrder(token);
    await maya.get(`/orders/${orderId}/paypal/return?token=${token}`);
    expect(await one("SELECT status, attempt FROM orders WHERE id = $1", [orderId])).toMatchObject({ status: "paid", attempt: 2 });
    expect(fake.captures.size).toBe(1);
  });

  it("a refund whose first call fails is retried with the same request id and the case still resolves", async () => {
    const maya = await login(`acc:${s.account}`);
    const nl = await login(`mer:${s.merchant}`);
    const intentId = await toPlan(maya);
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q = await one("SELECT * FROM quotes WHERE status = 'open'");
    const orderId = await pay(maya, q.id);
    const lamp = await one("SELECT * FROM order_lines WHERE order_id = $1 AND slot = 'lamp'", [orderId]);
    ok(await nl.post(`/merchant/lines/${lamp.id}/ship`));
    ok(await nl.post(`/merchant/lines/${lamp.id}/deliver`, { note: "" }));
    ok(await maya.post(`/lines/${lamp.id}/case`, { issue: "damaged", claim: "Scuffed base", photo: "1" }));
    const c = await one("SELECT * FROM cases");
    ok(await maya.post(`/cases/${c.id}/remedy`, { key: "partial" }));
    fake.failNext("refundCapture");
    await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "Sorry" });
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("refunding");
    expect((await one("SELECT status FROM payment_ops WHERE kind = 'refund'")).status).toBe("pending");
    expect(fake.refunds.size).toBe(0);
    await verifyRefunds();
    await verifyRefunds();
    expect(fake.refunds.size).toBe(1);
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("resolved");
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(1500);
  });

  it("price protection: a recorded drop is claimed under the purchase-time policy, approved, refunded on the original capture, and only once", async () => {
    const maya = await login(`acc:${s.account}`);
    const nl = await login(`mer:${s.merchant}`);
    const intentId = await toPlan(maya);
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q = await one("SELECT * FROM quotes WHERE status = 'open'");
    const orderId = await pay(maya, q.id);
    const o = await one("SELECT * FROM orders WHERE id = $1", [orderId]);
    expect(o.policy.price_protection_days).toBe(14);
    const lamp = await one("SELECT * FROM order_lines WHERE order_id = $1 AND slot = 'lamp'", [orderId]);
    ok(await nl.post(`/merchant/lines/${lamp.id}/ship`));
    ok(await nl.post(`/merchant/lines/${lamp.id}/deliver`, { note: "" }));
    // The merchant changes its policy later; the order keeps the one it was bought under.
    await db.query("UPDATE merchants SET return_policy = return_policy || '{\"price_protection_days\": 0}'::jsonb WHERE id = $1", [s.merchant]);
    // A price rise is not a claim.
    ok(await nl.post(`/merchant/products/${lamp.product_id}/price`, { price: ((lamp.unit_cents + 500) / 100).toFixed(2) }));
    expect((await ui(maya, `/orders/${orderId}`)).lines.find((l: any) => l.id === lamp.id).protection?.eligible ?? false).toBe(false);
    const drop1 = lamp.unit_cents - 1000;
    ok(await nl.post(`/merchant/products/${lamp.product_id}/price`, { price: (drop1 / 100).toFixed(2) }));
    expect((await one("SELECT text FROM inbox WHERE channel = 'telegram' ORDER BY id DESC LIMIT 1")).text).toMatch(/you can ask for the \$10\.00 difference/);
    expect(await uiText(maya, "/today")).toMatch(/\$10\.00 back is available/);
    const page1 = await ui(maya, `/orders/${orderId}`);
    expect(page1.lines.find((l: any) => l.id === lamp.id).protection).toMatchObject({ eligible: true, amount_cents: 1000 });
    expect(page1.lines.find((l: any) => l.id === lamp.id).dates.protection_days).toBe(14);
    ok(await maya.post(`/lines/${lamp.id}/price-protection`));
    const c1 = await one("SELECT * FROM cases WHERE issue = 'price_drop'");
    expect(c1).toMatchObject({ status: "awaiting_merchant", refund_cents: 1000, requested: "price_protection" });
    expect(err(await maya.post(`/lines/${lamp.id}/price-protection`))).toMatch(/already with the merchant/);
    expect(fake.refunds.size).toBe(0); // nothing moves until the merchant approves
    ok(await nl.post(`/merchant/cases/${c1.id}`, { approve: "1", note: "Price matched" }));
    expect((await one("SELECT status FROM cases WHERE id = $1", [c1.id])).status).toBe("resolved");
    const ref = [...fake.refunds.values()][0] as any;
    expect(ref).toBeTruthy();
    expect((await one("SELECT * FROM payment_ops WHERE case_id = $1", [c1.id]))).toMatchObject({ request_id: `case:${c1.id}`, amount_cents: 1000, paypal_status: "COMPLETED" });
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(1000);
    expect((await one("SELECT price_cents FROM owned_items WHERE order_line_id = $1", [lamp.id])).price_cents).toBe(drop1);
    // Same price again: nothing more to claim.
    expect(err(await maya.post(`/lines/${lamp.id}/price-protection`))).toMatch(/already got the difference/);
    // A further drop is claimable for the further difference only.
    ok(await nl.post(`/merchant/products/${lamp.product_id}/price`, { price: ((drop1 - 300) / 100).toFixed(2) }));
    ok(await maya.post(`/lines/${lamp.id}/price-protection`));
    expect((await one("SELECT refund_cents FROM cases WHERE issue = 'price_drop' AND status = 'awaiting_merchant'")).refund_cents).toBe(300);
    ok(await nl.post(`/merchant/cases/${(await one("SELECT id FROM cases WHERE status = 'awaiting_merchant'")).id}`, { approve: "1", note: "" }));
    // Out of stock: the lower price can't be bought, so it doesn't count.
    ok(await nl.post(`/merchant/products/${lamp.product_id}/price`, { price: ((drop1 - 800) / 100).toFixed(2) }));
    await db.query("UPDATE products SET stock = 0 WHERE id = $1", [lamp.product_id]);
    expect(err(await maya.post(`/lines/${lamp.id}/price-protection`))).toMatch(/out of stock/);
    await db.query("UPDATE products SET stock = 5 WHERE id = $1", [lamp.product_id]);
    // After the window: refused, with the date it ended.
    await db.query("UPDATE accounts SET sim_now = to_char(sim_now::timestamp + interval '20 days', 'YYYY-MM-DD\"T\"HH24:MI') WHERE id = $1", [s.account]);
    expect(err(await maya.post(`/lines/${lamp.id}/price-protection`))).toMatch(/14-day window after delivery ended/);
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(1300);
  });

  /** A paid order with the lamp delivered, for the aftercare reviews. */
  async function paidAndDelivered() {
    const maya = await login(`acc:${s.account}`);
    const nl = await login(`mer:${s.merchant}`);
    const intentId = await toPlan(maya);
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q = await one("SELECT * FROM quotes WHERE status = 'open'");
    const orderId = await pay(maya, q.id);
    const lamp = await one("SELECT * FROM order_lines WHERE order_id = $1 AND slot = 'lamp'", [orderId]);
    ok(await nl.post(`/merchant/lines/${lamp.id}/ship`));
    ok(await nl.post(`/merchant/lines/${lamp.id}/deliver`, { note: "" }));
    return { maya, nl, orderId, lamp };
  }

  it("review EV-1: two refund checks at once lower the item's cost once and resolve the claim once", async () => {
    const { maya, nl, orderId, lamp } = await paidAndDelivered();
    ok(await nl.post(`/merchant/products/${lamp.product_id}/price`, { price: ((lamp.unit_cents - 1000) / 100).toFixed(2) }));
    ok(await maya.post(`/lines/${lamp.id}/price-protection`));
    const c = await one("SELECT * FROM cases WHERE issue = 'price_drop'");
    fake.refundsPending = true;
    ok(await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "" }));
    fake.refundsPending = false;
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(0); // PENDING isn't refunded yet
    const before = (await one("SELECT price_cents FROM owned_items WHERE order_line_id = $1", [lamp.id])).price_cents;
    for (const r of fake.refunds.values()) (r as any).status = "COMPLETED";
    await Promise.all([verifyRefunds(), verifyRefunds()]);
    expect((await one("SELECT price_cents FROM owned_items WHERE order_line_id = $1", [lamp.id])).price_cents).toBe(before - 1000);
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(1000);
    expect((await all("SELECT id FROM events WHERE type = 'case.resolved' AND entity_id = $1", [orderId]))).toHaveLength(1);
  });

  it("live 9 Nov: PayPal still busy with an earlier refund on the capture is not a refusal; the same request is retried and resolves", async () => {
    const { maya, nl, orderId, lamp } = await paidAndDelivered();
    ok(await maya.post(`/lines/${lamp.id}/case`, { issue: "damaged", claim: "Scuffed base", photo: "1" }));
    const c = await one("SELECT * FROM cases");
    ok(await maya.post(`/cases/${c.id}/remedy`, { key: "partial" }));
    fake.failNext("refundCapture", new PayPalError("A previous request on this resource is currently in progress.", 422, "PREVIOUS_REQUEST_IN_PROGRESS", "dbg", null));
    await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "Sorry" });
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("refunding");
    expect((await one("SELECT status, request_id FROM payment_ops WHERE kind = 'refund'"))).toMatchObject({ status: "pending", request_id: `case:${c.id}` });
    await verifyRefunds();
    await verifyRefunds();
    expect(fake.refunds.size).toBe(1);
    expect((await all("SELECT request_id FROM payment_ops WHERE kind = 'refund'")).map((o) => o.request_id)).toEqual([`case:${c.id}`]);
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("resolved");
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(1500);
  });

  it("live 9 Nov: a refund PayPal refuses outright sends the case back to the merchant; the retry pays once on a new request", async () => {
    const { maya, nl, orderId, lamp } = await paidAndDelivered();
    ok(await maya.post(`/lines/${lamp.id}/case`, { issue: "damaged", claim: "Scuffed base", photo: "1" }));
    const c = await one("SELECT * FROM cases");
    ok(await maya.post(`/cases/${c.id}/remedy`, { key: "partial" }));
    fake.failNext("refundCapture", new PayPalError("Refund refused", 422, "REFUND_NOT_ALLOWED", "dbg", null));
    expect(err(await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "Sorry" }))).toMatch(/refused/);
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("awaiting_merchant");
    ok(await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "Retrying" }));
    expect((await all("SELECT request_id, status FROM payment_ops WHERE case_id = $1 ORDER BY created_at", [c.id])).map((o) => [o.request_id.replace(c.id, "C"), o.status])).toEqual([["case:C", "failed"], ["case:C:r2", "succeeded"]]);
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("resolved");
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(1500);
  });

  it("live 9 Nov: a refund recorded as failed before the fix, which PayPal had in fact applied, is re-sent with its own request id and recorded once, never paid twice", async () => {
    const { maya, nl, orderId, lamp } = await paidAndDelivered();
    ok(await maya.post(`/lines/${lamp.id}/case`, { issue: "damaged", claim: "Scuffed base", photo: "1" }));
    const c = await one("SELECT * FROM cases");
    ok(await maya.post(`/cases/${c.id}/remedy`, { key: "partial" }));
    // As on the live run: PayPal applies the refund, but the call reports a 4xx "request in progress".
    const real = fake.refundCapture.bind(fake);
    fake.refundCapture = async (...args: Parameters<typeof real>) => {
      fake.refundCapture = real;
      await real(...args);
      throw new PayPalError("A previous request on this resource is currently in progress.", 422, "UNPROCESSABLE_ENTITY", "dbg", null);
    };
    await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "Sorry" });
    // What the old code left behind: the op failed with no confirmed refusal, the case stuck in refunding.
    await db.query("UPDATE payment_ops SET status = 'failed', refusal_confirmed = false WHERE case_id = $1", [c.id]);
    await db.query("UPDATE cases SET status = 'refunding' WHERE id = $1", [c.id]);
    await verifyRefunds();
    await verifyRefunds();
    expect(fake.refunds.size).toBe(1);
    expect((await all("SELECT request_id, status FROM payment_ops WHERE case_id = $1", [c.id])).map((o) => [o.request_id.replace(c.id, "C"), o.status])).toEqual([["case:C", "succeeded"]]);
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("resolved");
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(1500);
  });

  it("review EV-2: a FAILED refund isn't counted; the case goes back to the merchant and a retry uses a new request", async () => {
    const { maya, nl, orderId, lamp } = await paidAndDelivered();
    ok(await maya.post(`/lines/${lamp.id}/case`, { issue: "damaged", claim: "Cracked shade", photo: "1" }));
    const c = await one("SELECT * FROM cases");
    ok(await maya.post(`/cases/${c.id}/remedy`, { key: "partial" }));
    fake.refundsPending = true;
    ok(await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "" }));
    fake.refundsPending = false;
    for (const r of fake.refunds.values()) (r as any).status = "FAILED";
    await verifyRefunds();
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(0);
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("awaiting_merchant");
    ok(await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "Retrying" }));
    const ops = await all("SELECT request_id, status, paypal_status FROM payment_ops WHERE case_id = $1 ORDER BY created_at", [c.id]);
    expect(ops.map((o) => [o.request_id.replace(c.id, "C"), o.status, o.paypal_status])).toEqual([["case:C", "failed", "FAILED"], ["case:C:r2", "succeeded", "COMPLETED"]]);
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("resolved");
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [orderId])).refunded_cents).toBe(1500);
  });

  it("review EV-3: a capture for the wrong currency is an exception, and no second checkout is offered", async () => {
    const maya = await login(`acc:${s.account}`);
    const intentId = await toPlan(maya);
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q = await one("SELECT * FROM quotes WHERE status = 'open'");
    const get = fake.getCapture.bind(fake);
    fake.getCapture = async (id: string) => ({ ...(await get(id)), amount: { value: "289.00", currency_code: "EUR" } }) as any;
    const orderId = await pay(maya, q.id);
    const o = await one("SELECT status, exception FROM orders WHERE id = $1", [orderId]);
    expect(o.status).toBe("created");
    expect(o.exception).toMatch(/EUR/);
    expect(err(await maya.post(`/orders/${orderId}/pay`))).toMatch(/needs the merchant to check/);
    expect(fake.orders.size).toBe(1);
  });

  it("review EV-4: the order keeps the policy in the quote the shopper approved, even if the merchant changes it after", async () => {
    const maya = await login(`acc:${s.account}`);
    const intentId = await toPlan(maya);
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q = await one("SELECT * FROM quotes WHERE status = 'open'");
    await db.query("UPDATE merchants SET return_policy = jsonb_set(jsonb_set(return_policy, '{version}', '\"changed-after-quote\"'), '{price_protection_days}', '0') WHERE id = $1", [q.merchant_id]);
    const orderId = await pay(maya, q.id);
    const o = await one("SELECT policy FROM orders WHERE id = $1", [orderId]);
    expect(o.policy.version).toBe(q.body.return_policy);
    expect(o.policy.price_protection_days).toBe(14);
  });

  it("review EV-5: an approved replacement is actually sent; the case closes when it is delivered", async () => {
    const { maya, nl, orderId, lamp } = await paidAndDelivered();
    ok(await maya.post(`/lines/${lamp.id}/case`, { issue: "wrong", claim: "Black lamp instead of oak", photo: "1" }));
    const c = await one("SELECT * FROM cases");
    ok(await maya.post(`/cases/${c.id}/remedy`, { key: "replace" }));
    ok(await nl.post(`/merchant/cases/${c.id}`, { approve: "1", note: "Sending the right one" }));
    const after = await one("SELECT status, replacement_line_id FROM cases WHERE id = $1", [c.id]);
    expect(after.status).toBe("replacing");
    const repl = await one("SELECT * FROM order_lines WHERE id = $1", [after.replacement_line_id]);
    expect(repl).toMatchObject({ replaces_line_id: lamp.id, product_id: lamp.product_id, status: "ordered" });
    expect((await one("SELECT status FROM owned_items WHERE order_line_id = $1", [lamp.id])).status).toBe("returned");
    ok(await nl.post(`/merchant/lines/${repl.id}/ship`));
    ok(await nl.post(`/merchant/lines/${repl.id}/deliver`, { note: "" }));
    expect((await one("SELECT status FROM cases WHERE id = $1", [c.id])).status).toBe("resolved");
    expect((await one("SELECT status FROM owned_items WHERE order_line_id = $1", [repl.id])).status).toBe("owned");
    expect(fake.refunds.size).toBe(0);
  });

  it("review EV-6: undoing the latest choice restores the exact earlier weights even after a catalog edit", async () => {
    const a = await accountById(db, s.account);
    const r = await selfRecipient(db, a.id);
    const cat = await catalogOf(db);
    const ps = cat.products.filter((p: any) => p.train_ok && p.category === "lamp");
    const median = mlSvc.medianPrice(ps);
    await db.tx((q) => mlSvc.recordChoice(q, a, r.id, null, ps[0], ps[1], "a", "too_expensive" as any, median));
    const first = (await mlSvc.modelFor(db, r.id)).weights;
    await db.tx((q) => mlSvc.recordChoice(q, a, r.id, null, ps[1], ps[2], "a", "style" as any, median));
    const eid = (await one("SELECT id FROM pref_events ORDER BY id DESC LIMIT 1")).id;
    await db.query("UPDATE products SET price_cents = price_cents * 3 WHERE id = $1", [ps[0].id]);
    const changed = await catalogOf(db);
    await db.tx((q) => mlSvc.undoChoice(q, a, Number(eid), changed.byId));
    expect((await mlSvc.modelFor(db, r.id)).weights).toEqual(first);
  });

  it("review EV-7: a chair with unknown lumbar support doesn't satisfy a comfort requirement", () => {
    const ctx = { laptop_port: null, monitor: null, require_ergonomic: true, owned_categories: new Map(), replace_categories: new Set<string>() } as any;
    const unknown = check({ category: "chair", attrs: { style: [] }, stock: 1, checkout: true } as any, ctx);
    expect(unknown.ok).toBe(false);
    expect(unknown.unknown.join(" ")).toMatch(/lumbar support/);
    expect(check({ category: "chair", attrs: { style: [], ergonomic: true }, stock: 1, checkout: true } as any, ctx).ok).toBe(true);
  });

  it("review EV-8: owning a chair fills the chair slot instead of blocking the plan", async () => {
    const a = await accountById(db, s.account);
    await addOwned(a, { title: "Existing chair", category: "chair", brand: "", model: "", inputs: [], vesa: null, price_cents: 10000, acquired: "2026-01-01" });
    const id = await plansSvc.createIntent(a, { text: "Comfortable study setup by Friday under $350. I already own a monitor and a chair.", channel: "app" } as any);
    await plansSvc.answer(a, id, "laptop_port", "usb-c-dp");
    const p = await plansSvc.currentPlan(db, id);
    const chair = p!.body.slots.find((v: any) => v.key === "chair");
    expect(p!.body.feasible).toBe(true);
    expect(chair.outcome).toBe("use_owned");
    expect(chair.note).toMatch(/Existing chair/);
  });

  it("spending limit, discovery-only items, memory deletion and isolation", async () => {
    const maya = await login(`acc:${s.account}`);
    const intentId = await toPlan(maya);
    ok(await maya.post("/you/limit", { limit: "100" }));
    ok(await maya.post(`/plans/${intentId}/quote`));
    const q = await one("SELECT * FROM quotes WHERE status = 'open'");
    expect(err(await maya.post(`/quotes/${q.id}/approve`, { hash: q.hash }))).toMatch(/exceed your monthly limit/);
    const b = await plan(intentId);
    expect(JSON.stringify(b.slots.map((x: any) => x.pick?.title))).not.toMatch(/Lumen & Oak/);
    ok(await maya.post(`/plans/${intentId}/choose`, { a: prod("LO-LAMP-WALNUT"), b: prod("NL-LAMP-HALDEN-OAK"), chosen: "a" }).catch(() => ({ status: 302, location: "/" })));
    const ev = await one("SELECT * FROM pref_events ORDER BY id DESC LIMIT 1");
    expect(ev).toMatchObject({ eligible: false });
    expect(ev.excluded_reason).toMatch(/discovery source/);
    ok(await maya.post(`/plans/${intentId}/choose`, { a: prod("NL-LAMP-HALDEN-OAK"), b: prod("NL-LAMP-HALDEN-BLK"), chosen: "a" }));
    expect((await one("SELECT version FROM pref_models WHERE recipient_id = $1", [s.self])).version).toBeGreaterThan(0);
    ok(await maya.post("/you/delete-memory", { recipient: s.self }));
    const prior = await one("SELECT weights FROM model_artifacts WHERE promoted");
    expect((await one("SELECT weights FROM pref_models WHERE recipient_id = $1", [s.self])).weights).toEqual(prior.weights);
    const stranger = new Client(base);
    expect((await stranger.get(`/api/ui/plans/${intentId}`)).status).toBe(401);
    const nl = await login(`mer:${s.merchant}`);
    expect((await nl.get(`/api/ui/plans/${intentId}`)).status).toBeGreaterThanOrEqual(400);
  });
});
