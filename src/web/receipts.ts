/**
 * B6: receipts in. POST /api/ui/receipts/read reads a pasted order email or a receipt photo (a data URL, shrunk in
 * the browser); nothing is saved until the shopper confirms with POST /api/ui/receipts/save. 20 reads an hour per
 * shopper. A failed reading says so and the page offers the same form to fill in by hand.
 */
import express, { Router } from "express";
import { AiFailed } from "../ai/provider.js";
import { GtError } from "../lib/util.js";
import { readReceipt, SAMPLE_RECEIPT, saveReceipt, type SaveLine } from "../services/receipts.js";
import { whoami } from "./auth.js";

const reads = new Map<string, number[]>();

export function receiptRoutes() {
  const r = Router();
  r.get("/api/ui/receipts/sample", (_req, res) => res.json({ text: SAMPLE_RECEIPT }));

  r.post("/api/ui/receipts/read", express.json({ limit: "6mb" }), async (req, res) => {
    try {
      const w = await whoami(req);
      if (!w?.account) return res.status(401).json({ error: "unauthorized", message: "Sign in first." });
      const now = Date.now();
      const xs = (reads.get(w.account.id) ?? []).filter((t) => now - t < 3_600_000);
      if (xs.length >= 20) return res.status(429).json({ error: "rate_limited", message: "That's 20 receipts this hour. Fill this one in by hand, or try later." });
      xs.push(now);
      reads.set(w.account.id, xs);
      let image: { mime: string; body: Buffer } | undefined;
      const url = String(req.body?.image ?? "");
      if (url) {
        const m = url.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (!m) return res.status(400).json({ error: "invalid", message: "That photo isn't a JPEG, PNG or WebP image." });
        image = { mime: m[1], body: Buffer.from(m[2], "base64") };
        if (image.body.length > 4_500_000) return res.status(413).json({ error: "too_large", message: "That photo is too large. Try a smaller one." });
      }
      const reading = await readReceipt({ text: String(req.body?.text ?? ""), image });
      res.json({ reading });
    } catch (e) {
      if (e instanceof AiFailed) return res.status(422).json({ error: "ai_failed", message: e.message, manual: true });
      if (e instanceof GtError) return res.status(e.status ?? 400).json({ error: e.code, message: e.message });
      res.status(500).json({ error: "server", message: "Something went wrong reading that receipt." });
    }
  });

  r.post("/api/ui/receipts/save", async (req, res) => {
    try {
      const w = await whoami(req);
      if (!w?.account) return res.status(401).json({ error: "unauthorized", message: "Sign in first." });
      const lines = (Array.isArray(req.body?.lines) ? req.body.lines : []) as SaveLine[];
      const out = await saveReceipt(w.account, lines, req.body?.how === "model" ? "model" : "manual");
      res.json(out);
    } catch (e) {
      if (e instanceof GtError) return res.status(e.status ?? 400).json({ error: e.code, message: e.message });
      res.status(500).json({ error: "server", message: "Something went wrong saving that receipt." });
    }
  });
  return r;
}
