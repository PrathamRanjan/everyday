
import { handleTelegram } from "../services/captures.js";
import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { paypal } from "../paypal/index.js";
import { fmtWall } from "../core/time.js";
import { link, receive, telegramUpdate, whatsappUpdate, type Party } from "../channels/index.js";
import { pushReady, subscribe } from "../channels/push.js";
import { isMerchantOwner, merchantOwner } from "../guard/policy.js";
import { currentWs, wsOfCustomId } from "../ws.js";
import { accountById, nowOf } from "../store.js";
import { loadRun, recentRuns, runsFor } from "../trace.js";
import { keyLogin, whoami } from "./auth.js";
import { back, json } from "./common.js";

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

type Who = { kind: "shopper"; id: string; name: string; clock: string } | { kind: "merchant"; id: string; name: string } | { kind: "console" };

/** Signed-in party (cookie), or the holder of a Bearer key. The operator console is open in demo mode. */
export async function partyOf(req: Request): Promise<Who | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  if (m) {
    const v = await keyLogin(m[1]);
    if (!v) return null;
    if (v.startsWith("acc:")) {
      const a = await accountById(await getDb(), v.slice(4)).catch(() => null);
      return a ? { kind: "shopper", id: a.id, name: a.name, clock: fmtWall(nowOf(a)) } : null;
    }
    return { kind: "merchant", id: merchantOwner(), name: "merchant" };
  }
  const w = await whoami(req);
  if (w?.account) return { kind: "shopper", id: w.account.id, name: w.account.name, clock: fmtWall(nowOf(w.account)) };
  if (w?.merchant) return { kind: "merchant", id: merchantOwner(), name: w.merchant.name };
  return config.demoMode ? { kind: "console" } : null;
}

