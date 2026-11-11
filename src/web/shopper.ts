import { Router } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { accountById, nowIso } from "../store.js";
import { catalog } from "../services/catalog.js";
import { capture, linkCode, selectObject } from "../services/captures.js";
import { addOwned, repairAdvice, setOwnedStatus, watchPrice } from "../services/life.js";
import { deleteMemory, forgetFeature, undoChoice } from "../services/ml.js";
import { claimPriceProtection } from "../services/protect.js";
import { acceptSwap, approveQuote, approveQuoteFromDemoWallet, checkoutLink, openCase, payFromDemoWallet, paypalReturn, quotePlan, requestRemedy, WALLET_LABEL } from "../services/orders.js";
import { answer, choose, createIntent } from "../services/plans.js";
import { clientOf, keyLogin, shopper, signIn, signOut, whoami } from "./auth.js";
import { currentWs, merchantOwner } from "../ws.js";
import { back } from "./common.js";
import { money } from "../lib/money.js";
import { readForm } from "./upload.js";
import { randomBytes } from "node:crypto";

export function shopperRoutes() {
  const r = Router();

  r.post("/login", async (req, res) => {
    const v = req.body.as && config.demoMode ? String(req.body.as) : req.body.key ? await keyLogin(String(req.body.key)) : null;
    if (!v) return back(res, "/login", "That key is not valid.", true);
    // A1: a demo persona can be chosen only inside the visitor's own workspace (Maya or her shop, never another's).
    if (req.body.as) {
      const id = v.slice(4);
      const owner = (await (await getDb()).query<{ ws_id: string | null }>(v.startsWith("mer:") ? "SELECT ws_id FROM merchants WHERE id = $1" : "SELECT ws_id FROM accounts WHERE id = $1", [id])).rows[0];
      if (!owner || (owner.ws_id ?? null) !== currentWs() || (config.privateDemos && !owner.ws_id)) return back(res, "/login", config.privateDemos ? "Start your own demo first: tap “Try the live demo”." : "That persona isn't part of this demo.", true);
    }
    signIn(res, v);
    const next = String(req.body.next ?? "");
    res.redirect(next.startsWith("/") && !next.startsWith("//") ? next : v.startsWith("mer:") ? "/merchant" : "/today");
  });
  r.post("/logout", (_req, res) => {
    signOut(res);
    res.redirect("/");
  });

  r.post("/discover/capture", shopper(async (req, res, a) => {
    const { fields, files } = await readForm(req);
    const shot = files.shot?.[0] ?? null;
    if (!fields.url && !fields.text && !shot) throw new GtError("Paste a link, add a screenshot or describe it.", "invalid");
    const c = await capture(a, { url: fields.url || undefined, text: fields.text, channel: clientOf(req), image: shot ? { mime: shot.mime, body: shot.body } : null });
    back(res, `/captures/${c.id}`, c.reused ? "Already in your library." : "Saved.");
  }, true));

  r.post("/discover/watch", shopper(async (req, res, a) => {
    await watchPrice(a, String(req.body.product), Math.round(Number(req.body.target) * 100));
    back(res, "/discover", "Watching. You'll hear only when the merchant's recorded price reaches your target.");
  }, true));

  r.post("/captures/:id/select", shopper(async (req, res, a) => {
    const o = await selectObject(a, req.params.id, String(req.body.key));
    back(res, `/captures/${req.params.id}`, `Selected: ${o.label}.`);
  }, true));

  r.post("/plans", shopper(async (req, res, a) => {
    // A5.5: the manual form (shown when the model couldn't read the sentence) sends each field itself.
    const b = req.body ?? {};
    const dollars = String(b.budget ?? "").trim();
    const manual = b.manual === "1"
      ? {
          category: String(b.category ?? ""),
          budget_cents: dollars ? (/^\d{1,5}$/.test(dollars) ? Number(dollars) * 100 : -1) : null,
          deadline: String(b.by ?? "").trim() || null,
          must: String(b.must ?? "").split(",").map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z][a-z -]{1,24}$/.test(w)).slice(0, 6),
        }
      : null;
    const id = await createIntent(a, { text: String(b.text ?? ""), capture_id: b.capture_id || null, recipient_id: b.recipient_id || null, channel: clientOf(req), manual });
    res.redirect(`/plans/${id}`);
  }, true));

  r.post("/plans/:id/answer", shopper(async (req, res, a) => {
    await answer(a, req.params.id, String(req.body.key), String(req.body.value ?? ""));
    back(res, `/plans/${req.params.id}`, "Plan updated.");
  }, true));

  r.post("/plans/:id/choose", shopper(async (req, res, a) => {
    const reason = ["too_expensive", "already_own", "wrong_recipient"].includes(req.body.reason) ? req.body.reason : "style";
    const out = await choose(a, req.params.id, String(req.body.a), String(req.body.b), reason === "style" ? (req.body.chosen === "b" ? "b" : "a") : reason === "too_expensive" ? (req.body.chosen === "b" ? "b" : "a") : null, reason);
    back(res, `/plans/${req.params.id}`, out.excluded ? `Noted (not used for learning: ${out.excluded}).` : out.changed ? "Your plan changed. See why at the top." : "Learned. Your plan already fits.");
  }, true));

  r.post("/plans/:id/quote", shopper(async (req, res, a) => {
    await quotePlan(a, req.params.id);
    res.redirect(`/plans/${req.params.id}#quote`);
  }, true));

  r.post("/quotes/:id/approve", shopper(async (req, res, a) => {
    const url = await approveQuote(a, req.params.id, String(req.body.hash ?? ""), { native: clientOf(req) === "mobile" });
    res.redirect(url);
  }, true));

  // A2.1: pay as the demo shopper from the saved sandbox wallet, with no PayPal login. Demo mode only.
  const walletDone = (orderId: string, out: { status: string; capture_id: string | null }) =>
    out.status === "paid" ? `${WALLET_LABEL}. PayPal capture ${out.capture_id} confirmed.` : out.status === "failed" ? "PayPal refused the payment; nothing was charged. Pay on PayPal's own page instead." : "Sent to PayPal from the saved wallet; confirming with PayPal.";
  r.post("/quotes/:id/approve-demo", shopper(async (req, res, a) => {
    const out = await approveQuoteFromDemoWallet(a, req.params.id, String(req.body.hash ?? ""));
    const o = (await (await getDb()).query<{ id: string }>("SELECT id FROM orders WHERE quote_id = $1", [req.params.id])).rows[0];
    back(res, `/orders/${o.id}`, walletDone(o.id, out), out.status === "failed");
  }, true));
  r.post("/orders/:id/pay-demo", shopper(async (req, res, a) => {
    const out = await payFromDemoWallet(a, req.params.id);
    back(res, `/orders/${req.params.id}`, walletDone(req.params.id, out), out.status === "failed");
  }, true));

  r.post("/orders/:id/pay", shopper(async (req, res, a) => {
    res.redirect(await checkoutLink(a, req.params.id, { native: clientOf(req) === "mobile" }));
  }, true));

  r.get("/orders/:id/paypal/return", shopper(async (req, res, a) => {
    const out = await paypalReturn(a, req.params.id, String(req.query.token ?? ""));
    back(res, `/orders/${req.params.id}`, out === "paid" ? "Paid and confirmed with PayPal." : out === "failed" ? "PayPal refused the payment; nothing was charged. Pay again and choose another way to pay." : "Thanks — confirming with PayPal.");
  }, true));

  // The phone app's PayPal return. The in-app browser has no Everyday session, so the order is found by the PayPal
  // order id PayPal sends back (it must match the order, as on the website) and the buyer lands back in the app.
  r.get("/orders/:id/paypal/return-app", async (req, res, next) => {
    try {
      const token = String(req.query.token ?? "");
      const db = await getDb();
      const o = (await db.query<{ account_id: string }>("SELECT account_id FROM orders WHERE id = $1 AND paypal_order_id = $2", [req.params.id, token])).rows[0];
      const to = `everyday://orders/${encodeURIComponent(req.params.id)}`;
      if (!o || !token) return res.redirect(`${to}?err=${encodeURIComponent("This PayPal approval does not match the order.")}`);
      const out = await paypalReturn(await accountById(db, o.account_id), req.params.id, token);
      const msg = out === "paid" ? "Paid and confirmed with PayPal." : out === "failed" ? "PayPal refused the payment; nothing was charged." : "Thanks — confirming with PayPal.";
      res.redirect(`${to}?${out === "failed" ? "err" : "ok"}=${encodeURIComponent(msg)}`);
    } catch (e) {
      if (e instanceof GtError) return res.redirect(`everyday://orders/${encodeURIComponent(req.params.id)}?err=${encodeURIComponent(e.message)}`);
      next(e);
    }
  });
  r.get("/orders/:id/paypal/cancel-app", (req, res) => res.redirect(`everyday://orders/${encodeURIComponent(req.params.id)}?err=${encodeURIComponent("Payment cancelled")}`));

  r.post("/lines/:id/swap", shopper(async (req, res, a) => {
    const offer = await acceptSwap(a, req.params.id);
    back(res, req.get("referer")?.split("?")[0] ?? "/purchases", `Swapped to ${offer.title}${offer.diff_cents ? `; ${money(offer.diff_cents)} refunded to your PayPal` : ""}.`);
  }, true));

  r.post("/lines/:id/price-protection", shopper(async (req, res, a) => {
    const c = await claimPriceProtection(a, req.params.id);
    back(res, (req.get("referer")?.split("?")[0] ?? "/purchases") + "#cases", `${c.number}: asked Northlight for ${money(c.amount_cents)}. You'll see it here once they approve and PayPal confirms.`);
  }, true));

  r.post("/lines/:id/case", shopper(async (req, res, a) => {
    await openCase(a, req.params.id, req.body.issue, String(req.body.claim ?? ""), req.body.photo === "1");
    back(res, (req.get("referer")?.split("?")[0] ?? "/purchases") + "#cases", "Case opened. Choose a remedy below.");
  }, true));

  r.post("/cases/:id/remedy", shopper(async (req, res, a) => {
    await requestRemedy(a, req.params.id, String(req.body.key));
    back(res, (req.get("referer")?.split("?")[0] ?? "/purchases") + "#cases", "Sent to the merchant.");
  }, true));

  r.post("/you/owned", shopper(async (req, res, a) => {
    const [brand, ...model] = String(req.body.brand_model ?? "").trim().split(/\s+/);
    await addOwned(a, { title: String(req.body.title ?? ""), category: String(req.body.category ?? ""), brand: brand ?? "", model: model.join(" "), inputs: String(req.body.inputs ?? "").split(/[,\s]+/).map((x) => x.toLowerCase()).filter((x) => ["hdmi", "dp", "usb-c"].includes(x)), vesa: req.body.vesa ? Number(req.body.vesa) : null, price_cents: req.body.price ? Math.round(Number(req.body.price) * 100) : null, acquired: nowIso(a).slice(0, 10) });
    back(res, "/you#owned", "Added. Future plans will use it.");
  }, true));

  r.post("/you/owned/:id/status", shopper(async (req, res, a) => {
    await setOwnedStatus(a, req.params.id, req.body.status);
    back(res, "/you#owned", "Updated.");
  }, true));

  r.post("/you/owned/:id/advice", shopper(async (req, res, a) => {
    const out = await repairAdvice(a, req.params.id, req.body.quote ? Math.round(Number(req.body.quote) * 100) : null);
    back(res, "/you#owned", `${out.decision.replace("_", " ").toUpperCase()}: ${out.reasons.join(" ")}`);
  }, true));

  r.post("/you/undo", shopper(async (req, res, a) => {
    const db = await getDb();
    await undoChoice(db, a, Number(req.body.event), (await catalog(db)).byId);
    back(res, "/you", "Undone. Your taste model was rebuilt from your other choices.");
  }, true));
  r.post("/you/forget", shopper(async (req, res, a) => {
    const db = await getDb();
    await forgetFeature(db, a, String(req.body.recipient), String(req.body.feature));
    back(res, "/you", "Forgotten.");
  }, true));

  r.post("/you/delete-memory", shopper(async (req, res, a) => {
    const db = await getDb();
    const own = (await db.query("SELECT 1 FROM recipients WHERE id = $1 AND account_id = $2", [req.body.recipient, a.id])).rows.length;
    if (!own) throw new GtError("Not found", "not_found", 404);
    await deleteMemory(db, a, String(req.body.recipient));
    back(res, "/you", "Preference memory deleted.");
  }, true));

  r.post("/you/limit", shopper(async (req, res, a) => {
    const v = Math.round(Number(req.body.limit) * 100);
    if (!(v >= 0 && v <= 10_000_000)) throw new GtError("Enter a limit in dollars.", "invalid");
    await (await getDb()).query("UPDATE accounts SET monthly_limit_cents = $2 WHERE id = $1", [a.id, v]);
    back(res, "/you", "Saved.");
  }, true));

  r.post("/you/telegram", shopper(async (_req, res, a) => {
    const code = await linkCode(a);
    res.redirect(`/you?code=${code}`);
  }, true));
  /** One tap: a 15-minute one-time code, then straight into Telegram; the shared bot routes "everyday-<code>" here. */
  r.post("/connect/telegram", async (req, res, next) => {
    try {
      const w = await whoami(req);
      if (w?.account) return res.redirect(303, `https://t.me/${config.channels.telegramBot}?start=everyday-${await linkCode(w.account)}`);
      if (w?.merchant) {
        const code = `m${randomBytes(9).toString("hex")}`;
        await (await getDb()).query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`tglink:${code}`, JSON.stringify({ party: "merchant", owner: merchantOwner(), exp: Date.now() + 15 * 60_000 })]);
        return res.redirect(303, `https://t.me/${config.channels.telegramBot}?start=everyday-${code}`);
      }
      res.redirect("/login?next=/you");
    } catch (e) {
      next(e);
    }
  });

  return r;
}
