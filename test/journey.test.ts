import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFxFetcher } from "../src/services/fx.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { seed, type Seeded } from "../src/services/seed.js";
import { Client } from "./client.js";
import { serveTracked } from "./journey-coverage.js";
import { ELSEWHERE, FOUNDATION_ROUTES } from "./foundation-routes.js";
import { DEMO_SCAM } from "../src/web/safety.js";

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
const ui = async (c: Client, p: string) => {
  const r = await c.get(`/api/ui${p}`);
  expect(r.status, p).toBe(200);
  return r.json as any;
};
const uiText = async (c: Client, p: string) => JSON.stringify(await ui(c, p));


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
    expect((await anon.get("/login?next=/purchases")).status).toBe(200);
    expect((await ui(anon, "/personas")).accounts.map((a: any) => a.id)).toContain(s.account);
    const back = new Client(base);
    expect((await back.post("/login", { as: `acc:${s.account}`, next: "/purchases" })).location).toBe("/purchases");
    const maya = new Client(base);
    ok(await maya.post("/login", { as: `acc:${s.account}` }));

    // Scam and fraud protection (SAFETY_ACCESSIBILITY_SPEC §4): the page, the model card, a scan, protected mode on and off.
    expect((await ui(maya, "/safety")).protected.on).toBe(false);
    expect((await maya.get("/safety/model-card")).status).toBe(200);
    const scan = await maya.req("POST", "/safety/scan", { json: { text: DEMO_SCAM } });
    expect(scan.status).toBe(200);
    expect(JSON.parse(scan.text).level).toBe("hold");
    expect((await maya.post("/safety/protected", { on: "1" })).status).toBe(302);
    expect((await ui(maya, "/safety")).protected.on).toBe(true);
    expect((await maya.post("/safety/protected", { on: "0" })).status).toBe(302);

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
    expect(await uiText(maya, `/telegram?chat=${CHAT}`)).toMatch(/Which item do you mean/);
    expect((await ui(maya, `/captures/${cap.id}`)).objects.length).toBeGreaterThan(1);
    ok(await maya.post(`/captures/${cap.id}/select`, { key: "lamp" }));
    // An app capture of the same link is recognised as already saved.
    expect((await maya.post("/discover/capture", { url: "https://www.youtube.com/watch?v=dSk7Setup01" })).status).toBe(302);
    expect(await all("SELECT id FROM captures")).toHaveLength(1);

    // Goal → plan → the one question → taste choice → quote → PayPal.
    ok(await maya.post("/plans", { capture_id: cap.id, text: "Help me create this comfortable study setup by Friday for $350. I already own a monitor." }));
    const intent = await one("SELECT * FROM intents ORDER BY created_at DESC LIMIT 1");
    expect(intent).toMatchObject({ budget_cents: 35000, goal: "desk_setup" });
    expect((await ui(maya, `/plans/${intent.id}`)).plan.questions[0].text).toMatch(/How does your laptop connect/);
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

    // Devices: connect the extension, use its key, disconnect it. The app's PayPal return on a paid order is a no-op.
    const dev = await maya.postJson("/api/ui/devices", { client: "extension" });
    expect(dev.status).toBe(200);
    expect((await maya.get("/api/ui/devices")).json.devices).toHaveLength(1);
    expect((await new Client(base).req("GET", "/api/ui/today", { headers: { authorization: `Bearer ${dev.json.key}` } })).status).toBe(200);
    expect((await maya.postJson(`/api/ui/devices/${dev.json.id}/revoke`, {})).status).toBe(200);
    // The phone app's demo sign-in, then it signs itself out.
    const phoneKey = (await new Client(base).postJson("/api/ui/devices/demo", { account_id: (await maya.get("/api/ui/session")).json.who.id })).json.key;
    expect((await new Client(base).postJson("/api/ui/devices/self/revoke", {}, { authorization: `Bearer ${phoneKey}` })).status).toBe(200);
    expect((await new Client(base).get(`/orders/${order.id}/paypal/return-app?token=${token}`)).location).toMatch(/^everyday:\/\/orders\//);
    expect((await new Client(base).get(`/orders/${order.id}/paypal/cancel-app`)).location).toMatch(/^everyday:\/\//);
    expect(fake.captures.size).toBe(1);

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
    // B6: Today leads with it.
    const mb = (await ui(maya, "/today")).money_back;
    expect(mb.claim_now_cents).toBe(1000);
    expect(mb.lines.find((l: any) => l.kind === "price_drop")?.line_id).toBe(dock.id);
    expect(mb.items.length).toBeGreaterThan(0);
    ok(await maya.post(`/lines/${dock.id}/price-protection`));
    expect((await ui(maya, "/today")).money_back).toMatchObject({ claim_now_cents: 0, in_progress_cents: 1000 });
    const pp = await one("SELECT * FROM cases WHERE issue = 'price_drop'");
    expect(pp).toMatchObject({ status: "awaiting_merchant", refund_cents: 1000 });
    ok(await nl.post(`/merchant/cases/${pp.id}`, { approve: "1", note: "Price matched" }));
    expect((await one("SELECT refunded_cents FROM orders WHERE id = $1", [order.id])).refunded_cents).toBe(2000 + 1500 + 1000);
    // B6: "claim price drops for me": turning it on claims a further drop without asking; the shop still decides.
    ok(await nl.post(`/merchant/products/${dock.product_id}/price`, { price: ((dock.unit_cents - 1500) / 100).toFixed(2) }));
    ok(await maya.post("/you/auto-claim", { on: "1" }));
    const auto = await one("SELECT * FROM cases WHERE issue = 'price_drop' AND status = 'awaiting_merchant'");
    expect(auto.refund_cents).toBe(500);
    ok(await nl.post(`/merchant/cases/${auto.id}`, { approve: "0", note: "Declined in the test" }));
    ok(await maya.post("/you/auto-claim", { on: "0" }));

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

    // The new front end: every screen URL serves the app shell, and each screen's data endpoint answers the right
    // party with no server error. Party boundaries hold: no session is 401, a merchant can't read shopper data.
    const runId = (await ui(maya, "/traces")).runs[0].id as string;
    const screens = ["/login", "/today", "/discover", `/captures/${cap.id}`, "/plans", `/plans/${intent.id}`, "/purchases", "/receipts", `/orders/${order.id}`, "/you", "/things", "/guard", "/passport", "/safety", "/safety/model-card", "/channels", "/traces", `/trace/${runId}`, "/merchant", "/merchant/money", "/merchant/approvals", "/demo", "/console", "/console/evidence", "/console/eval", "/telegram", "/ask", "/proof", "/ai", "/paypal", "/who-can-move-money", "/accessibility", "/agents"];
    for (const u of screens) {
      const r = await anon.get(u);
      expect(r.status, u).toBe(200);
      expect(r.text, u).toMatch(/<div id="root">/);
    }
    for (const f of ["/favicon.svg", "/robots.txt"]) expect((await anon.get(f)).status, f).toBe(200);
    expect((await anon.get("/")).status).toBe(200);
    expect((await maya.get("/")).location).toBe("/today");
    expect((await ui(anon, "/session")).who).toBeNull();
    expect((await ui(maya, "/session")).who).toMatchObject({ kind: "shopper", id: s.account });
    expect((await ui(nl, "/session")).who).toMatchObject({ kind: "merchant" });
    expect((await ui(anon, "/preview")).today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await ui(maya, "/today")).first).toBe("Maya");
    expect((await ui(maya, "/discover")).captures.map((x: any) => x.id)).toContain(cap.id);
    expect((await ui(maya, "/plans")).plans.map((x: any) => x.id)).toContain(intent.id);
    expect((await ui(maya, "/purchases")).orders.map((x: any) => x.id)).toContain(order.id);
    const od = await ui(maya, `/orders/${order.id}`);
    expect(od.order).toMatchObject({ status: "delivered", refunded_cents: 4500 });
    expect(od.ops.filter((x: any) => x.kind === "refund").length).toBe(3);
    expect(od.events.length).toBeGreaterThan(0);
    expect((await ui(maya, "/you")).owned.some((x: any) => x.title === "Kettle")).toBe(true);
    expect((await ui(maya, "/guard")).chain.ok).toBe(true);
    expect((await ui(maya, "/passport")).summary).toBeTruthy();
    expect((await ui(maya, "/channels")).address).toBe(`shopper:${s.account}`);
    expect((await ui(maya, `/trace/${runId}`)).steps.length).toBeGreaterThan(0);
    expect((await ui(nl, "/merchant")).lines.map((x: any) => x.order_id)).toContain(order.id);
    expect((await ui(nl, "/merchant/money")).totals.orders).toBeGreaterThan(0);
    expect((await ui(nl, "/merchant/approvals")).chain.ok).toBe(true);
    // The old judge page redirects to the home page's guided walk-throughs; the walk-through reads its progress here.
    expect((await anon.get("/judge")).location).toBe("/?home=1#start");
    const jr = await ui(anon, "/journey");
    expect(Array.isArray(jr.done)).toBe(true);
    const judge = await ui(anon, "/judge");
    expect(judge.paths.map((p: any) => p.id)).toEqual(["money", "buy", "scam", "receipt"]);
    expect(judge.live.length).toBeGreaterThan(8);
    expect(judge.pages.map((p: any) => p.href)).toContain("/proof");
    // A3.2: the pages that need no sign-in.
    for (const [path, key] of [["proof", "suites"], ["ai", "calls"], ["paypal", "apis"], ["roles", "roles"], ["accessibility", null], ["agents", "connect"]] as const) {
      const r = await anon.get(`/api/public/${path}`);
      expect(r.status, path).toBe(200);
      if (key) expect(Array.isArray(r.json[key]), path).toBe(true);
    }
    expect((await anon.get("/api/ui/ask/tools")).json.tools.length).toBeGreaterThan(5);
    // B6: the plan's web tier answers (no Channel3 key in tests, so it says so).
    const web = await maya.get(`/api/ui/plans/${intent.id}/web`);
    expect(web.status).toBe(200);
    expect(web.json.label).toMatch(/not purchasable in this demo/);
    // Tier 2: saying you bought a listing that isn't in the results is refused plainly (404), never a 500.
    expect((await maya.req("POST", `/api/ui/plans/${intent.id}/web/bought`, { json: { url: "https://nowhere.example/" } })).status).toBe(404);
    // B6/B5: the shopper's language is saved on the account; the exchange-rate reading is empty when rates can't be fetched.
    expect((await maya.req("POST", "/api/ui/lang", { json: { lang: "pt" } })).json).toMatchObject({ ok: true, lang: "pt" });
    expect((await one("SELECT lang FROM accounts WHERE id = $1", [s.account])).lang).toBe("pt");
    expect((await maya.req("POST", "/api/ui/lang", { json: { lang: "fr" } })).status).toBe(400);
    expect((await maya.req("POST", "/api/ui/lang", { json: { lang: "en" } })).status).toBe(200);
    expect(Array.isArray((await ui(maya, "/agents/calls")).calls)).toBe(true);
    // The taste model's card (no weights) and the shopper's own things it learns from.
    const card = await ui(maya, "/taste");
    expect(card.available).toBe(true);
    expect(card.W).toBeUndefined();
    const th = await ui(maya, "/taste/history");
    expect(th.items.length).toBeGreaterThan(0);
    expect(th.items[0]).toHaveProperty("kept");
    expect((await anon.get("/downloads/everyday-extension.zip")).status).toBe(200);
    setFxFetcher(async () => Promise.reject(new Error("no network in tests")));
    expect((await maya.get("/api/ui/fx")).json).toMatchObject({ fx: null });
    // B6: receipts in. The sample is served; reading with no model says so and offers the form; a typed line saves with its dates.
    expect((await maya.get("/api/ui/receipts/sample")).json.text).toMatch(/BrightDesk/);
    const rr = await maya.req("POST", "/api/ui/receipts/read", { json: { text: "1 x Desk lamp $20.00" } });
    expect(rr.status).toBe(422);
    expect(rr.json).toMatchObject({ manual: true });
    const rs = await maya.req("POST", "/api/ui/receipts/save", { json: { how: "manual", lines: [{ title: "Desk lamp", category: null, price_cents: 2000, purchase_date: "2026-11-01", merchant: "Elsewhere", return_days: 30, warranty_years: 1 }] } });
    expect(rs.status).toBe(200);
    expect(rs.json.items[0]).toMatchObject({ title: "Desk lamp", return_until: "2026-12-01", warranty_until: "2027-11-01" });
    // The phone QR link refuses a token it didn't sign.
    const join = await anon.get("/demo/join?t=forged");
    expect(join.status).toBe(302);
    expect(join.location ?? "").toMatch(/err=/);
    expect((await anon.req("POST", "/api/ui/ask", { json: { question: "hi" } })).status).toBe(401);
    expect((await ui(anon, "/demo")).demo).toBe(true);
    expect((await ui(anon, "/console")).weights.length).toBeGreaterThan(0);
    expect((await ui(anon, "/evidence")).real.captures).toBeGreaterThan(0);
    expect((await ui(anon, "/eval?suite=capture")).suite).toBe("capture");
    expect((await anon.get("/api/ui/today")).status).toBe(401);
    expect((await anon.get(`/api/ui/orders/${order.id}`)).status).toBe(401);
    expect((await nl.get(`/api/ui/orders/${order.id}`)).status).toBeGreaterThanOrEqual(400);
    expect((await maya.get("/api/ui/merchant")).status).toBeGreaterThanOrEqual(400);
    expect((await anon.get("/api/ui/nope")).status).toBe(404);

    // The front end's bridge: the same form routes, but a redirect comes back as JSON the app can show.
    const bridged = await maya.req("POST", "/you/limit", { form: { limit: "450" }, headers: { "x-everyday-ui": "1" } });
    expect(bridged.status).toBe(200);
    expect(bridged.json).toMatchObject({ to: "/you", external: false });
    expect(bridged.json.ok).toBeTruthy();
    const refused = await maya.req("POST", `/orders/${order.id}/pay`, { form: {}, headers: { "x-everyday-ui": "1" } });
    expect(refused.status).toBe(200);
    expect(refused.json.err).toBeTruthy();

    // Demo controls: the clock, the reconciler again, and a reset; then sign out.
    ok(await anon.post("/demo/clock", { step: "day" }));
    ok(await maya.post("/console/fault", { f: "refund_503" }));
    ok(await maya.post("/demo/reset"));
    expect((await one("SELECT COUNT(*)::int AS n FROM orders")).n).toBe(0);
    expect((await nl.post("/logout")).status).toBe(302);

    expect(srv.failures).toEqual([]);
    expect(srv.missed({ ...FOUNDATION_ROUTES, ...ELSEWHERE })).toEqual([]);
  });
});
