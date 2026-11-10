/**
 * Serving the React app (web/dist) and the bridge that lets it use the existing form routes.
 *
 * Bridge: the app posts to the same routes the server-rendered pages used (POST /plans, /quotes/:id/approve, ...)
 * with the header `X-Everyday-UI: 1`. Those handlers end in `res.redirect(path?ok=...)`; for the app that redirect
 * becomes `200 {to, ok, err, external}` so the app can show the message and move to `to` (or leave for PayPal).
 * No handler changes, so every rule, gate and test that covers a route covers the app too.
 */
import express, { type Express, type Request } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { whoami } from "./auth.js";

/** Every screen the app renders. Anything else that a browser asks for as a page also gets the app (its 404 screen). */
export const PAGES: RegExp[] = [
  /^\/login$/, /^\/today$/, /^\/discover$/, /^\/captures\/[\w-]+$/, /^\/plans$/, /^\/plans\/[\w-]+$/, /^\/purchases$/, /^\/orders\/[\w-]+$/,
  /^\/you$/, /^\/things$/, /^\/guard$/, /^\/passport$/, /^\/safety$/, /^\/safety\/model-card$/, /^\/channels$/, /^\/traces$/, /^\/trace\/[\w-]+$/,
  /^\/merchant$/, /^\/merchant\/money$/, /^\/merchant\/approvals$/, /^\/judge$/, /^\/demo$/, /^\/console$/, /^\/console\/evidence$/, /^\/console\/eval$/, /^\/telegram$/,
];

export function uiBridge(app: Express) {
  app.use((req, res, next) => {
    if (req.get("x-everyday-ui") !== "1") return next();
    const own = new URL(config.appUrl);
    (res as any).redirect = (a: unknown, b?: unknown) => {
      const raw = String(typeof a === "number" ? b : a);
      const u = new URL(raw, `${req.protocol}://${req.get("host") ?? own.host}`);
      const external = /^https?:\/\//i.test(raw) && u.host !== (req.get("host") ?? own.host) && u.host !== own.host;
      const ok = u.searchParams.get("ok");
      const err = u.searchParams.get("err");
      u.searchParams.delete("ok");
      u.searchParams.delete("err");
      const to = external ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
      res.status(200).set("Cache-Control", "no-store").json({ to, ok, err, external });
    };
    next();
  });
}

export function webDist(root: string) {
  return join(root, "web", "dist");
}

/** Static assets and the app shell. Call before the routers so pages are the app; JSON and file routes are untouched. */
export function serveApp(app: Express, root: string) {
  const dist = webDist(root);
  const indexPath = join(dist, "index.html");
  if (!existsSync(indexPath)) {
    // No silent fallback to an older UI: say plainly that the build step was skipped.
    app.get(PAGES, (_req, res) => res.status(503).type("text").send("The Everyday front end is not built. Run `npm run build` (it builds web/ into web/dist)."));
    return false;
  }
  let shell = readFileSync(indexPath, "utf8");
  app.use("/assets", express.static(join(dist, "assets"), { immutable: true, maxAge: "1y", index: false }));
  app.use("/fonts", express.static(join(dist, "fonts"), { immutable: true, maxAge: "1y", index: false }));
  for (const f of ["favicon.svg", "robots.txt"]) app.get(`/${f}`, (_req, res) => res.sendFile(join(dist, f), { maxAge: "1d" }));
  const sendShell = (_req: Request, res: express.Response) => {
    if (process.env.NODE_ENV !== "production") shell = readFileSync(indexPath, "utf8");
    res.set("Cache-Control", "no-cache").type("html").send(shell);
  };
  app.get("/", async (req, res, next) => {
    try {
      const w = await whoami(req);
      if (w?.account) return res.redirect("/today");
      if (w?.merchant) return res.redirect("/merchant");
      sendShell(req, res);
    } catch (e) {
      next(e);
    }
  });
  app.get(PAGES, (req, res) => sendShell(req, res));
  return sendShell;
}
