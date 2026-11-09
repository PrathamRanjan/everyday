import { createApp } from "./app.js";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { startWorker } from "./worker.js";

const db = await getDb();
createApp().listen(config.port, () => {
  console.log(`[everyday] ${config.appUrl} (db: ${db.kind}, paypal: ${config.paypal.env}, model: ${config.models.anthropicKey ? config.models.model : "none - template text"})`);
});
if (config.inlineWorker) startWorker();
