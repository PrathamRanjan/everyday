/**
 * A3.2: after the showcase is rebuilt, it is asked a few real questions, so /ai shows real model calls (request
 * reading, the second scam reader and the assistant with its PayPal MCP reads) and /paypal shows a live MCP read.
 * Three small calls a night, plus one real sandbox refund (the seeded price drop, claimed and approved by the shop)
 * so /paypal shows a refund id and PayPal's read-back. Without a model key nothing runs and /ai says so.
 */
import { hasOpenAI } from "../ai/provider.js";
import { getDb } from "../db.js";
import { accountById } from "../store.js";
import { withWs } from "../ws.js";

export const SHOWCASE_QUESTIONS = {
  request: "sweat-proof wireless earbuds for running, under $80, need them by next Friday",
  message: "Hi, hope you're well. Just a heads-up that we've moved banks this month, so please send this month's payment to our new PayPal: accounts.dept@outlook.com. Thanks so much!",
  ask: "Did PayPal confirm my last order and any refunds on it?",
};

export async function showcaseAi(wsId: string): Promise<{ done: string[]; failed: string[] }> {
  const out = { done: [] as string[], failed: [] as string[] };
  if (!hasOpenAI()) return out;
  const db = await getDb();
  const accId = (await db.query<{ account_id: string | null }>("SELECT account_id FROM workspaces WHERE id = $1", [wsId])).rows[0]?.account_id;
  if (!accId) return out;
  await withWs(wsId, async () => {
    const a = await accountById(db, accId);
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        out.done.push(name);
      } catch (e) {
        out.failed.push(`${name}: ${(e as Error).message.slice(0, 120)}`);
      }
    };
    const { createIntent } = await import("./plans.js");
    const { readMessage } = await import("../safety/readers.js");
    const { ask } = await import("../ai/agent.js");
    await step("request", () => createIntent(a, { text: SHOWCASE_QUESTIONS.request, channel: "app" }));
    await step("message", () => readMessage(SHOWCASE_QUESTIONS.message, { purpose: "scam_check" }));
    // The money-back path, for real: the seeded lamp is $7 cheaper inside the shop's promise. Claim it and approve
    // it as the shop, so /paypal shows a real sandbox refund and PayPal's read-back. Code works out the amount.
    await step("refund", async () => {
      const { protectionsFor, claimPriceProtection } = await import("./protect.js");
      const { merchantDecide } = await import("./orders.js");
      const p = (await protectionsFor(db, a)).find((x) => x.eligible);
      if (!p) throw new Error("no price drop inside the promise");
      const c = await claimPriceProtection(a, p.line_id);
      await merchantDecide(c.id, true, "The shop's price promise covers this drop.");
    });
    await step("ask", () => ask(a, SHOWCASE_QUESTIONS.ask, () => undefined));
  });
  if (out.failed.length) console.error("[everyday] showcase AI", out.failed.join("; "));
  return out;
}
