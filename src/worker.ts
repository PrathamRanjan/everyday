import { config } from "./config.js";
import { getDb } from "./db.js";
import { enqueue, Handler, JobType, runDueJobs } from "./jobs.js";
import { deliver } from "./channels/index.js";
import { sendPush } from "./channels/push.js";
import { releaseApproved } from "./guard/release.js";
import { reconcile, verifyRefunds } from "./services/orders.js";
import { runRepeatBuy, syncDisputes } from "./services/passport.js";
import { searchProducts } from "./services/channel3.js";

export const handlers: Record<JobType, Handler> = {
  reconcile_payments: async () => {
    await reconcile();
  },
  verify_refunds: async () => {
    await verifyRefunds();
  },
  watch_prices: async () => {},
  process_webhook: async () => {},
  send_channel_message: async (p: { messageId: string }) => {
    await deliver(p.messageId);
  },
  send_push: async (p: { subscriptionId: string; payload: { title: string; body: string; url?: string } }) => {
    await sendPush(p.subscriptionId, p.payload);
  },
  release_approved: async (p: { approvalId: string }) => {
    await releaseApproved(p.approvalId);
  },
  repeat_buy: async (p: { repeatId: string }) => {
    await runRepeatBuy(p.repeatId, "worker");
  },
  sync_disputes: async () => {
    await syncDisputes();
  },
  /** Refreshes the Channel3 cache for the queries shoppers watch, so price alerts compare against fresh results. */
  price_watch_channel3: async () => {
    const db = await getDb();
    const rows = (await db.query<{ query: string }>("SELECT query FROM channel3_cache WHERE fetched_at < now() - interval '6 hours' LIMIT 10")).rows;
    for (const r of rows) await searchProducts(r.query, db).catch(() => undefined);
  },
};

let timer: NodeJS.Timeout | null = null;
let last = 0;
let lastSlow = 0;

export function startWorker(intervalMs = config.workerIntervalMs) {
  if (timer) return;
  let busy = false;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const db = await getDb();
      if (Date.now() - last > 60_000) {
        last = Date.now();
        const slot = Math.floor(Date.now() / 60_000);
        await enqueue(db, "reconcile_payments", {}, new Date(), `reconcile:${slot}`);
        await enqueue(db, "verify_refunds", {}, new Date(), `verify:${slot}`);
      }
      if (Date.now() - lastSlow > 10 * 60_000) {
        lastSlow = Date.now();
        const slot = Math.floor(Date.now() / (10 * 60_000));
        await enqueue(db, "sync_disputes", {}, new Date(), `disputes:${slot}`);
        await enqueue(db, "price_watch_channel3", {}, new Date(), `c3:${slot}`);
      }
      await runDueJobs(db, handlers);
    } catch (e) {
      console.error("[everyday worker]", (e as Error).message);
    } finally {
      busy = false;
    }
  }, intervalMs);
  console.log(`[everyday] worker running every ${intervalMs} ms`);
}
