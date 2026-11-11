/**
 * Operator pages behind EV_ADMIN_KEY: the demo's saved wallet (A2.1: check it, switch it off to show the PayPal-page
 * path alone, or re-approve it on PayPal) and the global demo reset (A1.2: never on a public page). Without the
 * setting, every /admin route answers 404.
 */
import { Router, type Request, type Response } from "express";
import { timingSafeEqual, createHash } from "node:crypto";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { sign, unsign } from "../lib/crypto.js";
import { newId } from "../lib/ids.js";
import { paypal } from "../paypal/index.js";
import { putSetting, setting } from "../store.js";
import { checkDemoWallet, demoWallet, saveWalletToken, setWalletOff } from "../services/demowallet.js";
import { seedAll } from "../services/seed.js";
import { rebuildShowcase, showcase, WS_LIMIT } from "../services/workspaces.js";

const COOKIE = "ev_admin";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const same = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

export const isAdmin = (req: Request) => Boolean(config.adminKey) && unsign(req.cookies?.[COOKIE]) === "admin";

function page(res: Response, title: string, body: string, status = 200) {
  res
    .status(status)
    .set("Cache-Control", "no-store")
    .type("html")
    .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Everyday operator</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem;color:#1d1b16;background:#fbf9f4}h1{font-size:1.6rem}form{display:inline-block;margin:.25rem .5rem .25rem 0}button,input{font:inherit;min-height:44px;padding:.4rem .9rem}button{border:1px solid #1d1b16;background:#fff;border-radius:6px;cursor:pointer}dl{display:grid;grid-template-columns:max-content 1fr;gap:.3rem 1rem}dt{color:#5b5548}.ok{color:#1f6b3a}.bad{color:#9b2c1f}@media (prefers-color-scheme:dark){body{background:#16150f;color:#efeadd}button{background:#24221b;color:#efeadd;border-color:#efeadd}dt{color:#b8b09d}.ok{color:#7fd39b}.bad{color:#ff9d8c}}</style></head><body>${body}</body></html>`);
}

