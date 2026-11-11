import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { expireWorkspaces, rebuildShowcase, seedMoney, workspaceById } from "../src/services/workspaces.js";
import { Client } from "./client.js";

// A1: a private demo workspace for every visitor. Two visitors start demos; each sees its own rows on every list
// endpoint, an action in one never shows in the other, a PayPal webhook lands in the right workspace, an idle
// workspace is deleted after 48 hours, and the landing preview reads the showcase workspace.

let db: Db;
let fake: FakePayPal;
let server: Server;
let base: string;
const TOKEN = "demo-vault-token-ws";
const saved = { token: config.paypal.demoVaultToken, demo: config.demoMode, priv: config.privateDemos, admin: config.adminKey };
const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0];
const flash = (r: { location: string | null }, k: "ok" | "err" = "err") => decodeURIComponent(new URL(r.location ?? "/", base).searchParams.get(k) ?? "");

/** Every list or detail endpoint a visitor's pages read. */
const SHOPPER_LISTS = ["/api/ui/session", "/api/ui/personas", "/api/ui/today", "/api/ui/discover", "/api/ui/plans", "/api/ui/purchases", "/api/ui/you", "/api/ui/guard", "/api/ui/passport", "/api/ui/safety", "/api/ui/devices", "/api/ui/channels", "/api/ui/traces", "/api/ui/demo", "/api/ui/console", "/api/ui/evidence", "/api/ui/workspace", "/guard/runs.json", "/guard/audit.json"];
const MERCHANT_LISTS = ["/api/ui/session", "/api/ui/merchant", "/api/ui/merchant/money", "/api/ui/merchant/approvals", "/api/ui/channels", "/api/ui/traces"];

async function startDemo(ip = "203.0.113.7") {
  const c = new Client(base);
  const r = await c.req("POST", "/demo/start", { form: {}, headers: { "x-forwarded-for": ip } });
  expect(r.status, r.location ?? "").toBe(302);
  expect(flash(r, "ok")).toMatch(/Your own demo is ready/);
  const w = (await c.get("/api/ui/workspace")).json.workspace;
  expect(w).toMatchObject({ kind: "visitor", state: "ready" });
  // Wait for the background payments (the fake PayPal answers at once); this joins the run already going.
  const p = await seedMoney(w.id);
  if (p.payments_failed) console.log(JSON.stringify(p.steps));
  return { c, ws: w.id as string, join: w.join_url as string };
}

async function idsOf(ws: string) {
  const acc = await one("SELECT id FROM accounts WHERE ws_id = $1", [ws]);
  const mer = (await db.query<any>("SELECT id FROM merchants WHERE ws_id = $1", [ws])).rows.map((r) => r.id);
  const orders = (await db.query<any>("SELECT id, capture_id, paypal_order_id FROM orders WHERE account_id = $1", [acc.id])).rows;
  const runs = (await db.query<any>("SELECT id FROM agent_runs WHERE ws_id = $1", [ws])).rows.map((r) => r.id);
  const intents = (await db.query<any>("SELECT id FROM intents WHERE account_id = $1", [acc.id])).rows.map((r) => r.id);
  return { account: acc.id as string, merchants: mer as string[], orders, runs, intents, all: [ws, acc.id, ...mer, ...orders.flatMap((o: any) => [o.id, o.capture_id, o.paypal_order_id].filter(Boolean)), ...runs, ...intents] as string[] };
}

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  fake.tokens.add(TOKEN);
  setPayPal(fake);
  config.demoMode = true;
  config.privateDemos = true;
  config.paypal.demoVaultToken = TOKEN;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.close();
  setPayPal(null);
  config.paypal.demoVaultToken = saved.token;
  config.demoMode = saved.demo;
  config.privateDemos = saved.priv;
  config.adminKey = saved.admin;
  await db.close();
});

