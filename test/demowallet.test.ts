import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { checkDemoWallet, setWalletOff } from "../src/services/demowallet.js";
import { seed, type Seeded } from "../src/services/seed.js";
import { Client } from "./client.js";

// A2.1: the demo's saved sandbox wallet. A demo visitor pays a real (here: fake) PayPal order with no login; the order
// counts as paid only after the capture is read back, and says it was paid from the saved wallet. With the wallet
// missing, switched off or gone, only PayPal's own page is offered and no PayPal id is made up.

let db: Db;
let fake: FakePayPal;
let server: Server;
let base: string;
let s: Seeded;
const TOKEN = "demo-vault-token-test";
const saved = { token: config.paypal.demoVaultToken, email: config.paypal.demoVaultEmail, demo: config.demoMode, admin: config.adminKey };

const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0];
const msgOf = (r: { location: string | null }, k: "ok" | "err") => decodeURIComponent(new URL(r.location!, base).searchParams.get(k) ?? "");

async function login(as: string) {
  const c = new Client(base);
  expect((await c.post("/login", { as })).status).toBe(302);
  return c;
}
async function quote(maya: Client) {
  const intent = new URL((await maya.post("/plans", { text: "a desk lamp under $80 by Friday" })).location!, base).pathname.split("/").pop()!;
  expect((await maya.post(`/plans/${intent}/quote`)).status).toBe(302);
  return one("SELECT q.* FROM quotes q JOIN plans p ON p.id = q.plan_id WHERE p.intent_id = $1 ORDER BY q.created_at DESC LIMIT 1", [intent]);
}

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  fake.tokens.add(TOKEN);
  setPayPal(fake);
  config.demoMode = true;
  config.paypal.demoVaultToken = TOKEN;
  config.paypal.demoVaultEmail = "sb-demo@personal.example.com";
  s = await db.tx((q) => seed(q, { anchor: "2026-11-09T09:00" }));
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.close();
  setPayPal(null);
  Object.assign(config.paypal, { demoVaultToken: saved.token, demoVaultEmail: saved.email });
  config.demoMode = saved.demo;
  config.adminKey = saved.admin;
  await db.close();
});

