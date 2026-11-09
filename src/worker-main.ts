import { getDb } from "./db.js";
import { startWorker } from "./worker.js";

await getDb();
startWorker();
