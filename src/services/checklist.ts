/**
 * A3.1: the judge checklist ticks itself. The server records a step in the visitor's own workspace when the event
 * really happens (a refund PayPal confirmed, a plan paid from the saved wallet, a message held), never when a page is
 * merely opened. Outside a demo workspace (tests, `npm run seed`) nothing is recorded.
 */
import { getDb, type Queryable } from "../db.js";
import { currentWs, isSeeding } from "../ws.js";

export const STEPS = {
  money_back_seen: "Saw the money you can still get back",
  price_drop_claimed: "Claimed a price drop",
  refund_confirmed: "PayPal confirmed the refund",
  ask_answered: "Asked the assistant and watched it work (two or more tool calls)",
  plan_made: "Made a plan from a sentence",
  plan_quoted: "Got the exact quote",
  paid_demo_wallet: "Paid as the demo shopper (no PayPal login)",
  scam_checked: "Checked a message with all the readers",
  scam_held: "A scam message was held",
  receipt_added: "Added a receipt and got its return and warranty dates",
} as const;
export type Step = keyof typeof STEPS;

export async function tick(step: Step, detail: Record<string, unknown> = {}, q?: Queryable, ws: string | null = currentWs()): Promise<void> {
  if (!ws || isSeeding()) return;
  try {
    const db = q ?? (await getDb());
    await db.query("INSERT INTO ws_checklist (ws_id, step, detail) VALUES ($1,$2,$3) ON CONFLICT (ws_id, step) DO NOTHING", [ws, step, JSON.stringify(detail)]);
  } catch {
    /* the checklist never blocks the real action */
  }
}

export async function ticks(ws: string | null, q?: Queryable): Promise<Record<string, { at: string; detail: unknown }>> {
  if (!ws) return {};
  const db = q ?? (await getDb());
  const rows = (await db.query<any>("SELECT step, at, detail FROM ws_checklist WHERE ws_id = $1", [ws])).rows;
  return Object.fromEntries(rows.map((r) => [r.step, { at: new Date(r.at).toISOString(), detail: r.detail }]));
}
