import type { Queryable } from "../db.js";
import { addMonths } from "../core/after.js";
import { wallIso, wallNow } from "../core/time.js";
import { newId } from "../lib/ids.js";
import { hashKey, newSecret } from "../lib/util.js";
import { putSetting } from "../store.js";
import { DISCOVERY, NORTHLIGHT, RECALLS } from "./catalog-data.js";
import { ensurePrior } from "./ml.js";
import { getDb } from "../db.js";
import { compileLocal, MERCHANT, savePolicy } from "../guard/policy.js";
import { seedPurchaseHistory } from "./passport.js";

/** Demo mandates in the owners' own words. Compiled locally; the owner can rewrite them on /guard. */
export const SHOPPER_MANDATE = "Never spend more than $400 on a single purchase. Ask me before any repeat buy over $30. Repeat buys are on. Assistants may plan. Assistants may ask for approval. Only buy from Northlight. Never buy headphones";
export const MERCHANT_MANDATE = "Refund at most 60%. Ask me before refunding more than $150";

/** Seeds the demo world plus the foundation: mandates and the labelled purchase history. */
export async function seedAll(opts: { anchor?: string } = {}): Promise<Seeded> {
  const db = await getDb();
  const s = await db.tx((q) => seed(q, opts));
  await seedPurchaseHistory(db);
  await savePolicy(s.account, SHOPPER_MANDATE, compileLocal(SHOPPER_MANDATE), true, db);
  await savePolicy(MERCHANT, MERCHANT_MANDATE, compileLocal(MERCHANT_MANDATE), true, db);
  return s;
}

const TABLES = ["agent_trace", "agent_runs", "approvals", "audit_chain", "policies", "kill_switches", "provenance", "channel_messages", "party_links", "push_subscriptions", "judge_sessions", "eval_runs", "agent_requests", "ai_calls", "purchase_history", "vault_tokens", "repeat_buys", "disputes", "trackers", "channel3_cache", "events", "inbox", "price_watches", "owned_items", "cases", "payment_ops", "order_lines", "orders", "quotes", "plans", "intents", "captures", "price_history", "products", "merchants", "pref_events", "pref_models", "profile_facts", "recipients", "link_codes", "channel_links", "accounts", "recalls", "jobs_queue", "demo_faults"];

export function demoAnchor(tz: string, instant = new Date()) {
  const now = wallNow(tz, instant);
  const delta = (8 - now.getUTCDay()) % 7 || (now.getUTCHours() < 9 ? 0 : 7);
  return wallIso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta, 9, 0)));
}

export interface Seeded {
  keys: Record<string, string>;
  account: string;
  self: string;
  brother: string;
  merchant: string;
  products: Record<string, string>;
}