export function adminRoutes() {
  const r = Router();
  r.use("/admin", (req, res, next) => {
    if (!config.adminKey) return res.status(404).type("text").send("Not found");
    if (req.path === "/" || req.path === "/login" || isAdmin(req)) return next();
    // The robot judge's nightly job sends its run with the operator key in a header (no cookie, no browser).
    const key = req.get("x-everyday-operator");
    if (req.path === "/robot-judge" && req.method === "POST" && key && same(key, config.adminKey!)) return next();
    res.redirect("/admin");
  });

  r.get("/admin", (req, res) => {
    if (isAdmin(req)) return res.redirect("/admin/paypal/wallet");
    page(res, "Sign in", `<h1>Everyday operator</h1><p>For the person running this demo. Visitors never need this page.</p><form method="post" action="/admin/login"><label>Operator key <input name="key" type="password" autocomplete="off" required></label> <button>Sign in</button></form>${req.query.err ? `<p class="bad">${esc(req.query.err)}</p>` : ""}`);
  });
  r.post("/admin/login", (req, res) => {
    if (!same(String(req.body.key ?? ""), config.adminKey)) return res.redirect("/admin?err=" + encodeURIComponent("That key is not right."));
    res.cookie(COOKIE, sign("admin"), { httpOnly: true, sameSite: "strict", secure: config.appUrl.startsWith("https://"), maxAge: 8 * 3600_000, path: "/admin" });
    res.redirect("/admin/paypal/wallet");
  });
  r.post("/admin/logout", (_req, res) => {
    res.clearCookie(COOKIE, { path: "/admin" });
    res.redirect("/admin");
  });

  r.get("/admin/paypal/wallet", async (req, res) => {
    const w = await demoWallet();
    const tone = w.state === "ok" ? "ok" : w.state === "unchecked" ? "" : "bad";
    const words = { ok: "Working: PayPal read it back", unchecked: "Not checked yet", gone: "Needs re-approval", off: "Switched off", missing: "Not set up" }[w.state];
    page(
      res,
      "Saved wallet",
      `<h1>The demo's saved sandbox wallet</h1>
<p>Demo visitors can pay real sandbox orders from this wallet with no PayPal login. It is never used outside demo mode, and every order paid from it says so.</p>
<dl><dt>State</dt><dd class="${tone}">${esc(words)}</dd><dt>Buyer</dt><dd>${esc(w.email ?? "—")}</dd><dt>From</dt><dd>${esc(w.source === "admin" ? "re-approved on this page" : w.source === "setting" ? "the PAYPAL_DEMO_VAULT_TOKEN setting" : "—")}</dd><dt>Token</dt><dd>${w.token ? `…${esc(w.token.slice(-4))}` : "—"}</dd><dt>Last read back</dt><dd>${esc(w.checked_at ?? "never")}</dd>${w.detail ? `<dt>Note</dt><dd>${esc(w.detail)}</dd>` : ""}</dl>
<p><form method="post" action="/admin/paypal/wallet/check"><button>Read it back from PayPal now</button></form>
<form method="post" action="/admin/paypal/wallet/${w.state === "off" ? "on" : "off"}"><button>${w.state === "off" ? "Switch it back on" : "Switch it off (shows the PayPal-page path only)"}</button></form></p>
<h2>Re-approve</h2><p>Only if PayPal no longer has the token. You approve on PayPal's sandbox as the demo buyer; Everyday then saves the new token here.</p>
<form method="post" action="/admin/paypal/wallet/setup"><button>Re-approve on PayPal</button></form>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ""}${req.query.err ? `<p class="bad">${esc(req.query.err)}</p>` : ""}
<p><a href="/admin/demo">Demo workspaces and the global reset</a></p>
<form method="post" action="/admin/logout"><button>Sign out</button></form>`,
    );
  });

  // ---- A1: workspaces, the showcase and the global reset (never on a public page) ----
  r.get("/admin/demo", async (req, res) => {
    const db = await getDb();
    const c = (await db.query<any>("SELECT count(*) FILTER (WHERE kind = 'visitor' AND expires_at > now())::int AS live, count(*) FILTER (WHERE kind = 'visitor' AND created_at > now() - interval '24 hours')::int AS day, count(*) FILTER (WHERE seed_state = 'failed')::int AS failed FROM workspaces")).rows[0];
    const sc = await showcase();
    // PayPal webhooks in the last 48 hours: routed into a demo (by custom_id or paypal_refs) or not matched to one.
    const wh = (await db.query<any>("SELECT count(*) FILTER (WHERE ws_id IS NOT NULL)::int AS routed, count(*) FILTER (WHERE ws_id IS NULL)::int AS unrouted, count(*) FILTER (WHERE verified)::int AS verified, count(*) FILTER (WHERE ws_id IS NULL AND substring(coalesce(body->'resource'->>'custom_id', body->'resource'->'purchase_units'->0->>'custom_id', '') from '^(ws_[a-z0-9]+):') IN (SELECT id FROM workspaces))::int AS missed, count(*) FILTER (WHERE ws_id IS NULL AND (body->'resource'->>'id') IN (SELECT resource_id FROM paypal_refs WHERE ws_id IN (SELECT id FROM workspaces)))::int AS missed_ref, count(*) FILTER (WHERE ws_id IS NULL AND coalesce(body->'resource'->>'custom_id', body->'resource'->'purchase_units'->0->>'custom_id', '') ~ '^ws_[a-z0-9]+:' AND substring(coalesce(body->'resource'->>'custom_id', body->'resource'->'purchase_units'->0->>'custom_id', '') from '^(ws_[a-z0-9]+):') NOT IN (SELECT id FROM workspaces))::int AS gone, max(received_at) AS last FROM webhook_events WHERE received_at > now() - interval '48 hours'")).rows[0];
    page(
      res,
      "Demo workspaces",
      `<h1>Demo workspaces</h1>
<dl><dt>Live visitor demos</dt><dd>${esc(c.live)} of ${WS_LIMIT}</dd><dt>Started in 24 hours</dt><dd>${esc(c.day)}</dd><dt>Failed builds</dt><dd>${esc(c.failed)}</dd><dt>PayPal webhooks, 48 hours</dt><dd data-webhooks="${esc(wh.routed)}/${esc(wh.unrouted)}/${esc(wh.verified)}/${esc(wh.missed + wh.missed_ref)}/${esc(wh.gone)}">${esc(wh.routed)} routed into a demo, ${esc(wh.unrouted)} not matched to one (of those, ${esc(wh.missed + wh.missed_ref)} belong to a demo that still exists and should have been routed; ${esc(wh.gone)} name a demo that isn't here: deleted, or another app's look-alike id; the rest are payments made outside the demos), ${esc(wh.verified)} signature-verified${wh.last ? `; last ${esc(new Date(wh.last).toISOString())}` : ""}</dd><dt>Showcase</dt><dd>${sc ? `${esc(sc.id)}, built ${esc(new Date(sc.created_at).toISOString())}` : "none yet"}</dd></dl>
<p><form method="post" action="/admin/demo/showcase"><button>Rebuild the showcase now</button></form></p>
<h2>Global reset</h2><p>Deletes every visitor's demo and the showcase, then rebuilds the showcase. Visitors start a new demo on their next visit.</p>
<form method="post" action="/admin/demo/reset-all"><label><input type="checkbox" name="sure" value="1" required> I mean every visitor's demo</label> <button>Reset everything</button></form>
${req.query.ok ? `<p class="ok">${esc(req.query.ok)}</p>` : ""}${req.query.err ? `<p class="bad">${esc(req.query.err)}</p>` : ""}
<p><a href="/admin/paypal/wallet">The saved wallet</a></p>`,
    );
  });
  r.post("/admin/robot-judge", async (req, res) => {
    const b = req.body ?? {};
    const okPath = (p: any) => p && typeof p.id === "string" && typeof p.ok === "boolean" && Array.isArray(p.steps);
    if (typeof b.run_on !== "string" || !Array.isArray(b.paths) || !b.paths.every(okPath)) return res.status(400).json({ error: "invalid", message: "Not a robot-judge run" });
    const run = { run_on: b.run_on, target: String(b.target ?? "").slice(0, 200), by: String(b.by ?? "robot").slice(0, 120), ok: b.paths.every((p: any) => p.ok), paths: b.paths.slice(0, 12).map((p: any) => ({ id: String(p.id).slice(0, 40), title: String(p.title ?? p.id).slice(0, 120), ok: Boolean(p.ok), seconds: Number(p.seconds) || 0, error: p.error ? String(p.error).slice(0, 240) : null, steps: p.steps.slice(0, 10).map((s: any) => ({ key: String(s.key).slice(0, 40), label: String(s.label ?? s.key).slice(0, 160), done: Boolean(s.done) })) })) };
    await (await getDb()).query("INSERT INTO settings (key, value) VALUES ('robot_judge', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(run)]);
    res.json({ stored: true, ok: run.ok });
  });
  r.post("/admin/demo/showcase", async (_req, res) => {
    const ws = await rebuildShowcase();
    res.redirect("/admin/demo?ok=" + encodeURIComponent(`Showcase rebuilt (${ws.id}); its payments finish in the background.`));
  });
  r.post("/admin/demo/reset-all", async (req, res) => {
    if (req.body.sure !== "1") return res.redirect("/admin/demo?err=" + encodeURIComponent("Tick the box to confirm."));
    // Keep the saved wallet and its check: they are operator settings, not demo data.
    const db = await getDb();
    const keep = (await db.query<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('demo_wallet')")).rows;
    await seedAll();
    for (const k of keep) await putSetting(db, k.key, k.value);
    const ws = await rebuildShowcase();
    res.redirect("/admin/demo?ok=" + encodeURIComponent(`Everything reset; showcase ${ws.id} is building.`));
  });
  r.post("/admin/paypal/wallet/check", async (_req, res) => {
    const w = await checkDemoWallet();
    res.redirect("/admin/paypal/wallet?" + (w.state === "ok" ? "ok=" + encodeURIComponent("PayPal read the saved wallet back.") : "err=" + encodeURIComponent(w.detail ?? `State: ${w.state}`)));
  });
  r.post("/admin/paypal/wallet/:onoff(on|off)", async (req, res) => {
    await setWalletOff(req.params.onoff === "off");
    res.redirect("/admin/paypal/wallet?ok=" + encodeURIComponent(req.params.onoff === "off" ? "Switched off: pages now offer PayPal's own page only." : "Switched back on."));
  });
  r.post("/admin/paypal/wallet/setup", async (_req, res) => {
    const id = newId("dwl");
    const st = await paypal().createSetupToken({ returnUrl: `${config.appUrl}/admin/paypal/wallet/return?s=${id}`, cancelUrl: `${config.appUrl}/admin/paypal/wallet?err=${encodeURIComponent("Re-approval cancelled.")}`, description: "Everyday demo: the saved sandbox wallet demo visitors pay from" }, `demo-wallet-setup:${id}`);
    await putSetting(await getDb(), "demo_wallet_setup", JSON.stringify({ id, setup: st.id }));
    if (!st.approveUrl) return res.redirect("/admin/paypal/wallet?err=" + encodeURIComponent("PayPal did not return an approval link."));
    res.redirect(st.approveUrl);
  });
  r.get("/admin/paypal/wallet/return", async (req, res) => {
    const db = await getDb();
    const pending = JSON.parse((await setting(db, "demo_wallet_setup")) ?? "{}");
    if (!pending.id || pending.id !== req.query.s) return res.redirect("/admin/paypal/wallet?err=" + encodeURIComponent("That approval does not match the one this page started."));
    const pt = await paypal().createPaymentToken(pending.setup, `demo-wallet-token:${pending.id}`);
    await putSetting(db, "demo_wallet_setup", "{}");
    const w = await saveWalletToken(pt.id, pt.customerId ?? null);
    res.redirect("/admin/paypal/wallet?" + (w.state === "ok" ? "ok=" + encodeURIComponent("Saved. PayPal read the new wallet back.") : "err=" + encodeURIComponent(w.detail ?? w.state)));
  });
  return r;
}
