import { Router, type Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { GtError } from "../lib/util.js";
import { getDb } from "../db.js";
import { addWorkDays, fmtWall, wallIso } from "../core/time.js";
import { armFault } from "../paypal/index.js";
import { accountById, J, nowIso, nowOf, setting } from "../store.js";
import { handleTelegram } from "../services/captures.js";
import { setPrice } from "../services/life.js";
import { backorderLine, deliverLine, merchantDecide, reconcile, shipLine, verifyRefunds } from "../services/orders.js";
import { currentWs } from "../ws.js";
import { evalRows } from "../eval/store.js";
import { runTechjam } from "../core/techjam.js";
import { runAdversarial } from "../eval/adversarial.js";
import { runCaptureEval } from "../eval/capture.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { demoOnly, merchant } from "./auth.js";
import { back } from "./common.js";

export function opsRoutes() {
  const r = Router();

  const owns = async (mId: string, lineId: string) => (await (await getDb()).query("SELECT 1 FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE l.id = $1 AND o.merchant_id = $2", [lineId, mId])).rows.length > 0;
  r.post("/merchant/lines/:id/ship", merchant(async (req, res, m) => {
    if (!(await owns(m.id, req.params.id))) return res.status(404).send("Not found");
    await shipLine(req.params.id);
    back(res, "/merchant", "Shipped.");
  }, true));
  r.post("/merchant/lines/:id/deliver", merchant(async (req, res, m) => {
    if (!(await owns(m.id, req.params.id))) return res.status(404).send("Not found");
    await deliverLine(req.params.id, String(req.body.note ?? ""));
    back(res, "/merchant", "Delivered.");
  }, true));
  r.post("/merchant/lines/:id/backorder", merchant(async (req, res, m) => {
    if (!(await owns(m.id, req.params.id))) return res.status(404).send("Not found");
    const out = await backorderLine(req.params.id, Math.max(1, Number(req.body.days) || 4));
    back(res, "/merchant", `Backordered to ${out.eta}${out.offer ? `; swap offered: ${out.offer.title}` : ""}.`);
  }, true));
  r.post("/merchant/cases/:id", merchant(async (req, res, m) => {
    const db = await getDb();
    const ok = (await db.query("SELECT 1 FROM cases c JOIN orders o ON o.id = c.order_id WHERE c.id = $1 AND o.merchant_id = $2", [req.params.id, m.id])).rows.length;
    if (!ok) return res.status(404).send("Not found");
    await merchantDecide(req.params.id, req.body.approve === "1", String(req.body.note ?? ""));
    back(res, "/merchant#cases", "Decision recorded.");
  }, true));
  r.post("/merchant/products/:id/price", merchant(async (req, res, m) => {
    const db = await getDb();
    const p = (await db.query<any>("SELECT * FROM products WHERE id = $1 AND merchant_id = $2", [req.params.id, m.id])).rows[0];
    if (!p) return res.status(404).send("Not found");
    // The shop's own shopper in this workspace sets the demo clock the price change is recorded at.
    const acc = (await db.query<any>("SELECT * FROM accounts WHERE ws_id IS NOT DISTINCT FROM $1 ORDER BY created_at LIMIT 1", [currentWs()])).rows[0];
    const n = await setPrice(p.id, Math.round(Number(req.body.price) * 100), acc ? nowIso(await accountById(db, acc.id)) : wallIso(new Date()));
    back(res, "/merchant#catalog", `Price recorded${n ? `; ${n} shopper(s) notified (price watches and price protection)` : ""}.`);
  }, true));
  // ---- Eval explorer (roadmap B.4): every eval row, sliced by suite, arm, outcome and trap, with CSV ----
  const sliceRows = async (req: Request) => {
    const suite = typeof req.query.suite === "string" ? req.query.suite : "capture";
    const arm = typeof req.query.arm === "string" ? req.query.arm : undefined;
    const outcome = typeof req.query.outcome === "string" ? req.query.outcome : undefined;
    const trap = typeof req.query.trap === "string" ? req.query.trap : undefined;
    const all = await evalRows(suite, 3000);
    const kindOf = (x: any) => x.detail?.trap_kind ?? x.detail?.kind ?? null;
    const rows = all.filter((x: any) => (!arm || x.arm === arm) && (!outcome || (outcome === "correct") === Boolean(x.correct)) && (!trap || (trap === "trap" ? x.trap : trap === "plain" ? !x.trap : kindOf(x) === trap)));
    return { suite, arm, outcome, trap, all, rows, kindOf };
  };
  r.get("/console/eval.csv", demoOnly(async (req, res) => {
    const { suite, rows } = await sliceRows(req);
    const cols = ["id", "arm", "case_id", "expected", "actual", "correct", "trap", "naive_paid_cents", "ours_paid_cents", "latency_ms", "at"];
    const cell = (v: unknown) => { const t = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    res.type("text/csv").set("Content-Disposition", `attachment; filename="everyday-eval-${suite}.csv"`).send([cols.join(","), ...rows.map((x: any) => cols.map((c) => cell(x[c])).join(","))].join("\n"));
  }));
  r.get("/llms.txt", (_req, res) => {
    res.type("text/plain").send(`# Everyday
A shopping agent that buys for a person inside the mandate they set, approves every purchase on PayPal, and a merchant desk that ships, handles cases and disputes under its own refund ceiling.

MCP shopper agent (Streamable HTTP, stateless): ${config.appUrl}/mcp with Authorization: Bearer <shopper key>.
MCP merchant agent (read-only): ${config.appUrl}/merchant/mcp with Authorization: Bearer <merchant key>.
Skill: ${config.appUrl}/skill.md
Runs API: ${config.appUrl}/api/v1/runs
Evidence: ${config.appUrl}/console/evidence · eval explorer ${config.appUrl}/console/eval · judge ${config.appUrl}/judge

Guarantees: amounts come from the catalog and quotes, never from text; a quote hash must match before approval; every money move is dry-run against kill switches, the mandate, the monthly limit, the refund ceiling and live PayPal state; held moves wait for a click or passkey.
`);
  });
  r.get("/skill.md", (_req, res) => {
    try {
      res.type("text/markdown").send(readFileSync("skill/SKILL.md", "utf8").replace(/\{APP_URL\}/g, config.appUrl));
    } catch {
      res.status(404).type("text/plain").send("No skill file.");
    }
  });
  r.post("/console/eval", demoOnly(async (req, res) => {
    const suite = String(req.body.suite ?? "");
    const db = await getDb();
    if (suite === "capture") {
      const r2 = await runCaptureEval();
      writeFileSync("eval/capture.md", r2.markdown);
    } else if (suite === "adversarial") {
      const acc = (await db.query<any>("SELECT id FROM accounts WHERE ws_id IS NOT DISTINCT FROM $1 ORDER BY created_at LIMIT 1", [currentWs()])).rows[0]?.id;
      const ord = (await db.query<any>("SELECT id FROM orders WHERE capture_id IS NOT NULL AND account_id = $1 ORDER BY created_at DESC LIMIT 1", [acc ?? ""])).rows[0]?.id ?? null;
      if (!acc) throw new GtError("Seed the demo first", "bad_state", 409);
      const r2 = await runAdversarial(acc, ord);
      writeFileSync("eval/adversarial.md", r2.markdown);
      if (r2.leaked.length) return back(res, "/console/evidence", `LEAK: ${r2.leaked.length} case(s) were allowed`, true);
    } else if (suite === "techjam") {
      const manifest = JSON.parse(readFileSync("eval/techjam-heldout.json", "utf8"));
      writeFileSync("eval/techjam.md", runTechjam(manifest.seeds, manifest.per_seed).markdown);
    } else throw new GtError("Unknown suite", "validation", 422);
    back(res, "/console/evidence", `${suite} eval done`);
  }, true));
  r.get(["/console/capture.md", "/console/adversarial.md", "/console/techjam.md"], demoOnly(async (req, res) => {
    const f = `eval/${req.path.split("/").pop()}`;
    if (!existsSync(f)) throw new GtError("Not run yet", "not_found", 404);
    res.type("text/markdown").send(readFileSync(f, "utf8"));
  }));

  r.post("/console/fault", demoOnly(async (req, res) => {
    const f = String(req.body.f);
    if (f === "drop_return") await (await getDb()).query("INSERT INTO demo_faults (method, kind, ws_id) VALUES ('paypal_return','drop',$1)", [currentWs()]);
    if (f === "capture_lost") await armFault("captureOrder", "lose_response");
    if (f === "refund_503") await armFault("refundCapture", "fail_503");
    back(res, "/console#lab", `Armed: ${f.replace(/_/g, " ")}.`);
  }, true));
  r.post("/console/run", demoOnly(async (_req, res) => {
    const n = await reconcile();
    await verifyRefunds();
    back(res, "/console#lab", `Reconciled ${n} order(s); refunds verified.`);
  }, true));

  // ---------- Telegram: real webhook and a simulator that posts the same updates ----------
  r.post("/c/telegram/webhook", async (req, res) => {
    const want = config.telegram.webhookSecret;
    const got = String(req.header("x-telegram-bot-api-secret-token") ?? "");
    if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return res.status(401).json({ ok: false });
    await handleTelegram(req.body).catch((e) => console.error("[telegram]", (e as Error).message));
    res.json({ ok: true });
  });

  r.post("/telegram/send", demoOnly(async (req, res) => {
    const db = await getDb();
    const chat = String(req.body.chat ?? "555001");
    const text = req.body.text ? String(req.body.text) : null;
    const update = text
      ? { update_id: Date.now(), message: { message_id: Date.now(), chat: { id: Number(chat), type: "private" }, from: { id: Number(chat), first_name: "Maya" }, text } }
      : { update_id: Date.now(), callback_query: { id: String(Date.now()), data: String(req.body.callback), message: { chat: { id: Number(chat) } } } };
    if (text) {
      const sent = J<any[]>((await setting(db, `tg_sent:${chat}`)) ?? "[]");
      sent.push({ at: Date.now(), text });
      await db.query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [`tg_sent:${chat}`, JSON.stringify(sent.slice(-50))]);
    }
    const r2 = await fetch(`http://127.0.0.1:${(req.socket.localPort ?? config.port)}/c/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": config.telegram.webhookSecret }, body: JSON.stringify(update) });
    if (!r2.ok) return back(res, `/telegram?chat=${chat}`, "Webhook refused the update (secret not configured?).", true);
    res.redirect(`/telegram?chat=${chat}`);
  }, true));

  // A1: /demo/reset and /demo/clock act on the visitor's own workspace (web/demo.ts); the global reset is /admin.
  return r;
}
