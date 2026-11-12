/**
 * A4/A5: the server side of "Look and Say". A spoken phrase the page couldn't handle itself (it handles clicks,
 * scrolling and moving between pages) comes here. Code decides what it means, in four languages; no model reads it.
 *
 *   - Reads (what needs me, money back, my last order) answer in a sentence.
 *   - "Find me …" makes a plan, as typing it on Plans would.
 *   - Money (claim a price drop, pay an unpaid order from the demo's saved wallet) never happens on the first phrase.
 *     The answer names the amount and holds a one-time confirmation (60 seconds, this shopper, this action, this
 *     amount). Only "confirm" said back runs it, through the same code the buttons use, after checking the amount
 *     again. A changed amount, an expired or reused confirmation, or another shopper's: refused.
 *   - Deleting and cancelling are not done by voice.
 *   - At most ten steps in one hands-free run; then a tap or "start over" is needed.
 */
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { money } from "../lib/money.js";
import type { Account } from "../store.js";
import { claimPriceProtection, protectionsFor } from "./protect.js";
import { payFromDemoWallet, WALLET_LABEL } from "./orders.js";
import { demoWallet, walletUsable } from "./demowallet.js";
import { createIntent } from "./plans.js";
import { moneyBack } from "./money-back.js";
import { today } from "./life.js";
import { config } from "../config.js";

export const MAX_STEPS = 10;
const CONFIRM_MS = 60_000;

