/**
 * Structural safety tests (roadmap B.3), Everyday edition.
 *  1. AI modules never import the PayPal client; PayPal code never imports AI.
 *  2. Every schema handed to the provider is free of money and PayPal id fields.
 *  3. No configured secret reaches a model input.
 *  4. Every PayPal write in the services runs behind the gate.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeSchema, setProviderFetch, structured } from "../src/ai/provider.js";
import { config } from "../src/config.js";

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("structural safety", () => {
  it("AI modules never import payment code and payment code never imports AI", () => {
    for (const f of walk("src/ai")) {
      const src = readFileSync(f, "utf8");
      // One exception, and only for reading: the assistant asks PayPal's MCP server through src/paypal/mcp.ts, which
      // allows four get_ tools and imports nothing that can create, capture or refund (checked below).
      const paypalImports = [...src.matchAll(/from "\.\.?\/(?:\.\.\/)?paypal\/([a-z]+)\.js"/g)].map((m) => m[1]);
      expect(paypalImports.filter((m) => !(f.endsWith("agent.ts") && m === "mcp")), `${f} imports paypal`).toEqual([]);
      expect(src, `${f} imports the mandate`).not.toMatch(/from "\.\.\/guard\/policy\.js"/);
    }
    for (const f of walk("src/paypal")) expect(readFileSync(f, "utf8"), `${f} imports ai`).not.toMatch(/from "\.\.?\/ai\//);
    const mcp = readFileSync("src/paypal/mcp.ts", "utf8");
    expect(mcp, "the read-only PayPal MCP client imports the payment client").not.toMatch(/from "\.\/(client|index|fake)\.js"/);
    expect(mcp).toMatch(/READ_TOOLS = \["get_order", "get_refund", "get_dispute", "get_shipment_tracking"\]/);
  });

  it("rejects schemas with money or PayPal id fields", () => {
    expect(() => assertSafeSchema({ type: "object", properties: { amount_cents: { type: "integer" } } })).toThrow();
    expect(() => assertSafeSchema({ type: "object", properties: { capture_id: { type: "string" } } })).toThrow();
    expect(() => assertSafeSchema({ type: "object", properties: { nested: { type: "object", properties: { refund_amount: { type: "number" } } } } })).toThrow();
    expect(() => assertSafeSchema({ type: "object", properties: { label: { type: "string" }, price_seen: { type: ["number", "null"] } } })).not.toThrow();
  });

  it("every schema used in src passes the safety check", () => {
    let found = 0;
    for (const f of walk("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/properties:\s*\{/g)) {
        found++;
        const slice = src.slice(m.index!, m.index! + 4000);
        expect(slice, `${f} has a forbidden field name in a schema`).not.toMatch(/\b(amount_cents|fee_cents|capture_id|refund_id|order_id|payment_token_id|payer_id|invoice_id)\s*:\s*\{/);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("no configured secret reaches the model", async () => {
    const sentinel = "SENTINEL-" + Math.random().toString(36).slice(2);
    const saved = { ...config.paypal };
    const savedAi = { provider: config.ai.provider, key: config.ai.openaiKey };
    (config.paypal as any).clientSecret = sentinel;
    (config as any).ai.provider = "openai";
    (config as any).ai.openaiKey = "sk-test";
    let body = "";
    setProviderFetch((async (_i: any, init: any) => {
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ model: "m", output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    }) as any);
    try {
      await structured<any>({ purpose: "eval", tier: "classify", system: "test", parts: [{ type: "text", text: "hello" }], schemaName: "t", schema: { type: "object", properties: { ok: { type: "boolean" } } }, allowReplay: false });
      expect(body).not.toContain(sentinel);
      expect(body).not.toContain(config.sessionSecret);
      expect(body).not.toContain("sk-test");
    } finally {
      setProviderFetch(null);
      Object.assign(config.paypal, saved);
      (config as any).ai.provider = savedAi.provider;
      (config as any).ai.openaiKey = savedAi.key;
    }
  });

  it("every PayPal write in the services is preceded by the gate in the same function", () => {
    const writes = /paypal\(\)\.(createOrder|captureOrder|refundCapture|createVaultedCaptureOrder|addTracking|provideDisputeEvidence|acceptDisputeClaim)\(/g;
    for (const f of walk("src/services")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(writes)) {
        const before = src.slice(Math.max(0, m.index! - 6000), m.index!);
        const fnStart = Math.max(before.lastIndexOf("export async function"), before.lastIndexOf("\nasync function"));
        const scope = before.slice(fnStart);
        expect(scope, `${f}: ${m[1]} is not behind the gate`).toMatch(/\b(gate|gated|dryRun)\(/);
      }
    }
  });
});
