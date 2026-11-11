/**
 * Guard console (roadmap B.6, E6). The shopper writes a mandate in plain words, sees the compiled rules, replays a
 * year of purchases through them (backtest), adopts earned-autonomy suggestions, holds the kill switch, and
 * approves or declines held moves (passkey above the countersign threshold). The merchant has the same for refunds
 * at /merchant/approvals. "The agent proposes, code decides, the owner can always stop it."
 */
import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { enqueue } from "../jobs.js";
import { GtError } from "../lib/util.js";
import { recentAudit, verifyChain } from "../guard/audit.js";
import { applySuggestions, backtest } from "../guard/backtest.js";
import { countersignThreshold, decideApproval, payloadHash } from "../guard/dryrun.js";
import { setKill } from "../guard/kill.js";
import { finishRegistration, newChallenge, verifyAssertion } from "../guard/passkey.js";
import { activatePolicy, activePolicy, compilePolicy, DEFAULT_RULES, merchantOwner, RulesSchema, savePolicy } from "../guard/policy.js";
import { recentRuns } from "../trace.js";
import { merchant, shopper, whoami } from "./auth.js";
import { back, json, nextOf } from "./common.js";
import { money } from "../lib/money.js";

async function release(approvalId: string) {
  await enqueue(await getDb(), "release_approved", { approvalId }, new Date(), `release:${approvalId}`);
}

