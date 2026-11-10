/**
 * MCP tools for Everyday (roadmap E4). One server, the shopper's agent, keyed by the shopper's Everyday access key:
 *   my_constraints   the mandate, what is owned, the month's spending
 *   plan_for         a plan for a need in plain words (the planner asks its questions back)
 *   quote            an immutable 15-minute quote for the plan
 *   approve_purchase the PayPal approval link for a quote: the human approves on PayPal, nothing is charged here
 *   repeat_buy       a repeat buy on the saved PayPal, behind the gate (held or denied by the mandate)
 *   passport         purchases, dollars recovered, watches
 *   get_trace        the traced runs on an entity
 * Every call is rate limited, refused while a kill switch is engaged, recorded in agent_requests and replayable by
 * idempotency key.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "../db.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { isKilled } from "../guard/kill.js";
import { activePolicy, DEFAULT_RULES, merchantOwner, rulesFor } from "../guard/policy.js";
import { currentWs } from "../ws.js";
import { accountById, type Account } from "../store.js";
import { owned } from "../services/life.js";
import { approveQuote, quotePlan, spending } from "../services/orders.js";
import { createIntent, currentPlan, type SlotView } from "../services/plans.js";
import { passportSummary, planRepeatBuy } from "../services/passport.js";
import { runsFor, startRun } from "../trace.js";

const RATE = new Map<string, number[]>();
function rateLimit(key: string, perMin = 60) {
  const now = Date.now();
  const hits = (RATE.get(key) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= perMin) throw new GtError("Rate limit: 60 tool calls per minute", "rate_limited", 429);
  hits.push(now);
  RATE.set(key, hits);
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (v: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown): ToolResult => {
  const g = e instanceof GtError ? e : null;
  return { content: [{ type: "text", text: JSON.stringify({ error: g?.code ?? "error", message: (e as Error).message }) }], isError: true };
};

async function run(account: Account, agentId: string, tool: string, args: Record<string, unknown>, fn: () => Promise<unknown>): Promise<ToolResult> {
  const principal = `shopper:${account.id}`;
  try {
    rateLimit(`${principal}:${agentId}`);
    const db = await getDb();
    const killed = (await isKilled(`account:${account.id}`, db)) ?? (await isKilled(`agent:${agentId}`, db));
    if (killed?.engaged) throw new GtError(`Kill switch engaged (${killed.scope})${killed.reason ? `: ${killed.reason}` : ""}. Nothing runs until the shopper releases it.`, "killed", 423);
    const key = typeof args.idempotency_key === "string" && args.idempotency_key ? args.idempotency_key.slice(0, 80) : null;
    if (key) {
      const prev = (await db.query<any>("SELECT ok, result FROM agent_requests WHERE principal = $1 AND tool = $2 AND idempotency_key = $3", [principal, tool, key])).rows[0];
      if (prev && prev.ok !== null) {
        const r = typeof prev.result === "string" ? JSON.parse(prev.result) : prev.result;
        return prev.ok ? ok({ ...r, replayed: true }) : fail(new GtError(r?.message ?? "Earlier call failed", r?.error ?? "error"));
      }
    }
    const id = newId("req");
    await db.query("INSERT INTO agent_requests (id, principal, agent_id, tool, args, idempotency_key, ws_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", [id, principal, agentId, tool, JSON.stringify(args), key, currentWs()]);
    try {
      const out = await fn();
      await db.query("UPDATE agent_requests SET ok = true, result = $2 WHERE id = $1", [id, JSON.stringify(out)]);
      return ok(out);
    } catch (e) {
      await db.query("UPDATE agent_requests SET ok = false, result = $2 WHERE id = $1", [id, JSON.stringify({ error: (e as GtError).code ?? "error", message: (e as Error).message })]);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}

const money = (c: number | null | undefined) => (c === null || c === undefined ? null : (c / 100).toFixed(2));

function planView(p: any) {
  const b = p.body;
  return {
    intent_id: p.intent_id,
    version: p.version,
    feasible: b.feasible,
    gap: b.gap ?? null,
    questions: (b.questions ?? []).map((q: any) => ({ key: q.key, text: q.text, choices: (q.choices ?? []).map((c: any) => c.value ?? c.label) })),
    slots: (b.slots as SlotView[]).map((s) => ({ slot: s.key, label: s.label, outcome: s.outcome, pick: s.pick ? { product_id: s.pick.id, title: s.pick.title, price: money(s.pick.price_cents), merchant: s.pick.merchant, reasons: s.pick.reasons } : null, excluded: s.excluded.length, note: s.note })),
    total: money(b.total_cents),
    arrival: b.arrival ?? null,
    avoided: b.avoided ?? [],
    note: "A plan is a proposal. Quote it, then the shopper approves on PayPal; nothing is charged by this tool.",
  };
}

export function buildShopperServer(account: Account, agentId: string): McpServer {
  const s = new McpServer(
    { name: "everyday-shopper", version: "0.2.0" },
    {
      instructions:
        "Everyday shopping agent for one shopper. my_constraints shows the mandate (limits the shopper set), what they own and this month's spending. plan_for builds a plan for a need in plain words and may return questions; answer them by calling plan_for again with the answer appended. quote freezes prices for 15 minutes. approve_purchase returns a PayPal approval link: the shopper approves on PayPal; you never charge. repeat_buy charges the saved PayPal only inside the mandate; above the threshold it waits for the shopper. Every call is logged and the shopper can stop you at any time.",
    },
  );
  const fresh = async () => accountById(await getDb(), account.id);
  s.registerTool(
    "my_constraints",
    { title: "Shopper's constraints", description: "The mandate (largest purchase, approval threshold, allowed merchants, blocked categories, what agents may do), items owned, and spending against the monthly limit.", inputSchema: {} },
    async (args) =>
      run(account, agentId, "my_constraints", args, async () => {
        const db = await getDb();
        const a = await fresh();
        const pol = await activePolicy(a.id, db);
        const items = await owned(db, a);
        const sp = await spending(db, a);
        return { mandate: pol?.rules ?? DEFAULT_RULES, in_shopper_words: pol?.text ?? null, owned: items.filter((o: any) => o.status === "owned").map((o: any) => ({ title: o.title, category: o.category })), spending: { limit: money(sp.limit_cents), spent: money(sp.spent_cents), reserved: money(sp.reserved_cents), left: money(sp.left_cents), note: sp.note }, address_on_file: Boolean(a.address) };
      }),
  );
  s.registerTool(
    "plan_for",
    { title: "Plan for a need", description: "Build (or rebuild) a plan from a need in plain words, e.g. 'a quiet desk setup by Friday for $350, I already own a monitor'. Returns picks with reasons, excluded items, and any question the planner needs answered first.", inputSchema: { text: z.string().min(3).max(600), intent_id: z.string().optional().describe("Rebuild an existing plan with more detail"), idempotency_key: z.string().optional() } },
    async (args) =>
      run(account, agentId, "plan_for", args, async () => {
        const rules = await rulesFor(account.id);
        if (!rules.agents_may_plan) throw new GtError("The shopper's mandate does not let assistants plan.", "forbidden", 403);
        const a = await fresh();
        const db = await getDb();
        const run_ = await startRun({ actor: "agent", agentId, subject: `agent plans: ${args.text.slice(0, 60)}`, entity: "intent" });
        let intentId = args.intent_id ?? null;
        if (intentId) {
          // Follow-ups answer the planner's own questions; anything else becomes a fresh, fuller intent.
          const { answer } = await import("../services/plans.js");
          const l = args.text.toLowerCase();
          const port = /thunderbolt/.test(l) ? "thunderbolt" : /usb-c|usb c|type-c/.test(l) ? "usb-c-dp" : /hdmi/.test(l) ? "hdmi" : /usb-a|usb a/.test(l) ? "usb-a" : null;
          const budget = l.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
          if (port) await answer(a, intentId, "laptop_port", port);
          else if (budget) await answer(a, intentId, "budget", budget[1]);
          else {
            const prev = (await db.query<any>("SELECT text FROM intents WHERE id = $1 AND account_id = $2", [intentId, a.id])).rows[0];
            intentId = await createIntent(a, { text: `${prev?.text ?? ""}. ${args.text}`.trim(), channel: "app" });
          }
        } else intentId = await createIntent(a, { text: args.text, channel: "app" });
        await db.query("UPDATE intents SET run_id = $2 WHERE id = $1", [intentId, run_.id]);
        const p = await currentPlan(db, intentId);
        await run_.step({ actor: "code", tool: "planner", args: { text: args.text }, gate: "n/a", result: { feasible: p?.body.feasible, total_cents: p?.body.total_cents, questions: p?.body.questions?.length ?? 0 } });
        await run_.end("done");
        return { ...planView(p), run_id: run_.id };
      }),
  );
  s.registerTool(
    "quote",
    { title: "Quote a plan", description: "An immutable quote (hash, 15-minute expiry) for the plan's buyable picks from the connected test merchant.", inputSchema: { intent_id: z.string(), idempotency_key: z.string().optional() } },
    async (args) =>
      run(account, agentId, "quote", args, async () => {
        const rules = await rulesFor(account.id);
        if (!rules.agents_may_plan) throw new GtError("The shopper's mandate does not let assistants plan or quote.", "forbidden", 403);
        const a = await fresh();
        const id = await quotePlan(a, args.intent_id);
        const q = (await (await getDb()).query<any>("SELECT id, hash, total_cents, expires_at, body FROM quotes WHERE id = $1", [id])).rows[0];
        return { quote_id: q.id, hash: q.hash, total: money(q.total_cents), expires_at: q.expires_at, lines: q.body.lines.map((l: any) => ({ title: l.title, qty: l.qty, unit: money(l.unit_cents), eta: l.eta })), merchant: q.body.merchant.name, next: "Call approve_purchase with the quote id and hash to get the PayPal approval link for the shopper." };
      }),
  );
  s.registerTool(
    "approve_purchase",
    { title: "Start PayPal approval", description: "Re-checks the quote by hash against the mandate and the monthly limit, creates the PayPal order and returns the approval link. The shopper approves on PayPal; this tool never charges.", inputSchema: { quote_id: z.string(), hash: z.string(), idempotency_key: z.string().optional() } },
    async (args) =>
      run(account, agentId, "approve_purchase", args, async () => {
        const rules = await rulesFor(account.id);
        if (!rules.agents_may_request_approval) throw new GtError("The shopper's mandate does not let assistants start a checkout. Send the shopper to their plan in the app.", "forbidden", 403);
        const a = await fresh();
        const url = await approveQuote(a, args.quote_id, args.hash);
        return { approve_url: url, note: "Give this link to the shopper. Everyday records the capture only after PayPal confirms the shopper approved it." };
      }),
  );
  s.registerTool(
    "repeat_buy",
    { title: "Repeat buy", description: "Buy a product again on the shopper's saved PayPal. Runs only inside the mandate (one-tap on, under the threshold, allowed merchant and category, within the monthly limit); otherwise it is held for the shopper or denied.", inputSchema: { product_id: z.string(), qty: z.number().int().min(1).max(5).default(1), idempotency_key: z.string().optional() } },
    async (args) =>
      run(account, agentId, "repeat_buy", args, async () => {
        const a = await fresh();
        return planRepeatBuy(a, args.product_id, args.qty ?? 1, `agent ${agentId}`, `agent:${agentId}`);
      }),
  );
  s.registerTool(
    "passport",
    { title: "Purchase passport", description: "Purchases, dollars recovered (price protection, swaps, case refunds, recalls), repeat buys and price watches.", inputSchema: {} },
    async (args) =>
      run(account, agentId, "passport", args, async () => {
        const db = await getDb();
        const a = await fresh();
        const p = await passportSummary(db, a);
        const orders = (await db.query<any>("SELECT number, status, gross_cents, refunded_cents, created_at FROM orders WHERE account_id = $1 ORDER BY created_at DESC LIMIT 20", [a.id])).rows;
        return { history_note: "purchase_history is a seeded, labelled year; orders are live sandbox purchases", recovered: p.recovered.map((r: any) => ({ kind: r.kind, count: r.n, total: money(r.cents) })), spent_in_history: money(p.spent), back_in_history: money(p.back), live: { paid: money(p.live.paid_live), refunded: money(p.live.refunded_live), protections: p.live.protections_live, repeats_paid: p.live.repeats_paid, repeats_held: p.live.repeats_held }, orders: orders.map((o: any) => ({ number: o.number, status: o.status, paid: money(o.gross_cents), refunded: money(o.refunded_cents) })) };
      }),
  );
  s.registerTool(
    "get_trace",
    { title: "Agent runs on an entity", description: "Traced runs (gate decisions, PayPal request ids) on an intent, order or repeat buy.", inputSchema: { entity: z.enum(["intent", "order", "repeat_buy"]), id: z.string() } },
    async (args) =>
      run(account, agentId, "get_trace", args, async () => {
        const db = await getDb();
        const owns = args.entity === "intent" ? (await db.query("SELECT 1 FROM intents WHERE id = $1 AND account_id = $2", [args.id, account.id])).rows.length : args.entity === "order" ? (await db.query("SELECT 1 FROM orders WHERE id = $1 AND account_id = $2", [args.id, account.id])).rows.length : (await db.query("SELECT 1 FROM repeat_buys WHERE id = $1 AND account_id = $2", [args.id, account.id])).rows.length;
        if (!owns) throw new GtError("Not yours", "forbidden", 403);
        return { runs: await runsFor(args.entity, args.id, 20) };
      }),
  );
  return s;
}

// ---- Merchant's agent (read-only), roadmap B.3 parity: the merchant can let an agent watch orders, cases,
// approvals and disputes without being able to ship, refund or decide anything.
async function runMerchant(merchant: { id: string; name: string }, agentId: string, tool: string, args: Record<string, unknown>, fn: () => Promise<unknown>): Promise<ToolResult> {
  const principal = `merchant:${merchant.id}`;
  try {
    rateLimit(`${principal}:${agentId}`);
    const db = await getDb();
    const killed = (await isKilled("merchant", db)) ?? (await isKilled(`agent:${agentId}`, db));
    if (killed?.engaged) throw new GtError(`Kill switch engaged (${killed.scope})${killed.reason ? `: ${killed.reason}` : ""}.`, "killed", 423);
    const id = newId("req");
    await db.query("INSERT INTO agent_requests (id, principal, agent_id, tool, args, ws_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [id, principal, agentId, tool, JSON.stringify(args), currentWs()]);
    try {
      const out = await fn();
      await db.query("UPDATE agent_requests SET ok = true, result = $2 WHERE id = $1", [id, JSON.stringify(out)]);
      return ok(out);
    } catch (e) {
      await db.query("UPDATE agent_requests SET ok = false, result = $2 WHERE id = $1", [id, JSON.stringify({ error: (e as GtError).code ?? "error", message: (e as Error).message })]);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}

export function buildMerchantServer(merchant: { id: string; name: string }, agentId: string): McpServer {
  const s = new McpServer(
    { name: "everyday-merchant", version: "0.1.0" },
    { instructions: `Read-only view of ${merchant.name} on Everyday: orders, lines, cases, held approvals, disputes and performance. Nothing here ships, refunds or decides a case; those stay with the merchant's screens and the gate.` },
  );
  const orderView = (o: any) => ({ id: o.id, number: o.number, status: o.status, total: money(o.total_cents), paid: money(o.gross_cents), refunded: money(o.refunded_cents), paypal_order_id: o.paypal_order_id, capture_id: o.capture_id, created_at: o.created_at });
  s.registerTool(
    "list_orders",
    { title: "Orders at this merchant", description: "Recent orders placed with this merchant, newest first.", inputSchema: { status: z.string().optional(), limit: z.number().int().min(1).max(100).optional() } },
    async (args) =>
      runMerchant(merchant, agentId, "list_orders", args, async () => {
        const db = await getDb();
        const rows = (await db.query<any>(`SELECT * FROM orders WHERE merchant_id = $1 ${args.status ? "AND status = $3" : ""} ORDER BY created_at DESC LIMIT $2`, args.status ? [merchant.id, args.limit ?? 20, args.status] : [merchant.id, args.limit ?? 20])).rows;
        return { orders: rows.map(orderView) };
      }),
  );
  s.registerTool(
    "get_order",
    { title: "One order with its lines", description: "An order at this merchant with its lines, shipping state and cases.", inputSchema: { id: z.string() } },
    async (args) =>
      runMerchant(merchant, agentId, "get_order", args, async () => {
        const db = await getDb();
        const o = (await db.query<any>("SELECT * FROM orders WHERE id = $1 AND merchant_id = $2", [args.id, merchant.id])).rows[0];
        if (!o) throw new GtError("Not this merchant's order", "forbidden", 403);
        const lines = (await db.query<any>("SELECT id, title, qty, unit_cents, status, eta, delivered_at, replaced_by FROM order_lines WHERE order_id = $1 ORDER BY id", [o.id])).rows;
        const cases = (await db.query<any>("SELECT id, number, issue, status, refund_cents, created_at FROM cases WHERE order_id = $1 ORDER BY created_at", [o.id])).rows;
        return { ...orderView(o), lines: lines.map((l: any) => ({ ...l, unit: money(l.unit_cents), unit_cents: undefined })), cases: cases.map((c: any) => ({ ...c, refund: money(c.refund_cents), refund_cents: undefined })) };
      }),
  );
  s.registerTool(
    "list_cases",
    { title: "Customer cases", description: "Open and resolved cases (issues, claims) on this merchant's orders.", inputSchema: { status: z.string().optional() } },
    async (args) =>
      runMerchant(merchant, agentId, "list_cases", args, async () => {
        const db = await getDb();
        const rows = (await db.query<any>(`SELECT c.id, c.number, c.order_id, c.issue, c.claim, c.status, c.refund_cents, c.flags, c.created_at, c.resolved_at FROM cases c JOIN orders o ON o.id = c.order_id WHERE o.merchant_id = $1 ${args.status ? "AND c.status = $2" : ""} ORDER BY c.created_at DESC LIMIT 100`, args.status ? [merchant.id, args.status] : [merchant.id])).rows;
        return { cases: rows.map((c: any) => ({ ...c, refund: money(c.refund_cents), refund_cents: undefined })) };
      }),
  );
  s.registerTool(
    "list_approvals",
    { title: "Held money moves", description: "Approvals waiting for the merchant (refunds above the mandate), and recent decisions.", inputSchema: {} },
    async (args) =>
      runMerchant(merchant, agentId, "list_approvals", args, async () => {
        const db = await getDb();
        const rows = (await db.query<any>("SELECT id, action, status, method, created_at, decided_at FROM approvals WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 50", [merchantOwner()])).rows;
        return { approvals: rows, note: "Deciding an approval needs the merchant's click or passkey; this agent cannot do it." };
      }),
  );
  s.registerTool(
    "list_disputes",
    { title: "PayPal disputes", description: "Disputes synced from PayPal on this merchant's captures, with evidence state.", inputSchema: {} },
    async (args) =>
      runMerchant(merchant, agentId, "list_disputes", args, async () => {
        const db = await getDb();
        const rows = (await db.query<any>("SELECT d.id, d.paypal_id, d.order_id, d.status, d.reason, d.amount_cents, d.evidence_sent_at, d.due_at FROM disputes d JOIN orders o ON o.id = d.order_id WHERE o.merchant_id = $1 ORDER BY d.synced_at DESC LIMIT 50", [merchant.id])).rows;
        return { disputes: rows.map((d: any) => ({ ...d, amount: money(d.amount_cents), amount_cents: undefined })) };
      }),
  );
  s.registerTool(
    "get_performance",
    { title: "Merchant performance", description: "Counts of orders, delivered lines, backorders, cases and refunds as shoppers see them.", inputSchema: {} },
    async (args) =>
      runMerchant(merchant, agentId, "get_performance", args, async () => {
        const db = await getDb();
        const r = (await db.query<any>(`SELECT
          (SELECT count(*)::int FROM orders WHERE merchant_id = $1) AS orders,
          (SELECT count(*)::int FROM orders WHERE merchant_id = $1 AND capture_id IS NOT NULL) AS paid,
          (SELECT coalesce(sum(refunded_cents),0)::int FROM orders WHERE merchant_id = $1) AS refunded_cents,
          (SELECT count(*)::int FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.merchant_id = $1 AND l.status = 'delivered') AS delivered_lines,
          (SELECT count(*)::int FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.merchant_id = $1 AND l.status = 'backordered') AS backordered_lines,
          (SELECT count(*)::int FROM cases c JOIN orders o ON o.id = c.order_id WHERE o.merchant_id = $1) AS cases`, [merchant.id])).rows[0];
        return { ...r, refunded: money(r.refunded_cents), refunded_cents: undefined };
      }),
  );
  s.registerTool(
    "get_trace",
    { title: "Agent runs on an order", description: "Traced runs (gate decisions, PayPal request ids) on one of this merchant's orders.", inputSchema: { order_id: z.string() } },
    async (args) =>
      runMerchant(merchant, agentId, "get_trace", args, async () => {
        const db = await getDb();
        const owns = (await db.query("SELECT 1 FROM orders WHERE id = $1 AND merchant_id = $2", [args.order_id, merchant.id])).rows.length;
        if (!owns) throw new GtError("Not this merchant's order", "forbidden", 403);
        return { runs: await runsFor("order", args.order_id, 20) };
      }),
  );
  return s;
}
