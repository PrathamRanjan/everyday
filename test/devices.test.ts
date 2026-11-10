import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { seed, type Seeded } from "../src/services/seed.js";
import { Client } from "./client.js";

// The phone app and the browser extension: device keys made on the website, used as Bearer tokens, revocable; their
// captures and plans are tagged by client; the phone app's PayPal return lands back in the app.

let db: Db;
let fake: FakePayPal;
let server: Server;
let base: string;
let s: Seeded;

const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0];

async function login(as: string) {
  const c = new Client(base);
  const r = await c.post("/login", { as });
  expect(r.status).toBe(302);
  return c;
}
/** A client that sends only the device key, as the extension and the app do. */
const device = (key: string, client: "mobile" | "extension") => {
  const c = new Client(base);
  const headers = { authorization: `Bearer ${key}`, "x-everyday-client": client };
  return {
    get: (p: string) => c.req("GET", p, { headers }),
    post: (p: string, form: Record<string, string> = {}) => c.req("POST", p, { form, headers }),
    ui: (p: string, form: Record<string, string> = {}) => c.req("POST", p, { form, headers: { ...headers, "x-everyday-ui": "1" } }),
    postJson: (p: string, json: unknown) => c.req("POST", p, { json, headers }),
  };
};

beforeEach(async () => {
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

describe("device keys", () => {
  it("a key made on the website acts as the shopper, only from the website can make more, and stops working when revoked", async () => {
    const maya = await login(`acc:${s.account}`);
    const made = await maya.postJson("/api/ui/devices", { client: "extension" });
    expect(made.status).toBe(200);
    expect(made.json.key).toMatch(/^evd_/);
    const stored = await one("SELECT key_hash, client FROM device_keys WHERE id = $1", [made.json.id]);
    expect(stored.client).toBe("extension");
    expect(stored.key_hash).not.toContain(made.json.key); // only the hash is kept

    const ext = device(made.json.key, "extension");
    const who = await ext.get("/api/ui/session");
    expect(who.json.who).toMatchObject({ kind: "shopper", id: s.account });
    expect((await ext.get("/api/ui/today")).status).toBe(200);
    // A device can't mint more devices.
    expect((await ext.postJson("/api/ui/devices", { client: "mobile" })).status).toBe(403);
    // Used: the website shows when.
    const listed = (await maya.get("/api/ui/devices")).json.devices;
    expect(listed[0]).toMatchObject({ client: "extension", revoked: false });

    expect((await maya.postJson(`/api/ui/devices/${made.json.id}/revoke`, {})).status).toBe(200);
    expect((await ext.get("/api/ui/today")).status).toBe(401);
    expect((await ext.get("/api/ui/session")).json.who).toBeNull();
  });

  it("a wrong key or the merchant's agent key never signs anyone in", async () => {
    expect((await device("evd_not-a-real-key-at-all", "extension").get("/api/ui/today")).status).toBe(401);
    const asMerchant = device(s.keys.northlight, "extension");
    expect((await asMerchant.get("/api/ui/merchant")).status).toBe(401);
    expect((await asMerchant.get("/api/ui/session")).json.who).toBeNull();
  });

  it("tags captures and plans with the client that made them", async () => {
    const maya = await login(`acc:${s.account}`);
    const key = (await maya.postJson("/api/ui/devices", { client: "extension" })).json.key;
    const ext = device(key, "extension");
    const cap = await ext.ui("/discover/capture", { url: "https://shop.example.com/products/oak-desk-lamp", text: "Oak desk lamp, $49 at shop.example.com" });
    expect(cap.status).toBe(200);
    expect(cap.json.to).toMatch(/^\/captures\/cap_/);
    expect(await one("SELECT channel, url FROM captures ORDER BY created_at DESC LIMIT 1")).toMatchObject({ channel: "extension", url: "https://shop.example.com/products/oak-desk-lamp" });

    const phone = device((await maya.postJson("/api/ui/devices", { client: "mobile" })).json.key, "mobile");
    const plan = await phone.ui("/plans", { text: "a desk lamp under $80 by Friday" });
    expect(plan.json.to).toMatch(/^\/plans\/int_/);
    expect(await one("SELECT channel FROM intents ORDER BY created_at DESC LIMIT 1")).toMatchObject({ channel: "mobile" });
  });

  it("the phone app's checkout returns to the app, paid, and a mismatched token changes nothing", async () => {
    const maya = await login(`acc:${s.account}`);
    const phone = device((await maya.postJson("/api/ui/devices", { client: "mobile" })).json.key, "mobile");
    const intent = new URL((await phone.post("/plans", { text: "a desk lamp under $80 by Friday" })).location!, base).pathname.split("/").pop()!;
    expect((await phone.post(`/plans/${intent}/quote`)).status).toBe(302);
    const q = await one("SELECT q.* FROM quotes q JOIN plans p ON p.id = q.plan_id WHERE p.intent_id = $1 ORDER BY q.created_at DESC LIMIT 1", [intent]);
    const approve = await phone.ui(`/quotes/${q.id}/approve`, { hash: q.hash });
    expect(approve.json.external).toBe(true);
    const token = new URL(approve.json.to).searchParams.get("token")!;
    // PayPal is told to send the buyer back through the app route.
    expect(decodeURIComponent(approve.json.to)).toMatch(/\/paypal\/return-app/);
    const o = await one("SELECT * FROM orders WHERE quote_id = $1", [q.id]);

    const wrong = await new Client(base).get(`/orders/${o.id}/paypal/return-app?token=NOT-${token}`);
    expect(wrong.location).toMatch(/^everyday:\/\/orders\/.+\?err=/);
    expect((await one("SELECT status FROM orders WHERE id = $1", [o.id])).status).toBe("created");

    fake.approveOrder(token);
    const back = await new Client(base).get(`/orders/${o.id}/paypal/return-app?token=${token}`);
    expect(back.status).toBe(302);
    expect(back.location).toBe(`everyday://orders/${o.id}?ok=${encodeURIComponent("Paid and confirmed with PayPal.")}`);
    expect((await one("SELECT status, capture_id FROM orders WHERE id = $1", [o.id])).status).toBe("paid");

    const cancel = await new Client(base).get(`/orders/${o.id}/paypal/cancel-app`);
    expect(cancel.location).toMatch(/^everyday:\/\/orders\/.+\?err=Payment%20cancelled$/);
  });
});
