/**
 * After an owner approves a held move, the work that was waiting goes back to the queue (job release_approved).
 * Payloads are what dryRun stored: action, entity, entity_id, cents.
 */
import { getDb } from "../db.js";
import { enqueue } from "../jobs.js";

export async function releaseApproved(approvalId: string) {
  const db = await getDb();
  const a = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND status = 'approved'", [approvalId])).rows[0];
  if (!a) return;
  const p = a.payload as { action: string; entity: string; entity_id: string; cents: number };
  if (p.action === "refund") {
    // Refunds wait in payment_ops as pending; verify_refunds resends them with the same request id.
    await enqueue(db, "verify_refunds", {}, new Date(), `release-refund:${approvalId}`);
  }
  if (p.action === "repeat_buy") await enqueue(db, "repeat_buy", { repeatId: p.entity_id }, new Date(), `repeat:${p.entity_id}`);
}
