/**
 * A5.3/A8: PayPal's own hosted MCP server (sandbox: https://mcp.sandbox.paypal.com, SSE transport at /sse) as read
 * tools for Everyday's agent. The access token is minted from this app's client id and secret, and never logged.
 *
 * Only id-based reads are allowed. PayPal's server also offers writes (create_order, pay_order, create_refund,
 * accept_dispute_claim, ...): they are not in READ_TOOLS, so no call to them can be made from here. list_transactions
 * is left out too: it would show every visitor's and every app's payments on the shared sandbox account. The agent
 * passes a record of the shopper's own; the caller maps it to a PayPal id after checking it belongs to them.
 */
import { config } from "../config.js";

export const PAYPAL_MCP_URL = (process.env.PAYPAL_MCP_URL || (config.paypal.env === "live" ? "https://mcp.paypal.com" : "https://mcp.sandbox.paypal.com")).replace(/\/$/, "");
export const READ_TOOLS = ["get_order", "get_refund", "get_dispute", "get_shipment_tracking"] as const;
export type ReadTool = (typeof READ_TOOLS)[number];

let fetchImpl: typeof fetch | null = null;
export function setPayPalMcpFetch(f: typeof fetch | null) {
  fetchImpl = f;
}
const f = () => fetchImpl ?? fetch;
export const paypalMcpReady = () => Boolean(config.paypal.clientId && config.paypal.clientSecret);

let token: { value: string; until: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const base = config.paypal.env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const res = await f()(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`PayPal token ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 600) - 120) * 1000 };
  return token.value;
}

/** One MCP session over SSE: open the stream, read the endpoint, initialize, call one tool, close. */
export async function callPayPalTool(name: ReadTool, args: Record<string, unknown>, timeoutMs = 15_000): Promise<{ text: string; json: unknown; ms: number }> {
  if (!(READ_TOOLS as readonly string[]).includes(name)) throw new Error(`${name} is not a read tool Everyday allows`);
  if (!paypalMcpReady()) throw new Error("PayPal credentials are not configured");
  const t0 = Date.now();
  const auth = { Authorization: `Bearer ${await accessToken()}` };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await f()(`${PAYPAL_MCP_URL}/sse`, { headers: { ...auth, accept: "text/event-stream" }, signal: ac.signal });
    if (!res.ok || !res.body) throw new Error(`PayPal MCP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const waiters = new Map<number, (j: any) => void>();
    let endpoint: (v: string) => void = () => {};
    const ep = new Promise<string>((r) => (endpoint = r));
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(chunk)?.[1];
            const data = chunk.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
            if (ev === "endpoint") endpoint(data);
            else if (data)
              try {
                const j = JSON.parse(data);
                waiters.get(j.id)?.(j);
              } catch {
                /* not JSON-RPC */
              }
          }
        }
      } catch {
        /* aborted */
      }
    })();
    const path = await ep;
    const post = (body: unknown) => f()(`${PAYPAL_MCP_URL}${path}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
    const rpc = async (id: number, method: string, params: unknown) => {
      const p = new Promise<any>((r) => waiters.set(id, r));
      const r = await post({ jsonrpc: "2.0", id, method, params });
      if (r.status >= 300) throw new Error(`PayPal MCP ${method} ${r.status}`);
      return p;
    };
    await rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "everyday", version: "1" } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    const out = await rpc(2, "tools/call", { name, arguments: args });
    if (out.error) throw new Error(`PayPal MCP: ${String(out.error.message ?? "error").slice(0, 160)}`);
    const text = (out.result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (out.result?.isError) throw new Error(`PayPal MCP ${name}: ${text.slice(0, 160)}`);
    return { text: text.slice(0, 6000), json, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}