describe("the demo's saved wallet", () => {
  it("pays the approved quote with no PayPal login, reads the capture back, and labels the record", async () => {
    const maya = await login(`acc:${s.account}`);
    const session = (await maya.get("/api/ui/session")).json;
    expect(session.demo_wallet).toMatchObject({ usable: true, email: "sb-demo@personal.example.com" });
    expect(JSON.stringify(session)).not.toContain(TOKEN); // the token itself never reaches a page

    const q = await quote(maya);
    const r = await maya.post(`/quotes/${q.id}/approve-demo`, { hash: q.hash });
    expect(r.status).toBe(302);
    expect(msgOf(r, "ok")).toMatch(/^Paid from the demo's saved sandbox wallet\. PayPal capture \S+ confirmed\.$/);
    const o = await one("SELECT * FROM orders WHERE quote_id = $1", [q.id]);
    expect(o).toMatchObject({ status: "paid", paid_via: "demo_wallet" });
    // The id on the order is the capture PayPal holds, read back, for the quoted total.
    const cap = fake.captures.get(o.capture_id)!;
    expect(cap.status).toBe("COMPLETED");
    expect(Math.round(Number(cap.amount.value) * 100)).toBe(o.total_cents);
    expect(fake.orders.get(o.paypal_order_id)!.vault).toBe(TOKEN);
    expect(fake.calls).toContain("getCapture");
    const ops = (await db.query<any>("SELECT kind, status, reason FROM payment_ops WHERE order_id = $1 ORDER BY created_at", [o.id])).rows;
    expect(ops.map((x) => [x.kind, x.status, x.reason])).toEqual([
      ["order", "succeeded", "Paid from the demo's saved sandbox wallet"],
      ["capture", "succeeded", "Paid from the demo's saved sandbox wallet"],
    ]);
    const view = (await maya.get(`/api/ui/orders/${o.id}`)).json;
    expect(view.order.paid_via).toBe("demo_wallet");

    // Paying again is refused; nothing new reaches PayPal.
    const before = fake.orders.size;
    expect(msgOf(await maya.post(`/orders/${o.id}/pay-demo`), "err")).toMatch(/already paid/);
    expect(fake.orders.size).toBe(before);
  });

  it("an unpaid order (left on PayPal's page) can be paid from the wallet instead", async () => {
    const maya = await login(`acc:${s.account}`);
    const q = await quote(maya);
    const page = await maya.post(`/quotes/${q.id}/approve`, { hash: q.hash });
    expect(page.location).toMatch(/paypal|token=/);
    const o = await one("SELECT * FROM orders WHERE quote_id = $1", [q.id]);
    expect(o.paid_via).toBe("paypal_page");
    const r = await maya.post(`/orders/${o.id}/pay-demo`);
    expect(msgOf(r, "ok")).toMatch(/saved sandbox wallet/);
    expect(await one("SELECT status, paid_via FROM orders WHERE id = $1", [o.id])).toMatchObject({ status: "paid", paid_via: "demo_wallet" });
  });

  it("with the wallet switched off, missing or gone, only PayPal's page is offered and no id is invented", async () => {
    const maya = await login(`acc:${s.account}`);
    await setWalletOff(true);
    expect((await maya.get("/api/ui/session")).json.demo_wallet).toMatchObject({ usable: false, state: "off" });
    const q = await quote(maya);
    const before = fake.orders.size;
    expect(msgOf(await maya.post(`/quotes/${q.id}/approve-demo`, { hash: q.hash }), "err")).toMatch(/saved PayPal wallet isn't available.*PayPal's own page/);
    expect(fake.orders.size).toBe(before);
    const o = await one("SELECT * FROM orders WHERE quote_id = $1", [q.id]);
    expect(o).toMatchObject({ status: "created", paypal_order_id: null, capture_id: null });

    await setWalletOff(false);
    fake.tokens.delete(TOKEN); // PayPal no longer has it
    expect((await checkDemoWallet()).state).toBe("gone");
    expect((await maya.get("/api/ui/session")).json.demo_wallet).toMatchObject({ usable: false, state: "gone" });
    expect(msgOf(await maya.post(`/orders/${o.id}/pay-demo`), "err")).toMatch(/isn't available/);

    config.paypal.demoVaultToken = "";
    expect((await maya.get("/api/ui/session")).json.demo_wallet).toMatchObject({ usable: false, state: "missing" });
    // PayPal's own page still works.
    expect((await maya.post(`/orders/${o.id}/pay`)).location).toMatch(/token=/);
  });

  it("is never used outside demo mode", async () => {
    const maya = await login(`acc:${s.account}`);
    const q = await quote(maya);
    config.demoMode = false;
    expect((await maya.get("/api/ui/session")).json.demo_wallet).toBeNull();
    expect(msgOf(await maya.post(`/quotes/${q.id}/approve-demo`, { hash: q.hash }), "err")).toMatch(/only in demo mode/);
  });

  it("a PayPal refusal of the token marks the wallet as needing re-approval", async () => {
    const maya = await login(`acc:${s.account}`);
    const q = await quote(maya);
    fake.tokens.delete(TOKEN);
    const r = await maya.post(`/quotes/${q.id}/approve-demo`, { hash: q.hash });
    expect(msgOf(r, "err")).toMatch(/PayPal refused the payment from the demo's saved wallet.*Nothing was charged/);
    expect((await maya.get("/api/ui/session")).json.demo_wallet.usable).toBe(false);
  });

  it("the operator page is closed without the key, and with it can switch the wallet off and back on", async () => {
    config.adminKey = "";
    expect((await new Client(base).get("/admin")).status).toBe(404);
    config.adminKey = "operator-test-key";
    const op = new Client(base);
    expect((await op.get("/admin/paypal/wallet")).location).toBe("/admin");
    expect((await op.post("/admin/login", { key: "wrong" })).location).toMatch(/err=/);
    expect((await op.post("/admin/login", { key: "operator-test-key" })).location).toBe("/admin/paypal/wallet");
    const pageHtml = (await op.get("/admin/paypal/wallet")).text;
    expect(pageHtml).toContain("…" + TOKEN.slice(-4));
    expect(pageHtml).not.toContain(TOKEN);
    await op.post("/admin/paypal/wallet/off");
    expect((await new Client(base).get("/api/ui/session")).json.demo_wallet.state).toBe("off");
    await op.post("/admin/paypal/wallet/on");
    const checked = await op.post("/admin/paypal/wallet/check");
    expect(checked.location).toMatch(/ok=/);
    expect((await new Client(base).get("/api/ui/session")).json.demo_wallet.state).toBe("ok");
  });
});

describe("A4: quote expiry on the demo clock", () => {
  it("a demo quote outlives real time and runs out only when the demo clock passes it", async () => {
    const maya = await login(`acc:${s.account}`);
    const q = await quote(maya);
    expect(q.expires_wall).toBe("2026-11-09T09:15");
    // Real time has passed the server deadline: on a demo account that doesn't matter.
    await db.query("UPDATE quotes SET expires_at = now() - interval '2 hours' WHERE id = $1", [q.id]);
    // Move the demo clock a working day on: the quote is now past its time on that clock.
    expect((await maya.post("/demo/clock", { step: "day" })).status).toBe(302);
    const r = await maya.post(`/quotes/${q.id}/approve-demo`, { hash: q.hash });
    expect(msgOf(r, "err")).toMatch(/This quote expired/);
    // The plan no longer offers it (the refusal rolls back, so the row itself may still say open).
    const intent = (await one("SELECT intent_id FROM plans WHERE id = $1", [q.plan_id])).intent_id;
    expect((await maya.get(`/api/ui/plans/${intent}`)).json.quote).toBeNull();
  });
  it("before the clock moves, the same quote still pays", async () => {
    const maya = await login(`acc:${s.account}`);
    const q = await quote(maya);
    await db.query("UPDATE quotes SET expires_at = now() - interval '2 hours' WHERE id = $1", [q.id]);
    const intent = (await one("SELECT intent_id FROM plans WHERE id = $1", [q.plan_id])).intent_id;
    const shown = (await maya.get(`/api/ui/plans/${intent}`)).json.quote;
    expect(shown).toMatchObject({ id: q.id, expires_at: null, expires_on_clock: "Mon 9 Nov 09:15" });
    const r = await maya.post(`/quotes/${q.id}/approve-demo`, { hash: q.hash });
    expect(msgOf(r, "ok")).toMatch(/^Paid from the demo's saved sandbox wallet/);
  });
});

describe("A4/E4: plan dates on the demo clock", () => {
  it("a plan says when it was made on the demo clock, not the server's date", async () => {
    const maya = await login(`acc:${s.account}`);
    const q = await quote(maya);
    const intent = (await one("SELECT intent_id FROM plans WHERE id = $1", [q.plan_id])).intent_id;
    expect((await maya.get(`/api/ui/plans/${intent}`)).json.intent.created_at).toBe("2026-11-09T09:00");
    const row = (await maya.get("/api/ui/plans")).json.plans.find((p: any) => p.id === intent);
    expect(row.created_at).toBe("2026-11-09T09:00");
  });
});

describe("A4: health check", () => {
  it("checks the database and names the build", async () => {
    const saved = config.commit;
    config.commit = "abc1234";
    const h = await (await fetch(`${base}/healthz`)).json();
    config.commit = saved;
    expect(h).toMatchObject({ ok: true, db: { ok: true }, commit: "abc1234" });
  });
});
