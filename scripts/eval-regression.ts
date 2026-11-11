/**
 * A5.6/B6: the review's off-script requests through the real reader and planner. Writes eval/regression.md and
 * eval/regression.json. Runs on the in-memory PayPal fake (no payment is made); needs the OpenAI key for the reader.
 */
import { writeFileSync } from "node:fs";
import { getDb } from "../src/db.js";
import { hasOpenAI, providerLabel } from "../src/ai/provider.js";
import { config } from "../src/config.js";
import { runRegression } from "../src/eval/regression.js";
import { casesOf, summarise } from "../src/eval/store.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { seedAll } from "../src/services/seed.js";
import { accountById } from "../src/store.js";

setPayPal(new FakePayPal());
config.ai.rulesReader = false; // A11: the model reads, or the case fails; rules never stand in.
if (!hasOpenAI()) {
  console.error("eval-regression: needs OPENAI_API_KEY and AI_PROVIDER=openai.");
  process.exit(1);
}
const db = await getDb();
if (!Number((await db.query("SELECT count(*)::int AS n FROM accounts")).rows[0]?.n ?? 0)) await seedAll();
const acc = await accountById(db, (await db.query<any>("SELECT id FROM accounts WHERE ws_id IS NULL ORDER BY created_at LIMIT 1")).rows[0].id);
const rows = await runRegression(acc);
const runOn = new Date().toISOString();
const md = `# Off-script regression set (Everyday, ${runOn.slice(0, 10)})

The requests from the 10 Nov review that went wrong, kept as permanent cases (B6). Each goes through the real reader (${providerLabel()}) and the real planner on the seeded catalog; code checks the result. Passed: **${rows.filter((r) => r.ok).length}/${rows.length}**.

| Request | Expected | Result | Why |
|---|---|---|---|
${rows.map((r) => `| ${r.input} | ${r.expected} | ${r.ok ? "pass" : "FAIL"} | ${r.why.replace(/\|/g, "/")} |`).join("\n")}

Not here yet: a product screenshot (the capture suite covers drawn frames, not real screenshots) and a receipt photo.
Limits: the catalog is Everyday's seeded demo shop; the checks are written by the person who built the planner.
`;
writeFileSync("eval/regression.md", md);
writeFileSync("eval/regression.json", JSON.stringify({ suite: "regression", run_on: runOn, provider: providerLabel(), arms: await summarise("regression"), inputs: Object.fromEntries(rows.map((r) => [r.id, r.input])), cases: await casesOf("regression") }, null, 2) + "\n");
console.log(md);
process.exit(0);
