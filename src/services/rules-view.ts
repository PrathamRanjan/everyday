/**
 * A read-only view of a shopper's spending rules for the assistant (src/ai may not import the mandate module). It
 * returns a copy; nothing here can change a rule.
 */
import type { Queryable } from "../db.js";
import { activePolicy, DEFAULT_RULES } from "../guard/policy.js";

export async function readRules(accountId: string, q?: Queryable) {
  const pol = await activePolicy(accountId, q);
  return { rules: structuredClone(pol?.rules ?? DEFAULT_RULES), text: pol?.text ?? null };
}
