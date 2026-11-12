/**
 * Foundation and widening walk (roadmap B + C for Everyday): guard (mandate, backtest, kill switch, approvals,
 * passkey endpoints), traces and the API, judge mode, channels simulator and webhooks, PWA endpoints, passport
 * (vault, repeat buys behind the gate), merchant money (tracking, disputes, transaction search, negative tests),
 * the MCP shopper agent, the evidence console and the evals. Ends by asserting every route in FOUNDATION_ROUTES
 * was reached and no request returned a 5xx.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { drain } from "../src/jobs.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { setProviderFetch } from "../src/ai/provider.js";
import { seedAll, type Seeded } from "../src/services/seed.js";
import { handlers } from "../src/worker.js";
import { Client } from "./client.js";
import { FOUNDATION_ROUTES } from "./foundation-routes.js";
import { serveTracked } from "./journey-coverage.js";

let db: Db;
let fake: FakePayPal;
let srv: Awaited<ReturnType<typeof serveTracked>>;
let base: string;
let s: Seeded;

const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0];
const all = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows;
const ok = (r: { status: number; location: string | null }) => {
  expect(r.status, r.location ?? "").toBe(302);
  expect(decodeURIComponent(r.location ?? "")).not.toMatch(/[?&]err=/);
  return r;
};
const flash = (r: { location: string | null }) => decodeURIComponent(new URL(r.location!, base).searchParams.get("err") ?? new URL(r.location!, base).searchParams.get("ok") ?? "");
const ui = async (c: Client, p: string) => {
  const r = await c.get(`/api/ui${p}`);
  expect(r.status, p).toBe(200);
  return r.json as any;
};
const uiText = async (c: Client, p: string) => JSON.stringify(await ui(c, p));


beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  fake = new FakePayPal();
  setPayPal(fake);
  config.channels.telegramSecret = "";
  s = await seedAll({ anchor: "2026-11-09T09:00" });
  srv = await serveTracked(createApp());
  base = srv.base;
});
afterEach(async () => {
  setProviderFetch(null);
  await srv.close();
  await db.close();
});

/** A paid order: plan, quote, approve on (fake) PayPal, settle. */
async function paidOrder(maya: Client) {
  ok(await maya.post("/plans", { text: "a quiet wireless mouse for $60" }));
  const intent = await one("SELECT id FROM intents ORDER BY created_at DESC LIMIT 1");
  const plan = await one("SELECT body FROM plans WHERE intent_id = $1 AND status = 'current'", [intent.id]);
  if (plan.body.questions?.length) ok(await maya.post(`/plans/${intent.id}/answer`, { key: plan.body.questions[0].key, value: plan.body.questions[0].choices[0].value }));
  ok(await maya.post(`/plans/${intent.id}/quote`));
  const q = await one("SELECT * FROM quotes WHERE status = 'open' ORDER BY created_at DESC LIMIT 1");
  const r = await maya.post(`/quotes/${q.id}/approve`, { hash: q.hash });
  expect(r.status, flash(r)).toBe(302);
  const token = new URL(r.location!).searchParams.get("token")!;
  fake.approveOrder(token);
  const o = await one("SELECT * FROM orders WHERE quote_id = $1", [q.id]);
  ok(await maya.get(`/orders/${o.id}/paypal/return?token=${token}`));
  return one("SELECT * FROM orders WHERE id = $1", [o.id]);
}

