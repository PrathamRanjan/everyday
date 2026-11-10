import { defineConfig } from "@playwright/test";

/** Runs against a server that is already up (local `npm run dev`, or E2E_URL). One worker: the demo data is shared. */
export default defineConfig({
  testDir: "tests",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_URL ?? "http://localhost:4111", trace: "retain-on-failure", reducedMotion: "reduce" },
});