describe("private demo workspaces", () => {
  it("two visitors each get their own populated demo; nothing from one appears in the other", async () => {
    const A = await startDemo("203.0.113.7");
    const B = await startDemo("198.51.100.9");
    expect(A.ws).not.toBe(B.ws);

    // Each seed made real (fake) PayPal payments through the app's own executor, read back, and numbered its own.
    for (const v of [A, B]) {
      const w = (await v.c.get("/api/ui/workspace")).json.workspace;
      expect(w.progress).toMatchObject({ payments_planned: 2, payments_confirmed: 2, payments_failed: 0, finished: true });
      expect(w.progress_line).toBe("2 of 2 payments confirmed by PayPal.");
      const p = (await v.c.get("/api/ui/purchases")).json;
      const numbers = JSON.stringify(p).match(/EV-40\d\d/g) ?? [];
      expect(new Set(numbers)).toEqual(new Set(["EV-4001", "EV-4002"]));
    }
    const a = await idsOf(A.ws);
    const b = await idsOf(B.ws);
    for (const o of [...a.orders, ...b.orders]) expect(fake.captures.get(o.capture_id)?.status).toBe("COMPLETED");
    // The custom_id on each PayPal order names its workspace.
    for (const o of a.orders) expect(fake.orders.get(o.paypal_order_id)!.customId).toBe(`${A.ws}:${o.id}`);

    // Act in A: stop everything, and the shop changes a price.
    expect((await A.c.post("/guard/kill", { scope: "account", engaged: "1", reason: "testing" })).status).toBe(302);
    const nlA = a.merchants[0];
    const lampA = await one("SELECT p.id, p.price_cents FROM products p WHERE p.merchant_id = $1 AND p.category = 'lamp' ORDER BY price_cents LIMIT 1", [nlA]);
    const shopA = new Client(base);
    shopA.cookies = new Map(A.c.cookies);
    expect(flash(await shopA.post("/login", { as: `mer:${nlA}` }), "err")).toBe("");
    await shopA.post(`/merchant/products/${lampA.id}/price`, { price: String(lampA.price_cents / 100 - 5) });
    expect((await one("SELECT price_cents FROM products WHERE id = $1", [lampA.id])).price_cents).toBe(lampA.price_cents - 500);

    // B's catalog price is untouched and B's kill switch is off.
    const lampB = await one("SELECT p.price_cents FROM products p JOIN merchants m ON m.id = p.merchant_id WHERE m.ws_id = $1 AND p.category = 'lamp' ORDER BY price_cents LIMIT 1", [B.ws]);
    expect(lampB.price_cents).toBe(lampA.price_cents);
    expect((await B.c.get("/api/ui/guard")).json.kill).toEqual({ engaged: false, reason: null });
    expect((await A.c.get("/api/ui/guard")).json.kill).toEqual({ engaged: true, reason: "testing" });

    // Every list endpoint of B (as Maya, then as B's shop) holds none of A's ids, and vice versa.
    const shopB = new Client(base);
    shopB.cookies = new Map(B.c.cookies);
    expect(flash(await shopB.post("/login", { as: `mer:${b.merchants[0]}` }), "err")).toBe("");
    const a2 = await idsOf(A.ws);
    for (const [client, paths, foreign] of [[B.c, SHOPPER_LISTS, a2.all], [shopB, MERCHANT_LISTS, a2.all], [A.c, SHOPPER_LISTS, b.all], [shopA, MERCHANT_LISTS, b.all]] as const) {
      for (const p of paths) {
        const r = await client.get(p);
        expect(r.status, p).toBeLessThan(400);
        for (const id of foreign) expect(r.text.includes(id), `${p} leaks ${id}`).toBe(false);
      }
    }
    // A's runs, orders and plans are not readable from B by id either.
    expect((await B.c.get(`/api/ui/orders/${a.orders[0].id}`)).status).toBe(404);
    expect((await B.c.get(`/api/ui/trace/${a.runs[0]}`)).status).toBe(404);
    expect((await B.c.get(`/api/ui/plans/${a.intents[0]}`)).status).toBe(404);

    // A persona of another workspace cannot be chosen.
    expect(flash(await B.c.post("/login", { as: `acc:${a.account}` }))).toMatch(/Start your own demo|isn't part/);
    expect(flash(await B.c.post("/login", { as: `mer:${nlA}` }))).toMatch(/Start your own demo|isn't part/);

    // A PayPal webhook for A's order lands in A's workspace (custom_id), and by the recorded reference otherwise.
    const ppA = fake.orders.get(a.orders[0].paypal_order_id)!;
    await new Client(base).req("POST", "/webhooks/paypal", { json: { id: "WH-1", event_type: "CHECKOUT.ORDER.COMPLETED", resource: { id: ppA.id, purchase_units: [{ custom_id: `${A.ws}:${a.orders[0].id}` }] } } });
    await new Client(base).req("POST", "/webhooks/paypal", { json: { id: "WH-2", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: b.orders[0].capture_id } } });
    expect((await one("SELECT ws_id FROM webhook_events WHERE id = 'WH-1'")).ws_id).toBe(A.ws);
    expect((await one("SELECT ws_id FROM webhook_events WHERE id = 'WH-2'")).ws_id).toBe(B.ws);

    // The second-device link opens the same workspace.
    const phone = new Client(base);
    expect(flash(await phone.get(new URL(B.join).pathname), "ok")).toMatch(/same demo/);
    expect((await phone.get("/api/ui/session")).json.who.id).toBe(b.account);

    // "Reset my demo" rebuilds only B.
    expect(flash(await B.c.post("/demo/reset"), "ok")).toMatch(/Only yours/);
    expect(await one("SELECT id FROM accounts WHERE id = $1", [b.account])).toBeUndefined();
    expect((await one("SELECT count(*)::int AS n FROM orders WHERE account_id = $1", [a.account])).n).toBe(2);
    expect((await workspaceById(B.ws))!.seed_state).toBe("ready");

    // 48 idle hours later A is gone, rows and all; B stays.
    await db.query("UPDATE workspaces SET expires_at = now() - interval '1 minute' WHERE id = $1", [A.ws]);
    expect(await expireWorkspaces()).toBe(1);
    expect(await workspaceById(A.ws)).toBeNull();
    for (const t of ["accounts", "merchants"]) expect((await one(`SELECT count(*)::int AS n FROM ${t} WHERE ws_id = $1`, [A.ws])).n).toBe(0);
    for (const t of ["orders", "intents", "owned_items", "recipients"]) expect((await one(`SELECT count(*)::int AS n FROM ${t} WHERE account_id = $1`, [a.account])).n).toBe(0);
    expect((await one("SELECT count(*)::int AS n FROM products WHERE merchant_id = ANY($1::text[])", [a.merchants])).n).toBe(0);
    expect((await one("SELECT count(*)::int AS n FROM kill_switches WHERE starts_with(scope, $1)", [`${A.ws}|`])).n).toBe(0);
    expect((await workspaceById(B.ws))).not.toBeNull();
    // A's old cookie no longer reaches anything.
    expect((await A.c.get("/api/ui/session")).json.who).toBeNull();
  }, 60_000);

  it("rate limits starts per address, offers no shared world, and the landing preview reads the showcase", async () => {
    const anon = new Client(base);
    expect((await anon.get("/api/ui/personas")).json).toMatchObject({ accounts: [], merchants: [], private_demos: true });
    expect(flash(await anon.post("/demo/reset"))).toMatch(/Start your own demo/);
    for (let i = 0; i < 5; i++) expect((await new Client(base).req("POST", "/demo/start", { form: {}, headers: { "x-forwarded-for": "192.0.2.1" } })).status).toBe(302);
    expect(flash(await new Client(base).req("POST", "/demo/start", { form: {}, headers: { "x-forwarded-for": "192.0.2.1" } }))).toMatch(/5 demos in the last hour/);
    // E10: the landing page's start lands on Ask with a question typed; any other target falls back to Today.
    const toAsk = await new Client(base).req("POST", "/demo/start", { form: { next: "/ask?q=What%20can%20I%20still%20get%20money%20back%20on%3F" }, headers: { "x-forwarded-for": "192.0.2.2" } });
    expect(toAsk.location ?? "").toMatch(/^\/ask\?q=What%20can%20I%20still%20get%20money%20back%20on%3F&ok=/);
    const off = await new Client(base).req("POST", "/demo/start", { form: { next: "https://elsewhere.example/" }, headers: { "x-forwarded-for": "192.0.2.3" } });
    expect(off.location ?? "").toMatch(/^\/today\?ok=/);

    const sc = await rebuildShowcase({ background: false });
    const pv = (await anon.get("/api/ui/preview")).json;
    expect(pv).toMatchObject({ source: "showcase", showcase: sc.id });
    const scOrder = await one("SELECT o.number, l.title FROM orders o JOIN order_lines l ON l.order_id = o.id WHERE o.account_id = $1 AND o.capture_id IS NOT NULL ORDER BY o.created_at DESC LIMIT 1", [sc.account_id]);
    expect(pv.line).toMatchObject({ number: scOrder.number, title: scOrder.title, paid: true });
    // Visitors can't sign in to the showcase.
    expect(flash(await anon.post("/login", { as: `acc:${sc.account_id}` }))).toMatch(/Start your own demo/);

    // With the saved wallet off, a new demo says plainly that it has no PayPal payments.
    const { setWalletOff } = await import("../src/services/demowallet.js");
    await setWalletOff(true);
    const C = new Client(base);
    await C.req("POST", "/demo/start", { form: {}, headers: { "x-forwarded-for": "192.0.2.99" } });
    const w = (await C.get("/api/ui/workspace")).json.workspace;
    const p = await seedMoney(w.id);
    expect(p.payments_planned).toBe(0);
    expect((await C.get("/api/ui/workspace")).json.workspace.progress_line).toMatch(/saved sandbox wallet isn't available.*no PayPal payments/);
    expect((await one("SELECT count(*)::int AS n FROM orders o JOIN accounts a ON a.id = o.account_id WHERE a.ws_id = $1 AND o.capture_id IS NOT NULL", [w.id])).n).toBe(0);
  }, 60_000);

  it("the operator page lists workspaces, rebuilds the showcase and resets everything; visitors can't", async () => {
    config.adminKey = "operator-ws-key";
    const op = new Client(base);
    await op.post("/admin/login", { key: "operator-ws-key" });
    const A = await startDemo();
    expect((await op.get("/admin/demo")).text).toMatch(/Live visitor demos<\/dt><dd>1 of 300/);
    expect((await op.post("/admin/demo/showcase")).location).toMatch(/ok=/);
    expect((await op.post("/admin/demo/reset-all", {})).location).toMatch(/err=/);
    expect((await op.post("/admin/demo/reset-all", { sure: "1" })).location).toMatch(/ok=/);
    expect(await workspaceById(A.ws)).toBeNull();
    expect((await new Client(base).post("/admin/demo/reset-all", { sure: "1" })).location).toBe("/admin");
    // Wave 5: the robot judge's run is stored only with the operator key in the header, and /proof shows it.
    const run = { run_on: "2099-01-01T00:00:00.000Z", target: "https://example.test", by: "robot", paths: [{ id: "scam", title: "Check a scam message", ok: true, seconds: 9, error: null, steps: [{ key: "scam_checked", label: "Checked", done: true }] }] };
    const anonPost = await new Client(base).req("POST", "/admin/robot-judge", { json: run });
    expect(anonPost.status).toBe(302);
    expect((await new Client(base).req("POST", "/admin/robot-judge", { json: { run_on: 1 }, headers: { "x-everyday-operator": "operator-ws-key" } })).status).toBe(400);
    const stored = await new Client(base).req("POST", "/admin/robot-judge", { json: run, headers: { "x-everyday-operator": "operator-ws-key" } });
    expect(stored.json).toMatchObject({ stored: true, ok: true });
    const proof = (await new Client(base).get("/api/public/proof")).json.robot_judge;
    expect(proof).toMatchObject({ run_on: "2099-01-01T00:00:00.000Z", ok: true });
    expect(proof.stored).toMatch(/robot judge job/);
  }, 60_000);
});
