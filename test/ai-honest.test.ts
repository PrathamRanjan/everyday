import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { AI_FAILED_SENTENCE, AiFailed, MIN_OUTPUT_TOKENS, setProviderFetch, structured } from "../src/ai/provider.js";
import { seed, type Seeded } from "../src/services/seed.js";
import { Client } from "./client.js";

// A11, A5.1, A5.4, A5.5: the model chain is primary -> one repair -> backup -> stop; no rules or replayed answer
// stands in for a reading outside the tests; a failed reading shows the honest sentence, a retry and the manual form;
// production refuses to start without its keys.

let db: Db;
let s: Seeded;
let server: Server;
let base: string;
const saved = { provider: config.ai.provider, key: config.ai.openaiKey, rules: config.ai.rulesReader, demo: config.demoMode };

type Reply = { text?: string; status?: number };
/** A fake Responses endpoint: each call takes the next reply; records the bodies sent. */
function fakeChain(replies: Reply[]) {
  const calls: any[] = [];
  setProviderFetch((async (_url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r.status && r.status !== 200) return new Response("boom", { status: r.status });
    return new Response(JSON.stringify({ model: body.model, usage: { input_tokens: 5, output_tokens: 5 }, output: [{ type: "message", content: [{ type: "output_text", text: r.text ?? "{}" }] }] }), { status: 200 });
  }) as typeof fetch);
  return calls;
}
const call = () => structured<any>({ purpose: "read_request", tier: "read", system: "s", parts: [{ type: "text", text: "a lamp" }], schemaName: "x", schema: { type: "object", properties: { word: { type: "string" } } } });

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  s = await db.tx((q) => seed(q, { anchor: "2026-11-09T09:00" }));
  config.ai.provider = "openai";
  config.ai.openaiKey = "test-key";
  config.demoMode = true;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.close();
  setProviderFetch(null);
  Object.assign(config.ai, { provider: saved.provider, openaiKey: saved.key, rulesReader: saved.rules });
  config.demoMode = saved.demo;
  await db.close();
});

describe("A5.1/A5.4 the model chain", () => {
  it("uses gpt-6.1-sol with at least 4,000 output tokens and low effort", async () => {
    const calls = fakeChain([{ text: '{"word":"lamp"}' }]);
    const r = await call();
    expect(r).toMatchObject({ model: "gpt-6.1-sol", via: "primary", output: { word: "lamp" } });
    expect(calls[0]).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "low" } });
    expect(calls[0].max_output_tokens).toBeGreaterThanOrEqual(MIN_OUTPUT_TOKENS);
    expect(config.ai.models).toMatchObject({ read: "gpt-6.1-sol", backup: "gpt-6-sol", classify: "gpt-6-luna", transcribe: "gpt-transcribe" });
  });
  it("broken JSON gets one repair attempt with the same model", async () => {
    const calls = fakeChain([{ text: '{"word":"la' }, { text: '{"word":"lamp"}' }]);
    const r = await call();
    expect(r.via).toBe("repair");
    expect(calls.map((c) => c.model)).toEqual(["gpt-6.1-sol", "gpt-6.1-sol"]);
    expect(JSON.stringify(calls[1].input)).toContain("Return valid JSON for this schema");
  });
  it("then the backup model, then it stops with the honest failure (no replay)", async () => {
    fakeChain([{ text: '{"word":"lamp"}' }]);
    await call(); // a good answer to the same input exists now; it must not be replayed below
    const calls = fakeChain([{ text: "nope" }, { text: "still nope" }, { text: '{"word":"lamp"}' }]);
    expect((await call()).via).toBe("backup");
    expect(calls.map((c) => c.model)).toEqual(["gpt-6.1-sol", "gpt-6.1-sol", "gpt-6-sol"]);
    fakeChain([{ status: 400 }]);
    const e = await call().catch((x) => x);
    expect(e).toBeInstanceOf(AiFailed);
    expect(e.message).toBe(AI_FAILED_SENTENCE);
    const rows = (await db.query<any>("SELECT via, ok FROM ai_calls ORDER BY id DESC LIMIT 2")).rows;
    expect(rows.every((r) => !r.ok) && rows.every((r) => r.via !== "replay")).toBe(true);
  });
});

describe("A11/A5.5 what the shopper sees when the model fails", () => {
  it("the honest sentence (no raw error, no rules reading), then the manual form makes the plan", async () => {
    config.ai.rulesReader = false;
    fakeChain([{ status: 400 }]);
    const maya = new Client(base);
    expect((await maya.post("/login", { as: `acc:${s.account}` })).status).toBe(302);
    const before = (await db.query<any>("SELECT count(*)::int AS n FROM intents")).rows[0].n;
    const r = await maya.post("/plans", { text: "sweat-proof wireless earbuds for running, under $80" });
    const err = decodeURIComponent(new URL(r.location!, base).searchParams.get("err") ?? "");
    expect(err).toBe(AI_FAILED_SENTENCE);
    expect(err).not.toMatch(/gpt|OpenAI|JSON|400/);
    expect((await db.query<any>("SELECT count(*)::int AS n FROM intents")).rows[0].n).toBe(before);
    // The manual form: every field chosen by the person; the plan says no model read it.
    const m = await maya.post("/plans", { manual: "1", text: "sweat-proof wireless earbuds for running, under $80", category: "headphones", budget: "80", by: "2026-11-20", must: "sweat-proof, wireless" });
    expect(m.status).toBe(302);
    const id = new URL(m.location!, base).pathname.split("/").pop()!;
    const view = (await maya.get(`/api/ui/plans/${id}`)).json;
    expect(view.intent).toMatchObject({ budget_cents: 8000, deadline: "2026-11-20" });
    expect(view.intent.read).toMatchObject({ reader: "manual", model: null });
    expect(msgOf(await maya.post("/plans", { manual: "1", category: "toaster" }), "err")).toBe("Pick what kind of item it is.");
  });
});

describe("A11 production refuses to start without its keys", () => {
  it("exits with the missing names, and never prints a value", () => {
    const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", RENDER: "true", PAYPAL_CLIENT_ID: "cid-should-not-print", PGLITE_PATH: "memory://" };
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], { env, encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refusing to start in production: missing OPENAI_API_KEY, AI_PROVIDER=openai, PAYPAL_CLIENT_SECRET/);
    expect(r.stderr + r.stdout).not.toContain("cid-should-not-print");
  });
});

const msgOf = (r: { location: string | null }, k: "ok" | "err") => decodeURIComponent(new URL(r.location!, base).searchParams.get(k) ?? "");
