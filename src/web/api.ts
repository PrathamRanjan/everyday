/**
 * Read-only JSON for the React app (web/). Each endpoint returns what one screen needs, from the same services and
 * queries the server-rendered pages used. Every action still posts to its existing route (see spa.ts for how a
 * redirect becomes JSON for the app), so business logic lives in one place.
 */
import { Router, type Request, type Response } from "express";
import { sandboxBuyer } from "./judge.js";
import { existsSync, readFileSync } from "node:fs";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { fmtWall, wallIso } from "../core/time.js";
import { FEATURES, label } from "../core/prefs.js";
import { GtError, hashKey, newSecret } from "../lib/util.js";
import { accountById, J, nowOf, type Account } from "../store.js";
import { catalog, CATEGORY_LABEL } from "../services/catalog.js";
import { BASIS } from "../services/captures.js";
import { CLIPS } from "../services/catalog-data.js";
import { calendar, owned, recallsFor, today } from "../services/life.js";
import { choiceReceipts, modelFor, whyPanel } from "../services/ml.js";
import { protectionsFor } from "../services/protect.js";
import { quoteExpired, spending } from "../services/orders.js";
import { currentPlan, intentRow, tastePairs } from "../services/plans.js";
import { passportSummary, reconcileTransactions, vaultStatus } from "../services/passport.js";
import { channel3Ready, searchProducts } from "../services/channel3.js";
import { aiUsageSummary, hasOpenAI, providerLabel } from "../ai/provider.js";
import { evalRows, summarise } from "../eval/store.js";
import { recentAudit, verifyChain } from "../guard/audit.js";
import { backtest, suggestAutonomy } from "../guard/backtest.js";
import { countersignThreshold, pendingApprovals } from "../guard/dryrun.js";
import { isKilled, listKills } from "../guard/kill.js";
import { hasPasskey } from "../guard/passkey.js";
import { activePolicy, DEFAULT_RULES, isMerchantOwner, listPolicies, merchantOwner, type Rules } from "../guard/policy.js";
import { currentWs } from "../ws.js";
import { progressLine, showcase, startWorkspace, workspaceById, workspaceByToken } from "../services/workspaces.js";
import { protectedMode, safetyHolds } from "../safety/index.js";
import { scanText, TACTIC_WORDS, TACTICS } from "../safety/rules.js";
import { telegramReady, conversation, recentMessages } from "../channels/index.js";
import { pushReady } from "../channels/push.js";
import { loadRun, recentRuns, runsFor } from "../trace.js";
import { bearerOf, whoami } from "./auth.js";
import { unlimited } from "./demo.js";
import { partyOf } from "./trace.js";
import { DEMO_SCAM } from "./safety.js";
import { newId } from "../lib/ids.js";
import { demoWallet, walletView } from "../services/demowallet.js";
import { fxRates } from "../services/fx.js";
import { handsfreeCommand } from "../services/handsfree.js";
import { normLang } from "../i18n/index.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;
const send = (fn: Handler) => (req: Request, res: Response, next: (e?: unknown) => void) =>
  fn(req, res)
    .then((out) => {
      if (!res.headersSent) res.set("Cache-Control", "no-store").json(out);
    })
    .catch((e) => {
      if (e instanceof GtError) return res.status(e.status).json({ error: e.code, message: e.message });
      next(e);
    });

const signIn = () => new GtError("Sign in first.", "unauthorized", 401);
async function shopperOf(req: Request): Promise<Account> {
  const w = await whoami(req);
  if (!w?.account) throw signIn();
  return w.account;
}
async function merchantOf(req: Request) {
  const w = await whoami(req);
  if (!w?.merchant) throw signIn();
  return w.merchant;
}
const demoOnly = () => {
  if (!config.demoMode) throw new GtError("Demo mode is off.", "forbidden", 403);
};

export const RULE_LABELS: Record<keyof Rules, string> = {
  max_purchase_cents: "Largest single purchase an assistant may put in front of me",
  approve_above_cents: "Ask me before a repeat buy (or, for the merchant, a refund) at or above",
  max_refund_pct: "Largest refund as a share of what was paid",
  agents_may_plan: "Outside assistants may plan and quote for me",
  agents_may_request_approval: "Outside assistants may start the PayPal approval step",
  one_tap_repeat: "Repeat buys may run on my saved PayPal without a tap (under the threshold)",
  allowed_merchants: "Only buy from",
  blocked_categories: "Never buy",
};
const SHOPPER_KEYS: (keyof Rules)[] = ["max_purchase_cents", "approve_above_cents", "one_tap_repeat", "agents_may_plan", "agents_may_request_approval", "allowed_merchants", "blocked_categories"];
const MERCHANT_KEYS: (keyof Rules)[] = ["max_refund_pct", "approve_above_cents"];
const rulesView = (keys: (keyof Rules)[], r: Rules) => keys.map((k) => ({ key: k, label: RULE_LABELS[k], value: r[k] as unknown }));

/** One held money move, ready for the approval card: what, how much, to whom, why it waited, how to undo. */
export function approvalView(a: any) {
  const p = a.payload ?? {};
  const scam = Array.isArray(p.safety_reasons) && p.safety_reasons.length > 0;
  return {
    id: a.id as string,
    action: String(a.action).replace(/_/g, " "),
    cents: Number(p.cents ?? 0),
    entity: p.entity ?? null,
    entity_id: p.entity_id ?? null,
    to: p.payee ?? p.merchant ?? p.to ?? null,
    title: p.title ?? p.subject ?? null,
    status: a.status,
    created_at: a.created_at,
    level: scam ? "hold" : "caution",
    reasons: scam ? (p.safety_reasons as string[]) : [`It's at or above the approval limit${isMerchantOwner(a.owner_id) ? " in the shop's refund rules" : " you set"}.`],
    passkey: Number(p.cents ?? 0) > countersignThreshold(),
  };
}

const lineDates = (l: any, policy: any, i: any) => ({
  ordered: l.placed ? String(l.placed).slice(0, 10) : l.created_at ? wallIso(new Date(l.created_at)).slice(0, 10) : null,
  eta: l.eta ?? null,
  delivered: l.delivered_at ? String(l.delivered_at).slice(0, 10) : null,
  deadline: i?.deadline ?? null,
  return_days: Number(policy?.window_days ?? 30),
  protection_days: Number(policy?.price_protection_days ?? 0),
});

