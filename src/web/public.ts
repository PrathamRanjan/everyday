/**
 * A3.2: the pages that need no sign-in. Each reads either a committed result file (eval/*.json, written by the
 * scripts that ran the checks) or the showcase workspace (the one demo the landing page shows, rebuilt nightly).
 * Nothing on them is typed by hand except the roles table, which is checked against the code by a test.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { hasOpenAI } from "../ai/provider.js";
import { DECISIONS_MODEL } from "../ai/decisions.js";
import { TOOLS, MAX_STEPS, MAX_MS } from "../ai/agent.js";
import { paypalMcpReady, PAYPAL_MCP_URL, READ_TOOLS } from "../paypal/mcp.js";
import { showcase } from "../services/workspaces.js";
import { SCAM_PREDICATES } from "../safety/readers.js";
import { json } from "./common.js";

const EVAL = join(process.cwd(), "eval");
const readJson = (f: string): any => {
  const p = join(EVAL, f);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};
const parse = (s: unknown) => {
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/** The scam model's card (same figures as /safety/model-card); from the training notebooks, not re-run here. */
export const MODEL_CARD = [
  { set: "ScamShield SMS test", n: "8,188", auc: "0.988", caught_at_1pct: "75%", what: "real Singapore SMS, in-distribution" },
  { set: "ScamShield eval sets", n: "1,574", auc: "0.979", caught_at_1pct: "67%", what: "real and hand-written" },
  { set: "Singlish genuine", n: "600", auc: "—", caught_at_1pct: "1.0% held", what: "real everyday messages: the false-alarm check" },
  { set: "Business templates", n: "200", auc: "0.85", caught_at_1pct: "11%", what: "author-written, held-out templates" },
  { set: "Business email (BEC) seed", n: "200", auc: "0.58", caught_at_1pct: "25%", what: "hand-written; the model is weak here" },
];

/** What has not been measured, said plainly on /proof. */
export const NOT_MEASURED = [
  "Real shoppers: every case was written by the people who built the app; no stranger has been timed on a judge path yet.",
  "Photo reading on real phone screenshots: the capture set is flat drawings with printed labels.",
  "The scam model on real business messages: its training and test messages are synthetic; the business figures above are its weak spot.",
  "The payment-risk model on real fraud: it is trained on synthetic data and is a ranking signal, not a fraud rate.",
  "The second reader (Decisions) beyond 48 hand-labelled messages; five of its eleven questions had too few examples to calibrate and are not used to hold.",
  "The assistant's answers: no graded set yet; each answer cites the tool calls it relies on so a reader can check it.",
  "The phone app on a real device: tested as a web build only.",
];

function suite(name: string, title: string, what: string) {
  const j = readJson(`${name}.json`);
  if (!j) return { name, title, what, missing: true };
  const cases = (j.cases ?? []).map((c: any) => ({
    arm: c.arm,
    id: c.case_id,
    input: j.inputs?.[c.case_id] ?? null,
    expected: parse(c.expected),
    actual: parse(c.actual),
    reason: j.reasons?.[c.case_id] ?? c.detail?.reason ?? null,
    correct: Boolean(c.correct),
    trap: Boolean(c.trap),
    ms: c.latency_ms ?? null,
    model: c.detail?.model ?? null,
  }));
  return { name, title, what, run_on: j.run_on, provider: j.provider, arms: j.arms, cases };
}

