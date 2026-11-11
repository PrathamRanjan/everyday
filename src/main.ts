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
const db = await getDb();
createApp().listen(config.port, () => {
  console.log(`[everyday] ${config.appUrl} (db: ${db.kind}, paypal: ${config.paypal.env}, models: ${config.ai.provider === "openai" ? `${config.ai.models.read} / ${config.ai.models.backup} / ${config.ai.models.classify}` : "none (tests or offline evaluation only)"})`);
});
if (config.inlineWorker) startWorker();
