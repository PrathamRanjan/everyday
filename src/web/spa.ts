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
import { brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { config } from "../config.js";
import { whoami } from "./auth.js";
import { fmtWall } from "../core/time.js";
import { nowOf } from "../store.js";

/** Every screen the app renders. Anything else that a browser asks for as a page also gets the app (its 404 screen). */
export const PAGES: RegExp[] = [
  /^\/login$/, /^\/today$/, /^\/discover$/, /^\/captures\/[\w-]+$/, /^\/plans$/, /^\/plans\/[\w-]+$/, /^\/purchases$/, /^\/receipts$/, /^\/orders\/[\w-]+$/,
  /^\/you$/, /^\/things$/, /^\/guard$/, /^\/passport$/, /^\/safety$/, /^\/safety\/model-card$/, /^\/channels$/, /^\/traces$/, /^\/trace\/[\w-]+$/,
  /^\/merchant$/, /^\/merchant\/money$/, /^\/merchant\/approvals$/, /^\/judge$/, /^\/demo$/, /^\/console$/, /^\/console\/evidence$/, /^\/console\/eval$/, /^\/telegram$/,
  /^\/ask$/, /^\/proof$/, /^\/ai$/, /^\/paypal$/, /^\/who-can-move-money$/, /^\/accessibility$/, /^\/agents$/,
];

/** Which page module renders each path, so the shell can preload that chunk instead of waiting for the main script. */
const PAGE_MODULE: [RegExp, string][] = [
  [/^\/login$/, "Login"], [/^\/today$/, "Today"], [/^\/discover$/, "Discover"], [/^\/captures\//, "Capture"], [/^\/plans$/, "Plans"], [/^\/plans\//, "Plan"],
  [/^\/purchases$/, "Purchases"], [/^\/receipts$/, "Receipts"], [/^\/orders\//, "Order"], [/^\/(you|things)$/, "You"], [/^\/guard$/, "Guard"], [/^\/passport$/, "Passport"], [/^\/safety/, "Safety"],
  [/^\/channels$/, "Channels"], [/^\/trace/, "Traces"], [/^\/merchant/, "Merchant"], [/^\/(judge|demo)$/, "Demo"], [/^\/(console|telegram)/, "Console"], [/^\/ask$/, "Ask"],
  [/^\/(proof|ai|paypal|who-can-move-money|accessibility|agents)$/, "Public"],
];

/** The first read each page makes, fetched alongside the scripts. Same URL, mode and credentials as the app's fetch. */
const PAGE_DATA: Record<string, string> = {
  "/today": "/api/ui/today", "/login": "/api/ui/personas", "/judge": "/api/ui/judge", "/plans": "/api/ui/plans", "/purchases": "/api/ui/purchases",
  "/you": "/api/ui/you", "/safety": "/api/ui/safety", "/traces": "/api/ui/traces", "/merchant": "/api/ui/merchant", "/merchant/approvals": "/api/ui/merchant/approvals",
  "/console": "/api/ui/console", "/console/evidence": "/api/ui/evidence", "/demo": "/api/ui/demo",
  "/proof": "/api/public/proof", "/ai": "/api/public/ai", "/paypal": "/api/public/paypal", "/who-can-move-money": "/api/public/roles", "/accessibility": "/api/public/accessibility", "/agents": "/api/public/agents",
};
const dataLink = (u: string) => `<link rel="preload" as="fetch" crossorigin="anonymous" href="${u}">`;

type Manifest = Record<string, { file: string; imports?: string[]; isEntry?: boolean }>;

/** `<link rel="modulepreload">` tags per page module: its chunk plus the shared chunks it needs that the entry doesn't load. */
export function preloads(manifest: Manifest): Map<string, string> {
  const entry = Object.keys(manifest).find((k) => manifest[k].isEntry);
  const walk = (key: string, seen: Set<string>) => {
    if (seen.has(key) || !manifest[key]) return seen;
    seen.add(key);
    for (const i of manifest[key].imports ?? []) walk(i, seen);
    return seen;
  };
  const loaded = entry ? walk(entry, new Set()) : new Set<string>();
  const out = new Map<string, string>();
  for (const [, name] of PAGE_MODULE) {
    const key = `src/pages/${name}.tsx`;
    if (out.has(name) || !manifest[key]) continue;
    const files = [...walk(key, new Set())].filter((k) => !loaded.has(k)).map((k) => manifest[k].file);
    out.set(name, files.map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`).join(""));
  }
  return out;
}

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

/**
 * Built JS and CSS, Brotli- or gzip-compressed once and kept in memory (the files are content-hashed and immutable).
 * Behind Render's edge this is redundant; self-hosted it cuts the first load by about two thirds.
 */
function compressed(dir: string) {
  const cache = new Map<string, Buffer>();
  return (req: Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== "GET" || !/^\/[\w.-]+\.(js|css)$/.test(req.path)) return next();
    const enc = req.acceptsEncodings("br", "gzip");
    if (enc !== "br" && enc !== "gzip") return next();
    const file = join(dir, req.path);
    if (!existsSync(file)) return next();
    const key = `${enc}:${req.path}`;
    let body = cache.get(key);
    if (!body) {
      const raw = readFileSync(file);
      body = enc === "br" ? brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 } }) : gzipSync(raw, { level: 9 });
      cache.set(key, body);
    }
    res.set({ "Content-Encoding": enc, Vary: "Accept-Encoding", "Cache-Control": "public, max-age=31536000, immutable" }).type(req.path.endsWith(".js") ? "application/javascript" : "text/css").send(body);
  };
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
  const manifestPath = join(dist, ".vite", "manifest.json");
  const readPreloads = () => (existsSync(manifestPath) ? preloads(JSON.parse(readFileSync(manifestPath, "utf8"))) : new Map<string, string>());
  let pre = readPreloads();
  app.use("/assets", compressed(join(dist, "assets")));
  app.use("/assets", express.static(join(dist, "assets"), { immutable: true, maxAge: "1y", index: false }));
  app.use("/fonts", express.static(join(dist, "fonts"), { immutable: true, maxAge: "1y", index: false }));
  // A1.4: the hands-free face tracker's runtime and model, served from here (no CDN); fetched only when switched on.
  app.use("/mediapipe", express.static(join(dist, "mediapipe"), { maxAge: "7d", index: false }));
  app.use("/models", express.static(join(dist, "models"), { maxAge: "7d", index: false }));
  for (const f of ["favicon.svg", "robots.txt"]) app.get(`/${f}`, (_req, res) => res.sendFile(join(dist, f), { maxAge: "1d" }));
  const sendShell = async (req: Request, res: express.Response) => {
    if (process.env.NODE_ENV !== "production") (shell = readFileSync(indexPath, "utf8")), (pre = readPreloads());
    // What the first paint needs without a round trip: the demo ribbon, the PayPal environment, and a shopper's demo clock.
    let who: { kind: string; clock?: string } | null = null;
    try {
      const w = await whoami(req);
      if (w?.account) who = { kind: "shopper", clock: fmtWall(nowOf(w.account)) };
      else if (w?.merchant) who = { kind: "merchant" };
    } catch {
      who = null;
    }
    const boot = JSON.stringify({ demo: config.demoMode, paypal_env: config.paypal.env, who }).replace(/</g, "\\u003c");
    const page = req.path === "/" ? "" : PAGE_MODULE.find(([re]) => re.test(req.path))?.[1] ?? "NotFound";
    const data = PAGE_DATA[req.path];
    const links = (pre.get(page) ?? "") + dataLink("/api/ui/session") + (data && (who || req.path === "/login") ? dataLink(data) : "");
    res.set("Cache-Control", "no-cache").type("html").send(shell.replace("</head>", `${links}<script>window.__EV_BOOT__=${boot}</script></head>`));
  };
  app.get("/", async (req, res, next) => {
    try {
      const w = await whoami(req);
      // Keep the query (?tour=judge and friends) so a signed-in visitor opening a tour link still gets the tour.
      const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      if (w?.account) return res.redirect(`/today${qs}`);
      if (w?.merchant) return res.redirect(`/merchant${qs}`);
      await sendShell(req, res);
    } catch (e) {
      next(e);
    }
  });
  app.get(PAGES, (req, res, next) => sendShell(req, res).catch(next));
  return sendShell;
}
