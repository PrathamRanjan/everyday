import express from "express";
import cookieParser from "cookie-parser";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { GtError } from "./lib/util.js";
import { opsRoutes } from "./web/ops.js";
import { safetyRoutes } from "./web/safety.js";
import { shopperRoutes } from "./web/shopper.js";
import { guardRoutes } from "./web/guard.js";
import { traceRoutes } from "./web/trace.js";
import { passportRoutes } from "./web/passport.js";
import { mcpRoutes } from "./web/mcp.js";
import { installChannelHandlers } from "./channels/handlers.js";
import { apiRoutes } from "./web/api.js";
import { adminRoutes } from "./web/admin.js";
import { serveApp, uiBridge } from "./web/spa.js";

let handlersInstalled = false;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function createApp() {
  if (!handlersInstalled) {
    installChannelHandlers();
    handlersInstalled = true;
  }
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "200kb" }));
  app.use(cookieParser());
  // The phone app's browser build runs on Expo's dev server, another origin. It may call the API with a device key;
  // credentials (the cookie) are never allowed cross-origin, so a page elsewhere can't act as a signed-in shopper.
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (!origin || !config.appOrigins.includes(origin)) return next();
    res.set({ "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "authorization, content-type, accept, x-everyday-ui, x-everyday-client", "Access-Control-Max-Age": "600" });
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  uiBridge(app);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use("/static", express.static(join(root, "public"), { maxAge: 0, setHeaders: (res, file) => { if (/[\\/]safety[\\/]/.test(file)) res.setHeader("Cache-Control", "public, max-age=86400"); } }));
  app.get("/healthz", async (_req, res) => {
    try {
      await (await getDb()).query("SELECT 1");
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });
  const shell = serveApp(app, root);
  app.use(adminRoutes());
  app.use(apiRoutes());
  app.use(mcpRoutes());
  app.use(opsRoutes());
  app.use(guardRoutes());
  app.use(traceRoutes());
  app.use(passportRoutes());
  app.use(safetyRoutes());
  app.use(shopperRoutes());
  // Any other page a browser asks for is the app's own "not found" screen.
  app.use((req, res, next) => (shell && req.method === "GET" && req.accepts(["html", "json"]) === "html" ? (res.status(404), void shell(req, res).catch(next)) : next()));
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof GtError) return res.status(err.status).type("text").send(err.message);
    console.error("[everyday]", req.method, req.path, err);
    res.status(500).send("Something went wrong.");
  });
  return app;
}
