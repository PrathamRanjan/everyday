import { renderShell, type Brand, type NavGroup } from "./shell.js";
/** Minimal safe HTML templating: every interpolated value is escaped unless wrapped in raw(). */
export class Raw {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

export const raw = (s: string) => new Raw(s);

export function esc(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(esc).join("");
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += esc(values[i]) + strings[i + 1];
  return new Raw(out);
}

export interface LayoutOpts {
  title: string;
  who?: { name: string; clock: string } | null;
  area?: "shopper" | "merchant" | "console" | "public";
  head?: Raw;
  flash?: { ok?: string; err?: string };
  /** Public landing page: full-width sections. */
  site?: boolean;
}

export const BRAND: Brand = {
  name: "Everyday",
  mark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
  description: "Everyday: show it something you like or say what you need. It helps you decide, buys with PayPal when you approve, and keeps helping after delivery.",
  themeColor: "#0f766e",
  fonts: "family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500",
  appFoot: "PayPal sandbox and a clearly identified test merchant: no real money or goods move. Every payment needs your approval.",
  siteLinks: [["/#how", "How it works"], ["/#safe", "Safe shopping"], ["/#try", "Try it"], ["/judge", "Judge tour"]],
  cta: ["/#try", "Try the demo"],
  siteFoot: "Everyday · built for the PayPal AI Hackathon · PayPal sandbox only, no real money moves.",
  siteFootLinks: [["/judge", "Judge tour"], ["/login", "Sign in"], ["/demo", "Demo setup"]],
  staticBase: "/static",
};

const NAV: Record<"shopper" | "merchant" | "console", NavGroup[]> = {
  shopper: [
    { label: "Shopping", items: [["/today", "Today", "home"], ["/discover", "Discover", "search"], ["/plans", "Plans", "sparkles"], ["/purchases", "Purchases", "package"]] },
    { label: "Your money", items: [["/guard", "Approvals and limits", "shieldCheck"], ["/passport", "PayPal passport", "wallet"], ["/safety", "Scam protection", "shield"]] },
    { label: "You", items: [["/you", "Things you own", "box"], ["/channels", "Messages", "message"], ["/traces", "How it decided", "layers"]] },
  ],
  merchant: [
    { label: "Northlight Supply", items: [["/merchant", "Orders and cases", "package"], ["/merchant/money", "Money and disputes", "wallet"], ["/merchant/approvals", "Approvals", "shieldCheck"]] },
    { label: "More", items: [["/channels", "Messages", "message"], ["/traces", "Runs", "layers"]] },
  ],
  console: [
    { label: "Operator", items: [["/console", "Model", "flask"], ["/console/evidence", "Evidence", "receipt"], ["/console#lab", "Failure lab", "wrench"], ["/traces", "Runs", "layers"]] },
    { label: "Demo", items: [["/channels", "Messages", "message"], ["/telegram", "Telegram bot", "phone"], ["/judge", "Judge tour", "route"], ["/demo", "Demo setup", "gauge"]] },
  ],
};

export function layout(o: LayoutOpts, body: Raw): string {
  const area = o.area ?? (o.who ? "shopper" : "public");
  const common = { title: o.title, body: body.value, flash: o.flash, head: `<link rel="manifest" href="/manifest.webmanifest">${o.head?.value ?? ""}`, scripts: `<script src="/static/pwa.js" defer></script>` };
  if (area === "shopper" && o.who) return renderShell(BRAND, { ...common, mode: "app", nav: NAV.shopper, homeHref: "/today", top: `<span class="clock" title="Your local time">${esc(o.who.clock)}</span>`, user: { name: o.who.name, sub: "Shopper", logout: "/logout", settings: "/you#phone" } });
  if (area === "merchant") return renderShell(BRAND, { ...common, mode: "app", nav: NAV.merchant, homeHref: "/merchant", workspace: "Northlight Supply", user: { name: "Northlight Supply", sub: "Test merchant", logout: "/logout", settings: "/channels" } });
  if (area === "console") return renderShell(BRAND, { ...common, mode: "app", nav: NAV.console, homeHref: "/console", workspace: "Operator", user: { name: "Operator", sub: "Everyday console", logout: "/logout" } });
  return renderShell(BRAND, { ...common, mode: o.site ? "site" : "plain" });
}

export const STATE_CLASS: Record<string, string> = {
  planning: "info", purchased: "good", stale: "muted", current: "info", superseded: "muted", ordered: "good",
  created: "warn", paid: "good", delivered: "good", cancelled: "muted",
  pending: "warn", backordered: "bad", swapped: "muted", shipped: "info", returned: "muted",
  needs_info: "warn", choose: "warn", awaiting_merchant: "info", refunding: "info", resolved: "good", declined: "muted", not_eligible: "muted",
  owned: "good", sold: "muted", given: "muted", recycled: "muted",
  succeeded: "good", failed: "bad", COMPLETED: "good",
  buy: "good", suggested: "info", skip: "muted", not_needed: "muted", none: "bad",
  link_saved: "warn", analysed_fixture: "info", analysed_screenshot: "good", described: "info",
};
export const pill = (state: string, label?: string) => html`<span class="pill ${STATE_CLASS[state] ?? ""}">${label ?? state.replace(/_/g, " ")}</span>`;
export const money = (c: number | null | undefined) => (c === null || c === undefined ? "—" : `$${(c / 100).toFixed(2)}`);

export function fmtDate(v: string | Date | null | undefined, withTime = true): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return String(v);
  return withTime ? d.toISOString().slice(0, 16).replace("T", " ") : d.toISOString().slice(0, 10);
}
