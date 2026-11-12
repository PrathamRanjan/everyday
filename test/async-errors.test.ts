import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { isDbOutage } from "../src/lib/async-errors.js";

// The live crash of 13 Nov: the shared Postgres restarted, an `await db.query` in an async route rejected, Express 4
// ignored the promise, and Node exited. Now the rejection reaches the error handler, which answers 503.
describe("a database outage during a request", () => {
  let real: Db;
  let base = "";
  let close = () => {};
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);

  beforeAll(async () => {
    real = await openDb({ memory: true });
    const dropped = () => Promise.reject(new Error("Connection terminated unexpectedly"));
    setDb({ ...real, query: dropped, exec: dropped, tx: dropped } as Db);
    process.on("unhandledRejection", onUnhandled);
    const srv = createApp().listen(0);
    await new Promise((r) => srv.once("listening", r));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    close = () => srv.close();
  });
  afterAll(() => {
    close();
    process.off("unhandledRejection", onUnhandled);
    setDb(real);
  });

  it("answers 503 with a retry hint, and the server keeps serving", async () => {
    const hook = await fetch(`${base}/webhooks/paypal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "X", custom_id: "ws1:r1" } }) });
    expect(hook.status).toBe(503);
    expect(hook.headers.get("retry-after")).toBe("15");
    expect(await hook.text()).toMatch(/restarting/);
    const again = await fetch(`${base}/healthz`);
    expect(again.status).toBeLessThan(600);
    await new Promise((r) => setTimeout(r, 50));
    expect(unhandled).toEqual([]);
  });

  it("tells an outage from an ordinary bug", () => {
    expect(isDbOutage(new Error("Connection terminated unexpectedly"))).toBe(true);
    expect(isDbOutage(Object.assign(new Error("the database system is shutting down"), { code: "57P03" }))).toBe(true);
    expect(isDbOutage(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isDbOutage(new TypeError("x is undefined"))).toBe(false);
  });
});
