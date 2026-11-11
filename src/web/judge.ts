/**
 * A3.1: the judge page's data. Three short paths whose steps tick themselves from events the server recorded in the
 * visitor's own workspace (src/services/checklist.ts), a "what is live, what is simulated" table built from this
 * instance's real configuration at request time, a QR code that opens the same demo on a phone, and the pages that
 * need no sign-in.
 */
import { Router } from "express";
import QRCode from "qrcode";
import { hasOpenAI } from "../ai/provider.js";
import { DECISIONS_MODEL } from "../ai/decisions.js";
import { pushReady } from "../channels/push.js";
import { telegramReady, whatsappReady } from "../channels/index.js";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { sign, unsign } from "../lib/crypto.js";
import { paypalMcpReady, PAYPAL_MCP_URL } from "../paypal/mcp.js";
import { channel3Ready } from "../services/channel3.js";
import { STEPS, ticks, type Step } from "../services/checklist.js";
import { currentWs } from "../ws.js";
import { setWsCookie, signIn, whoami } from "./auth.js";
import { json } from "./common.js";

interface PathStep {
  key: Step;
  label: string;
  how: string;
  href: string;
}
export const PATHS: { id: string; title: string; minutes: number; no_login: boolean; why: string; steps: PathStep[] }[] = [
  {
    id: "money",
    title: "Get money back",
    minutes: 2,
    no_login: true,
    why: "The part no close rival has: Everyday watches what you bought and gets money back inside the shop's own promise, with the refund read back from PayPal.",
    steps: [
      { key: "price_drop_claimed", label: STEPS.price_drop_claimed, how: "Today opens with the money you can still get back: something you bought is cheaper now. Press Ask for … back.", href: "/today" },
      { key: "refund_confirmed", label: STEPS.refund_confirmed, how: "As the shop, approve the claim (Orders, then the case). Everyday sends the refund and shows it only once PayPal confirms it.", href: "/merchant" },
      { key: "ask_answered", label: STEPS.ask_answered, how: "Ask the assistant to check with PayPal itself. Watch the AI work rail.", href: "/ask?q=Did%20PayPal%20confirm%20my%20refund%3F&go=1" },
    ],
  },
  {
    id: "buy",
    title: "Ask for something and buy it",
    minutes: 3,
    no_login: true,
    why: "A sentence becomes a checked plan: code applies the budget, the date, what you own and every quality you asked for, then you pay from the demo's saved sandbox wallet.",
    steps: [
      { key: "plan_made", label: STEPS.plan_made, how: "The sentence is typed for you. Press Plan it.", href: "/plans?text=a%20wireless%20keyboard%20under%20%2480" },
      { key: "plan_quoted", label: STEPS.plan_quoted, how: "On the plan, press Get the exact quote.", href: "/plans" },
      { key: "paid_demo_wallet", label: STEPS.paid_demo_wallet, how: "Press Pay … as the demo shopper. PayPal captures it from a saved sandbox wallet; no login.", href: "/plans" },
    ],
  },
  {
    id: "scam",
    title: "Check a scam message",
    minutes: 1,
    no_login: true,
    why: "Four checks, strictest wins: a model on your device, rules, a second reader (OpenAI's Decisions) and a look for pay-to details. A message that names somewhere to pay is never shown as clear.",
    steps: [
      { key: "scam_checked", label: STEPS.scam_checked, how: "Paste the demo scam and press Check this message.", href: "/safety" },
      { key: "scam_held", label: STEPS.scam_held, how: "The polite \"we've moved banks\" message is held, with the reasons.", href: "/safety" },
    ],
  },
  {
    id: "receipt",
    title: "Add a receipt from another shop",
    minutes: 1,
    no_login: true,
    why: "Things bought elsewhere get the same watch: the model reads the receipt, code keeps only what it can point to on it, and works out the return and warranty dates. Nothing is saved until you check it.",
    steps: [{ key: "receipt_added", label: STEPS.receipt_added, how: "Press Use the sample receipt, then Read it, check the lines and press Save.", href: "/receipts" }],
  },
];

