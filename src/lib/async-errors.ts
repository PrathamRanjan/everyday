import { createRequire } from "node:module";

/**
 * Express 4 calls route handlers but ignores the promise an async handler returns, so a rejected `await` (a database
 * restart, a dropped connection) becomes an unhandled rejection and Node exits: the live 502 stretches. This sends
 * that rejection to `next(err)` instead, so the app's error handler answers and the server keeps running.
 * Same idea as the express-async-errors package, in a few lines. Installed once, before any route is added.
 */
let installed = false;
export function routeAsyncErrorsToNext() {
  if (installed) return;
  installed = true;
  const Layer = createRequire(import.meta.url)("express/lib/router/layer.js");
  const original = Layer.prototype.handle_request;
  Layer.prototype.handle_request = function handle(this: { handle: (...a: unknown[]) => unknown }, req: unknown, res: unknown, next: (e?: unknown) => void) {
    if (this.handle.length > 3) return next();
    try {
      const out = this.handle(req, res, next) as { catch?: (fn: (e: unknown) => void) => unknown } | undefined;
      if (out && typeof out.catch === "function") out.catch((e) => next(e ?? new Error("Rejected without a reason")));
    } catch (e) {
      next(e);
    }
  };
  Layer.prototype.handle_request.original = original;
}

/** A database that is restarting or out of reach, worth a "try again in a moment" rather than a plain 500. */
export function isDbOutage(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e ?? "");
  const code = (e as { code?: string } | null)?.code ?? "";
  return /Connection terminated|database system is (shutting down|starting up)|ECONNREFUSED|ECONNRESET|timeout exceeded when trying to connect/i.test(m) || ["57P01", "57P02", "57P03", "ECONNREFUSED", "ECONNRESET"].includes(code);
}