export function proofData() {
  const tj = readJson("techjam.json");
  const th = readJson("decisions/thresholds.json");
  const ans = readJson("decisions/answers.json");
  const robot = readJson("robot-judge.json");
  return {
    built_from: "Committed result files in eval/, written by the scripts that ran each check (npm run eval:*, npm run calibrate).",
    models: { read: config.ai.models.read, backup: config.ai.models.backup, small: config.ai.models.classify ?? DECISIONS_MODEL, decisions: DECISIONS_MODEL, connected: hasOpenAI() },
    suites: [
      suite("regression", "Requests that went wrong in the 10 Nov review", "Each goes through the real request reader and the real planner on the demo shop; code checks the plan."),
      suite("capture", "Reading a saved clip", "Ten drawn frames, two with an instruction printed on the image. The model must name what is there and ignore what is written."),
      suite("adversarial", "Payment gate under attack", "Twenty-four attempts to make Everyday move money it shouldn't. Code decides; no model is involved."),
    ],
    techjam: tj
      ? {
          title: "Finding the right product in a short conversation",
          what: "120 scenarios from three fixed seeds on the demo catalog; a simulated shopper answers questions from a hidden truth. Retrieval and the reply tree are code; no model.",
          run_on: tj.run_on,
          systems: tj.systems,
          cases: tj.cases.map((c: any) => ({ id: c.id, kind: c.kind, query: c.query, target: c.target, everyday: c.everyday && { hit10: c.everyday.hit10, rr: c.everyday.rr, turns: c.everyday.turns, converted: c.everyday.converted, abstained: c.everyday.abstained, asked: c.everyday.asked }, baseline: c.baseline && { hit10: c.baseline.hit10, rr: c.baseline.rr } })),
        }
      : null,
    decisions: th
      ? {
          title: "Second reader for scam messages: calibration",
          what: "48 hand-labelled messages, split within each label into a tuning half and a held-out half. Thresholds are set on the tuning half; the held-out figures are what we report.",
          run_on: th.run_on,
          model: th.model,
          thresholds: Object.values(th.thresholds ?? {}),
          not_calibrated: SCAM_PREDICATES.map((q) => q.name).filter((n) => !th.thresholds?.[n]),
          cases: (ans?.cases ?? []).map((c: any) => ({ text: c.text, labels: c.labels, answers: c.probabilities ?? null })),
        }
      : null,
    model_card: { rows: MODEL_CARD, note: "From the training notebooks, which are not in this repository, so these figures can't be re-run from it. The payment-risk model is trained on synthetic data: its score is a ranking signal, not a fraud rate." },
    robot_judge: robot,
    not_measured: NOT_MEASURED,
  };
}

/** Each PayPal API Everyday calls, when it calls it, and where to find a live id in the showcase. */
const PAYPAL_APIS = [
  { key: "order", api: "Orders v2: create order", endpoint: "POST /v2/checkout/orders", when: "When you approve a quote, or when the demo pays from its saved wallet." },
  { key: "capture", api: "Orders v2: capture", endpoint: "POST /v2/checkout/orders/{id}/capture", when: "Right after approval. Everyday says paid only after reading the capture back." },
  { key: "refund", api: "Payments v2: refund a capture", endpoint: "POST /v2/payments/captures/{id}/refund", when: "When the shop approves a claim, a price drop or a return." },
  { key: "refund_read", api: "Payments v2: read a refund", endpoint: "GET /v2/payments/refunds/{id}", when: "Until PayPal reports the refund COMPLETED; only then is it shown as money back." },
  { key: "vault", api: "Vault v3: saved wallet", endpoint: "POST /v3/vault/setup-tokens, /v3/vault/payment-tokens", when: "Once, by the owner, to save the demo shopper's sandbox wallet. Each demo payment uses it." },
  { key: "webhook", api: "Webhooks", endpoint: "POST /v1/notifications/verify-webhook-signature", when: "Every event PayPal sends; unsigned or unverifiable events are dropped." },
  { key: "tracking", api: "Orders v2: add tracking", endpoint: "POST /v2/checkout/orders/{id}/track", when: "When the shop ships an order." },
  { key: "dispute", api: "Disputes v1", endpoint: "GET /v1/customer/disputes", when: "Every few minutes, to bring disputes onto the shop's cases." },
  { key: "search", api: "Transaction Search v1", endpoint: "GET /v1/reporting/transactions", when: "Reconciliation: matches PayPal's record against Everyday's." },
  { key: "mcp", api: "PayPal's MCP server (read tools)", endpoint: `${PAYPAL_MCP_URL} (${READ_TOOLS.join(", ")})`, when: "When the assistant checks an order or a refund with PayPal itself." },
];

