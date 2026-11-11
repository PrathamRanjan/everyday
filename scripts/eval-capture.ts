import { writeFileSync } from "node:fs";
import { getDb } from "../src/db.js";
import { runCaptureEval } from "../src/eval/capture.js";
import { summarise } from "../src/eval/store.js";
import { providerLabel } from "../src/ai/provider.js";
import { seedAll } from "../src/services/seed.js";
const db = await getDb();
const n = Number((await db.query("SELECT count(*)::int AS n FROM accounts")).rows[0]?.n ?? 0);
if (!n) await seedAll();
const r = await runCaptureEval();
writeFileSync("eval/capture.md", r.markdown);
// A5.6: the committed result file /proof shows on every instance, with its date and what ran.
writeFileSync("eval/capture.json", JSON.stringify({ suite: "capture", run_on: new Date().toISOString(), provider: providerLabel(), arms: await summarise("capture") }, null, 2) + "\n");
console.log(r.markdown);
process.exit(0);