/** What is live and what is simulated, from this instance's real settings now. */
export function liveTable() {
  const pp = Boolean(config.paypal.clientId && config.paypal.clientSecret);
  const sandbox = config.paypal.env === "sandbox";
  const env = sandbox ? "PayPal sandbox (test money)" : "PayPal live";
  const row = (what: string, live: boolean, how: string) => ({ what, state: live ? "live" : "not connected", how });
  return [
    row("PayPal orders and captures", pp, pp ? `${env}; each capture read back from PayPal before Everyday says it happened` : "No PayPal credentials on this instance"),
    row("Pay as the demo shopper (no login)", pp && Boolean(config.paypal.demoVaultToken), config.paypal.demoVaultToken ? "A saved sandbox buyer wallet (PayPal Vault), approved once by the owner" : "No saved wallet on this instance: pay on PayPal's page"),
    row("Refunds", pp, pp ? `${env}; a refund counts once PayPal reports it COMPLETED` : "No PayPal credentials"),
    row("PayPal webhooks", pp && Boolean(config.paypal.webhookId), config.paypal.webhookId ? "Signature-verified by PayPal, routed to the visitor's own demo" : "No webhook id set"),
    row("PayPal's MCP server (the assistant's PayPal reads)", paypalMcpReady(), paypalMcpReady() ? `${PAYPAL_MCP_URL}, read tools only (get_order, get_refund)` : "No PayPal credentials"),
    row("Reading requests and photos", hasOpenAI(), hasOpenAI() ? `${config.ai.models.read}, backup ${config.ai.models.backup}` : "No model key: a failed reading shows the manual form"),
    row("Second reader for scams (Decisions)", hasOpenAI(), hasOpenAI() ? `${DECISIONS_MODEL} on /v1/decisions, thresholds calibrated on labelled messages` : "No model key: results can't be marked clear"),
    row("The assistant (Ask)", hasOpenAI(), hasOpenAI() ? `${config.ai.models.read} with read and propose tools only` : "No model key"),
    { what: "Scam model on your device", state: "live", how: "A fine-tuned MiniLM, int8 ONNX, run in your browser; trained on about 80,000 messages" },
    { what: "Payment-risk score", state: "live", how: "A small model trained on synthetic data: a ranking signal, not a fraud rate" },
    row("Product search on the web (Channel3)", channel3Ready(), channel3Ready() ? "Live Channel3 results, labelled \"found on the web; not purchasable in this demo\"" : "No Channel3 key: the demo shop only"),
    row("Telegram", telegramReady(), telegramReady() ? "A real bot; messages are really sent" : "Not connected: nothing is shown as sent"),
    row("WhatsApp", whatsappReady(), whatsappReady() ? "Connected" : "Not connected: nothing is shown as sent"),
    row("Push notifications", pushReady(), pushReady() ? "Web push with this site's keys" : "Not connected"),
    { what: "The demo shop, its catalog and its price drops", state: "sample", how: "Seeded sample data (marked Sample); the payments made in it are real sandbox payments" },
    { what: "The demo clock", state: "sample", how: "Each demo has its own clock, moved only by its own +1 day control" },
  ];
}

export const NO_SIGN_IN = [
  { href: "/proof", label: "Proof", what: "Every evaluation case, the model ids and the date run" },
  { href: "/ai", label: "AI calls", what: "The last model calls in the showcase demo, with what each cost" },
  { href: "/paypal", label: "PayPal", what: "Every PayPal API Everyday uses, when, with a live id" },
  { href: "/who-can-move-money", label: "Who can move money", what: "The shopper, the shop, each model and any outside agent: can and cannot" },
  { href: "/accessibility", label: "Accessibility", what: "What was tested, how, and what wasn't" },
  { href: "/agents", label: "Agents", what: "How an outside assistant connects, with a copy-paste command" },
];

export function judgeRoutes() {
  const r = Router();

  r.get("/api/ui/judge", json(async (req) => {
    const ws = currentWs();
    const done = await ticks(ws);
    const w = await whoami(req).catch(() => null);
    let phone: { url: string; svg: string } | null = null;
    if (ws && config.demoMode) {
      const t = sign(`join|${ws}|${Date.now() + 48 * 3600_000}`);
      const url = `${config.appUrl.replace(/\/$/, "")}/demo/join?t=${encodeURIComponent(t)}`;
      phone = { url, svg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
    }
    return {
      ws,
      signed_in: Boolean(w?.account || w?.merchant),
      paths: PATHS.map((p) => ({ ...p, steps: p.steps.map((s) => ({ ...s, done: Boolean(done[s.key]), at: done[s.key]?.at ?? null })) })),
      live: liveTable(),
      pages: NO_SIGN_IN,
      phone,
      sandbox_buyer: process.env.EV_JUDGE_BUYER_EMAIL ? { email: process.env.EV_JUDGE_BUYER_EMAIL, password: process.env.EV_JUDGE_BUYER_PASSWORD ?? null } : null,
    };
  }));

  /** The QR code's link: opens the same demo workspace on a phone (48 hours), signed in as its shopper. */
  r.get("/demo/join", async (req, res, next) => {
    try {
      const v = unsign(String(req.query.t ?? ""));
      const m = v?.match(/^join\|(ws_[a-z0-9]+)\|(\d+)$/);
      if (!m || Number(m[2]) < Date.now()) return res.redirect(302, "/?err=" + encodeURIComponent("That link has run out. Start a demo on this phone instead."));
      const db = await getDb();
      const acc = (await db.query<{ id: string }>("SELECT a.id FROM accounts a JOIN workspaces w ON w.id = a.ws_id WHERE a.ws_id = $1 AND w.expires_at > now() ORDER BY a.created_at LIMIT 1", [m[1]])).rows[0];
      if (!acc) return res.redirect(302, "/?err=" + encodeURIComponent("That demo has ended. Start a new one on this phone."));
      setWsCookie(res, m[1]);
      signIn(res, `acc:${acc.id}`);
      res.redirect(302, "/today");
    } catch (e) {
      next(e);
    }
  });

  return r;
}