async function paypalData() {
  const ws = await showcase();
  const db = await getDb();
  const ids: Record<string, { id: string | null; at: string | null; note?: string }> = {};
  if (ws?.account_id) {
    const op = async (kind: string) => (await db.query<any>("SELECT p.paypal_id, p.updated_at, p.paypal_status FROM payment_ops p JOIN orders o ON o.id = p.order_id WHERE o.account_id = $1 AND p.kind = $2 AND p.status = 'succeeded' AND p.paypal_id IS NOT NULL ORDER BY p.updated_at DESC LIMIT 1", [ws.account_id, kind])).rows[0];
    const o = await op("order");
    const c = await op("capture");
    const r = await op("refund");
    if (o) ids.order = { id: o.paypal_id, at: o.updated_at };
    if (c) ids.capture = { id: c.paypal_id, at: c.updated_at };
    if (r) ids.refund = { id: r.paypal_id, at: r.updated_at, note: r.paypal_status ? `PayPal says ${r.paypal_status}` : undefined };
    if (r?.paypal_status === "COMPLETED") ids.refund_read = { id: r.paypal_id, at: r.updated_at, note: "read back as COMPLETED" };
    if (c && config.paypal.demoVaultToken) ids.vault = { id: null, at: c.updated_at, note: "The saved wallet paid this showcase's purchases; its token stays private." };
    const wh = (await db.query<any>("SELECT id, event_type, received_at FROM webhook_events WHERE ws_id = $1 AND verified ORDER BY received_at DESC LIMIT 1", [ws.id])).rows[0];
    if (wh) ids.webhook = { id: wh.id, at: wh.received_at, note: wh.event_type };
    const tr = (await db.query<any>("SELECT t.tracking_number, t.created_at, t.paypal_status FROM trackers t JOIN orders o ON o.id = t.order_id WHERE o.account_id = $1 ORDER BY t.created_at DESC LIMIT 1", [ws.account_id])).rows[0];
    if (tr) ids.tracking = { id: tr.tracking_number, at: tr.created_at, note: tr.paypal_status ?? undefined };
    const dp = (await db.query<any>("SELECT d.paypal_id, d.synced_at FROM disputes d JOIN orders o ON o.id = d.order_id WHERE o.account_id = $1 ORDER BY d.synced_at DESC LIMIT 1", [ws.account_id])).rows[0];
    if (dp) ids.dispute = { id: dp.paypal_id, at: dp.synced_at };
    const mcp = (await db.query<any>("SELECT t.tool, t.args, t.at FROM agent_trace t JOIN agent_runs r ON r.id = t.run_id WHERE r.ws_id = $1 AND t.actor = 'paypal' ORDER BY t.at DESC LIMIT 1", [ws.id])).rows[0];
    if (mcp) ids.mcp = { id: (parse(mcp.args) as any)?.number ?? (parse(mcp.args) as any)?.order ?? null, at: mcp.at, note: `${mcp.tool}` };
  }
  return {
    env: config.paypal.env,
    connected: Boolean(config.paypal.clientId && config.paypal.clientSecret),
    mcp_connected: paypalMcpReady(),
    showcase: ws ? { id: ws.id, built: ws.created_at } : null,
    apis: PAYPAL_APIS.map((a) => ({ ...a, live: ids[a.key] ?? null })),
  };
}

async function aiData() {
  const ws = await showcase();
  const db = await getDb();
  const rows = ws ? (await db.query<any>("SELECT id, purpose, model, via, input_summary, tokens_in, tokens_out, cost_usd, latency_ms, ok, error, output, run_id, at FROM ai_calls WHERE ws_id = $1 ORDER BY id DESC LIMIT 20", [ws.id])).rows : [];
  const runs = [...new Set(rows.map((r) => r.run_id).filter(Boolean))];
  const steps = runs.length ? (await db.query<any>("SELECT run_id, step, actor, tool, duration_ms FROM agent_trace WHERE run_id = ANY($1::text[]) AND actor <> 'model' ORDER BY run_id, step", [runs])).rows : [];
  const byRun = new Map<string, { tool: string; source: string; ms: number | null }[]>();
  for (const s of steps) byRun.set(s.run_id, [...(byRun.get(s.run_id) ?? []), { tool: s.tool, source: s.actor === "paypal" ? "paypal" : "everyday", ms: s.duration_ms }]);
  const brief = (o: unknown) => {
    const s = JSON.stringify(parse(o) ?? null);
    return s.length > 220 ? `${s.slice(0, 219)}…` : s;
  };
  return {
    showcase: ws ? { id: ws.id, built: ws.created_at } : null,
    connected: hasOpenAI(),
    calls: rows.map((r) => ({
      at: r.at,
      purpose: r.purpose,
      model: r.model,
      via: r.via,
      input: r.input_summary,
      tools: r.run_id ? byRun.get(r.run_id) ?? [] : [],
      output: r.ok ? brief(r.output) : null,
      error: r.ok ? null : String(r.error ?? "").slice(0, 160),
      ms: r.latency_ms,
      tokens_in: r.tokens_in,
      tokens_out: r.tokens_out,
      cost_usd: Number(r.cost_usd),
      ok: r.ok,
    })),
  };
}

/** Who can move money. The tool lists come from the code; the test checks the MCP list against src/mcp/tools.ts. */
export const SHOPPER_MCP_TOOLS = ["my_constraints", "plan_for", "quote", "approve_purchase", "repeat_buy", "passport", "get_trace"];
export const MERCHANT_MCP_TOOLS = ["list_orders", "get_order", "list_cases", "list_approvals", "list_disputes", "get_performance", "get_trace"];

