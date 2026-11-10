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
<form method="post" action="/admin/logout"><button>Sign out</button></form>`,
    );
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
