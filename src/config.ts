import { randomBytes } from "node:crypto";

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return v === undefined || v === "" || !Number.isFinite(n) ? dflt : n;
}

const port = num(process.env.PORT, 3500);

export const config = {
  port,
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, ""),
  databaseUrl: process.env.DATABASE_URL || "",
  pglitePath: process.env.PGLITE_PATH || "./data/pglite",
  paypal: {
    env: (process.env.PAYPAL_ENV || "sandbox") as "sandbox" | "live",
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
    webhookId: process.env.PAYPAL_WEBHOOK_ID || "",
  },
  currency: (process.env.EV_CURRENCY || "USD").toUpperCase(),
  sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
  demoMode: bool(process.env.EV_DEMO_MODE, true),
  inlineWorker: bool(process.env.EV_INLINE_WORKER, true),
  workerIntervalMs: num(process.env.EV_WORKER_INTERVAL_MS, 2000),
  maxUploadBytes: num(process.env.EV_MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
  },
  models: {
    anthropicKey: process.env.ANTHROPIC_API_KEY || "",
    anthropicBaseUrl: (process.env.EV_ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, ""),
    model: process.env.EV_MODEL || "claude-haiku-5-5",
  },
  /** Roadmap B.1: OpenAI Responses API. provider "none" means rules only; replayed answers still work. */
  ai: {
    provider: (process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "none")) as "openai" | "none",
    openaiKey: process.env.OPENAI_API_KEY || "",
    openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, ""),
    models: {
      vision: process.env.AI_MODEL_VISION || "gpt-5.6-luna",
      read: process.env.AI_MODEL_READ || "gpt-5.5",
      classify: process.env.AI_MODEL_CLASSIFY || "gpt-5.4-mini",
      transcribe: process.env.AI_MODEL_TRANSCRIBE || "gpt-4o-mini-transcribe",
    },
  },
  /** Roadmap B.8: channels beyond the existing Telegram bot. */
  channels: {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramSecret: process.env.TELEGRAM_WEBHOOK_SECRET || "",
    whatsappToken: process.env.WHATSAPP_TOKEN || "",
    whatsappPhoneId: process.env.WHATSAPP_PHONE_ID || "",
    whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "everyday-verify",
    vapidPublic: process.env.VAPID_PUBLIC_KEY || "",
    vapidPrivate: process.env.VAPID_PRIVATE_KEY || "",
  },
  /** Roadmap B.6: guard thresholds not in the shopper mandate. */
  guard: {
    countersignAboveCents: num(process.env.EV_COUNTERSIGN_ABOVE_CENTS, 20000),
  },
  /** Channel3 product search (E1). Without a key the catalog is the only source and the page says so. */
  channel3: {
    apiKey: process.env.CHANNEL3_API_KEY || "",
    baseUrl: (process.env.CHANNEL3_BASE_URL || "https://api.trychannel3.com").replace(/\/$/, ""),
  },
  /** Log in with PayPal (E5). Uses the same sandbox client id; the redirect must be registered in the PayPal app. */
  paypalLogin: {
    enabled: bool(process.env.PAYPAL_LOGIN_ENABLED, false),
  },
};

export function paypalBaseUrl(env: "sandbox" | "live" = config.paypal.env): string {
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
