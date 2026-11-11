/**
 * A5.3: POST /api/ui/ask streams the agent's work to the browser as server-sent events (one `data:` line per step),
 * so the AI work rail fills in while the agent runs. A signed-in shopper only; 30 questions an hour per shopper.
 */
import { Router } from "express";
import { ask, TOOLS, MAX_STEPS, MAX_MS, type AgentEvent } from "../ai/agent.js";
import { hasOpenAI } from "../ai/provider.js";
import { config } from "../config.js";
import { paypalMcpReady, READ_TOOLS, PAYPAL_MCP_URL } from "../paypal/mcp.js";
import { tick } from "../services/checklist.js";
import { whoami } from "./auth.js";
import { getDb } from "../db.js";

const asked = new Map<string, number[]>();

export function askRoutes() {
  const r = Router();

  r.get("/api/ui/ask/tools", (_req, res) => {
    res.json({
      model: config.ai.models.read,
      backup: config.ai.models.backup,
      ready: hasOpenAI(),
      max_steps: MAX_STEPS,
      max_seconds: MAX_MS / 1000,
      tools: TOOLS.map((t) => ({ name: t.name, kind: t.kind, source: t.source, description: t.description })),
      paypal: { url: PAYPAL_MCP_URL, ready: paypalMcpReady(), allowed: READ_TOOLS },
    });
  });

  r.post("/api/ui/ask", async (req, res, next) => {
    try {
      const w = await whoami(req);
      if (!w?.account) return res.status(401).json({ error: "unauthorized", message: "Sign in first." });
      const question = String(req.body?.question ?? "").trim().slice(0, 1000);
      if (!question) return res.status(400).json({ error: "bad_request", message: "Type a question first." });
      const now = Date.now();
      const xs = (asked.get(w.account.id) ?? []).filter((t) => now - t < 3_600_000);
      if (xs.length >= 30) return res.status(429).json({ error: "rate_limited", message: "That's 30 questions this hour. Try again later." });
      xs.push(now);
      asked.set(w.account.id, xs);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
      const send = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
      try {
        const runId = await ask(w.account, question, send);
        const db = await getDb();
        const steps = runId ? Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM agent_trace WHERE run_id = $1 AND actor <> 'model'", [runId])).rows[0]?.n ?? 0) : 0;
        if (steps >= 2) await tick("ask_answered", { run_id: runId, steps });
      } catch {
        /* the error event was already sent */
      }
      res.end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}
