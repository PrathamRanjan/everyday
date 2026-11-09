/**
 * MCP endpoint (roadmap E4): /mcp is the shopper's agent, Bearer <Everyday access key> (the shopper's own key,
 * shown on /demo in demo mode). Stateless Streamable HTTP; every tool call is recorded in agent_requests and
 * refused while the shopper's or the agent's kill switch is engaged.
 */
import { Router } from "express";
import { getDb } from "../db.js";
import { accountById } from "../store.js";
import { keyLogin } from "./auth.js";
import { agentIdOf, serveMcp } from "../mcp/http.js";
import { buildMerchantServer, buildShopperServer } from "../mcp/tools.js";

function bearer(req: { header(n: string): string | undefined }): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  return m ? m[1] : null;
}

export function mcpRoutes() {
  const r = Router();
  r.all("/mcp", async (req, res) => {
    const key = bearer(req);
    const v = key ? await keyLogin(key) : null;
    if (!v) return res.status(401).json({ error: "unauthorized", message: "Bearer <Everyday access key> required. Keys are shown on /demo in demo mode." });
    if (!v.startsWith("acc:")) return res.status(403).json({ error: "forbidden", message: "The shopping agent needs a shopper's key, not the merchant's." });
    const account = await accountById(await getDb(), v.slice(4)).catch(() => null);
    if (!account) return res.status(401).json({ error: "unauthorized", message: "Unknown shopper." });
    await serveMcp(req, res, () => buildShopperServer(account, agentIdOf(req)));
  });
  // Merchant's read-only agent: Bearer <merchant key>. Lets a merchant's agent watch orders, cases, approvals and
  // disputes; it cannot ship, refund or decide anything.
  r.all("/merchant/mcp", async (req, res) => {
    const key = bearer(req);
    const v = key ? await keyLogin(key) : null;
    if (!v) return res.status(401).json({ error: "unauthorized", message: "Bearer <Everyday merchant key> required. Keys are shown on /demo in demo mode." });
    if (!v.startsWith("mer:")) return res.status(403).json({ error: "forbidden", message: "This endpoint needs the merchant's key, not a shopper's." });
    const m = (await (await getDb()).query<any>("SELECT id, name FROM merchants WHERE id = $1", [v.slice(4)])).rows[0];
    if (!m) return res.status(401).json({ error: "unauthorized", message: "Unknown merchant." });
    await serveMcp(req, res, () => buildMerchantServer(m, agentIdOf(req)));
  });
  return r;
}
