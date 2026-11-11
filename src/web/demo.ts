/**
 * A1: the visitor's own demo. "Try the live demo" posts to /demo/start, which builds a private workspace and signs
 * the visitor in as its Maya. /demo/join/<token> opens the same workspace on a second device. "Reset my demo"
 * rebuilds only the visitor's own workspace; the global reset lives behind the operator key (/admin).
 */
import { Router, type Request } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { addWorkDays, fmtWall, wallIso } from "../core/time.js";
import { GtError } from "../lib/util.js";
import { accountById, nowOf } from "../store.js";
import { currentWs } from "../ws.js";
import { progressLine, resetWorkspace, startWorkspace, workspaceById, workspaceByToken } from "../services/workspaces.js";
import { setWsCookie, signIn, signOut, whoami } from "./auth.js";
import { seedAll } from "../services/seed.js";
import { back } from "./common.js";

const ipOf = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "unknown";
/**
 * The per-address limit doesn't apply to this machine itself (local test runs) or to the operator's own test runs,
 * which send the operator key in a header. The 300-workspace ceiling still applies to both.
 */
export const unlimited = (req: Request) => {
  const ip = String(req.socket.remoteAddress ?? "");
  if (!req.get("x-forwarded-for") && /^(127\.|::1$|::ffff:127\.)/.test(ip)) return true;
  const k = req.get("x-everyday-operator") ?? "";
  if (!config.adminKey || !k) return false;
  const a = createHash("sha256").update(k).digest();
  const b = createHash("sha256").update(config.adminKey).digest();
  return timingSafeEqual(a, b);
};

export function demoRoutes() {
  const r = Router();
  const demoOn = (fn: (req: Request, res: any) => Promise<unknown>) => async (req: Request, res: any, next: any) => {
    try {
      if (!config.demoMode) return res.status(404).send("Not found");
      await fn(req, res);
    } catch (e) {
      if (e instanceof GtError) return back(res, String(req.get("referer") ?? "/").replace(/[?&](ok|err)=[^&#]*/g, "").split("#")[0] || "/", e.message, true);
      next(e);
    }
  };

  r.post("/demo/start", demoOn(async (req, res) => {
    // A visitor who already has a live workspace goes back to it, unless they ask for a fresh one.
    const mine = currentWs();
    const existing = mine && req.body?.fresh !== "1" ? await workspaceById(mine) : null;
    const ws = existing && existing.seed_state !== "failed" && new Date(existing.expires_at) > new Date() && existing.kind === "visitor" ? existing : await startWorkspace({ ip: ipOf(req), unlimited: unlimited(req) });
    setWsCookie(res, ws.id);
    if (ws.account_id) signIn(res, `acc:${ws.account_id}`);
    // E10: the landing page asks to land on Ask with a question typed; only that one shape is accepted.
    const next = String(req.body?.next ?? "");
    const to = /^\/ask\?q=[\w%.~-]{1,300}$/.test(next) ? next : "/today";
    back(res, to, existing === ws ? "Back in your own demo." : "Your own demo is ready. Nobody else sees what you do here.");
  }));

  r.get("/demo/join/:token", demoOn(async (req, res) => {
    const ws = await workspaceByToken(String(req.params.token));
    if (!ws?.account_id) return back(res, "/", "That demo link has expired. Start a new demo.", true);
    setWsCookie(res, ws.id);
    signIn(res, `acc:${ws.account_id}`);
    back(res, "/today", "You're in the same demo as your other device.");
  }));

  r.post("/demo/reset", demoOn(async (_req, res) => {
    const ws = currentWs();
    if (!ws && !config.privateDemos) {
      // Private demos off (local development and the unit tests): one shared world, rebuilt in place.
      await seedAll();
      signOut(res);
      return back(res, "/login", "Demo loaded. Sign in as Maya.");
    }
    if (!ws) throw new GtError("Start your own demo first: there is no shared demo to reset.", "no_workspace", 409);
    const w = await workspaceById(ws);
    if (!w || w.kind !== "visitor") throw new GtError("This demo can't be reset from here.", "forbidden", 403);
    const fresh = await resetWorkspace(ws);
    if (fresh.account_id) signIn(res, `acc:${fresh.account_id}`);
    back(res, "/today", "Your demo was reset. Only yours: nobody else's changed.");
  }));

  /** The visitor's own demo clock: +1 working day or +1 week, on their workspace only. */
  r.post("/demo/clock", demoOn(async (req, res) => {
    const db = await getDb();
    const w = await whoami(req);
    const ws = currentWs();
    const acc = w?.account ?? (ws || !config.privateDemos ? (await db.query<any>("SELECT * FROM accounts WHERE ws_id IS NOT DISTINCT FROM $1 ORDER BY created_at LIMIT 1", [ws])).rows[0] : null);
    if (!acc) throw new GtError("Start your own demo first.", "no_workspace", 409);
    const a = await accountById(db, acc.id);
    const now = nowOf(a);
    const next = req.body.step === "week" ? new Date(now.getTime() + 7 * 864e5) : addWorkDays(now, 1);
    await db.query("UPDATE accounts SET sim_now = $2 WHERE id = $1", [a.id, wallIso(next)]);
    back(res, "/demo", `Clock: ${fmtWall(next)}`);
  }));

  /** The visitor's workspace: when it expires, how the seed payments are going, and the second-device link. */
  r.get("/api/ui/workspace", async (_req, res, next) => {
    try {
      const ws = currentWs();
      const w = ws ? await workspaceById(ws) : null;
      if (!w) return res.json({ workspace: null, private_demos: config.privateDemos, demo: config.demoMode });
      res.set("Cache-Control", "no-store").json({
        private_demos: config.privateDemos,
        demo: config.demoMode,
        workspace: {
          id: w.id,
          kind: w.kind,
          state: w.seed_state,
          created_at: w.created_at,
          expires_at: w.expires_at,
          progress: w.progress,
          progress_line: progressLine(w.progress),
          join_url: w.kind === "visitor" && w.join_token ? `${config.appUrl}/demo/join/${w.join_token}` : null,
        },
      });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
