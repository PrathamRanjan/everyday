/**
 * Traces, judge mode, channels simulator, webhooks and PWA routes (roadmap B.2, B.8, B.9, B.10) for Everyday.
 * Shoppers see runs on their own entities; the merchant sees runs on its orders; the operator console sees all.
 */
import { icon } from "./icons.js";
import { messageFlag } from "./safetyui.js";
import { handleTelegram } from "../services/captures.js";
import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { newId } from "../lib/ids.js";
import { paypal } from "../paypal/index.js";
import { fmtWall } from "../core/time.js";
import { conversation, link, receive, recentMessages, telegramReady, telegramUpdate, whatsappReady, whatsappUpdate, type Party } from "../channels/index.js";
import { pushReady, subscribe } from "../channels/push.js";
import { MERCHANT } from "../guard/policy.js";
import { accountById, nowOf } from "../store.js";
import { loadRun, recentRuns, renderTrace, runsFor } from "../trace.js";
import { keyLogin, whoami } from "./auth.js";
import { back, flashOf, json } from "./common.js";
import { fmtDate, html, layout, pill, raw, type Raw } from "./html.js";

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
    return { kind: "merchant", id: MERCHANT, name: "merchant" };
  }
  const w = await whoami(req);
  if (w?.account) return { kind: "shopper", id: w.account.id, name: w.account.name, clock: fmtWall(nowOf(w.account)) };
  if (w?.merchant) return { kind: "merchant", id: MERCHANT, name: w.merchant.name };
  return config.demoMode ? { kind: "console" } : null;
}

const pageFor = (req: Request, who: Who, title: string, body: Raw) => layout({ title, area: who.kind === "shopper" ? "shopper" : who.kind === "merchant" ? "merchant" : "console", who: who.kind === "shopper" ? { name: who.name, clock: who.clock } : null, flash: flashOf(req) }, body);