export function apiRoutes() {
  const r = Router();

  // ---------- Session and public ----------
  // C2: the live tool-call panel on /agents: this shopper's last calls from outside assistants (arguments and
  // results shortened; keys are never stored here).
  r.get("/api/ui/agents/calls", send(async (req) => {
    const a = await shopperOf(req);
    const rows = (await (await getDb()).query<any>("SELECT id, agent_id, tool, args, ok, result, created_at FROM agent_requests WHERE principal = $1 ORDER BY created_at DESC LIMIT 20", [`shopper:${a.id}`])).rows;
    const short = (v: unknown) => {
      const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
      return s.length > 220 ? `${s.slice(0, 220)}…` : s;
    };
    return {
      calls: rows.map((x) => {
        const res = typeof x.result === "string" ? JSON.parse(x.result) : x.result;
        return { id: x.id, agent: String(x.agent_id).slice(0, 60), tool: x.tool, args: short(x.args), state: x.ok === null ? "running" : x.ok ? "ok" : "refused", detail: x.ok === false ? String(res?.message ?? "") : short(res), at: x.created_at };
      }),
    };
  }));
  // A4/A5: a spoken phrase the page couldn't handle itself; money steps wait for "confirm" said back.
  r.post("/api/ui/handsfree/command", send(async (req) => handsfreeCommand(await shopperOf(req), req.body ?? {})));
  // B6: the shopper's language, saved on the account so messages sent later (Telegram, push) are worded in it.
  r.post("/api/ui/lang", send(async (req) => {
    const a = await shopperOf(req);
    const l = normLang(req.body?.lang);
    if (!l) throw new GtError("Pick one of: en, hi, id, pt.", "bad_lang", 400);
    await (await getDb()).query("UPDATE accounts SET lang = $2 WHERE id = $1", [a.id, l]);
    return { ok: true, lang: l };
  }));
  // B5: a rough local-currency reading of dollar amounts (display only; Everyday charges in US dollars).
  r.get("/api/ui/fx", send(async () => fxRates()));
  r.get("/api/ui/session", send(async (req) => {
    const w = await whoami(req);
    const wallet = config.demoMode ? walletView(await demoWallet()) : null;
    // A1: the visitor's own demo workspace (expiry, the seed's payment progress, the second-device link).
    const wsId = currentWs();
    const wsRow = wsId && config.demoMode ? await workspaceById(wsId) : null;
    const workspace = wsRow ? { id: wsRow.id, kind: wsRow.kind, state: wsRow.seed_state, expires_at: wsRow.expires_at, progress_line: progressLine(wsRow.progress), finished: Boolean(wsRow.progress.finished), join_url: wsRow.kind === "visitor" && wsRow.join_token ? `${config.appUrl}/demo/join/${wsRow.join_token}` : null } : null;
    const base = { demo: config.demoMode, private_demos: config.privateDemos, workspace, paypal_env: config.paypal.env, demo_wallet: wallet, sandbox_buyer: sandboxBuyer(), live: { telegram: telegramReady(), push: pushReady(), channel3: channel3Ready(), ai: hasOpenAI(), ai_label: providerLabel(), paypal: Boolean(config.paypal.clientId) }, telegram_bot: config.channels.telegramBot };
    if (w?.account) {
      const a = w.account;
      const db = await getDb();
      const [items, held] = await Promise.all([today(db, a), pendingApprovals(a.id)]);
      return { ...base, who: { kind: "shopper", id: a.id, name: a.name, first: a.name.split(" ")[0], clock: fmtWall(nowOf(a)), today: wallIso(nowOf(a)).slice(0, 10), needs: items.length + held.length, held: held.length } };
    }
    if (w?.merchant) return { ...base, who: { kind: "merchant", id: w.merchant.id, name: w.merchant.name, first: w.merchant.name, needs: (await pendingApprovals(merchantOwner())).length } };
    return { ...base, who: null };
  }));

  r.get("/api/ui/personas", send(async () => {
    const db = await getDb();
    if (!config.demoMode) return { demo: false, accounts: [], merchants: [] };
    // A1: the personas of the visitor's own workspace only. With private demos on and no workspace yet, none: the
    // page offers "Try the live demo" instead of a shared world.
    const ws = currentWs();
    if (config.privateDemos && !ws) return { demo: true, accounts: [], merchants: [], private_demos: true, workspace: null };
    const accounts = (await db.query<any>("SELECT id, name FROM accounts WHERE ws_id IS NOT DISTINCT FROM $1 ORDER BY name", [ws]).catch(() => ({ rows: [] as any[] }))).rows;
    const merchants = (await db.query<any>("SELECT id, name FROM merchants WHERE kind = 'test_merchant' AND ws_id IS NOT DISTINCT FROM $1 ORDER BY name", [ws]).catch(() => ({ rows: [] as any[] }))).rows;
    return { demo: true, accounts, merchants, private_demos: config.privateDemos, workspace: ws };
  }));

  /**
   * The landing page's live preview, read from the showcase workspace (A1.2): its newest paid order line and owned
   * items, with their dates. Built through the same seeding path as every visitor's demo; nothing here is typed in.
   */
  r.get("/api/ui/preview", send(async () => {
    const db = await getDb();
    const sc = config.privateDemos ? await showcase() : null;
    const acc = sc?.account_id ? (await db.query<any>("SELECT * FROM accounts WHERE id = $1", [sc.account_id])).rows[0] : config.privateDemos ? null : (await db.query<any>("SELECT * FROM accounts WHERE ws_id IS NULL ORDER BY created_at LIMIT 1")).rows[0];
    if (!acc) return { line: null, owned: [], today: wallIso(new Date()).slice(0, 10), source: "none" };
    const l = (await db.query<any>("SELECT l.title, l.unit_cents, l.status, l.eta, l.delivered_at, o.created_at, o.policy, o.number, o.status AS order_status, o.capture_id, o.paypal_order_id FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.capture_id IS NOT NULL AND o.account_id = $1 ORDER BY o.created_at DESC LIMIT 1", [acc.id])).rows[0];
    const own = (await db.query<any>("SELECT title, price_cents, acquired, return_until, warranty_until, source FROM owned_items WHERE status = 'owned' AND warranty_until IS NOT NULL AND account_id = $1 ORDER BY acquired DESC LIMIT 3", [acc.id])).rows;
    return { line: l ? { title: l.title, cents: l.unit_cents, status: l.status, number: l.number, paid: Boolean(l.capture_id), capture_id: l.capture_id, dates: lineDates(l, J<any>(l.policy), null) } : null, owned: own, today: wallIso(nowOf(acc)).slice(0, 10), source: sc ? "showcase" : "demo", showcase: sc?.id ?? null };
  }));

  // ---------- Shopper ----------
  r.get("/api/ui/today", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const [items, cal, sp, held] = await Promise.all([today(db, a), calendar(db, a), spending(db, a), pendingApprovals(a.id)]);
    const inbox = (await db.query<any>("SELECT * FROM inbox WHERE account_id = $1 AND channel = 'app' ORDER BY id DESC LIMIT 5", [a.id])).rows.map((m) => ({ id: m.id, text: m.text, at: m.created_at, flag: flagOf(m.text) }));
    const mine = await owned(db, a);
    const now = wallIso(nowOf(a)).slice(0, 10);
    const soon = mine.filter((o) => o.status === "owned" && o.return_until && o.return_until >= now).map((o) => ({ id: o.id, title: o.title, return_until: o.return_until, warranty_until: o.warranty_until, acquired: o.acquired })).sort((x, y) => String(x.return_until).localeCompare(String(y.return_until))).slice(0, 4);
    const { moneyBack } = await import("../services/money-back.js");
    const back = await moneyBack(db, a);
    return { first: a.name.split(" ")[0], today: now, clock: fmtWall(nowOf(a)), items, calendar: cal, spending: sp, inbox, held: held.slice(0, 4).map(approvalView), soon, money_back: back };
  }));

  r.get("/api/ui/discover", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const caps = (await db.query<any>("SELECT id, url, title, status, channel, platform, created_at, objects FROM captures WHERE account_id = $1 ORDER BY created_at DESC", [a.id])).rows.map((c) => ({ ...c, objects: J<any[]>(c.objects).length }));
    const cat = await catalog(db);
    const q = String(req.query.q ?? "").trim().slice(0, 120);
    const results = q ? cat.index.fused(q, 12).map((x) => cat.byId.get(x.id)!).filter(Boolean).map((p) => ({ id: p.id, title: p.title, model: p.model, merchant: p.merchant_label, price_cents: p.price_cents, checkout: p.checkout, category: p.category })) : [];
    const watches = (await db.query<any>("SELECT w.id, w.target_cents, w.status, p.title, p.price_cents FROM price_watches w JOIN products p ON p.id = w.product_id WHERE w.account_id = $1", [a.id])).rows;
    return { captures: caps, q, results, watches, clips: CLIPS.map((c) => ({ url: c.url, title: c.title })) };
  }));

  r.get("/api/ui/captures/:id", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const c = (await db.query<any>("SELECT * FROM captures WHERE id = $1 AND account_id = $2", [req.params.id, a.id])).rows[0];
    if (!c) throw new GtError("Not found", "not_found", 404);
    const intents = (await db.query<any>("SELECT id, text, status, COALESCE((SELECT MIN(wall) FROM events WHERE entity = 'intent' AND entity_id = intents.id), intents.created_at::text) AS created_at FROM intents WHERE capture_id = $1 ORDER BY intents.created_at DESC", [c.id])).rows;
    const sig = J<any>(c.signal);
    return { capture: { id: c.id, url: c.url, title: c.title, platform: c.platform, channel: c.channel, status: c.status, basis: BASIS[c.status] ?? c.basis, selected: c.selected, reader: c.reader, created_at: c.created_at, quarantined: sig?.quarantined ?? [], flags: J<any[]>(c.flags) }, objects: J<any[]>(c.objects), intents };
  }));

  r.get("/api/ui/plans", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const rows = (await db.query<any>("SELECT i.id, i.text, i.status, i.channel, COALESCE((SELECT MIN(wall) FROM events WHERE entity = 'intent' AND entity_id = i.id), i.created_at::text) AS created_at, i.budget_cents, i.deadline, r.name AS recipient, r.is_self FROM intents i JOIN recipients r ON r.id = i.recipient_id WHERE i.account_id = $1 ORDER BY i.created_at DESC", [a.id])).rows;
    const recipients = (await db.query<any>("SELECT id, name, relation, is_self FROM recipients WHERE account_id = $1 ORDER BY is_self DESC", [a.id])).rows;
    return { plans: rows, recipients };
  }));

  // The taste model's card (taste-lab/): metrics against baselines, the "nothing fits" line, the language test.
  r.get("/api/ui/taste", send(async () => {
    const { tasteCard } = await import("../taste/taste.js");
    return tasteCard();
  }));
  // What the browser's taste model learns from: the shopper's own things (title and brand), and whether they kept them.
  r.get("/api/ui/taste/history", send(async (req) => {
    const a = await shopperOf(req);
    const mine = await owned(await getDb(), a);
    return { items: mine.slice(0, 40).map((o: any) => ({ title: String(o.title), brand: o.brand ? String(o.brand) : null, kept: o.status === "owned" })) };
  }));

  // B6: the plan's web tier (Channel3), checked in code against the same must-haves; a labelled hand-off, never a checkout.
  r.get("/api/ui/plans/:id/web", send(async (req) => {
    const a = await shopperOf(req);
    const { webPicksFor } = await import("../services/web-picks.js");
    return webPicksFor(a, String(req.params.id), { refresh: req.query.refresh === "1" });
  }));
  // Tier 2: the shopper bought a web listing at the retailer; Everyday tracks it from here (nothing is paid here).
  r.post("/api/ui/plans/:id/web/bought", send(async (req) => {
    const a = await shopperOf(req);
    const { trackWebPurchase } = await import("../services/web-picks.js");
    return trackWebPurchase(a, String(req.params.id), String(req.body?.url ?? ""));
  }));
  r.get("/api/ui/plans/:id", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const i = await intentRow(db, a, req.params.id);
    const p = await currentPlan(db, i.id);
    const b = p?.body ?? null;
    const open = p?.status === "current" && i.status === "planning";
    const pairs = open && b && !b.questions.length ? await tastePairs(db, a, i.id, 1) : [];
    const answered = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pref_events WHERE intent_id = $1", [i.id])).rows[0].n;
    const quote0 = (await db.query<any>("SELECT * FROM quotes WHERE plan_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 1", [p?.id ?? ""])).rows[0];
    const quote = quote0 && !quoteExpired(a, quote0) ? quote0 : undefined;
    const order = (await db.query<any>("SELECT id, number, status, total_cents FROM orders WHERE intent_id = $1 ORDER BY created_at DESC LIMIT 1", [i.id])).rows[0] ?? null;
    const recipient = (await db.query<any>("SELECT id, name, relation, is_self FROM recipients WHERE id = $1", [i.recipient_id])).rows[0];
    const reqs = J<any>(i.reqs);
    const nl = (await db.query<any>("SELECT shipping FROM merchants WHERE kind = 'test_merchant' AND ws_id IS NOT DISTINCT FROM $1 LIMIT 1", [currentWs()])).rows[0];
    const capture = i.capture_id ? (await db.query<any>("SELECT id, title, url FROM captures WHERE id = $1", [i.capture_id])).rows[0] ?? null : null;
    const runs = await runsFor("intent", i.id, 5).catch(() => []);
    return {
      intent: { id: i.id, text: i.text, status: i.status, budget_cents: i.budget_cents, deadline: i.deadline, channel: i.channel, created_at: (await db.query<{ w: string | null }>("SELECT MIN(wall) AS w FROM events WHERE entity = 'intent' AND entity_id = $1", [i.id])).rows[0]?.w ?? i.created_at, read: reqs?.read ?? null, must_have: reqs?.must_have ?? reqs?.style_words ?? [], require_ergonomic: reqs?.require_ergonomic ?? false, laptop_port: reqs?.laptop_port ?? null },
      recipient,
      capture,
      plan: p ? { id: p.id, version: p.version, status: p.status, ...b } : null,
      open,
      pairs: pairs.map(([x, y]: any) => [pairItem(x), pairItem(y)]),
      answered,
      // A4: on a demo clock the quote has no real-time countdown; it says when it runs out on that clock.
      quote: quote ? { id: quote.id, hash: quote.hash, total_cents: quote.total_cents, ...J<any>(quote.body), expires_at: a.sim_now && quote.expires_wall ? null : quote.expires_at, expires_on_clock: a.sim_now && quote.expires_wall ? fmtWall(quote.expires_wall) : null } : null,
      order,
      shipping: J<any>(nl?.shipping),
      runs: runs.map((x: any) => ({ id: x.id, subject: x.subject, status: x.status })),
    };
  }));

  r.get("/api/ui/purchases", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const orders = (await db.query<any>("SELECT id, number, status, total_cents, gross_cents, refunded_cents, repaired, paid_via, created_at, (SELECT MIN(wall) FROM events WHERE entity_id = orders.id) AS placed_at, capture_id, paypal_order_id FROM orders WHERE account_id = $1 ORDER BY created_at DESC", [a.id])).rows;
    const lines = (await db.query<any>("SELECT l.order_id, l.title, l.status, l.eta FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.account_id = $1 ORDER BY l.slot", [a.id])).rows;
    return { orders: orders.map((o) => ({ ...o, lines: lines.filter((l) => l.order_id === o.id) })) };
  }));

  r.get("/api/ui/orders/:id", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const o = (await db.query<any>("SELECT * FROM orders WHERE id = $1 AND account_id = $2", [req.params.id, a.id])).rows[0];
    if (!o) throw new GtError("Not found", "not_found", 404);
    const lines = (await db.query<any>("SELECT * FROM order_lines WHERE order_id = $1 ORDER BY status = 'swapped', slot", [o.id])).rows;
    const ops = (await db.query<any>("SELECT kind, amount_cents, status, paypal_status, paypal_id, request_id, reason, error, created_at FROM payment_ops WHERE order_id = $1 ORDER BY created_at", [o.id])).rows;
    const cases = (await db.query<any>("SELECT * FROM cases WHERE order_id = $1 ORDER BY created_at", [o.id])).rows;
    const events = (await db.query<any>("SELECT id, wall, summary, actor, type AS kind FROM events WHERE entity_id = $1 ORDER BY id DESC", [o.id])).rows;
    const i = (await db.query<any>("SELECT id, text, deadline FROM intents WHERE id = $1", [o.intent_id])).rows[0];
    const merchant = (await db.query<any>("SELECT name, label FROM merchants WHERE id = $1", [o.merchant_id])).rows[0];
    const prot = new Map((await protectionsFor(db, a)).filter((x) => x.order_id === o.id).map((x) => [x.line_id, x]));
    const held = o.status === "created" ? (await pendingApprovals(a.id)).filter((x: any) => x.payload?.entity_id === o.id).map(approvalView) : [];
    const policy = J<any>(o.policy);
    // When it was placed on the shopper's clock (the demo clock in demo mode), from the order's first event.
    const placed = events.map((e) => String(e.wall ?? "")).filter(Boolean).sort()[0] ?? null;
    const runs = await runsFor("order", o.id, 10).catch(() => []);
    return {
      order: { id: o.id, number: o.number, status: o.status, total_cents: o.total_cents, gross_cents: o.gross_cents, fee_cents: o.fee_cents, refunded_cents: o.refunded_cents, paypal_order_id: o.paypal_order_id, capture_id: o.capture_id, repaired: o.repaired, paid_via: o.paid_via ?? null, created_at: o.created_at, placed_at: placed ?? o.created_at, exception: o.exception ?? null, intent_id: o.intent_id },
      merchant,
      intent: i ?? null,
      policy,
      lines: lines.map((l) => ({ id: l.id, title: l.title, status: l.status, unit_cents: l.unit_cents, qty: l.qty, eta: l.eta, delivered_at: l.delivered_at, swap_offer: J<any>(l.swap_offer), protection: prot.get(l.id) ?? null, dates: lineDates({ ...l, created_at: o.created_at, placed }, policy, i) })),
      ops,
      cases: cases.map((c) => ({ id: c.id, number: c.number, status: c.status, issue: c.issue, claim: c.claim, observations: J<string[]>(c.observations), missing: J<any[]>(c.missing), eligibility: J<any>(c.eligibility), options: J<any[]>(c.options), requested: c.requested, merchant_decision: J<any>(c.merchant_decision), refund_cents: c.refund_cents, line_id: c.line_id, created_at: c.created_at })),
      events,
      held,
      runs: runs.map((x: any) => ({ id: x.id, subject: x.subject, status: x.status, started_at: x.started_at })),
    };
  }));

  r.get("/api/ui/you", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const items = await owned(db, a);
    const recalls = await recallsFor(db, a);
    const recipients = (await db.query<any>("SELECT * FROM recipients WHERE account_id = $1 ORDER BY is_self DESC", [a.id])).rows;
    const linked = (await db.query<any>("SELECT channel FROM channel_links WHERE account_id = $1", [a.id])).rows;
    const facts = (await db.query<any>("SELECT key, value, source, created_at FROM profile_facts WHERE account_id = $1 ORDER BY created_at DESC", [a.id])).rows;
    const byId = (await catalog(db)).byId;
    const people = [];
    for (const r0 of recipients) {
      const m = await modelFor(db, r0.id);
      people.push({ id: r0.id, name: r0.is_self ? "You" : r0.name, relation: r0.relation, is_self: r0.is_self, version: m.version, why: whyPanel(m.weights, m.prior), receipts: await choiceReceipts(db, r0.id, byId) });
    }
    return {
      today: wallIso(nowOf(a)).slice(0, 10),
      owned: items.map((o) => ({ id: o.id, title: o.title, status: o.status, source: o.source, category: o.category, attrs: o.attrs, price_cents: o.price_cents, acquired: o.acquired, return_until: o.return_until, warranty_until: o.warranty_until, recipient: o.recipient, order_line_id: o.order_line_id ?? null })),
      recalls: recalls.map((x: any) => ({ item: x.item.title, item_id: x.item.id, title: x.recall.title, remedy: x.recall.remedy, url: x.recall.url })),
      people,
      limit_cents: a.monthly_limit_cents,
      telegram: linked.some((x) => x.channel === "telegram"),
      facts,
      categories: CATEGORY_LABEL,
    };
  }));

  r.get("/api/ui/guard", send(async (req) => {
    const a = await shopperOf(req);
    const policy = await activePolicy(a.id);
    const rules = policy?.rules ?? DEFAULT_RULES;
    const threshold = req.query.approve_above_cents ? Number(req.query.approve_above_cents) : null;
    const btRules = threshold && threshold > 0 ? { ...rules, approve_above_cents: Math.round(threshold) } : rules;
    const [kills, runs, drafts, myKill, suggestions, bt, approvals, passkey, chain, audit] = await Promise.all([listKills(), recentRuns(12), listPolicies(a.id), isKilled(`account:${a.id}`), suggestAutonomy(a.id, rules), backtest(btRules, 365), pendingApprovals(a.id), hasPasskey(a.id), verifyChain(), recentAudit(25)]);
    return {
      policy: policy ? { text: policy.text, compiler: policy.compiler, unexpressed: policy.unexpressed } : null,
      rules: rulesView(SHOPPER_KEYS, rules),
      backtest: { ...bt, approve_above_cents: btRules.approve_above_cents },
      candidate: threshold && threshold > 0 ? JSON.stringify(btRules) : null,
      suggestions: suggestions.map((s: any) => ({ ...s, label: RULE_LABELS[s.field as keyof Rules] })),
      suggestions_payload: JSON.stringify(suggestions),
      kill: myKill?.engaged ? { engaged: true, reason: myKill.reason } : { engaged: false, reason: null },
      agent_kills: kills.filter((k: any) => String(k.scope).startsWith("agent:")),
      approvals: approvals.map(approvalView),
      countersign_cents: countersignThreshold(),
      passkey,
      chain: { ok: chain.ok, rows: chain.rows, head: chain.head, broken_at: chain.broken_at ?? null },
      audit,
      runs,
      drafts: drafts.map((d: any) => ({ id: d.id, active: d.active, compiler: d.compiler, text: d.text, created_at: d.created_at })),
    };
  }));

  r.get("/api/ui/passport", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const [p, vault, recalls, cat] = await Promise.all([passportSummary(db, a), vaultStatus(db, a.id), recallsFor(db, a), catalog(db)]);
    const repeats = (await db.query<any>("SELECT r.id, r.qty, r.amount_cents, r.status, r.order_id, r.created_at, p.title FROM repeat_buys r JOIN products p ON p.id = r.product_id WHERE r.account_id = $1 ORDER BY r.created_at DESC LIMIT 12", [a.id])).rows;
    const watches = (await db.query<any>("SELECT w.id, w.target_cents, w.status, p.title, p.price_cents FROM price_watches w JOIN products p ON p.id = w.product_id WHERE w.account_id = $1", [a.id])).rows;
    const buyable = cat.products.filter((x) => x.checkout && x.stock > 0).slice(0, 40).map((x) => ({ id: x.id, title: x.title, price_cents: x.price_cents }));
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 120) : "";
    const ext = q ? await searchProducts(q, db) : null;
    return { summary: { spent: p.spent, back: p.back, live: p.live, recovered: p.recovered, by_category: p.byCategory, history: p.hist }, vault: vault ? { status: vault.status, last4: String(vault.payment_token ?? "").slice(-4) } : null, recalls: recalls.map((x: any) => ({ item: x.item.title, title: x.recall.title, remedy: x.recall.remedy, url: x.recall.url })), repeats, watches, buyable, q, ext, channel3: channel3Ready() };
  }));

  r.get("/api/ui/safety", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const inbox = (await db.query<any>("SELECT id, channel, text, created_at FROM inbox WHERE account_id = $1 ORDER BY id DESC LIMIT 20", [a.id])).rows.map((m) => ({ ...m, flag: flagOf(m.text) }));
    const holds = await safetyHolds(a.id);
    const prot = await protectedMode(a.id);
    const sellers = (await db.query<any>("SELECT m.name, m.kind, count(o.id)::int AS paid FROM merchants m LEFT JOIN orders o ON o.merchant_id = m.id AND o.account_id = $1 AND o.status NOT IN ('created','cancelled') GROUP BY m.id ORDER BY m.name", [a.id])).rows;
    return { inbox, holds: holds.map((h: any) => ({ id: h.id, action: String(h.action).replace(/_/g, " "), cents: Number(h.payload?.cents ?? 0), status: h.status, reasons: h.payload?.safety_reasons ?? [] })), protected: prot, sellers, demo_scam: DEMO_SCAM, tactics: TACTICS.map((t) => ({ key: t, words: TACTIC_WORDS[t] })) };
  }));

  // ---------- Shopper and merchant ----------
  // ---------- Devices: the phone app and the browser extension ----------
  // A key is made on the website (signed in with the session cookie, never with another key), shown once, stored
  // hashed and revocable. It acts only as this shopper: it can plan, quote and start checkout, and PayPal still asks
  // the buyer to approve every payment.
  const deviceRows = async (accountId: string) =>
    (await (await getDb()).query<any>("SELECT id, label, client, created_at, last_used_at, revoked_at FROM device_keys WHERE account_id = $1 ORDER BY created_at DESC", [accountId])).rows.map((d) => ({ id: d.id, label: d.label, client: d.client, created_at: d.created_at, last_used_at: d.last_used_at, revoked: Boolean(d.revoked_at) }));
  const cookieShopper = async (req: Request) => {
    if (bearerOf(req)) throw new GtError("Connect new devices from the Everyday website, not from another device.", "forbidden", 403);
    return shopperOf(req);
  };
  r.get("/api/ui/devices", send(async (req) => ({ devices: await deviceRows((await shopperOf(req)).id) })));
  r.post("/api/ui/devices", send(async (req) => {
    const a = await cookieShopper(req);
    // "agent": a key for an outside assistant on /mcp only (A3.2 /agents). It never signs in to the website's API.
    const client = req.body?.client === "mobile" ? "mobile" : req.body?.client === "extension" ? "extension" : req.body?.client === "agent" ? "agent" : null;
    if (!client) throw new GtError("Say which device: the phone app, the browser extension or an outside assistant.", "invalid", 400);
    const label = String(req.body?.label ?? "").trim().slice(0, 60) || (client === "mobile" ? "Phone app" : client === "extension" ? "Browser extension" : "Outside assistant (MCP)");
    const db = await getDb();
    const live = (await db.query<{ c: number }>("SELECT count(*)::int AS c FROM device_keys WHERE account_id = $1 AND revoked_at IS NULL", [a.id])).rows[0].c;
    if (live >= 10) throw new GtError("You have 10 connected devices. Disconnect one first.", "limit", 409);
    const key = newSecret("evd");
    const id = newId("dev");
    await db.query("INSERT INTO device_keys (id, account_id, label, client, key_hash) VALUES ($1,$2,$3,$4,$5)", [id, a.id, label, client, hashKey(key)]);
    return { id, key, label, client, devices: await deviceRows(a.id) };
  }));
  // Demo only: the phone app's "Continue as Maya", like the website's. It makes a phone key for a demo shopper
  // without a website session. Off when demo mode is off. Older demo keys for that shopper are disconnected first,
  // so repeated demo sign-ins never pile up.
  r.post("/api/ui/devices/demo", send(async (req) => {
    demoOnly();
    const db = await getDb();
    // A1: the phone app's demo sign-in opens the visitor's own workspace: a new one ({start: true}), the one a join
    // token names (the QR code on the judge page), or a persona inside the workspace this request is already in.
    let accountId = String(req.body?.account_id ?? "");
    if (typeof req.body?.join === "string" && req.body.join) {
      const w = await workspaceByToken(String(req.body.join).replace(/^.*\/demo\/join\//, ""));
      if (!w?.account_id) throw new GtError("That demo link has expired. Start a new demo.", "invalid", 400);
      accountId = w.account_id;
    } else if (req.body?.start === true || req.body?.start === "1" || (config.privateDemos && !accountId)) {
      const w = await startWorkspace({ ip: req.ip ?? "unknown", unlimited: unlimited(req) });
      accountId = w.account_id ?? "";
    }
    const a = (await db.query<{ id: string; name: string; ws_id: string | null }>("SELECT id, name, ws_id FROM accounts WHERE id = $1", [accountId])).rows[0];
    if (!a) throw new GtError("Choose one of the demo shoppers.", "invalid", 400);
    if (!req.body?.join && !(req.body?.start === true || req.body?.start === "1" || (config.privateDemos && !req.body?.account_id)) && ((a.ws_id ?? null) !== currentWs() || (config.privateDemos && !a.ws_id))) throw new GtError("That shopper isn't part of your demo. Start your own demo.", "invalid", 400);
    await db.query("UPDATE device_keys SET revoked_at = now() WHERE account_id = $1 AND client = 'mobile' AND label = 'Phone app (demo sign-in)' AND revoked_at IS NULL", [a.id]);
    const key = newSecret("evd");
    const id = newId("dev");
    await db.query("INSERT INTO device_keys (id, account_id, label, client, key_hash) VALUES ($1,$2,'Phone app (demo sign-in)','mobile',$3)", [id, a.id, hashKey(key)]);
    return { id, key, name: a.name };
  }));
  // A device signing itself out: its own key stops working at once.
  r.post("/api/ui/devices/self/revoke", send(async (req) => {
    const key = bearerOf(req);
    if (!key) throw new GtError("Only a connected device can sign itself out.", "invalid", 400);
    await (await getDb()).query("UPDATE device_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE key_hash = $1", [hashKey(key)]);
    return { ok: true };
  }));
  r.post("/api/ui/devices/:id/revoke", send(async (req) => {
    const a = await shopperOf(req);
    const db = await getDb();
    const d = (await db.query("UPDATE device_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND account_id = $2 RETURNING id", [req.params.id, a.id])).rows[0];
    if (!d) throw new GtError("Not found", "not_found", 404);
    return { devices: await deviceRows(a.id) };
  }));

  r.get("/api/ui/channels", send(async (req) => {
    const who = await partyOf(req);
    if (!who) throw signIn();
    const own = who.kind === "shopper" ? `shopper:${who.id}` : who.kind === "merchant" ? `merchant:${merchantOwner()}` : "";
    // Reading another party's conversation is the demo simulator; outside demo mode a party sees only its own.
    const addr = typeof req.query.address === "string" && (config.demoMode || who.kind === "console") ? req.query.address : own;
    const msgs = addr ? await conversation(addr, 60) : await recentMessages(60);
    const db = await getDb();
    const accounts = (await db.query<any>("SELECT id, name FROM accounts WHERE ws_id IS NOT DISTINCT FROM $1 ORDER BY name", [currentWs()])).rows;
    const tg = who.kind === "console" ? false : Number((await db.query<any>("SELECT count(*)::int AS n FROM party_links WHERE channel = 'telegram' AND party_id = $1", [who.kind === "merchant" ? merchantOwner() : who.id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0) > 0;
    return { address: addr, who: who.kind, telegram_linked: tg, telegram_ready: telegramReady(), push_ready: pushReady(), simulator: config.demoMode, addresses: config.demoMode ? [{ value: `merchant:${merchantOwner()}`, label: "Northlight Supply (merchant)" }, ...accounts.map((x: any) => ({ value: `shopper:${x.id}`, label: x.name }))] : [], messages: (msgs as any[]).map((m) => ({ id: m.id, address: m.address, channel: m.channel, direction: m.direction, status: m.status, body: String(m.body), created_at: m.created_at, buttons: m.buttons ? (typeof m.buttons === "string" ? JSON.parse(m.buttons) : m.buttons) : null, flag: m.direction === "in" ? flagOf(String(m.body)) : null })) };
  }));

  r.get("/api/ui/traces", send(async (req) => {
    const who = await partyOf(req);
    if (!who) throw signIn();
    const all = await recentRuns(150);
    const out: any[] = [];
    for (const x of all) if (await mayView(who, x)) out.push(x);
    return { runs: out };
  }));

  r.get("/api/ui/trace/:id", send(async (req) => {
    const who = await partyOf(req);
    if (!who) throw signIn();
    const t = await loadRun(req.params.id);
    if (!t || (t.run.ws_id ?? null) !== currentWs() || !(await mayView(who, t.run))) throw new GtError("Run not found", "not_found", 404);
    return { ...t, viewer: who.kind };
  }));

  // ---------- Merchant ----------
  r.get("/api/ui/merchant", send(async (req) => {
    const m = await merchantOf(req);
    const db = await getDb();
    const lines = (await db.query<any>("SELECT l.id, l.title, l.status, l.eta, l.unit_cents, l.delivered_at, o.number, o.id AS order_id, o.status AS order_status, a.name AS customer FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN accounts a ON a.id = o.account_id WHERE o.merchant_id = $1 AND o.status <> 'created' ORDER BY o.created_at DESC, l.slot", [m.id])).rows;
    const cases = (await db.query<any>("SELECT c.id, c.number, c.status, c.issue, c.claim, c.flags, c.requested, c.refund_cents, c.created_at, o.number AS order_number, l.title FROM cases c JOIN orders o ON o.id = c.order_id JOIN order_lines l ON l.id = c.line_id WHERE o.merchant_id = $1 ORDER BY c.created_at DESC", [m.id])).rows.map((c) => ({ ...c, flagged: J<any[]>(c.flags).length > 0, flags: undefined }));
    const cat = (await catalog(db)).products.filter((p) => p.merchant_id === m.id).map((p) => ({ id: p.id, title: p.title, sku: p.sku, stock: p.stock, price_cents: p.price_cents, category: p.category }));
    const kill = await isKilled("merchant");
    return { merchant: m, lines, cases, catalog: cat, kill: Boolean(kill?.engaged), approvals: (await pendingApprovals(merchantOwner())).length };
  }));

  r.get("/api/ui/merchant/money", send(async (req) => {
    const m = await merchantOf(req);
    const db = await getDb();
    // A1: only this shop's disputes and trackers (each workspace has its own shop row).
    const disputes = (await db.query<any>("SELECT d.*, o.number FROM disputes d JOIN orders o ON o.id = d.order_id WHERE o.merchant_id = $1 ORDER BY d.synced_at DESC", [m.id])).rows;
    const trackers = (await db.query<any>("SELECT t.*, o.number FROM trackers t JOIN orders o ON o.id = t.order_id WHERE o.merchant_id = $1 ORDER BY t.created_at DESC LIMIT 20", [m.id])).rows;
    const lines = (await db.query<any>("SELECT l.id, l.title, l.status, o.number FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.merchant_id = $1 AND o.capture_id IS NOT NULL AND l.status IN ('ordered','shipped') AND NOT EXISTS (SELECT 1 FROM trackers t WHERE t.line_id = l.id) ORDER BY o.created_at DESC", [m.id])).rows;
    const totals = (await db.query<any>("SELECT count(*)::int AS orders, coalesce(sum(gross_cents),0)::int AS gross, coalesce(sum(fee_cents),0)::int AS fees, coalesce(sum(refunded_cents),0)::int AS refunded FROM orders WHERE merchant_id = $1 AND capture_id IS NOT NULL", [m.id])).rows[0];
    const recon = req.query.reconcile ? await reconcileTransactions(30).catch((e) => ({ error: (e as Error).message })) : null;
    return { merchant: m, disputes, trackers, lines, totals, recon, fake: !config.paypal.clientId };
  }));

  r.get("/api/ui/merchant/approvals", send(async (req) => {
    const m = await merchantOf(req);
    const policy = await activePolicy(merchantOwner());
    const rules = policy?.rules ?? DEFAULT_RULES;
    const [kill, approvals, passkey, chain, audit] = await Promise.all([isKilled("merchant"), pendingApprovals(merchantOwner()), hasPasskey(merchantOwner()), verifyChain(), recentAudit(25)]);
    return { merchant: m, policy: policy ? { text: policy.text, compiler: policy.compiler, unexpressed: policy.unexpressed } : null, rules: rulesView(MERCHANT_KEYS, rules), kill: kill?.engaged ? { engaged: true, reason: kill.reason } : { engaged: false, reason: null }, approvals: approvals.map(approvalView), countersign_cents: countersignThreshold(), passkey, chain: { ok: chain.ok, rows: chain.rows, head: chain.head, broken_at: chain.broken_at ?? null }, audit };
  }));

  // ---------- Judge and operator (demo mode) ----------

  r.get("/api/ui/demo", send(async () => {
    const db = await getDb();
    const acc = (await db.query<any>("SELECT * FROM accounts WHERE ws_id IS NOT DISTINCT FROM $1 ORDER BY created_at LIMIT 1", [currentWs()])).rows[0];
    return { demo: config.demoMode, clock: acc ? fmtWall(nowOf(acc)) : null, loaded: Boolean(acc) && (!config.privateDemos || Boolean(currentWs())), private_demos: config.privateDemos, workspace: currentWs() };
  }));

  r.get("/api/ui/console", send(async () => {
    demoOnly();
    const db = await getDb();
    const art = (await db.query<any>("SELECT * FROM model_artifacts WHERE kind = 'pref_prior' ORDER BY created_at DESC LIMIT 1")).rows[0];
    const events = (await db.query<any>("SELECT e.id, e.reason, e.eligible, e.excluded_reason, e.chosen, e.a_product, e.b_product, a.title AS at, b.title AS bt FROM pref_events e JOIN products a ON a.id = e.a_product JOIN products b ON b.id = e.b_product JOIN merchants m ON m.id = a.merchant_id WHERE m.ws_id IS NOT DISTINCT FROM $1 ORDER BY e.id DESC LIMIT 20", [currentWs()])).rows;
    const prior = art ? J<number[]>(art.weights) : [];
    return { report: art ? J<any>(art.report) : null, manifest: art ? J<any>(art.manifest) : null, weights: prior.map((w, i) => ({ feature: FEATURES[i], label: label(i), w })), events };
  }));

  r.get("/api/ui/evidence", send(async () => {
    demoOnly();
    const db = await getDb();
    const [cap0, adv0, ai, chain] = await Promise.all([summarise("capture"), summarise("adversarial"), aiUsageSummary(), verifyChain()]);
    // A5.6: an instance that hasn't run a suite itself shows the committed result file, with its date and what ran.
    const file = (suite: string) => {
      try {
        return existsSync(`eval/${suite}.json`) ? (JSON.parse(readFileSync(`eval/${suite}.json`, "utf8")) as { run_on: string; provider: string; arms: any[] }) : null;
      } catch {
        return null;
      }
    };
    const fc = cap0.length ? null : file("capture");
    const fa = adv0.length ? null : file("adversarial");
    const cap = cap0.length ? cap0 : (fc?.arms ?? []);
    const adv = adv0.length ? adv0 : (fa?.arms ?? []);
    const runs = {
      capture: cap0.length ? { source: "this instance", run_on: null, provider: null } : fc ? { source: "eval/capture.json (committed result file)", run_on: fc.run_on, provider: fc.provider } : null,
      adversarial: adv0.length ? { source: "this instance", run_on: null, provider: null } : fa ? { source: "eval/adversarial.json (committed result file)", run_on: fa.run_on, provider: fa.provider } : null,
    };
    const tj = existsSync("eval/techjam.md") ? readFileSync("eval/techjam.md", "utf8") : null;
    // A1: this workspace's own records (each visitor's demo counts its own).
    const real = (await db.query<any>(`WITH acc AS (SELECT id FROM accounts WHERE ws_id IS NOT DISTINCT FROM $1), ord AS (SELECT id FROM orders WHERE account_id IN (SELECT id FROM acc))
      SELECT
      (SELECT count(*) FROM orders WHERE capture_id IS NOT NULL AND id IN (SELECT id FROM ord))::int AS captures,
      (SELECT count(*) FROM payment_ops WHERE kind = 'refund' AND status = 'succeeded' AND order_id IN (SELECT id FROM ord))::int AS refunds,
      (SELECT count(*) FROM repeat_buys WHERE status = 'paid' AND account_id IN (SELECT id FROM acc))::int AS repeats_paid,
      (SELECT count(*) FROM repeat_buys WHERE status IN ('held','denied') AND account_id IN (SELECT id FROM acc))::int AS repeats_stopped,
      (SELECT count(*) FROM vault_tokens WHERE status = 'active' AND account_id IN (SELECT id FROM acc))::int AS vaults,
      (SELECT count(*) FROM trackers WHERE order_id IN (SELECT id FROM ord))::int AS trackers,
      (SELECT count(*) FROM disputes WHERE order_id IN (SELECT id FROM ord))::int AS disputes,
      (SELECT count(*) FROM agent_runs WHERE ws_id IS NOT DISTINCT FROM $1)::int AS runs,
      (SELECT count(*) FROM approvals WHERE status = 'pending' AND (owner_id IN (SELECT id FROM acc) OR owner_id = $2))::int AS approvals_pending,
      (SELECT count(*) FROM agent_requests WHERE ws_id IS NOT DISTINCT FROM $1)::int AS agent_requests,
      (SELECT count(*) FROM captures WHERE reader <> 'rules' AND account_id IN (SELECT id FROM acc))::int AS model_captures`, [currentWs(), merchantOwner()])).rows[0];
    return { real, capture: cap, adversarial: adv, runs, ai, chain: { ok: chain.ok, rows: chain.rows, head: chain.head, broken_at: chain.broken_at ?? null }, techjam: tj, paypal: Boolean(config.paypal.clientId), provider: providerLabel(), channel3: channel3Ready(), telegram: telegramReady(), push: pushReady(), has_openai: hasOpenAI() };
  }));

  r.get("/api/ui/eval", send(async (req) => {
    demoOnly();
    const suite = typeof req.query.suite === "string" ? req.query.suite : "capture";
    const arm = typeof req.query.arm === "string" ? req.query.arm : undefined;
    const outcome = typeof req.query.outcome === "string" ? req.query.outcome : undefined;
    const trap = typeof req.query.trap === "string" ? req.query.trap : undefined;
    const all = await evalRows(suite, 3000);
    const kindOf = (x: any) => x.detail?.trap_kind ?? x.detail?.kind ?? null;
    const rows = all.filter((x: any) => (!arm || x.arm === arm) && (!outcome || (outcome === "correct") === Boolean(x.correct)) && (!trap || (trap === "trap" ? x.trap : trap === "plain" ? !x.trap : kindOf(x) === trap)));
    return { suite, arm: arm ?? null, outcome: outcome ?? null, trap: trap ?? null, total: all.length, arms: [...new Set(all.map((x: any) => String(x.arm)))], kinds: [...new Set(all.map(kindOf).filter(Boolean))], sums: await summarise(suite), rows: rows.slice(0, 400).map((x: any) => ({ id: x.id, case_id: x.case_id, arm: x.arm, expected: String(x.expected).slice(0, 100), actual: String(x.actual).slice(0, 100), correct: Boolean(x.correct), kind: kindOf(x) ?? (x.trap ? "trap" : ""), naive: Number(x.naive_paid_cents), ours: Number(x.ours_paid_cents), ms: x.latency_ms, detail: String(x.detail?.reason ?? x.detail?.title ?? x.detail?.note ?? "").slice(0, 120) })), count: rows.length };
  }));

  r.get("/api/ui/telegram", send(async (req) => {
    demoOnly();
    const db = await getDb();
    const chat = String(req.query.chat ?? "555001").replace(/[^0-9-]/g, "").slice(0, 20) || "555001";
    const acc = (await db.query<any>("SELECT account_id FROM channel_links WHERE channel = 'telegram' AND external_id = $1", [chat])).rows[0];
    const msgs = (await db.query<any>("SELECT * FROM inbox WHERE channel = 'telegram' AND (account_id = $1 OR account_id = $2) ORDER BY id", [acc?.account_id ?? "-", `chat:${chat}`])).rows;
    const sentRow = (await db.query<any>("SELECT value FROM settings WHERE key = $1", [`tg_sent:${chat}`])).rows[0];
    const sent = J<any[]>(sentRow?.value ?? "[]") ?? [];
    const all = [...msgs.map((m) => ({ at: new Date(m.created_at).getTime(), me: false, text: m.text, buttons: J<any[][]>(m.buttons) })), ...sent.map((s: any) => ({ at: s.at, me: true, text: s.text, buttons: null }))].sort((a, b) => a.at - b.at);
    return { chat, linked: Boolean(acc), live: Boolean(config.telegram.botToken), messages: all.map((m) => ({ ...m, buttons: m.buttons ? m.buttons.flat().map((b: any) => ({ text: b.text, data: b.data ?? null, url: b.url ? String(b.url).replace(config.appUrl, "") : null })) : null })) };
  }));

  r.use("/api/ui", (_req, res) => res.status(404).json({ error: "not_found", message: "Not found" }));
  return r;
}

function pairItem(x: any) {
  return { id: x.id, title: x.title, price_cents: x.price_cents, finish: [...new Set([x.attrs?.finish, x.attrs?.material].filter(Boolean))].join(" "), style: (x.attrs?.style ?? []).join(", ") };
}

const SERIOUS = ["changed_details", "off_platform", "gift_cards_crypto", "fee_to_release", "overpay_refund", "otp_or_link"];
const INJECTION = /\b(ignore|disregard|forget)\b[^.]{0,30}\b(previous|prior|above|earlier|all)\b[^.]{0,20}\b(instructions?|rules|prompts?)\b|\bsystem prompt\b|\byou are now\b|\bact as (the )?(owner|admin|operator)\b/i;
/** The scam flag for a message as displayed (rules only): the tactics in plain words, or null when clean. */
export function flagOf(text: string): { serious: boolean; words: string[] } | null {
  const s = scanText(text ?? "");
  const words: string[] = s.fired.map((t) => TACTIC_WORDS[t]);
  const injection = INJECTION.test(text ?? "");
  if (injection) words.push("tries to give the app instructions, which it ignores");
  if (!words.length) return null;
  return { serious: injection || s.fired.some((t) => SERIOUS.includes(t)), words };
}

async function mayView(who: Awaited<ReturnType<typeof partyOf>>, run: any): Promise<boolean> {
  if (!who) return false;
  if (who.kind !== "shopper") return true;
  if (!run.entity || !run.entity_id) return false;
  const table = run.entity === "intent" ? "intents" : run.entity === "order" ? "orders" : run.entity === "repeat_buy" ? "repeat_buys" : null;
  if (!table) return false;
  return (await (await getDb()).query(`SELECT 1 FROM ${table} WHERE id = $1 AND account_id = $2`, [run.entity_id, who.id])).rows.length > 0;
}

export { accountById };