export async function seed(q: Queryable, opts: { anchor?: string } = {}): Promise<Seeded> {
  for (const t of TABLES) await q.query(`DELETE FROM ${t}`);
  const anchor = opts.anchor ?? demoAnchor("Asia/Singapore");
  const keys: Record<string, string> = { maya: newSecret("evk"), northlight: newSecret("nlk") };
  const account = newId("acc");
  await q.query("INSERT INTO accounts (id, name, tz, monthly_limit_cents, sim_now, key_hash, address) VALUES ($1,'Maya','Asia/Singapore',60000,$2,$3,'Room 412, Kent Ridge Hall, Singapore')", [account, anchor, hashKey(keys.maya)]);
  const self = newId("rcp");
  const brother = newId("rcp");
  await q.query("INSERT INTO recipients (id, account_id, name, relation, is_self) VALUES ($1,$2,'Maya','self',true),($3,$2,'Ari','brother',false)", [self, account, brother]);
  const nl = newId("mer");
  await q.query("INSERT INTO merchants (id, name, kind, label, caps, shipping, return_policy, key_hash) VALUES ($1,'Northlight Supply (sandbox test merchant)','test_merchant','Buy here with PayPal',$2,$3,$4,$5)", [
    nl,
    JSON.stringify({ discovery: true, quote: true, checkout: true, track: true, swap: true, refund: true, train: true, cache: true }),
    JSON.stringify({ standard_cents: 1200, free_over_cents: 30000, standard_days: 2, express_cents: 1500, express_days: 1 }),
    JSON.stringify({ window_days: 30, restock_pct: 10, final_sale_when_opened: ["headphones"], partial_pct: 30, swap: true, version: "NL-returns-2026-10", price_protection_days: 14, price_protection_clause: "If Northlight's own price for the same item drops within 14 days of delivery (or before it arrives), we refund the difference to your original payment. Same item, new and in stock, Northlight's own recorded price only." }),
    hashKey(keys.northlight),
  ]);
  const lumen = newId("mer");
  const unverified = newId("mer");
  await q.query("INSERT INTO merchants (id, name, kind, label, caps, shipping, return_policy) VALUES ($1,'Lumen & Oak','discovery','Continue at retailer',$3,'{}',$4),($2,'Marketplace listing','discovery','Availability needs confirmation',$3,'{}',$4)", [lumen, unverified, JSON.stringify({ discovery: true, quote: false, checkout: false, train: false, cache: false }), JSON.stringify({ window_days: 0, restock_pct: 0, final_sale_when_opened: [], partial_pct: 0, swap: false, version: "unknown" })]);
  const products: Record<string, string> = {};
  for (const p of NORTHLIGHT) {
    const id = newId("prd");
    products[p.sku] = id;
    await q.query("INSERT INTO products (id, merchant_id, sku, title, brand, model, category, price_cents, stock, backorder_days, attrs, description, warranty_months, train_ok) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,true)", [id, nl, p.sku, p.title, p.brand, p.model, p.category, p.price * 100, p.stock, JSON.stringify(p.attrs), p.description, p.warranty_months ?? 12]);
    await q.query("INSERT INTO price_history (product_id, price_cents, wall) VALUES ($1,$2,$3)", [id, p.price * 100, anchor]);
  }
  for (const p of DISCOVERY) {
    const id = newId("prd");
    products[p.sku] = id;
    await q.query("INSERT INTO products (id, merchant_id, sku, title, brand, model, category, price_cents, stock, attrs, description, url, train_ok) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false)", [id, p.merchant === "lumen" ? lumen : unverified, p.sku, p.title, p.brand, p.model, p.category, p.price * 100, p.stock, JSON.stringify(p.attrs), p.description, p.url]);
  }
  for (const r of RECALLS) await q.query("INSERT INTO recalls (id, brand, model, title, remedy, url) VALUES ($1,$2,$3,$4,$5,$6)", [newId("rcl"), r.brand, r.model, r.title, r.remedy, r.url]);
  // Maya's possessions: the monitor she mentions, and headphones that match the (demo) recall feed.
  const eightMonths = addMonths(new Date(`${anchor.slice(0, 10)}T00:00:00Z`), -8).toISOString().slice(0, 10);
  await q.query("INSERT INTO owned_items (id, account_id, recipient_id, title, brand, model, category, attrs, price_cents, acquired, warranty_until, source) VALUES ($1,$2,$3,'Dell P2422H 24\" monitor','Dell','P2422H','monitor',$4,18900,$5,$6,'added by Maya')", [newId("own"), account, self, JSON.stringify({ inputs: ["hdmi", "dp"], vesa_mount: 100 }), eightMonths, addMonths(new Date(`${eightMonths}T00:00:00Z`), 36).toISOString().slice(0, 10)]);
  await q.query("INSERT INTO owned_items (id, account_id, recipient_id, title, brand, model, category, attrs, price_cents, acquired, warranty_until, source) VALUES ($1,$2,$3,'Hush ANC Headphones','Hush','H-ANC','headphones','{}',9900,$4,$5,'receipt import')", [newId("own"), account, self, eightMonths, addMonths(new Date(`${eightMonths}T00:00:00Z`), 12).toISOString().slice(0, 10)]);
  await ensurePrior(q);
  const out: Seeded = { keys, account, self, brother, merchant: nl, products };
  await putSetting(q, "demo", JSON.stringify(out));
  return out;
}
