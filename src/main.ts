import { createApp } from "./app.js";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { startWorker } from "./worker.js";

// A11: production refuses to start without the keys it needs. Names only: values are never printed.
if (config.production) {
  const missing = [
    !config.ai.openaiKey && "OPENAI_API_KEY",
    config.ai.provider !== "openai" && "AI_PROVIDER=openai",
    !config.paypal.clientId && "PAYPAL_CLIENT_ID",
    !config.paypal.clientSecret && "PAYPAL_CLIENT_SECRET",
  ].filter(Boolean);
  if (missing.length) {
    console.error(`[everyday] refusing to start in production: missing ${missing.join(", ")}`);
    process.exit(1);
  }
}
// A stray rejected promise or a dropped database socket is logged, not fatal: one bad request must not take the
// whole site down. (Route handlers already send theirs to the error handler; see lib/async-errors.ts.)
process.on("unhandledRejection", (e) => console.error("[everyday] unhandled rejection, still running:", e instanceof Error ? e.message : e));

// The shared database can be restarting when this starts. Wait for it (up to about 3 minutes) instead of exiting,
// which on Render means a crash loop of 502s.
async function dbWithRetry() {
  for (let i = 1; ; i++) {
    try {
      return await getDb();
    } catch (e) {
      if (i >= 36) throw e;
      console.error(`[everyday] database not ready (try ${i}): ${e instanceof Error ? e.message : e}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
const db = await dbWithRetry();
createApp().listen(config.port, () => {
  console.log(`[everyday] ${config.appUrl} (db: ${db.kind}, paypal: ${config.paypal.env}, models: ${config.ai.provider === "openai" ? `${config.ai.models.read} / ${config.ai.models.backup} / ${config.ai.models.classify}` : "none (tests or offline evaluation only)"})`);
});
if (config.inlineWorker) startWorker();
