import { writeFileSync } from "node:fs";
import { getDb } from "../src/db.js";
import { runAdversarial } from "../src/eval/adversarial.js";
import { summarise } from "../src/eval/store.js";
import { seedAll } from "../src/services/seed.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { Client } from "../test/client.js";
// The harness says it runs against the in-memory PayPal fake, so it does: no sandbox call is made from here.
const fake = new FakePayPal();
setPayPal(fake);
const db = await getDb();
const n = Number((await db.query("SELECT count(*)::int AS n FROM accounts")).rows[0]?.n ?? 0);
if (!n) await seedAll();
const acc = (await db.query<any>("SELECT id FROM accounts ORDER BY created_at LIMIT 1")).rows[0].id;
let ord = (await db.query<any>("SELECT id FROM orders WHERE capture_id IS NOT NULL ORDER BY created_at DESC LIMIT 1")).rows[0]?.id ?? null;
if (!ord) {
  // No paid order here: buy one on the fake (plan, quote, approve, capture), so the refund cases test a real paid amount.
  config.demoMode = true;
  config.privateDemos = false; // a local eval database with the shared showcase, not a visitor's workspace
  config.ai.rulesReader = true;
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const one = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows[0];
  const shopper = new Client(base);
  const li = await shopper.post("/login", { as: `acc:${acc}` });
  const pl = await shopper.post("/plans", { text: "a quiet wireless mouse for $60" });
  if (li.status !== 302 || li.location?.includes("err=") || pl.location?.includes("err=")) throw new Error(`eval setup could not make a plan: ${li.location} ${pl.location}`);
  const intent = await one("SELECT id FROM intents WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1", [acc]);
  const plan = await one("SELECT body FROM plans WHERE intent_id = $1 AND status = 'current'", [intent.id]);
  if (plan.body.questions?.length) await shopper.post(`/plans/${intent.id}/answer`, { key: plan.body.questions[0].key, value: plan.body.questions[0].choices[0].value });
  await shopper.post(`/plans/${intent.id}/quote`);
  const q = await one("SELECT * FROM quotes WHERE status = 'open' ORDER BY created_at DESC LIMIT 1");
  const r = await shopper.post(`/quotes/${q.id}/approve`, { hash: q.hash });
  const token = new URL(r.location!).searchParams.get("token")!;
  fake.approveOrder(token);
  const o = await one("SELECT id FROM orders WHERE quote_id = $1", [q.id]);
  await shopper.get(`/orders/${o.id}/paypal/return?token=${token}`);
  ord = (await one("SELECT id FROM orders WHERE id = $1 AND capture_id IS NOT NULL", [o.id]))?.id ?? null;
  server.close();
  config.ai.rulesReader = false;
}
const r = await runAdversarial(acc, ord);
writeFileSync("eval/adversarial.md", r.markdown);
writeFileSync("eval/adversarial.json", JSON.stringify({ suite: "adversarial", run_on: new Date().toISOString(), provider: "no model (code gate and the in-memory PayPal fake)", arms: await summarise("adversarial") }, null, 2) + "\n");
console.log(r.markdown);
process.exit(r.leaked.length ? 1 : 0);
