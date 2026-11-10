/**
 * Purchase passport (shopper) and the merchant's money page (roadmap E3, E5): dollars recovered, saved PayPal and
 * repeat buys behind the gate, price watches and recalls; merchant tracking uploads, disputes with evidence packs,
 * transaction reconcile and sandbox negative tests.
 */
import { Router } from "express";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { acceptDispute, addTrackingForLine, evidencePack, finishVaultSetup, negativeTest, passportSummary, planRepeatBuy, reconcileTransactions, revokeVault, sendEvidence, startVaultSetup, syncDisputes } from "../services/passport.js";
import { merchant, shopper } from "./auth.js";
import { back, json } from "./common.js";

export function passportRoutes() {
  const r = Router();

  r.post("/passport/vault", shopper(async (_req, res, a) => {
    res.redirect(await startVaultSetup(a));
  }, true));
  r.get("/passport/vault/return", shopper(async (req, res, a) => {
    const v = await finishVaultSetup(a, String(req.query.v ?? ""));
    back(res, "/passport", `PayPal saved (…${String(v.payment_token).slice(-4)}). Repeat buys run inside your mandate.`);
  }));
  r.post("/passport/vault/revoke", shopper(async (_req, res, a) => {
    await revokeVault(a);
    back(res, "/passport", "Saved PayPal removed.");
  }, true));
  r.post("/passport/repeat", shopper(async (req, res, a) => {
    const out = await planRepeatBuy(a, String(req.body.product ?? ""), Number(req.body.qty ?? 1), a.name, "shopper");
    back(res, "/passport", out.message, out.status === "denied" || out.status === "failed");
  }, true));
  r.get("/passport.json", json(async (req) => {
    const { partyOf } = await import("./trace.js");
    const who = await partyOf(req);
    if (!who || who.kind !== "shopper") throw new GtError("Unauthorized", "unauthorized", 401);
    const db = await getDb();
    const { accountById } = await import("../store.js");
    const a = await accountById(db, who.id);
    const p = await passportSummary(db, a);
    return { recovered: p.recovered, spent_cents: p.spent, back_cents: p.back, live: p.live, history: p.hist };
  }));
  r.post("/merchant/lines/:id/tracking", merchant(async (req, res) => {
    await addTrackingForLine(req.params.id, String(req.body.carrier ?? ""), String(req.body.number ?? ""));
    back(res, "/merchant/money#tracking", "Tracking attached to the PayPal order.");
  }, true));
  r.post("/merchant/money/disputes/sync", merchant(async (_req, res) => {
    const n = await syncDisputes();
    back(res, "/merchant/money#disputes", `Synced ${n} dispute(s).`);
  }, true));
  r.post("/merchant/money/disputes/:id/evidence", merchant(async (req, res) => {
    await sendEvidence(req.params.id);
    back(res, "/merchant/money#disputes", "Evidence sent to PayPal.");
  }, true));
  r.post("/merchant/money/disputes/:id/accept", merchant(async (req, res) => {
    await acceptDispute(req.params.id, String(req.body.note ?? ""));
    back(res, "/merchant/money#disputes", "Claim accepted; PayPal refunds the shopper.");
  }, true));
  r.get("/merchant/money/disputes/:id/evidence.json", merchant(async (req, res) => {
    res.json((await evidencePack(req.params.id)).pack);
  }));
  r.post("/merchant/money/negative-test", merchant(async (req, res) => {
    const code = String(req.body.code ?? "INSTRUMENT_DECLINED").replace(/[^A-Z_]/g, "");
    const out = await negativeTest(code);
    back(res, "/merchant/money", `${out.code}: ${out.message}`, out.outcome === "accepted");
  }, true));
  r.get("/merchant/money/transactions.json", merchant(async (_req, res) => {
    res.json(await reconcileTransactions(30));
  }));
  return r;
}
