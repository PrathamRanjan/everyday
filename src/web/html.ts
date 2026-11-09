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
}

export function layout(o: LayoutOpts, body: Raw): string {
  const area = o.area ?? (o.who ? "shopper" : "public");
  const nav =
    area === "shopper"
      ? [["/today", "Today"], ["/discover", "Discover"], ["/plans", "Plans"], ["/purchases", "Purchases"], ["/passport", "Passport"], ["/guard", "Guard"], ["/safety", "Safety"], ["/you", "You"]]
      : area === "merchant"
        ? [["/merchant", "Orders"], ["/merchant#cases", "Cases"], ["/merchant#catalog", "Catalog"], ["/merchant/money", "Money"], ["/merchant/approvals", "Approvals"]]
        : area === "console"
          ? [["/console", "Model"], ["/console/evidence", "Evidence"], ["/console#lab", "Failure lab"], ["/channels", "Channels"], ["/telegram", "Telegram"], ["/traces", "Traces"], ["/judge", "Judge"], ["/demo", "Demo"]]
          : [["/login", "Sign in"], ["/demo", "Demo"]];
  const links = nav.map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join("");
  const who = o.who ? `<span class="muted small" title="Clock">${esc(o.who.clock)}</span><form method="post" action="/logout" class="inline"><button class="btn small" type="submit">Sign out</button></form>` : "";
  const flash = o.flash?.ok ? `<div class="banner good" role="status">${esc(o.flash.ok)}</div>` : o.flash?.err ? `<div class="banner bad" role="alert">${esc(o.flash.err)}</div>` : "";
  const brand = area === "merchant" ? `<a class="brand" href="/merchant"><span class="dot">N</span>Northlight Supply · merchant</a>` : area === "console" ? `<a class="brand" href="/console"><span class="dot">E</span>Everyday · operator</a>` : `<a class="brand" href="/"><span class="dot">E</span>Everyday</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)} · Everyday</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23234e8a'/%3E%3Ctext x='16' y='22' font-size='17' text-anchor='middle' fill='white' font-family='Arial' font-weight='700'%3EE%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/static/app.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#234e8a">
${o.head ? o.head.value : ""}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="topbar"><div class="wrap">${brand}<nav class="nav" aria-label="Main">${links}${who}</nav></div></header>
<main id="main"><div class="wrap">${flash}${body.value}</div></main>
<footer><div class="wrap">Everyday · PayPal sandbox and a clearly identified test merchant: no real money or goods move. Recommendations explain themselves; payments need your approval.</div></footer>
<script src="/static/pwa.js" defer></script>
<link rel="stylesheet" href="/static/a11y.css"><script src="/static/a11y.js" defer></script>
</body>
</html>`;
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
