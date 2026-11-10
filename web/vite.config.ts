import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// The built app is served by the Express server (src/web/spa.ts) from web/dist. In dev, vite proxies the API to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false, chunkSizeWarningLimit: 600, manifest: true },
  server: {
    port: 5190,
    proxy: Object.fromEntries(["/api", "/static", "/login", "/logout", "/plans", "/quotes", "/orders", "/lines", "/cases", "/discover", "/captures", "/you", "/guard", "/passport", "/merchant", "/safety", "/channels", "/console", "/demo", "/telegram", "/connect", "/push", "/judge"].map((p) => [p, { target: "http://localhost:4111", bypass: (req: any) => (req.method === "GET" && req.headers.accept?.includes("text/html") ? "/index.html" : undefined) }])),
  },
});