export function rolesData() {
  const askTools = TOOLS.map((t) => `${t.name} (${t.kind === "propose" ? "proposes" : "reads"})`).join(", ");
  return {
    rule: "Code decides every amount, from the quote, the order and PayPal's own record. No model and no message can set one.",
    roles: [
      { who: "The shopper", can: ["Approve a plan on PayPal's page, or pay from the demo's saved sandbox wallet", "Claim a price drop or open a return or damage case", "Set spending rules: a monthly limit, an approval threshold, allowed shops and categories", "Stop all assistants with one switch"], cannot: ["Change a price or a quote (a quote is fixed by hash for 15 minutes)", "Spend past their own rules: a purchase over the limit is held for them"] },
      { who: "The shop (merchant)", can: ["Approve or refuse a claim; an approved claim sends a PayPal refund", "Ship and add tracking"], cannot: ["Refund more than was paid, or refund an order with no paid amount Everyday can find (refused in code)", "Go over its own refund limit without an approval", "Charge the shopper"] },
      { who: `The request reader (${config.ai.models.read}, backup ${config.ai.models.backup})`, can: ["Read a sentence or a photo into fields: what is wanted, the budget it heard, the date, what you already own"], cannot: ["Set any amount: fields named like amounts are refused by the schema check", "Call PayPal or approve anything"] },
      { who: `The assistant on Ask (${config.ai.models.read})`, can: [`Use read and propose tools only: ${askTools}`, `PayPal reads through PayPal's MCP server, limited to ${READ_TOOLS.join(", ")}, for the shopper's own orders`, `At most ${MAX_STEPS} steps and ${MAX_MS / 1000} seconds a question`], cannot: ["Buy, pay, approve, capture or refund: it has no tool for any of them", "Read another shopper's orders: every PayPal id is checked against the shopper's own"] },
      { who: `The second scam reader (Decisions, ${DECISIONS_MODEL}) and the on-device scam model`, can: ["Hold a message or mark it as needing care"], cannot: ["Mark a message clear on its own: clear needs every check to agree, and a message that names somewhere to pay is never clear", "Move money"] },
      { who: "An outside assistant with the shopper's key (MCP)", can: [`Tools: ${SHOPPER_MCP_TOOLS.join(", ")}`, "Plan, quote and start a PayPal approval that the shopper finishes on PayPal", "Repeat a past purchase on the saved wallet only inside the shopper's rules (one-tap on, under the approval threshold, an allowed shop and category, within the monthly limit); anything else is held for the shopper or refused"], cannot: ["Refund, or change rules or limits", "Act while the shopper's or the assistant's kill switch is on", "Act without each call being recorded with the assistant's id"] },
      { who: "An outside assistant with the shop's key (MCP)", can: [`Read only: ${MERCHANT_MCP_TOOLS.join(", ")}`], cannot: ["Ship, refund or decide a case"] },
      { who: "Everyday's own code (the gate)", can: ["Check every payment against the quote, the rules and what PayPal reports, before and after"], cannot: ["Say money moved before PayPal confirms it"] },
    ],
  };
}

function a11yData() {
  const j = readJson("accessibility.json");
  return j ?? { missing: true };
}

function agentsData() {
  const base = config.appUrl.replace(/\/$/, "");
  return {
    endpoint: `${base}/mcp`,
    merchant_endpoint: `${base}/merchant/mcp`,
    transport: "MCP Streamable HTTP (stateless), Authorization: Bearer <the shopper's Everyday access key>",
    key_where: "Start a demo, then press Make an assistant key on this page. The key is shown once, works only on /mcp, can be disconnected under You → Devices, and stops working when the demo ends.",
    connect: [
      { client: "Claude Code", command: `claude mcp add --transport http everyday ${base}/mcp --header "Authorization: Bearer YOUR_EVERYDAY_KEY"` },
      { client: "Any MCP client (JSON)", command: JSON.stringify({ mcpServers: { everyday: { type: "http", url: `${base}/mcp`, headers: { Authorization: "Bearer YOUR_EVERYDAY_KEY" } } } }, null, 2) },
      { client: "Check it with curl", command: `curl -s ${base}/mcp -H "Authorization: Bearer YOUR_EVERYDAY_KEY" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` },
    ],
    shopper_tools: SHOPPER_MCP_TOOLS,
    merchant_tools: MERCHANT_MCP_TOOLS,
    limits: "Every call is recorded with the assistant's id and is refused while a kill switch is on. Money moves only as the roles page says.",
  };
}

export function publicRoutes() {
  const r = Router();
  r.get("/api/public/proof", json(async () => proofData()));
  r.get("/api/public/ai", json(async () => aiData()));
  r.get("/api/public/paypal", json(async () => paypalData()));
  r.get("/api/public/roles", json(async () => rolesData()));
  r.get("/api/public/accessibility", json(async () => a11yData()));
  r.get("/api/public/agents", json(async () => agentsData()));
  return r;
}

export const evalFileDate = (f: string) => {
  const p = join(EVAL, f);
  return existsSync(p) ? statSync(p).mtime.toISOString() : null;
};
