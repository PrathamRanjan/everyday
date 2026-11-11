import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/ai/agent.js";
import { READ_TOOLS } from "../src/paypal/mcp.js";
import { MERCHANT_MCP_TOOLS, SHOPPER_MCP_TOOLS, rolesData } from "../src/web/public.js";
import { PATHS } from "../src/web/judge.js";
import { STEPS } from "../src/services/checklist.js";

/** A5.3: the assistant can read and propose; nothing it holds can move money. */
describe("assistant tools", () => {
  it("has only read and propose tools, and none named like a money action", () => {
    for (const t of TOOLS) {
      expect(["read", "propose"]).toContain(t.kind);
      if (t.source === "everyday") expect(t.name).not.toMatch(/(^|_)(pay|capture|charge|payout|transfer|buy|approve|refund)(_|$)/i);
      else expect(t.kind, `${t.name} reads PayPal`).toBe("read");
    }
    const propose = TOOLS.filter((t) => t.kind === "propose").map((t) => t.name);
    expect(propose).toEqual(["propose_plan"]);
  });

  it("asks PayPal's MCP server only for read tools", () => {
    expect([...READ_TOOLS].sort()).toEqual(["get_dispute", "get_order", "get_refund", "get_shipment_tracking"]);
    for (const n of READ_TOOLS) expect(n).toMatch(/^get_/);
    const src = readFileSync("src/paypal/mcp.ts", "utf8");
    // The client refuses any tool not on the list before it opens a session.
    expect(src).toMatch(/READ_TOOLS[^\n]*\.includes\(name\)/);
  });

  it("the agent source never reaches the PayPal client's write calls", () => {
    const src = readFileSync("src/ai/agent.ts", "utf8");
    expect(src).not.toMatch(/\b(captureOrder|refundCapture|createOrder|payFromDemoWallet|approveQuote|refund\()\b/);
  });
});

describe("public roles table", () => {
  it("lists the MCP tools exactly as the server registers them", () => {
    const src = readFileSync("src/mcp/tools.ts", "utf8");
    const [shopper, merchant] = src.split("export function buildMerchantServer");
    const names = (s: string) => [...s.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(names(shopper)).toEqual(SHOPPER_MCP_TOOLS);
    expect(names(merchant)).toEqual(MERCHANT_MCP_TOOLS);
  });
  it("names every assistant tool on the roles page", () => {
    const text = JSON.stringify(rolesData());
    for (const t of TOOLS) expect(text).toContain(t.name);
  });
});

describe("judge paths", () => {
  it("every step is a checklist event the server records", () => {
    for (const p of PATHS) for (const s of p.steps) expect(Object.keys(STEPS)).toContain(s.key);
  });
  it("one path needs no PayPal login and is under three minutes", () => {
    expect(PATHS.some((p) => p.no_login && p.minutes <= 3)).toBe(true);
  });
});
