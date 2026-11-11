import { mkdirSync } from "node:fs";
import { config } from "./config.js";

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: "pglite" | "postgres";
}

async function openPglite(path: string | null): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (path) mkdirSync(path, { recursive: true });
  const pg = path ? new PGlite(path) : new PGlite();
  await pg.waitReady;
  // PGlite is single-connection: serialise transactions so concurrent requests don't interleave.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    kind: "pglite",
    query: async (sql, params) => ({ rows: (await pg.query(sql, params as any[])).rows as any[] }),
    exec: async (sql) => {
      await pg.exec(sql);
    },
    tx: (fn) => {
      const run = chain.then(() => pg.transaction(async (t) => fn({ query: async (s, p) => ({ rows: (await t.query(s, p as any[])).rows as any[] }) })));
      chain = run.catch(() => undefined);
      return run as any;
    },
    close: async () => {
      await pg.close();
    },
  };
}

async function openPostgres(url: string): Promise<Db> {
  const pgmod = await import("pg");
  const Pool = (pgmod as any).default?.Pool ?? (pgmod as any).Pool;
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }, max: 10 });
  return {
    kind: "postgres",
    query: async (sql, params) => ({ rows: (await pool.query(sql, params)).rows }),
    exec: async (sql) => {
      await pool.query(sql);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: async (s: string, p?: unknown[]) => ({ rows: (await client.query(s, p)).rows }) });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tz TEXT NOT NULL DEFAULT 'Asia/Singapore',
  monthly_limit_cents INTEGER NOT NULL DEFAULT 60000,
  sim_now TEXT,
  key_hash TEXT UNIQUE,
  address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channel_links (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, external_id)
);
CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'self',
  is_self BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS profile_facts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  recipient_id TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pref_models (
  recipient_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  weights JSONB NOT NULL,
  prior_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pref_events (
  id BIGSERIAL PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  intent_id TEXT,
  a_product TEXT NOT NULL,
  b_product TEXT NOT NULL,
  chosen TEXT,
  reason TEXT NOT NULL,
  eligible BOOLEAN NOT NULL,
  excluded_reason TEXT,
  weights_before JSONB,
  weights_after JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS model_artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  weights JSONB NOT NULL,
  manifest JSONB NOT NULL,
  report JSONB NOT NULL,
  promoted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('test_merchant','discovery')),
  label TEXT NOT NULL,
  caps JSONB NOT NULL,
  shipping JSONB NOT NULL,
  return_policy JSONB NOT NULL,
  key_hash TEXT
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  sku TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL,
  backorder_days INTEGER NOT NULL DEFAULT 0,
  attrs JSONB NOT NULL,
  description TEXT NOT NULL,
  warranty_months INTEGER NOT NULL DEFAULT 12,
  url TEXT,
  train_ok BOOLEAN NOT NULL
);
CREATE TABLE IF NOT EXISTS price_history (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  wall TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  url TEXT NOT NULL,
  platform TEXT NOT NULL,
  canonical TEXT NOT NULL,
  status TEXT NOT NULL,
  basis TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  objects JSONB NOT NULL DEFAULT '[]',
  selected TEXT,
  channel TEXT NOT NULL,
  flags JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, canonical)
);
CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  recipient_id TEXT NOT NULL,
  capture_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  goal TEXT NOT NULL,
  text TEXT NOT NULL,
  budget_cents INTEGER,
  deadline TEXT,
  reqs JSONB NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'planning',
  channel TEXT NOT NULL DEFAULT 'app',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES intents(id),
  version INTEGER NOT NULL,
  intent_version INTEGER NOT NULL,
  body JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current','superseded','ordered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (intent_id, version)
);
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  merchant_id TEXT NOT NULL,
  body JSONB NOT NULL,
  total_cents INTEGER NOT NULL,
  hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','approved','expired','superseded','used')),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  intent_id TEXT NOT NULL,
  quote_id TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  paypal_order_id TEXT,
  capture_id TEXT,
  gross_cents INTEGER,
  fee_cents INTEGER,
  net_cents INTEGER,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  repaired BOOLEAN NOT NULL DEFAULT false,
  attempt INTEGER NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  title TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  eta TEXT,
  delivered_at TEXT,
  opened BOOLEAN NOT NULL DEFAULT false,
  swap_offer JSONB,
  replaced_by TEXT
);
CREATE TABLE IF NOT EXISTS payment_ops (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  case_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('order','capture','refund')),
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed')),
  amount_cents INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  paypal_id TEXT,
  paypal_status TEXT,
  reason TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  line_id TEXT NOT NULL,
  issue TEXT NOT NULL,
  claim TEXT NOT NULL,
  observations JSONB NOT NULL DEFAULT '[]',
  missing JSONB NOT NULL DEFAULT '[]',
  eligibility JSONB,
  requested TEXT,
  options JSONB NOT NULL DEFAULT '[]',
  merchant_decision JSONB,
  status TEXT NOT NULL,
  refund_cents INTEGER,
  flags JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS owned_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  recipient_id TEXT,
  product_id TEXT,
  title TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  attrs JSONB NOT NULL DEFAULT '{}',
  price_cents INTEGER,
  acquired TEXT NOT NULL,
  order_line_id TEXT UNIQUE,
  return_until TEXT,
  warranty_until TEXT,
  condition TEXT NOT NULL DEFAULT 'good',
  status TEXT NOT NULL DEFAULT 'owned',
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recalls (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  title TEXT NOT NULL,
  remedy TEXT NOT NULL,
  url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS price_watches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  target_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'watching',
  fired_at TEXT,
  UNIQUE (account_id, product_id)
);
CREATE TABLE IF NOT EXISTS inbox (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  text TEXT NOT NULL,
  buttons JSONB,
  sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT,
  entity TEXT,
  entity_id TEXT,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'Everyday',
  data JSONB,
  wall TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_entity ON events(entity_id, id DESC);
CREATE TABLE IF NOT EXISTS demo_faults (id BIGSERIAL PRIMARY KEY, method TEXT NOT NULL, kind TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, resource_id TEXT, body JSONB NOT NULL, verified BOOLEAN NOT NULL, processed_at TIMESTAMPTZ, received_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS jobs_queue (
  id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, dedupe_key TEXT UNIQUE, payload JSONB NOT NULL DEFAULT '{}', run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')), attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_queue_due ON jobs_queue(status, run_at);
ALTER TABLE pref_events ADD COLUMN IF NOT EXISTS median INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS policy JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS exception TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS replacement_line_id TEXT;
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS replaces_line_id TEXT;
ALTER TABLE pref_events ADD COLUMN IF NOT EXISTS features_a JSONB;
ALTER TABLE pref_events ADD COLUMN IF NOT EXISTS features_b JSONB;
ALTER TABLE pref_events ADD COLUMN IF NOT EXISTS undone BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payment_ops ADD COLUMN IF NOT EXISTS refusal_confirmed BOOLEAN NOT NULL DEFAULT false;

-- ---------- Foundation (roadmap Part B) ----------
CREATE TABLE IF NOT EXISTS ai_calls (
  id BIGSERIAL PRIMARY KEY, purpose TEXT NOT NULL, model TEXT NOT NULL, via TEXT NOT NULL, input_hash TEXT NOT NULL, output_hash TEXT NOT NULL DEFAULT '',
  tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL, error TEXT, output JSONB, run_id TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_calls_hash ON ai_calls(input_hash, id DESC);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, agent_id TEXT, subject TEXT NOT NULL DEFAULT '', entity TEXT, entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'running', started_at TIMESTAMPTZ NOT NULL DEFAULT now(), ended_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS agent_trace (
  id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id), step INTEGER NOT NULL, actor TEXT NOT NULL, tool TEXT NOT NULL,
  args JSONB, policy TEXT, gate TEXT, result JSONB, pp_request_id TEXT, pp_debug_id TEXT, duration_ms INTEGER, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_trace_run ON agent_trace(run_id, step);
CREATE TABLE IF NOT EXISTS audit_chain (
  seq BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL, payload JSONB NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, text TEXT NOT NULL, rules JSONB NOT NULL, unexpressed JSONB NOT NULL DEFAULT '[]', compiler TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kill_switches (scope TEXT PRIMARY KEY, engaged BOOLEAN NOT NULL DEFAULT false, reason TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, action TEXT NOT NULL, payload_hash TEXT NOT NULL, payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','expired')), method TEXT, decided_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, credential_id TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS provenance (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, trust TEXT NOT NULL CHECK (trust IN ('system','paypal','owner','agent','document','message','web')), text TEXT NOT NULL,
  entity TEXT, entity_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY, channel TEXT NOT NULL, direction TEXT NOT NULL CHECK (direction IN ('in','out')), address TEXT NOT NULL, body TEXT NOT NULL, buttons JSONB,
  entity TEXT, entity_id TEXT, external_id TEXT, status TEXT NOT NULL DEFAULT 'queued', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS party_links (id TEXT PRIMARY KEY, channel TEXT NOT NULL, address TEXT NOT NULL, party TEXT NOT NULL, party_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (channel, address));
CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, party TEXT NOT NULL, party_id TEXT NOT NULL, subscription JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS judge_sessions (id TEXT PRIMARY KEY, persona TEXT NOT NULL, beat INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY, suite TEXT NOT NULL, arm TEXT NOT NULL, case_id TEXT NOT NULL, expected TEXT NOT NULL, actual TEXT NOT NULL, correct BOOLEAN NOT NULL,
  trap BOOLEAN NOT NULL DEFAULT false, naive_paid_cents INTEGER NOT NULL DEFAULT 0, ours_paid_cents INTEGER NOT NULL DEFAULT 0, cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0, detail JSONB, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eval_runs_suite ON eval_runs(suite, arm);
CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY, principal TEXT NOT NULL, agent_id TEXT NOT NULL, tool TEXT NOT NULL, args JSONB, idempotency_key TEXT, ok BOOLEAN, result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (principal, tool, idempotency_key)
);
-- ---------- Everyday widening (roadmap C.4) ----------
CREATE TABLE IF NOT EXISTS purchase_history (
  id TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL, category TEXT NOT NULL, merchant TEXT NOT NULL, price_cents INTEGER NOT NULL,
  refund_cents INTEGER NOT NULL DEFAULT 0, refund_kind TEXT, approved_by_hand BOOLEAN NOT NULL DEFAULT true, repeat BOOLEAN NOT NULL DEFAULT false, note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vault_tokens (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, setup_token TEXT, payment_token TEXT, customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked','failed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS repeat_buys (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, product_id TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1, amount_cents INTEGER NOT NULL, request_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','held','paid','failed','denied')), paypal_order_id TEXT, capture_id TEXT, order_id TEXT, note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY, paypal_id TEXT UNIQUE NOT NULL, capture_id TEXT, order_id TEXT, status TEXT NOT NULL, reason TEXT, amount_cents INTEGER,
  evidence_pack JSONB, evidence_sent_at TIMESTAMPTZ, due_at TIMESTAMPTZ, synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trackers (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, line_id TEXT, carrier TEXT NOT NULL, tracking_number TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'SHIPPED',
  paypal_status TEXT, request_id TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channel3_cache (
  query TEXT PRIMARY KEY, results JSONB NOT NULL, source TEXT NOT NULL, fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Keys for the phone app and the browser extension: one per device, shown once, stored hashed, revocable.
CREATE TABLE IF NOT EXISTS device_keys (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, label TEXT NOT NULL, client TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ
);
ALTER TABLE captures ADD COLUMN IF NOT EXISTS signal JSONB;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS reader TEXT NOT NULL DEFAULT 'rules';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS paypal_payer_id TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS paypal_email TEXT;
ALTER TABLE intents ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS run_id TEXT;
-- A2.1: how the order was paid: on PayPal's own approval page, or from the demo's saved sandbox wallet.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_via TEXT;
-- ---------- A1: a private demo workspace for every visitor ----------
-- A workspace is a shopper account plus its own copy of the shops and catalog (stock and prices change in a demo).
-- Rows with ws_id NULL are the workspace-less world of the unit tests and 'npm run seed'.
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, account_id TEXT, merchant_id TEXT, kind TEXT NOT NULL DEFAULT 'visitor' CHECK (kind IN ('visitor','showcase')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '48 hours',
  ip_hash TEXT, seed_version INTEGER NOT NULL DEFAULT 1, seed_state TEXT NOT NULL DEFAULT 'seeding' CHECK (seed_state IN ('seeding','ready','failed')),
  seed_detail TEXT, seeded JSONB, join_token TEXT UNIQUE, checklist JSONB NOT NULL DEFAULT '{}', progress JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS workspaces_ip ON workspaces(ip_hash, created_at);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ws_id TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS ws_id TEXT;
CREATE INDEX IF NOT EXISTS accounts_ws ON accounts(ws_id);
CREATE INDEX IF NOT EXISTS merchants_ws ON merchants(ws_id);
-- Tables that hang off neither an account nor a merchant carry the workspace themselves.
ALTER TABLE demo_faults ADD COLUMN IF NOT EXISTS ws_id TEXT;
ALTER TABLE purchase_history ADD COLUMN IF NOT EXISTS ws_id TEXT;
ALTER TABLE audit_chain ADD COLUMN IF NOT EXISTS ws_id TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS ws_id TEXT;
ALTER TABLE agent_requests ADD COLUMN IF NOT EXISTS ws_id TEXT;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS ws_id TEXT;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS ws_id TEXT;
CREATE INDEX IF NOT EXISTS agent_runs_ws ON agent_runs(ws_id, started_at DESC);
CREATE INDEX IF NOT EXISTS audit_chain_ws ON audit_chain(ws_id, seq DESC);
-- Every shop in every workspace sells the same SKUs; each workspace numbers its own orders from EV-4001.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_merchant_sku ON products(merchant_id, sku);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS orders_account_number ON orders(account_id, number);
-- Which workspace a PayPal object belongs to, written when the object is created (for events that don't echo custom_id).
CREATE TABLE IF NOT EXISTS paypal_refs (resource_id TEXT PRIMARY KEY, ws_id TEXT, kind TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- A4: a demo account's quote runs out on its own demo clock (wall time, "YYYY-MM-DDTHH:MM"), not the server's.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expires_wall TEXT;
`;

let shared: Db | null = null;

export async function openDb(opts: { memory?: boolean } = {}): Promise<Db> {
  const db = opts.memory ? await openPglite(null) : config.databaseUrl ? await openPostgres(config.databaseUrl) : await openPglite(config.pglitePath);
  await db.exec(SCHEMA);
  return db;
}

export async function getDb(): Promise<Db> {
  if (!shared) shared = await openDb();
  return shared;
}

export function setDb(db: Db) {
  shared = db;
}
