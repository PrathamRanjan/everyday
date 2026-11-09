import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { sign, unsign } from "../lib/crypto.js";
import { GtError, hashKey } from "../lib/util.js";
import { accountById, type Account } from "../store.js";
import { back } from "./common.js";

export const COOKIE = "ev_who";

export async function whoami(req: Request): Promise<{ account?: Account; merchant?: { id: string; name: string } } | null> {
  const v = unsign(req.cookies?.[COOKIE]);
  if (!v) return null;
  const db = await getDb();
  if (v.startsWith("acc:")) return { account: await accountById(db, v.slice(4)).catch(() => undefined) };
  if (v.startsWith("mer:")) {
    const m = (await db.query<any>("SELECT id, name FROM merchants WHERE id = $1", [v.slice(4)])).rows[0];
    return m ? { merchant: m } : null;
  }
  return null;
}

export async function keyLogin(key: string): Promise<string | null> {
  const db = await getDb();
  const a = (await db.query<{ id: string }>("SELECT id FROM accounts WHERE key_hash = $1", [hashKey(key.trim())])).rows[0];
  if (a) return `acc:${a.id}`;
  const m = (await db.query<{ id: string }>("SELECT id FROM merchants WHERE key_hash = $1", [hashKey(key.trim())])).rows[0];
  return m ? `mer:${m.id}` : null;
}

export function signIn(res: Response, value: string) {
  res.cookie(COOKIE, sign(value), { httpOnly: true, sameSite: "lax", secure: config.appUrl.startsWith("https://"), maxAge: 7 * 864e5, path: "/" });
}
export function signOut(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

function wrap<T>(load: (req: Request) => Promise<T | null>, onMissing: string, fn: (req: Request, res: Response, who: T) => Promise<unknown>, post: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const w = await load(req);
      if (!w) return res.redirect(`${onMissing}?next=${encodeURIComponent(req.originalUrl.slice(0, 200))}`);
      await fn(req, res, w);
    } catch (e) {
      if (e instanceof GtError) {
        if (e.status === 404) return res.status(404).send("Not found");
        if (post) return back(res, (req.get("referer") ?? "/today").replace(/[?&](ok|err)=[^&#]*/g, "").split("#")[0], e.message, true);
      }
      next(e);
    }
  };
}

export const shopper = (fn: (req: Request, res: Response, a: Account) => Promise<unknown>, post = false) => wrap(async (req) => (await whoami(req))?.account ?? null, "/login", fn, post);
export const merchant = (fn: (req: Request, res: Response, m: { id: string; name: string }) => Promise<unknown>, post = false) => wrap(async (req) => (await whoami(req))?.merchant ?? null, "/login", fn, post);
export const demoOnly = (fn: (req: Request, res: Response) => Promise<unknown>, post = false) =>
  wrap(async () => (config.demoMode ? true : null), "/login", (req, res) => fn(req, res), post);