describe("Everyday foundation", () => {
  it("guard, traces, channels, PWA, passport, merchant money, MCP, evidence: every new route, no server error", { timeout: 240_000 }, async () => {
    const maya = new Client(base);
    ok(await maya.post("/login", { as: `acc:${s.account}` }));
    const nl = new Client(base);
    ok(await nl.post("/login", { as: `mer:${s.merchant}` }));
    const anon = new Client(base);

    // ---- Seeded mandates are set by code, and labelled so (A11: never presented as a model's reading).
    expect(await one("SELECT compiler FROM policies WHERE active AND owner_id = $1", [s.account])).toMatchObject({ compiler: "the demo's starting rules (set by code, not read by a model)" });
    const rules = (await one("SELECT rules FROM policies WHERE active AND owner_id = $1", [s.account])).rules;
    expect(rules).toMatchObject({ max_purchase_cents: 40000, approve_above_cents: 3000, one_tap_repeat: true, allowed_merchants: ["northlight"], blocked_categories: ["headphones"] });
    expect(await uiText(maya, "/guard")).toMatch(/northlight/i);

    // ---- A paid order carries a trace with gate steps and the PayPal request id.
    const order = await paidOrder(maya);
    expect(order.status).toBe("paid");
    const runs = await all("SELECT * FROM agent_runs WHERE entity = 'order' AND entity_id = $1", [order.id]);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const steps = await all("SELECT * FROM agent_trace WHERE run_id = ANY($1::text[])", [runs.map((r) => r.id)]);
    expect(steps.some((x) => x.gate === "allowed" && String(x.tool).startsWith("dry_run:"))).toBe(true);
    expect(steps.some((x) => x.pp_request_id)).toBe(true);
    expect((await maya.get(`/trace/${runs[0].id}`)).status).toBe(200);
    expect((await maya.get("/traces")).status).toBe(200);
    expect((await nl.get(`/trace/${runs[0].id}`)).status).toBe(200);
    expect((await anon.get("/api/v1/runs")).status).toBe(401);
    const keys = JSON.parse((await one("SELECT value FROM settings WHERE key = 'demo'")).value).keys;
    const api = await fetch(`${base}/api/v1/runs?entity=order&id=${order.id}`, { headers: { authorization: `Bearer ${keys.maya}` } });
    expect(api.status).toBe(200);
    expect((await api.json()).runs.length).toBeGreaterThanOrEqual(2);
    expect((await fetch(`${base}/api/v1/runs/${runs[0].id}`, { headers: { authorization: `Bearer ${keys.maya}` } })).status).toBe(200);

    // ---- Mandate: preview, adopt, activate, backtest, adopt-rules, suggestions (none yet), kill switch.
    const prev = await maya.post("/guard/policy", { text: "Never spend more than $250 on a single purchase. Ask me before any repeat buy over $20. Repeat buys are on. Only buy from Northlight. Never buy headphones. Bananas are yellow", mode: "preview" });
    expect(prev.status).toBe(302);
    expect(flash(prev)).toMatch(/Couldn't turn into a rule: Bananas are yellow/);
    const draft = await one("SELECT id FROM policies WHERE owner_id = $1 AND NOT active ORDER BY created_at DESC LIMIT 1", [s.account]);
    ok(await maya.post(`/guard/policy/${draft.id}/activate`));
    expect((await one("SELECT rules FROM policies WHERE active AND owner_id = $1", [s.account])).rules.max_purchase_cents).toBe(25000);
    ok(await maya.post("/guard/policy", { text: "Never spend more than $400 on a single purchase. Ask me before any repeat buy over $30. Repeat buys are on. Only buy from Northlight. Never buy headphones", mode: "adopt" }));
    const bt = await maya.post("/guard/backtest", { approve_above_cents: "10000" });
    expect(bt.status).toBe(200);
    expect(bt.json.rules.approve_above_cents).toBe(10000);
    const cur = (await one("SELECT rules FROM policies WHERE active AND owner_id = $1", [s.account])).rules;
    ok(await maya.post("/guard/adopt-rules", { rules: JSON.stringify({ ...cur, approve_above_cents: 3000 }) }));
    expect(flash(await maya.post("/guard/suggestions", {}))).toMatch(/Pick at least one/);
    ok(await maya.post("/guard/kill", { scope: "account", engaged: "1", reason: "test" }));
    expect((await maya.post("/plans", { text: "a felt desk mat" })).status).toBe(302);
    const killedIntent = await one("SELECT id FROM intents ORDER BY created_at DESC LIMIT 1");
    const kplan = await one("SELECT body FROM plans WHERE intent_id = $1 AND status = 'current'", [killedIntent.id]);
    if (kplan.body.questions?.length) ok(await maya.post(`/plans/${killedIntent.id}/answer`, { key: kplan.body.questions[0].key, value: kplan.body.questions[0].choices[0].value }));
    ok(await maya.post(`/plans/${killedIntent.id}/quote`));
    const kq = await one("SELECT * FROM quotes WHERE status = 'open' ORDER BY created_at DESC LIMIT 1");
    const killedApprove = await maya.post(`/quotes/${kq.id}/approve`, { hash: kq.hash });
    expect(flash(killedApprove)).toMatch(/kill switch/i);
    expect(fake.calls.filter((c) => c === "createOrder")).toHaveLength(1);
    ok(await maya.post("/guard/kill", { scope: "account", engaged: "0" }));
    ok(await maya.post("/guard/kill", { scope: "agent:rogue", engaged: "1" }));
    expect((await maya.get("/guard/audit.json")).status).toBe(200);
    expect((await maya.get("/guard/runs.json")).status).toBe(200);

    // ---- Passkey endpoints: register start, sign start on a pending approval, bad finishes refused.
    expect((await maya.req("POST", "/guard/passkey/register/start", { json: {} })).status).toBe(200);
    expect((await maya.req("POST", "/guard/passkey/register/finish", { json: { chalId: "nope", clientDataJSON: "", authenticatorData: "", rawId: "" } })).status).toBe(400);

    // ---- Passport: vault, repeat buy under the threshold runs; above it is held; approve -> queue -> paid.
    expect((await ui(maya, "/passport")).summary).toHaveProperty("recovered");
    expect(await uiText(maya, "/passport?q=oak%20lamp")).toMatch(/catalog/);
    const vaultRedirect = await maya.post("/passport/vault");
    expect(vaultRedirect.status).toBe(302);
    const setup = await one("SELECT * FROM vault_tokens ORDER BY created_at DESC LIMIT 1");
    fake.approveSetup(setup.setup_token);
    ok(await maya.get(`/passport/vault/return?v=${setup.id}`));
    expect((await one("SELECT status FROM vault_tokens WHERE id = $1", [setup.id])).status).toBe("active");
    const mouse = s.products["NL-MOUSE-BASIC"];
    const r1 = await maya.post("/passport/repeat", { product: mouse, qty: "1" });
    expect(flash(r1)).toMatch(/Paid/);
    expect(await one("SELECT status FROM repeat_buys ORDER BY created_at DESC LIMIT 1")).toMatchObject({ status: "paid" });
    const chair = s.products["NL-CHAIR-BASIC"];
    const r2 = await maya.post("/passport/repeat", { product: chair, qty: "1" });
    expect(flash(r2)).toMatch(/Waiting for your approval/);
    const held = await one("SELECT * FROM repeat_buys WHERE status = 'held'");
    const approval = await one("SELECT * FROM approvals WHERE owner_id = $1 AND status = 'pending'", [s.account]);
    expect(approval.payload.cents).toBe(7900);
    expect((await maya.req("POST", "/guard/passkey/sign/start", { json: { approvalId: approval.id } })).status).toBe(200);
    expect((await maya.req("POST", "/guard/passkey/sign/finish", { json: { approvalId: approval.id, chalId: "x", rawId: "", clientDataJSON: "", authenticatorData: "", signature: "" } })).status).toBe(400);
    // The approval request went to the shopper's channel (simulator): approve it from there.
    const msg = await one("SELECT * FROM channel_messages WHERE address = $1 AND direction = 'out' ORDER BY created_at DESC LIMIT 1", [`shopper:${s.account}`]);
    expect(msg.body).toMatch(/approval threshold/);
    ok(await maya.post("/channels/reply", { address: `shopper:${s.account}`, buttonId: `approve:${approval.id}`, replyTo: String(msg.id) }));
    await drain(db, handlers);
    expect((await one("SELECT status FROM repeat_buys WHERE id = $1", [held.id])).status).toBe("paid");
    expect(fake.calls.filter((c) => c === "createVaultedCaptureOrder")).toHaveLength(2);
    // Blocked category and the per-agent kill are refused before PayPal.
    const hp = s.products["NL-HP-QUIET"];
    expect(flash(await maya.post("/passport/repeat", { product: hp, qty: "1" }))).toMatch(/Refused before PayPal/);
    expect(fake.calls.filter((c) => c === "createVaultedCaptureOrder")).toHaveLength(2);
    expect((await maya.post("/guard/approvals/nope/click", { approve: "1" })).status).toBe(404);
    expect((await maya.post("/guard/approvals/nope/approve", { next: "/today" })).status).toBe(404);
    // One-tap Telegram: the shopper's code links the chat for clips and approvals; the merchant's links the merchant.
    const tg = await maya.post("/connect/telegram", {});
    expect(tg.status).toBe(303);
    const tcode = String(tg.location).split("start=everyday-")[1];
    expect(tcode).toMatch(/^\d{6}$/);
    const post = (body: unknown) => fetch(`${base}/webhooks/telegram`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ message: { chat: { id: 5150 }, text: "/start " + tcode } })).status).toBe(200);
    expect((await one("SELECT party FROM party_links WHERE channel = 'telegram' AND address = '5150'"))?.party).toBe("shopper");
    expect((await post({ message: { chat: { id: 5152 }, text: "link shopper:" + s.account } })).status).toBe(200);
    expect(await one("SELECT party FROM party_links WHERE channel = 'telegram' AND address = '5152'")).toBeUndefined();
    expect((await maya.get("/passport.json")).status).toBe(200);
    expect((await maya.get("/channels")).status).toBe(200);
    expect((await maya.req("POST", "/channels/link", { json: { channel: "telegram", address: "tg:1" } })).status).toBe(200);

    // ---- Merchant: approvals page and mandate, tracking, disputes, transactions, negative test.
    expect((await ui(nl, "/merchant/approvals")).rules.length).toBeGreaterThan(0);
    ok(await nl.post("/merchant/approvals/policy", { text: "Refund at most 60%. Ask me before refunding more than $150" }));
    ok(await nl.post("/merchant/approvals/kill", { engaged: "1", reason: "drill" }));
    ok(await nl.post("/merchant/approvals/kill", { engaged: "0" }));
    expect((await nl.req("POST", "/merchant/approvals/passkey/register/start", { json: {} })).status).toBe(200);
    expect((await nl.req("POST", "/merchant/approvals/passkey/register/finish", { json: { chalId: "nope", clientDataJSON: "", authenticatorData: "", rawId: "" } })).status).toBe(400);
    expect((await nl.req("POST", "/merchant/approvals/passkey/sign/start", { json: { approvalId: "none" } })).status).toBe(404);
    expect((await nl.req("POST", "/merchant/approvals/passkey/sign/finish", { json: { approvalId: "none" } })).status).toBe(404);
    expect((await nl.post("/merchant/approvals/none/click", { approve: "0" })).status).toBe(404);
    expect((await nl.post("/merchant/approvals/none/decline", {})).status).toBe(404);
    const mt = await nl.post("/connect/telegram", {});
    const mcode = String(mt.location).split("start=everyday-")[1];
    await fetch(`${base}/webhooks/telegram`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: { chat: { id: 5151 }, text: "/start " + mcode } }) });
    expect((await one("SELECT party FROM party_links WHERE channel = 'telegram' AND address = '5151'"))?.party).toBe("merchant");
    expect((await nl.get("/merchant/approvals/audit.json")).status).toBe(200);
    expect((await nl.get("/merchant/money")).status).toBe(200);
    const line = await one("SELECT id FROM order_lines WHERE order_id = $1", [order.id]);
    ok(await nl.post(`/merchant/lines/${line.id}/tracking`, { carrier: "DHL", number: "JD0123" }));
    expect(fake.trackers).toHaveLength(1);
    fake.openDispute(order.capture_id);
    ok(await nl.post("/merchant/money/disputes/sync"));
    const d = await one("SELECT * FROM disputes");
    expect(d.order_id).toBe(order.id);
    const pack = await nl.get(`/merchant/money/disputes/${d.id}/evidence.json`);
    expect(pack.status).toBe(200);
    expect(JSON.parse(pack.text).agreed_quote.hash).toBeTruthy();
    ok(await nl.post(`/merchant/money/disputes/${d.id}/evidence`));
    expect((await one("SELECT status FROM disputes WHERE id = $1", [d.id])).status).toBe("UNDER_REVIEW");
    const d2 = fake.openDispute(order.capture_id);
    ok(await nl.post("/merchant/money/disputes/sync"));
    const d2row = await one("SELECT id FROM disputes WHERE paypal_id = $1", [d2.dispute_id]);
    // Accepting by hand is the person the mandate asks for: PayPal gets the accept-claim call once.
    ok(await nl.post(`/merchant/money/disputes/${d2row.id}/accept`, { note: "ok" }));
    expect((await one("SELECT status FROM disputes WHERE id = $1", [d2row.id])).status).toBe("RESOLVED");
    expect(fake.calls.filter((c) => c === "acceptDisputeClaim")).toHaveLength(1);
    // With the merchant kill switch on, the same click is refused before PayPal.
    const d3 = fake.openDispute(order.capture_id);
    ok(await nl.post("/merchant/money/disputes/sync"));
    const d3row = await one("SELECT id FROM disputes WHERE paypal_id = $1", [d3.dispute_id]);
    ok(await nl.post("/merchant/approvals/kill", { engaged: "1", reason: "drill" }));
    expect(flash(await nl.post(`/merchant/money/disputes/${d3row.id}/accept`, { note: "ok" }))).toMatch(/Refused before PayPal/);
    ok(await nl.post("/merchant/approvals/kill", { engaged: "0" }));
    expect(fake.calls.filter((c) => c === "acceptDisputeClaim")).toHaveLength(1);
    expect((await ui(nl, "/merchant/money?reconcile=1")).recon).toBeTruthy();
    expect((await nl.get("/merchant/money/transactions.json")).status).toBe(200);
    const neg = await nl.post("/merchant/money/negative-test", { code: "INSTRUMENT_DECLINED" });
    expect(flash(neg)).toMatch(/refused as asked/);

    // ---- Channels: webhooks and the simulator conversation as the merchant.
    ok(await nl.post("/channels/reply", { address: "merchant:merchant", text: "cases" }));
    expect((await fetch(`${base}/webhooks/telegram`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: { chat: { id: 1 }, text: "pending" } }) })).status).toBe(200);
    expect((await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${config.channels.whatsappVerifyToken}&hub.challenge=abc`)).status).toBe(200);
    expect((await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entry: [] }) })).status).toBe(200);
    // PayPal webhook: unverified posts are recorded and rejected; a verified one (fake signature) is accepted once.
    const ppEvent = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP-1" } };
    const prevWh = config.paypal.webhookId;
    (config.paypal as { webhookId: string }).webhookId = "WH-TEST";
    expect((await fetch(`${base}/webhooks/paypal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ppEvent) })).status).toBe(400);
    expect((await fetch(`${base}/webhooks/paypal`, { method: "POST", headers: { "content-type": "application/json", "paypal-transmission-sig": "valid-fake-signature" }, body: JSON.stringify({ ...ppEvent, id: "WH-2" }) })).status).toBe(200);
    expect((await fetch(`${base}/webhooks/paypal`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(400);
    (config.paypal as { webhookId: string }).webhookId = prevWh;
    expect((await db.query("SELECT verified FROM webhook_events WHERE id = 'WH-2'")).rows[0]).toEqual({ verified: true });

    // ---- PWA.
    expect((await anon.get("/manifest.webmanifest")).status).toBe(200);
    expect((await anon.get("/sw.js")).status).toBe(200);
    expect((await anon.get("/push/public-key")).status).toBe(200);
    expect((await maya.req("POST", "/push/subscribe", { json: { endpoint: "https://push.example/x", keys: { p256dh: "a", auth: "b" } } })).status).toBe(200);

    // ---- Judge mode and evidence console.
    // /judge now folds into the landing page's guided walk-throughs.
    const judge = await anon.get("/judge");
    expect(judge.status).toBe(302);
    expect(judge.location).toBe("/?home=1#start");
    expect((await anon.get("/console/evidence")).status).toBe(200);
    ok(await anon.post("/console/eval", { suite: "adversarial" }));
    expect((await one("SELECT count(*)::int AS n FROM eval_runs WHERE suite = 'adversarial' AND NOT correct")).n).toBe(0);
    ok(await anon.post("/console/eval", { suite: "techjam" }));
    ok(await anon.post("/console/eval", { suite: "capture" }));
    expect((await anon.get("/console/adversarial.md")).status).toBe(200);
    expect((await anon.get("/console/techjam.md")).status).toBe(200);
    expect((await anon.get("/console/capture.md")).status).toBe(200);
    expect((await ui(anon, "/eval")).total).toBeGreaterThan(0);
    expect((await ui(anon, "/eval?suite=adversarial&arm=gate&outcome=correct&trap=trap")).suite).toBe("adversarial");
    expect((await anon.get("/console/eval.csv?suite=capture")).text).toMatch(/^id,arm/);
    expect((await anon.get("/llms.txt")).text).toMatch(/\/merchant\/mcp/);
    expect((await anon.get("/skill.md")).text).toMatch(/Everyday skill/);

    // ---- MCP merchant agent (read-only): the shopper's key is refused; the merchant's key lists orders and the trace.
    expect((await fetch(`${base}/merchant/mcp`, { method: "POST", headers: { authorization: `Bearer ${keys.maya}` } })).status).toBe(403);
    const mTransport = new StreamableHTTPClientTransport(new URL(`${base}/merchant/mcp`), { requestInit: { headers: { authorization: `Bearer ${keys.northlight}`, "x-agent-id": "merchant-agent" } } });
    const mmcp = new McpClient({ name: "test-merchant", version: "0" });
    await mmcp.connect(mTransport);
    expect((await mmcp.listTools()).tools.map((t) => t.name).sort()).toEqual(["get_order", "get_performance", "get_trace", "list_approvals", "list_cases", "list_disputes", "list_orders"]);
    const mOrders = JSON.parse(((await mmcp.callTool({ name: "list_orders", arguments: {} })).content as any)[0].text);
    expect(mOrders.orders.map((o: any) => o.id)).toContain(order.id);
    const mOrder = JSON.parse(((await mmcp.callTool({ name: "get_order", arguments: { id: order.id } })).content as any)[0].text);
    expect(mOrder.lines.length).toBeGreaterThan(0);
    expect(JSON.parse(((await mmcp.callTool({ name: "get_performance", arguments: {} })).content as any)[0].text).orders).toBeGreaterThan(0);
    expect(JSON.parse(((await mmcp.callTool({ name: "get_trace", arguments: { order_id: order.id } })).content as any)[0].text).runs.length).toBeGreaterThan(0);
    expect(JSON.parse(((await mmcp.callTool({ name: "list_cases", arguments: {} })).content as any)[0].text).cases).toBeDefined();
    await mmcp.close();

    // ---- MCP shopper agent: constraints, plan, quote, approval link; repeat buy of a blocked category denied.
    expect((await fetch(`${base}/mcp`, { method: "POST" })).status).toBe(401);
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${keys.maya}`, "x-agent-id": "test-agent" } } });
    const mcp = new McpClient({ name: "test", version: "0" });
    await mcp.connect(transport);
    const tools = await mcp.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["approve_purchase", "get_trace", "my_constraints", "passport", "plan_for", "quote", "repeat_buy"]);
    const cons = JSON.parse(((await mcp.callTool({ name: "my_constraints", arguments: {} })).content as any)[0].text);
    expect(cons.mandate.max_purchase_cents).toBe(40000);
    const plannedRaw = ((await mcp.callTool({ name: "plan_for", arguments: { text: "a felt desk mat", idempotency_key: "p1" } })).content as any)[0].text;
    const planned = JSON.parse(plannedRaw);
    if (!planned.intent_id) throw new Error(`plan_for: ${plannedRaw}`);
    if (planned.questions.length) {
      const followed = JSON.parse(((await mcp.callTool({ name: "plan_for", arguments: { text: "my laptop has a USB-C port", intent_id: planned.intent_id } })).content as any)[0].text);
      expect(followed.questions).toEqual([]);
    }
    const quotedRaw = ((await mcp.callTool({ name: "quote", arguments: { intent_id: planned.intent_id } })).content as any)[0].text;
    const quoted = JSON.parse(quotedRaw);
    expect(quoted.hash, quotedRaw).toBeTruthy();
    const appr = JSON.parse(((await mcp.callTool({ name: "approve_purchase", arguments: { quote_id: quoted.quote_id, hash: quoted.hash, idempotency_key: "a1" } })).content as any)[0].text);
    expect(appr.approve_url).toMatch(/^http/);
    const replay = JSON.parse(((await mcp.callTool({ name: "approve_purchase", arguments: { quote_id: quoted.quote_id, hash: quoted.hash, idempotency_key: "a1" } })).content as any)[0].text);
    expect(replay.replayed).toBe(true);
    const denied = await mcp.callTool({ name: "repeat_buy", arguments: { product_id: hp, qty: 1 } });
    expect(JSON.parse((denied.content as any)[0].text).status).toBe("denied");
    const trace = JSON.parse(((await mcp.callTool({ name: "get_trace", arguments: { entity: "order", id: order.id } })).content as any)[0].text);
    expect(trace.runs.length).toBeGreaterThan(0);
    // Revoking the saved PayPal stops repeat buys at the door (no PayPal call).
    ok(await maya.post("/passport/vault/revoke"));
    expect(flash(await maya.post("/passport/repeat", { product: mouse, qty: "1" }))).toMatch(/Save a PayPal/);
    expect(JSON.parse(((await mcp.callTool({ name: "passport", arguments: {} })).content as any)[0].text).recovered.length).toBeGreaterThan(0);
    await mcp.close();
    expect((await one("SELECT count(*)::int AS n FROM agent_requests")).n).toBeGreaterThanOrEqual(7);

    // ---- Audit chain intact; every foundation route reached; no 5xx.
    const chain = JSON.parse((await maya.get("/guard/audit.json")).text).chain;
    expect(chain.ok).toBe(true);
    expect(srv.missed(Object.fromEntries(Object.keys(FOUNDATION_ROUTES).length ? [] : []))).toEqual(expect.arrayContaining([]));
    const missed = srv.missed().filter((r) => r in FOUNDATION_ROUTES);
    expect(missed).toEqual([]);
    expect(srv.failures).toEqual([]);
  });
});