/** May this party see a run? Shoppers: runs on their own intents, orders and repeat buys. Merchant and console: all. */
async function mayView(who: Who, run: any): Promise<boolean> {
  if (who.kind !== "shopper") return true;
  const db = await getDb();
  if (!run.entity || !run.entity_id) return false;
  const table = run.entity === "intent" ? "intents" : run.entity === "order" ? "orders" : run.entity === "repeat_buy" ? "repeat_buys" : null;
  if (!table) return false;
  return (await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND account_id = $2`, [run.entity_id, who.id])).rows.length > 0;
}

const addressOf = (who: Who) => (who.kind === "shopper" ? `shopper:${who.id}` : who.kind === "merchant" ? `merchant:${MERCHANT}` : "");

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

  r.get("/trace/:id", guard(async (req, res, who) => {
    const t = await loadRun(req.params.id);
    if (!t || !(await mayView(who, t.run))) throw new GtError("Run not found", "not_found", 404);
    res.send(pageFor(req, who, `Trace ${t.run.id}`, html`<h1>Agent trace</h1><p class="sub">${t.run.subject} · ${t.run.actor}${t.run.agent_id ? html` · <span class="mono">${t.run.agent_id}</span>` : ""} · ${pill(t.run.status)} · started ${fmtDate(t.run.started_at)}${t.run.ended_at ? html` · ended ${fmtDate(t.run.ended_at)}` : ""}</p>
<p class="small muted">Every step shows who acted (model, code, guard, PayPal), what the gate said, and the PayPal request id so a judge can match it in the sandbox. Secrets and image bytes are redacted.</p>
<div class="card">${renderTrace(t.steps)}</div>
${t.run.entity === "order" ? html`<p class="small"><a href="${who.kind === "merchant" ? "/merchant" : `/orders/${t.run.entity_id}`}">Open order</a></p>` : t.run.entity === "intent" ? html`<p class="small"><a href="/plans/${t.run.entity_id}">Open plan</a></p>` : t.run.entity === "repeat_buy" ? html`<p class="small"><a href="/passport">Open passport</a></p>` : ""}`));
  }));

  r.get("/traces", guard(async (req, res, who) => {
    const all = await recentRuns(150);
    const runs: any[] = [];
    for (const x of all) if (await mayView(who, x)) runs.push(x);
    res.send(pageFor(req, who, "Traces", html`<h1>Agent runs</h1><p class="sub">Every checkout, capture, refund, repeat buy, tracking write, dispute response and assistant call is a traced run. Open one to see the gate decisions and PayPal request ids.</p>
<div class="table-wrap"><table><thead><tr><th>Started</th><th>Actor</th><th>Subject</th><th>Steps</th><th>Blocked</th><th>Status</th></tr></thead><tbody>${runs.length ? raw(runs.map((x: any) => `<tr><td>${fmtDate(x.started_at)}</td><td>${x.actor}${x.agent_id ? ` <span class="mono small">${String(x.agent_id).replace(/</g, "&lt;")}</span>` : ""}</td><td><a href="/trace/${x.id}">${String(x.subject).replace(/</g, "&lt;")}</a></td><td>${x.steps ?? ""}</td><td>${Number(x.blocked) || ""}</td><td>${pill(x.status).value}</td></tr>`).join("")) : html`<tr><td colspan="6" class="muted">No runs yet. Pay an order or plan a repeat buy.</td></tr>`}</tbody></table></div>`));
  }));

  r.get("/api/v1/runs/:id", json(async (req) => {
    const who = await partyOf(req);
    if (!who || who.kind === "console") throw new GtError("Unauthorized", "unauthorized", 401);
    const t = await loadRun(req.params.id);
    if (!t || !(await mayView(who, t.run))) throw new GtError("Run not found", "not_found", 404);
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

  // ---- Judge mode (roadmap B.9) ----
  const BEATS = [
    { title: "A clip becomes a plan", body: "Maya shares a Short on Telegram; Everyday names the objects (authored for the demo clip, read by the vision model for a screenshot) and asks which she means. The planner excludes the monitor she owns, explains the hub without video, and asks one question about her laptop's port.", href: "/discover" },
    { title: "The quote is exact and the mandate is hers", body: "A 15-minute quote with a hash. Her mandate (plain words on Guard) caps the purchase, names the merchants, and decides whether an outside assistant may plan or start checkout. The gate checks the order against it before PayPal is asked for an approval link.", href: "/guard" },
    { title: "PayPal approves, Everyday reads back", body: "She approves on PayPal; the capture is read back and recorded once, even when the return is dropped. Open the trace: who acted, what the gate said, which PayPal request id.", href: "/traces" },
    { title: "After the sale", body: "A backorder swap refunds the difference; a scuffed lamp becomes a case with options; price protection pays the drop under the policy version she bought under. Each refund runs under the merchant's mandate and is verified with PayPal before the case closes.", href: "/merchant" },
    { title: "Repeat buys on a saved PayPal", body: "On the passport she saves PayPal once (Vault). A repeat buy under her threshold runs on its own; at or above it waits for a tap, above the countersign line for a passkey. Try it from the passport and watch the approval appear on Guard and on the channel.", href: "/passport" },
    { title: "Try to break it", body: "Flip the kill switch and watch a repeat buy get refused before PayPal. Ask the MCP agent to spend $9,000. Open the evidence console for the capture eval, the TechJam-style eval, the adversarial harness and the PayPal negative tests.", href: "/console/evidence" },
  ];
  r.get("/judge", async (req, res, next) => {
    try {
      const db = await getDb();
      const who = (await partyOf(req)) ?? { kind: "console" as const };
      let id = typeof req.query.s === "string" ? req.query.s : null;
      let beat = 0;
      if (id) {
        const row = (await db.query<any>("SELECT * FROM judge_sessions WHERE id = $1", [id])).rows[0];
        if (row) {
          beat = Math.min(BEATS.length - 1, Math.max(0, Number(req.query.b ?? row.beat)));
          await db.query("UPDATE judge_sessions SET beat = $2, last_seen = now() WHERE id = $1", [id, beat]);
        } else id = null;
      }
      if (!id) {
        id = newId("jdg");
        await db.query("INSERT INTO judge_sessions (id, persona) VALUES ($1, $2)", [id, String(req.query.persona ?? "judge")]);
      }
      const b = BEATS[beat];
      res.send(pageFor(req, who, "Judge mode", html`<h1>Three minutes, six beats</h1><p class="sub">A guided walk through the whole loop. Each beat opens the right page; the trace and evidence are live, not screenshots. Sign in as Maya from <a href="/login">/login</a> first.</p>
<ol class="beats">${raw(BEATS.map((x, i) => `<li class="${i === beat ? "now" : i < beat ? "done" : ""}"><a href="/judge?s=${id}&b=${i}">${x.title}</a></li>`).join(""))}</ol>
<div class="card"><h2>${beat + 1}. ${b.title}</h2><p>${b.body}</p><div class="row"><a class="btn primary" href="${b.href}" target="_blank" rel="noopener">Open</a>${beat + 1 < BEATS.length ? html`<a class="btn" href="/judge?s=${id}&b=${beat + 1}">Next beat</a>` : html`<a class="btn" href="/console/evidence">Evidence console</a>`}</div></div>
<p class="small muted">Sandbox only. Maya and Northlight Supply are seeded.</p>`));
    } catch (e) {
      next(e);
    }
  });

  // ---- Channels (roadmap B.8) ----
  r.get("/channels", guard(async (req, res, who) => {
    const addr = typeof req.query.address === "string" ? req.query.address : addressOf(who);
    const msgs = addr ? await conversation(addr, 60) : await recentMessages(60);
    const accounts = (await (await getDb()).query<any>("SELECT id, name FROM accounts ORDER BY name")).rows;
    const tg = who.kind === "console" ? false : Number((await (await getDb()).query<any>("SELECT count(*)::int AS n FROM party_links WHERE channel = 'telegram' AND party_id = $1", [who.kind === "merchant" ? MERCHANT : who.id]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0) > 0;
    res.send(pageFor(req, who, "Messages", html`<div class="page-head"><div><h1>Messages and alerts</h1><p>Approvals, delays, price drops and refunds reach you on your phone, with buttons.</p></div></div>
${who.kind !== "console" ? html`<section class="card" id="phone"><h2>On your phone</h2><div class="row">${tg ? html`<span class="pill good">Telegram connected</span>` : html`<span class="pill">Telegram not connected</span>`}<form method="post" action="/connect/telegram" class="inline" target="_blank"><button class="btn primary" type="submit">${raw(icon("message"))}${tg ? "Connect another chat" : "Connect Telegram"}</button></form><button class="btn" id="push-sub" type="button">${raw(icon("zap"))}Notifications in this browser</button></div><p class="small muted">Telegram opens with a one-time code that lasts 15 minutes: press Start and you're done.${telegramReady() ? "" : " The bot token isn't set on this server, so messages are recorded below as simulated."}</p></section>` : ""}
<div class="section-title"><h2>Message simulator</h2><p>Exactly what the phone channels would send, and replies as any party.</p></div>
<form class="row" method="get" action="/channels"><label class="sr" for="addr">Address</label><input id="addr" type="text" name="address" value="${addr}" placeholder="shopper:<account id> or merchant:merchant" list="addrs"><datalist id="addrs"><option value="merchant:${MERCHANT}">${raw(accounts.map((a: any) => `<option value="shopper:${a.id}">${String(a.name).replace(/</g, "&lt;")}</option>`).join(""))}</datalist><button class="btn small">Show</button></form>
<div class="chat">${(msgs as any[]).slice().reverse().map((m) => html`<div class="msg ${m.direction}"><div class="meta small muted">${m.channel} · ${m.direction === "in" ? "received" : "sent"} · ${fmtDate(m.created_at)} · ${m.status}</div>${m.direction === "in" ? messageFlag(String(m.body), "Everyday only acts on its own buttons and commands; a message can't change where money goes.") : ""}<div class="body">${String(m.body)}</div>${m.buttons && m.direction === "out" ? html`<div class="row">${(typeof m.buttons === "string" ? JSON.parse(m.buttons) : m.buttons).map((b: any) => html`<form method="post" action="/channels/reply" class="inline"><input type="hidden" name="address" value="${String(m.address)}"><input type="hidden" name="replyTo" value="${m.id}"><input type="hidden" name="buttonId" value="${String(b.id)}"><button class="btn small">${String(b.label)}</button></form>`)}</div>` : ""}</div>`)}${msgs.length ? "" : html`<p class="muted small">No messages for this address yet.</p>`}</div>
${addr ? html`<form method="post" action="/channels/reply" class="row"><input type="hidden" name="address" value="${addr}"><label class="sr" for="rp">Reply</label><input id="rp" type="text" name="text" placeholder="Reply as this party (try: pending, orders, watch, stop, cases, disputes)" required maxlength="500"><button class="btn primary small">Send</button></form>` : ""}`));
  }));
  r.post("/channels/reply", guard(async (req, res) => {
    const address = String(req.body.address ?? "");
    if (!/^(shopper|merchant):/.test(address)) throw new GtError("Simulator addresses look like shopper:<account id> or merchant:merchant", "validation", 422);
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
    await db.query(
      "INSERT INTO webhook_events (id, event_type, resource_id, body, verified) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
      [event.id, event.event_type, event.resource?.id ?? null, JSON.stringify(event), verified],
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
    res.type("application/manifest+json").json({ name: "Everyday", short_name: "Everyday", start_url: "/today", display: "standalone", background_color: "#0f172a", theme_color: "#234e8a", icons: [{ src: "/static/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }] });
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