const norm = (s: string) => s.toLowerCase().normalize("NFC").replace(/[.,!?।"“”]/g, " ").replace(/\s+/g, " ").trim();
const has = (s: string, words: string[]) => words.some((w) => new RegExp(`(^|\\s)${w}(\\s|$)`, "u").test(s));

const W = {
  confirm: ["confirm", "yes", "yes pay", "yes confirm", "हाँ", "हां", "पुष्टि", "पुष्टि करें", "ya", "iya", "konfirmasi", "sim", "confirmar", "confirmo"],
  claim: ["claim", "price drop", "money back", "ask for", "दाम घटा", "कीमत घटी", "क्लेम", "पैसे वापस", "klaim", "harga turun", "minta kembali", "reivindicar", "queda de preço", "pedir de volta", "dinheiro de volta"],
  pay: ["pay", "pay this", "pay it", "भुगतान", "पेमेंट", "पे करो", "bayar", "pagar", "pague"],
  needs: ["what needs me", "anything for me", "what's new", "what is new", "today", "मेरे लिए क्या", "आज क्या", "ada apa", "apa yang perlu", "o que precisa", "o que há", "hoje"],
  order: ["my order", "last order", "where is my order", "order status", "मेरा ऑर्डर", "pesanan saya", "meu pedido"],
  plan: ["find me", "find", "plan", "i need", "i want", "get me", "मुझे चाहिए", "चाहिए", "ढूंढो", "cari", "carikan", "butuh", "saya butuh", "preciso de", "preciso", "procure", "encontre", "quero"],
  destructive: ["delete", "remove", "cancel order", "cancel the order", "forget", "हटाओ", "मिटाओ", "hapus", "batalkan pesanan", "apagar", "excluir", "cancelar pedido"],
};

const steps = new Map<string, { n: number; at: number }>();
function step(a: Account, run: string): number {
  const now = Date.now();
  for (const [k, v] of steps) if (now - v.at > 30 * 60_000) steps.delete(k);
  const key = `${a.id}:${run}`;
  const cur = steps.get(key) ?? { n: 0, at: now };
  cur.n += 1;
  cur.at = now;
  steps.set(key, cur);
  return cur.n;
}
export const resetSteps = (a: Account, run: string) => steps.delete(`${a.id}:${run}`);

type Out = { say: string; steps: number; navigate?: string; confirm?: { token: string; amount_cents: number; expires_at: string; action: "claim" | "pay" }; done?: string; reload?: boolean };
type Input = { text?: unknown; run?: unknown; confirm_token?: unknown; context?: { path?: unknown; order_id?: unknown } };

const hashOf = (t: string) => createHash("sha256").update(t).digest("hex");

async function hold(a: Account, action: "claim" | "pay", args: Record<string, string>, amount: number) {
  const token = randomBytes(18).toString("base64url");
  const expires = new Date(Date.now() + CONFIRM_MS);
  await (await getDb()).query("INSERT INTO handsfree_confirms (token_hash, account_id, action, args, amount_cents, expires_at) VALUES ($1,$2,$3,$4,$5,$6)", [hashOf(token), a.id, action, JSON.stringify(args), amount, expires.toISOString()]);
  return { token, amount_cents: amount, expires_at: expires.toISOString(), action };
}

export async function handsfreeCommand(a: Account, input: Input): Promise<Out> {
  const run = String(input.run ?? "").slice(0, 64) || "default";
  const text = norm(String(input.text ?? "")).slice(0, 300);
  if (/^(start over|फिर से शुरू|mulai lagi|recomeçar|recomecar)$/.test(text)) {
    resetSteps(a, run);
    return { say: "Starting over. Ten more steps by voice.", steps: 0 };
  }
  const n = step(a, run);
  if (n > MAX_STEPS) throw new GtError(`That's ${MAX_STEPS} steps by voice in a row. Tap anything, or say “start over”, to carry on.`, "too_many_steps", 429);
  const db = await getDb();

  // The second half of a money step: "confirm" said back with the token the first half gave.
  if (input.confirm_token) {
    if (!W.confirm.includes(text)) throw new GtError("Say “confirm” to go ahead, or “cancel”.", "not_confirmed", 400);
    const row = (
      await db.query<any>("UPDATE handsfree_confirms SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING account_id, action, args, amount_cents, expires_at", [hashOf(String(input.confirm_token))])
    ).rows[0];
    if (!row || row.account_id !== a.id) throw new GtError("That confirmation isn't valid. Ask again.", "bad_confirm", 403);
    if (Date.parse(row.expires_at) < Date.now()) throw new GtError("That confirmation ran out (a minute). Ask again.", "confirm_expired", 410);
    const args = typeof row.args === "string" ? JSON.parse(row.args) : row.args;
    if (row.action === "claim") {
      const pr = (await protectionsFor(db, a, args.line_id))[0];
      if (!pr?.eligible || pr.amount_cents !== Number(row.amount_cents)) throw new GtError("The amount changed since you asked, so nothing was claimed. Ask again to hear the new amount.", "amount_changed", 409);
      const c = await claimPriceProtection(a, args.line_id);
      return { say: `Asked the shop for ${money(c.amount_cents)} back (${c.number}). It counts once PayPal confirms the refund.`, steps: n, done: "claim", reload: true };
    }
    if (row.action === "pay") {
      const o = (await db.query<any>("SELECT id, number, status, total_cents FROM orders WHERE id = $1 AND account_id = $2", [args.order_id, a.id])).rows[0];
      if (!o || o.status !== "created" || o.total_cents !== Number(row.amount_cents)) throw new GtError("The order changed since you asked, so nothing was paid. Ask again.", "amount_changed", 409);
      const out = await payFromDemoWallet(a, o.id);
      return {
        say: out.status === "paid" ? `${WALLET_LABEL}: ${money(o.total_cents)} for ${o.number}. PayPal confirmed it.` : out.status === "failed" ? "PayPal refused the payment; nothing was charged." : "Sent to PayPal from the saved wallet; confirming with PayPal.",
        steps: n,
        done: "pay",
        reload: true,
      };
    }
    throw new GtError("That confirmation isn't valid. Ask again.", "bad_confirm", 403);
  }

  if (!text) return { say: "I didn't hear anything.", steps: n };
  if (has(text, W.destructive)) return { say: "Deleting and cancelling are done by hand, not by voice.", steps: n };

  if (has(text, W.claim)) {
    const eligible = (await protectionsFor(db, a)).filter((p) => p.eligible);
    if (!eligible.length) return { say: "Nothing you bought is cheaper now, so there is nothing to claim.", steps: n };
    const ctxOrder = String(input.context?.order_id ?? "");
    const pr = eligible.find((p) => p.order_id === ctxOrder) ?? eligible[0];
    return { say: `Claim ${money(pr.amount_cents)} back on ${pr.title}? Say “confirm” to ask the shop, or “cancel”.`, steps: n, confirm: await hold(a, "claim", { line_id: pr.line_id }, pr.amount_cents) };
  }

  if (has(text, W.pay)) {
    const orderId = String(input.context?.order_id ?? "");
    const o = orderId ? (await db.query<any>("SELECT id, number, status, total_cents FROM orders WHERE id = $1 AND account_id = $2", [orderId, a.id])).rows[0] : null;
    if (!o) return { say: "Open the order you want to pay first; by voice, Everyday pays the order on the screen.", steps: n };
    if (o.status !== "created") return { say: `${o.number} doesn't need paying.`, steps: n };
    const w = config.demoMode ? await demoWallet(db) : null;
    if (!w || !walletUsable(w))
      return { say: "PayPal's own page is the way to pay this one. Say “click Pay with PayPal”: PayPal opens, and you sign in and approve there yourself; Everyday never sees your PayPal password.", steps: n };
    return { say: `Pay ${money(o.total_cents)} for ${o.number} from the demo's saved sandbox wallet? Say “confirm” to pay, or “cancel”.`, steps: n, confirm: await hold(a, "pay", { order_id: o.id }, o.total_cents) };
  }

  if (has(text, W.order)) {
    const o = (await db.query<any>("SELECT number, status, total_cents FROM orders WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1", [a.id])).rows[0];
    if (!o) return { say: "You have no orders yet.", steps: n };
    return { say: `Your last order, ${o.number}, is ${String(o.status).replace(/_/g, " ")} (${money(o.total_cents)}).`, steps: n, navigate: "/purchases" };
  }

  if (has(text, W.needs)) {
    const items = await today(db, a);
    const mb = await moneyBack(db, a);
    const parts = [`${items.length} ${items.length === 1 ? "thing needs" : "things need"} you`];
    if (mb.claim_now_cents) parts.push(`${money(mb.claim_now_cents)} to claim back`);
    return { say: `${parts.join("; ")}.`, steps: n, navigate: "/today" };
  }

  for (const w of W.plan.sort((x, y) => y.length - x.length)) {
    const m = text.match(new RegExp(`^${w}\\s+(.+)$`, "u"));
    if (m && m[1].length >= 3) {
      const id = await createIntent(a, { text: m[1], channel: "app" });
      return { say: `Planning “${m[1]}”.`, steps: n, navigate: `/plans/${id}` };
    }
  }

  return { say: "I didn't catch a command. Try “Peek, click Plan it”, “Peek, what needs me?”, or say “stop”.", steps: n };
}
