import { config } from "./config.js";
import { getDb } from "./db.js";
import { enqueue, Handler, JobType, runDueJobs } from "./jobs.js";
import { deliver } from "./channels/index.js";
import { sendPush } from "./channels/push.js";
import { releaseApproved } from "./guard/release.js";
import { reconcile, verifyRefunds } from "./services/orders.js";
import { runRepeatBuy, syncDisputes } from "./services/passport.js";
import { searchProducts } from "./services/channel3.js";
import { checkDemoWallet } from "./services/demowallet.js";
import { expireWorkspaces, rebuildShowcase, showcase } from "./services/workspaces.js";

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
  send_push: async (p: { subscriptionId: string; payload: { title: string; body: string; url?: string; lang?: string | null } }) => {
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
  /** A2.1: reads the demo's saved wallet back from PayPal once a day, so a removed token shows on /admin and pages. */
  check_demo_wallet: async () => {
    if (config.demoMode) await checkDemoWallet();
  },
  /** A1: deletes visitor workspaces idle for 48 hours. */
  expire_workspaces: async () => {
    if (config.demoMode && config.privateDemos) await expireWorkspaces();
  },
  /** A1/A4: the showcase that feeds the landing preview, rebuilt nightly (and at start when there is none). */
  rebuild_showcase: async () => {
    if (config.demoMode && config.privateDemos) await rebuildShowcase({ background: false });
  },
  /** B6: claims price drops for shoppers who turned on "claim price drops for me". */
  auto_claim: async () => {
    const { autoClaimAll } = await import("./services/money-back.js");
    await autoClaimAll();
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
        await enqueue(db, "auto_claim", {}, new Date(), `auto-claim:${slot}`);
        // Once a day (and at start): is the demo's saved wallet still there?
        await db.query("INSERT INTO jobs_queue (type, payload, dedupe_key) VALUES ('check_demo_wallet', '{}', $1) ON CONFLICT (dedupe_key) DO NOTHING", [`wallet:${new Date().toISOString().slice(0, 10)}`]);
        if (config.demoMode && config.privateDemos) {
          await enqueue(db, "expire_workspaces", {}, new Date(), `expire-ws:${slot}`);
          // Nightly (once per UTC day), and now if there is no showcase yet.
          const day = new Date().toISOString().slice(0, 10);
          const key = (await showcase()) ? `showcase:${day}` : `showcase:${day}:missing:${slot}`;
          await db.query("INSERT INTO jobs_queue (type, payload, dedupe_key) VALUES ('rebuild_showcase', '{}', $1) ON CONFLICT (dedupe_key) DO NOTHING", [key]);
        }
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
