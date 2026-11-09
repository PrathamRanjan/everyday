import express from "express";
import cookieParser from "cookie-parser";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";
import { GtError } from "./lib/util.js";
import { opsRoutes } from "./web/ops.js";
import { shopperRoutes } from "./web/shopper.js";
import { guardRoutes } from "./web/guard.js";
import { traceRoutes } from "./web/trace.js";
import { passportRoutes } from "./web/passport.js";
import { mcpRoutes } from "./web/mcp.js";
import { installChannelHandlers } from "./channels/handlers.js";

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
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use("/static", express.static(join(root, "public"), { maxAge: "1h" }));
  app.get("/healthz", async (_req, res) => {
    try {
      await (await getDb()).query("SELECT 1");
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });
  app.use(mcpRoutes());
  app.use(opsRoutes());
  app.use(guardRoutes());
  app.use(traceRoutes());
  app.use(passportRoutes());
  app.use(shopperRoutes());
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof GtError) return res.status(err.status).type("text").send(err.message);
    console.error("[everyday]", req.method, req.path, err);
    res.status(500).send("Something went wrong.");
  });
  return app;
}
