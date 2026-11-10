import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { sign, unsign } from "../lib/crypto.js";
import { GtError, hashKey } from "../lib/util.js";
import { accountById, type Account } from "../store.js";
import { back } from "./common.js";

export const COOKIE = "ev_who";
/** A1: the visitor's own demo workspace (signed id). Stays when they switch between Maya and the shop. */
export const WS_COOKIE = "ev_ws";

type Who = { account?: Account; merchant?: { id: string; name: string; ws_id?: string | null }; via?: "cookie" | "key" } | null;

/** The device key in `Authorization: Bearer ...`, if any. Not a cookie, so a page on another site can't send it. */
export const bearerOf = (req: Request) => req.get("authorization")?.match(/^Bearer\s+(\S{8,200})$/i)?.[1] ?? null;

/**
 * Who is asking. The phone app and the browser extension send a device key (shopper only: a key never acts as the
 * merchant); the website uses the signed session cookie. Memoised per request.
 */
export async function whoami(req: Request): Promise<Who> {
  const memo = req as Request & { __who?: Promise<Who> };
  return (memo.__who ??= resolveWho(req));
}

async function resolveWho(req: Request): Promise<Who> {
  const w = await resolveWhoAny(req);
  // A1: with private demos on, the shared workspace-less demo world is not reachable by visitors.
  if (config.demoMode && config.privateDemos && w && !(w.account?.ws_id ?? w.merchant?.ws_id)) return null;
  return w;
}

async function resolveWhoAny(req: Request): Promise<Who> {
  const key = bearerOf(req);
  if (key) {
    const db = await getDb();
    const d = (await db.query<{ id: string; account_id: string }>("SELECT id, account_id FROM device_keys WHERE key_hash = $1 AND revoked_at IS NULL", [hashKey(key)])).rows[0];
    if (d) {
      void db.query("UPDATE device_keys SET last_used_at = now() WHERE id = $1", [d.id]).catch(() => undefined);
      const account = await accountById(db, d.account_id).catch(() => undefined);
      return account ? { account, via: "key" } : null;
    }
    const v = await keyLogin(key);
    if (v?.startsWith("acc:")) {
      const account = await accountById(db, v.slice(4)).catch(() => undefined);
      return account ? { account, via: "key" } : null;
    }
    return null;
  }
  const v = unsign(req.cookies?.[COOKIE]);
  if (!v) return null;
  const db = await getDb();
  if (v.startsWith("acc:")) return { account: await accountById(db, v.slice(4)).catch(() => undefined), via: "cookie" };
  if (v.startsWith("mer:")) {
    const m = (await db.query<any>("SELECT id, name, ws_id FROM merchants WHERE id = $1", [v.slice(4)])).rows[0];
    return m ? { merchant: m, via: "cookie" } : null;
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

/** Which client sent the request: the website, the phone app or the browser extension. Used to tag captures and plans. */
export type Client = "app" | "mobile" | "extension";
export const clientOf = (req: Request): Client => {
  const c = req.get("x-everyday-client");
  return c === "mobile" || c === "extension" ? c : "app";
};

export function signIn(res: Response, value: string) {
  res.cookie(COOKIE, sign(value), { httpOnly: true, sameSite: "lax", secure: config.appUrl.startsWith("https://"), maxAge: 7 * 864e5, path: "/" });
}
export function signOut(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

export function setWsCookie(res: Response, ws: string) {
  res.cookie(WS_COOKIE, sign(ws), { httpOnly: true, sameSite: "lax", secure: config.appUrl.startsWith("https://"), maxAge: 30 * 864e5, path: "/" });
}

/**
 * The demo workspace a request acts in: the signed-in shopper's or shop's own, else the visitor's workspace cookie.
 * A merchant key (the read-only merchant MCP) resolves to its shop's workspace.
 */
export async function wsOfRequest(req: Request): Promise<string | null> {
  const w = await whoami(req).catch(() => null);
  if (w?.account) return w.account.ws_id ?? null;
  if (w?.merchant) return w.merchant.ws_id ?? null;
  const key = bearerOf(req);
  if (key) {
    const v = await keyLogin(key).catch(() => null);
    if (v?.startsWith("mer:")) return (await (await getDb()).query<{ ws_id: string | null }>("SELECT ws_id FROM merchants WHERE id = $1", [v.slice(4)])).rows[0]?.ws_id ?? null;
  }
  const c = unsign(req.cookies?.[WS_COOKIE]);
  return c && /^ws_[a-z0-9]+$/.test(c) ? c : null;
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