export function guardRoutes() {
  const r = Router();

  r.post("/guard/policy", shopper(async (req, res, a) => {
    const text = String(req.body.text ?? "").slice(0, 2000);
    if (!text.trim()) throw new GtError("Write your rules first", "validation", 422);
    const compiled = await compilePolicy(text);
    const adopt = req.body.mode === "adopt";
    await savePolicy(a.id, text, compiled, adopt);
    if (adopt) return back(res, "/guard", `Mandate adopted (${compiled.compiler})${compiled.unexpressed.length ? `; could not express: ${compiled.unexpressed.join("; ")}` : ""}`);
    back(res, "/guard#drafts", `Draft saved (read by ${compiled.compiler}). Nothing changes until you adopt it.${compiled.unexpressed.length ? ` Couldn't turn into a rule: ${compiled.unexpressed.join("; ")}.` : ""}`);
  }, true));

  r.post("/guard/policy/:id/activate", shopper(async (req, res, a) => {
    if (!(await activatePolicy(a.id, req.params.id))) throw new GtError("Mandate not found", "not_found", 404);
    back(res, "/guard", "Mandate adopted");
  }, true));

  r.post("/guard/backtest", shopper(async (req, res, a) => {
    const current = (await activePolicy(a.id))?.rules ?? DEFAULT_RULES;
    const candidate = RulesSchema.parse({ ...current, approve_above_cents: Number(req.body.approve_above_cents) });
    const [x, y] = await Promise.all([backtest(current, 365), backtest(candidate, 365)]);
    res.json({ current: x, candidate: y, rules: candidate });
  }, true));

  r.post("/guard/adopt-rules", shopper(async (req, res, a) => {
    const rules = RulesSchema.parse(JSON.parse(String(req.body.rules)));
    const prev = await activePolicy(a.id);
    await savePolicy(a.id, `${prev?.text ?? "(defaults)"} [edited from backtest]`, { rules, unexpressed: prev?.unexpressed ?? [], compiler: "backtest" }, true);
    back(res, "/guard", "Rules adopted");
  }, true));

  r.post("/guard/suggestions", shopper(async (req, res, a) => {
    const all = JSON.parse(String(req.body.payload ?? "[]"));
    const picks = (Array.isArray(req.body.pick) ? req.body.pick : req.body.pick ? [req.body.pick] : []).map((i: string) => all[Number(i)]).filter(Boolean);
    if (!picks.length) throw new GtError("Pick at least one suggestion", "validation", 422);
    const prev = await activePolicy(a.id);
    const rules = applySuggestions(prev?.rules ?? DEFAULT_RULES, picks);
    await savePolicy(a.id, `${prev?.text ?? "(defaults)"} [earned autonomy: ${picks.map((x: any) => x.field).join(", ")}]`, { rules, unexpressed: prev?.unexpressed ?? [], compiler: "earned-autonomy" }, true);
    back(res, "/guard", `Adopted ${picks.length} suggestion(s)`);
  }, true));

  r.post("/guard/kill", shopper(async (req, res, a) => {
    const raw_ = String(req.body.scope ?? "");
    const scope = raw_ === "account" ? `account:${a.id}` : raw_;
    if (scope !== `account:${a.id}` && !scope.startsWith("agent:")) throw new GtError("Scope must be account or agent:<id>", "validation", 422);
    const engaged = String(req.body.engaged) === "1";
    await setKill(scope, engaged, engaged ? String(req.body.reason ?? "").slice(0, 200) || null : null, a.name);
    const who = scope.startsWith("agent:") ? `the assistant ${scope.slice(6)}` : "every assistant";
    back(res, "/guard", engaged ? `Kill switch on: ${who} is stopped from planning, quoting or paying for you.` : `Kill switch off: ${who} can work inside your rules again.`);
  }, true));

  r.post("/guard/approvals/:id/click", shopper(async (req, res, a) => {
    const approve = String(req.body.approve) === "1";
    const db = await getDb();
    const ap = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, a.id])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    if (approve && ap.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
    const payload = await decideApproval(ap.id, a.id, approve, "click");
    if (payload && approve) await release(ap.id);
    back(res, "/guard", approve ? "Approved; the held step is back in the queue" : "Declined");
  }, true));

  r.post("/guard/approvals/:id/:choice(approve|decline)", shopper(async (req, res, a) => {
    const approve = req.params.choice === "approve";
    const ap = (await (await getDb()).query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, a.id])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    if (approve && ap.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
    const payload = await decideApproval(ap.id, a.id, approve, "click");
    if (payload && approve) await release(ap.id);
    back(res, nextOf(req.body?.next, "/guard"), approve ? "Approved. Everyday is carrying on with it." : "Declined. Nothing was charged.");
  }, true));

  // Passkey endpoints serve both owners: the signed-in party decides which owner id applies.
  const ownerOf = async (req: Request): Promise<{ id: string; name: string }> => {
    const w = await whoami(req);
    if (w?.account) return { id: w.account.id, name: w.account.name };
    if (w?.merchant) return { id: merchantOwner(), name: w.merchant.name };
    throw new GtError("Sign in", "unauthorized", 401);
  };
  r.post(["/guard/passkey/register/start", "/merchant/approvals/passkey/register/start"], json(async (req) => {
    const o = await ownerOf(req);
    const c = newChallenge(o.id, null);
    return { id: c.id, challenge: c.challenge, rpName: "Everyday", userId: Buffer.from(o.id).toString("base64url"), userName: o.name };
  }));
  r.post(["/guard/passkey/register/finish", "/merchant/approvals/passkey/register/finish"], json(async (req) => {
    const o = await ownerOf(req);
    try {
      return await finishRegistration(o.id, String(req.body.chalId), req.body);
    } catch (e) {
      throw new GtError((e as Error).message, "passkey_failed", 400);
    }
  }));
  r.post(["/guard/passkey/sign/start", "/merchant/approvals/passkey/sign/start"], json(async (req) => {
    const o = await ownerOf(req);
    const db = await getDb();
    const ap = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2 AND status = 'pending'", [String(req.body.approvalId), o.id])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    const c = newChallenge(o.id, ap.payload_hash);
    return { id: c.id, challenge: c.challenge, payloadHash: ap.payload_hash, summary: `${ap.action} ${money(ap.payload.cents)} ${ap.payload.entity_id}` };
  }));
  r.post(["/guard/passkey/sign/finish", "/merchant/approvals/passkey/sign/finish"], json(async (req) => {
    const o = await ownerOf(req);
    const db = await getDb();
    const ap = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2 AND status = 'pending'", [String(req.body.approvalId), o.id])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    const ok = await verifyAssertion(o.id, String(req.body.chalId), ap.payload_hash, req.body);
    if (!ok) throw new GtError("Signature did not verify", "passkey_failed", 400);
    const payload = await decideApproval(ap.id, o.id, true, "passkey");
    if (payload) await release(ap.id);
    return { approved: true, payload_hash: ap.payload_hash, hashed: payloadHash(ap.payload) === ap.payload_hash };
  }));
  r.get(["/guard/audit.json", "/merchant/approvals/audit.json"], json(async (req) => {
    await ownerOf(req);
    return { chain: await verifyChain(), rows: await recentAudit(1000) };
  }));
  r.get("/guard/runs.json", json(async (req) => {
    await ownerOf(req);
    return { runs: await recentRuns(50), threshold_cents: config.guard.countersignAboveCents };
  }));
  r.post("/merchant/approvals/policy", merchant(async (req, res) => {
    const text = String(req.body.text ?? "").slice(0, 1000);
    if (!text.trim()) throw new GtError("Write your rules first", "validation", 422);
    const compiled = await compilePolicy(text);
    await savePolicy(merchantOwner(), text, compiled, true);
    back(res, "/merchant/approvals", `Mandate adopted (${compiled.compiler})${compiled.unexpressed.length ? `; could not express: ${compiled.unexpressed.join("; ")}` : ""}`);
  }, true));
  r.post("/merchant/approvals/kill", merchant(async (req, res, m) => {
    const engaged = String(req.body.engaged) === "1";
    await setKill("merchant", engaged, engaged ? String(req.body.reason ?? "").slice(0, 200) || null : null, m.name);
    back(res, "/merchant/approvals", engaged ? "Kill switch engaged" : "Kill switch released");
  }, true));
  r.post("/merchant/approvals/:id/click", merchant(async (req, res) => {
    const approve = String(req.body.approve) === "1";
    const db = await getDb();
    const ap = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, merchantOwner()])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    if (approve && ap.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
    const payload = await decideApproval(ap.id, merchantOwner(), approve, "click");
    if (payload && approve) await release(ap.id);
    back(res, "/merchant/approvals", approve ? "Approved; the refund is back in the queue" : "Declined");
  }, true));
  r.post("/merchant/approvals/:id/:choice(approve|decline)", merchant(async (req, res) => {
    const approve = req.params.choice === "approve";
    const ap = (await (await getDb()).query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2", [req.params.id, merchantOwner()])).rows[0];
    if (!ap) throw new GtError("Approval not found", "not_found", 404);
    if (approve && ap.payload.cents > countersignThreshold()) throw new GtError("This amount needs your passkey", "passkey_required", 403);
    const payload = await decideApproval(ap.id, merchantOwner(), approve, "click");
    if (payload && approve) await release(ap.id);
    back(res, nextOf(req.body?.next, "/merchant/approvals"), approve ? "Approved; the refund is back in the queue." : "Declined. Nothing moves.");
  }, true));
  return r;
}
export type { Response };
