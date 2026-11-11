/**
 * Scam and fraud protection for shoppers (SAFETY_ACCESSIBILITY_SPEC §4, §6 Everyday row): check a seller or marketplace
 * message (rules on the server, the fine-tuned text model in this browser), see inbound messages with their scan,
 * see holds the safety layer created and why, and switch protected mode on for a first payment to any new seller.
 */
import { Router } from "express";
import { GtError } from "../lib/util.js";
import { setProtectedMode } from "../safety/index.js";
import { readMessage } from "../safety/readers.js";
import { shopper } from "./auth.js";
import { back, json } from "./common.js";
import { unlimited } from "./demo.js";

/** The scan is public (the landing page and order pages use it) and asks a paid model, so each address gets 40 an hour. */
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const xs = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  xs.push(now);
  hits.set(ip, xs);
  if (hits.size > 5000) hits.clear();
  return xs.length > 40;
}

/** The marketplace message the demo button pastes: an off-platform, overpayment-refund scam aimed at a shopper. */
export const DEMO_SCAM = "Hi! I saw you want the oak lamp. I can do it for $40 instead of $59 but PayPal takes a big fee, so please pay me directly by bank transfer or send a gift card code on WhatsApp. If you already paid, I was sent too much, refund me the difference today and I ship tonight. Here is the tracking: http://bit.ly/lamp-track";

export function safetyRoutes() {
  const r = Router();

  r.post("/safety/scan", json(async (req) => {
    const text = String(req.body?.text ?? "").slice(0, 4000);
    if (!text.trim()) throw new GtError("Paste a message first.", "bad_request", 400);
    if (!unlimited(req) && limited(String(req.ip ?? req.socket.remoteAddress ?? "unknown"))) throw new GtError("That's a lot of checks from one place in an hour. Try again later.", "rate_limited", 429);
    // A6.1: rules, Decisions and the code reader; the browser adds the on-device model.
    const out = await readMessage(text);
    return { ...out, risk: out.rules.risk };
  }));

  r.post("/safety/protected", shopper(async (req, res, a) => {
    const on = String(req.body.on) === "1";
    await setProtectedMode(a.id, on, [String(req.body.contact1 ?? "").trim(), String(req.body.contact2 ?? "").trim()]);
    back(res, "/safety#protected", on ? "Protected mode is on." : "Protected mode is off.");
  }, true));

  return r;
}