/** May this party see a run? Shoppers: runs on their own intents, orders and repeat buys. Merchant and console: all. */
async function mayView(who: Who, run: any): Promise<boolean> {
  if (who.kind !== "shopper") return true;
  const db = await getDb();
  if (!run.entity || !run.entity_id) return false;
  const table = run.entity === "intent" ? "intents" : run.entity === "order" ? "orders" : run.entity === "repeat_buy" ? "repeat_buys" : null;
  if (!table) return false;
  return (await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND account_id = $2`, [run.entity_id, who.id])).rows.length > 0;
}

export const BEATS = [
    { title: "A clip becomes a plan", body: "Maya shares a Short on Telegram; Everyday names the objects (authored for the demo clip, read by the vision model for a screenshot) and asks which she means. The planner excludes the monitor she owns, explains the hub without video, and asks one question about her laptop's port.", href: "/discover" },
    { title: "The quote is exact and the mandate is hers", body: "A 15-minute quote with a hash. Her mandate (plain words on Guard) caps the purchase, names the merchants, and decides whether an outside assistant may plan or start checkout. The gate checks the order against it before PayPal is asked for an approval link.", href: "/guard" },
    { title: "PayPal approves, Everyday reads back", body: "She approves on PayPal; the capture is read back and recorded once, even when the return is dropped. Open the trace: who acted, what the gate said, which PayPal request id.", href: "/traces" },
    { title: "After the sale", body: "A backorder swap refunds the difference; a scuffed lamp becomes a case with options; price protection pays the drop under the policy version she bought under. Each refund runs under the merchant's mandate and is verified with PayPal before the case closes.", href: "/merchant" },
    { title: "Repeat buys on a saved PayPal", body: "On the passport she saves PayPal once (Vault). A repeat buy under her threshold runs on its own; at or above it waits for a tap, above the countersign line for a passkey. Try it from the passport and watch the approval appear on Guard and on the channel.", href: "/passport" },
    { title: "Try to break it", body: "Flip the kill switch and watch a repeat buy get refused before PayPal. Ask the MCP agent to spend $9,000. Open the evidence console for the capture eval, the TechJam-style eval, the adversarial harness and the PayPal negative tests.", href: "/console/evidence" },
  ];

export function traceRoutes() {
  const r = Router();
  const guard = (fn: (req: Request, res: Response, who: Who) => Promise<unknown>) => async (req: Request, res: Response, next: (e?: unknown) => void) => {
    try {
      const who = await partyOf(req);
      if (!who) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      await fn(req, res, who);
    } catch (e) {
      if (e instanceof GtError) return back(res, "/", e.message, true);
      next(e);
    }
  };

  r.get("/api/v1/runs/:id", json(async (req) => {
    const who = await partyOf(req);
    if (!who || who.kind === "console") throw new GtError("Unauthorized", "unauthorized", 401);
    const t = await loadRun(req.params.id);
    if (!t || (t.run.ws_id ?? null) !== currentWs() || !(await mayView(who, t.run))) throw new GtError("Run not found", "not_found", 404);
    return t;
  }));
  r.get("/api/v1/runs", json(async (req) => {
    const who = await partyOf(req);
    if (!who || who.kind === "console") throw new GtError("Unauthorized", "unauthorized", 401);
    const entity = typeof req.query.entity === "string" ? req.query.entity : null;
    const id = typeof req.query.id === "string" ? req.query.id : null;
    const rows = entity && id ? await runsFor(entity, id, 50) : await recentRuns(50);
    const out: any[] = [];
    for (const x of rows) if (await mayView(who, x)) out.push(x);
    return { runs: out };
  }));
  r.post("/channels/reply", guard(async (req, res, who) => {
    const address = String(req.body.address ?? "");
    if (!/^(shopper|merchant):/.test(address)) throw new GtError("Simulator addresses look like shopper:<account id> or merchant:merchant", "validation", 422);
    if (!config.demoMode && who.kind !== "console" && address !== (who.kind === "shopper" ? `shopper:${who.id}` : `merchant:${merchantOwner()}`)) throw new GtError("You can only reply as yourself.", "forbidden", 403);
    await receive("simulator", address, String(req.body.text ?? req.body.buttonId ?? ""), req.body.buttonId ? String(req.body.buttonId) : null, req.body.replyTo ? String(req.body.replyTo) : null);
    back(res, `/channels?address=${encodeURIComponent(address)}`, "Sent");
  }));
  /** Foundation channel webhook for Telegram (approvals and alerts); the clip bot keeps /c/telegram/webhook. */

  /** PayPal webhook receiver (roadmap B.7): verifies the transmission signature against PAYPAL_WEBHOOK_ID, records the
   * event once (webhook_events), rejects unverified posts. State still comes from PayPal read-back, so this is a
   * verified log, not a second source of truth. */
  r.post("/webhooks/paypal", async (req, res) => {
    const event = req.body as { id?: string; event_type?: string; resource?: { id?: string } } | undefined;
    if (!event?.id || !event?.event_type) return res.status(400).json({ error: "not a PayPal event" });
    let verified = false;
    try {
      if (config.paypal.webhookId) verified = await paypal().verifyWebhookSignature(req.headers as Record<string, string | undefined>, event, config.paypal.webhookId);
    } catch {
      verified = false;
    }
    const db = await getDb();
    // A1: the event belongs to the workspace in the resource's custom_id ("<ws>:<record id>"), else the one recorded
    // when Everyday created the PayPal object (paypal_refs, for events whose resource doesn't echo custom_id).
    const res0 = (event.resource ?? {}) as any;
    const custom = res0.custom_id ?? res0.purchase_units?.[0]?.custom_id ?? null;
    const related = res0.supplementary_data?.related_ids ?? {};
    // Only a demo that exists here: other apps on the same PayPal sandbox account can send look-alike custom_ids.
    let ws = wsOfCustomId(custom);
    if (ws && !(await db.query("SELECT 1 FROM workspaces WHERE id = $1", [ws])).rows.length) ws = null;
    if (!ws) {
      const ids = [res0.id, related.order_id, related.capture_id].filter(Boolean);
      ws = ids.length ? (await db.query<{ ws_id: string | null }>("SELECT ws_id FROM paypal_refs WHERE resource_id = ANY($1::text[]) AND ws_id IS NOT NULL LIMIT 1", [ids])).rows[0]?.ws_id ?? null : null;
    }
    await db.query(
      "INSERT INTO webhook_events (id, event_type, resource_id, body, verified, ws_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
      [event.id, event.event_type, event.resource?.id ?? null, JSON.stringify(event), verified, ws],
    );
    if (!verified) return res.status(400).json({ error: "signature verification failed" });
    res.json({ ok: true });
  });
  r.post("/webhooks/telegram", async (req, res) => {
    const secret = req.header("x-telegram-bot-api-secret-token") ?? "";
    if (config.channels.telegramSecret && !safeEq(secret, config.channels.telegramSecret)) return res.status(401).end();
    try {
      const u = req.body ?? {};
      const t = String(u.message?.text ?? "").trim();
      const data = String(u.callback_query?.data ?? "");
      const foundation = /^\/start\s+m[0-9a-f]+$/i.test(t) || /^\/?link\s/i.test(t) || /^(approve|decline):/i.test(t) || /^(pending|approvals|waiting|orders|purchases|status|stop|kill|freeze|watch|watches|protection|cases|open|disputes)$/i.test(t) || (data !== "" && !data.startsWith("obj:"));
      if (foundation) await telegramUpdate(u);
      else await handleTelegram(u);
    } catch (e) {
      console.error("[telegram]", (e as Error).message);
    }
    res.json({ ok: true });
  });
  r.get("/webhooks/whatsapp", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && typeof req.query["hub.verify_token"] === "string" && safeEq(String(req.query["hub.verify_token"]), config.channels.whatsappVerifyToken)) return res.send(String(req.query["hub.challenge"]));
    res.status(403).end();
  });
  r.post("/webhooks/whatsapp", async (req, res) => {
    try {
      await whatsappUpdate(req.body);
    } catch (e) {
      console.error("[whatsapp]", (e as Error).message);
    }
    res.json({ ok: true });
  });
  r.post("/channels/link", json(async (req) => {
    const who = await partyOf(req);
    if (!who || who.kind === "console") throw new GtError("Sign in", "unauthorized", 401);
    const channel = String(req.body.channel);
    if (channel !== "telegram" && channel !== "whatsapp") throw new GtError("channel must be telegram or whatsapp", "validation", 422);
    const party: Party = who.kind;
    await link(channel, String(req.body.address), party, who.id);
    return { linked: true };
  }));

  // ---- PWA (roadmap B.10) ----
  r.get("/manifest.webmanifest", (_req, res) => {
    res.type("application/manifest+json").json({ name: "Everyday", short_name: "Everyday", start_url: "/today", display: "standalone", background_color: "#f7f4ee", theme_color: "#1c1a17", icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] });
  });
  r.get("/sw.js", (_req, res) => {
    res.type("application/javascript").set("Service-Worker-Allowed", "/").send(readFileSync("public/sw.js", "utf8"));
  });
  r.get("/push/public-key", (_req, res) => res.json({ key: config.channels.vapidPublic || null }));
  r.post("/push/subscribe", json(async (req) => {
    const who = await partyOf(req);
    if (!who || who.kind === "console") throw new GtError("Sign in", "unauthorized", 401);
    if (!req.body?.endpoint) throw new GtError("Subscription missing", "validation", 422);
    await subscribe(who.kind, who.id, req.body);
    return { subscribed: true, live: pushReady() };
  }));
  return r;
}
