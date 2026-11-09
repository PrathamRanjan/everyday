import type { ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, ArrowRight, CircleSlash, Cpu, Loader2, ScanText, ShieldCheck, WifiOff } from "lucide-react";
import { Dot, type Tone } from "./Lifeline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { money, words } from "@/lib/format";
import type { ApiError } from "@/lib/api";

/** Top of every screen: what happened, what needs you, what happens next. */
export function PageHead({ eyebrow, title, lede, needs, next, actions, className }: { eyebrow?: ReactNode; title: ReactNode; lede?: ReactNode; needs?: ReactNode; next?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-3xl font-medium sm:text-4xl">{title}</h1>
        {lede && <p className="prose-w mt-2 text-ink-2">{lede}</p>}
        {(needs || next) && (
          <dl className="mt-3 grid gap-1 text-sm sm:flex sm:gap-6">
            {needs && (
              <div className="flex gap-2">
                <dt className="font-semibold text-now">Needs you</dt>
                <dd>{needs}</dd>
              </div>
            )}
            {next && (
              <div className="flex gap-2">
                <dt className="font-semibold text-ink-2">Next</dt>
                <dd>{next}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, sub, children, className, id, action, tight }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; className?: string; id?: string; action?: ReactNode; tight?: boolean }) {
  return (
    <section id={id} className={cn("scroll-mt-24 rounded-lg border border-rule bg-card", tight ? "p-0" : "p-4 sm:p-5", className)}>
      {(title || action) && (
        <div className={cn("mb-3 flex items-start justify-between gap-3", tight && "px-4 pt-4 sm:px-5 sm:pt-5")}>
          <div className="min-w-0">
            {title && <h2 className="text-xl font-medium">{title}</h2>}
            {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** A server status → the money-state language: tone and plain words. */
const STATES: Record<string, [Tone, string]> = {
  created: ["wait", "awaiting payment"],
  pending: ["wait", "waiting on PayPal"],
  approved: ["done", "approved"],
  open: ["wait", "open"],
  paid: ["done", "paid"],
  succeeded: ["done", "done"],
  completed: ["done", "completed"],
  COMPLETED: ["done", "PayPal COMPLETED"],
  PENDING: ["wait", "PayPal PENDING"],
  PARTIALLY_REFUNDED: ["back", "partly refunded"],
  REFUNDED: ["back", "refunded"],
  DECLINED: ["stop", "declined by PayPal"],
  FAILED: ["stop", "failed"],
  failed: ["stop", "failed"],
  declined: ["stop", "declined"],
  denied: ["stop", "refused"],
  held: ["now", "waiting for you"],
  ordered: ["plain", "ordered"],
  shipped: ["wait", "on its way"],
  delivered: ["done", "delivered"],
  backordered: ["now", "backordered"],
  swapped: ["back", "swapped"],
  returned: ["back", "returned"],
  cancelled: ["stop", "cancelled"],
  planning: ["now", "planning"],
  quoted: ["wait", "quoted"],
  purchased: ["done", "bought"],
  stale: ["plain", "out of date"],
  choose: ["now", "choose a remedy"],
  awaiting_merchant: ["wait", "with the merchant"],
  resolved: ["done", "resolved"],
  owned: ["done", "owned"],
  sold: ["plain", "sold"],
  given: ["plain", "given away"],
  recycled: ["plain", "recycled"],
  current: ["done", "current"],
  fired: ["done", "target reached"],
  active: ["done", "active"],
  done: ["done", "done"],
  running: ["wait", "running"],
  link_saved: ["plain", "link saved"],
  analysed_fixture: ["plain", "demo clip"],
  analysed_screenshot: ["done", "read from screenshot"],
  analysed_cover: ["done", "read from cover"],
  described: ["plain", "described"],
};
export function stateOf(s: string | null | undefined): [Tone, string] {
  if (!s) return ["plain", "—"];
  return STATES[s] ?? STATES[s.toLowerCase()] ?? ["plain", words(s)];
}

export function State({ s, label, className }: { s: string | null | undefined; label?: string; className?: string }) {
  const [tone, text] = stateOf(s);
  const bg = tone === "now" ? "bg-now-bg text-now" : tone === "done" || tone === "back" ? "bg-done-bg text-done" : tone === "wait" ? "bg-wait-bg text-wait" : tone === "stop" ? "bg-stop-bg text-stop" : "bg-sunk text-ink-2";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", bg, className)}>
      <Dot tone={tone} className="size-3" />
      {label ?? text}
    </span>
  );
}

export function Amount({ cents, className, strong }: { cents: number | null | undefined; className?: string; strong?: boolean }) {
  return <span className={cn("num whitespace-nowrap", strong && "font-semibold", className)}>{money(cents)}</span>;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-rule-2 bg-paper/60 p-5">
      {icon && <div className="text-ink-3">{icon}</div>}
      <p className="font-display text-lg">{title}</p>
      {children && <div className="text-sm text-ink-2">{children}</div>}
      {action}
    </div>
  );
}

export function LoadError({ error, retry }: { error: ApiError; retry?: () => void }) {
  const offline = error.status === 0;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-stop/40 bg-stop-bg p-5 text-stop">
      <div className="flex items-center gap-2 font-semibold">
        {offline ? <WifiOff className="size-5" /> : <AlertTriangle className="size-5" />}
        {error.status === 404 ? "Not found" : offline ? "Offline" : "Couldn't load this"}
      </div>
      <p className="text-sm text-ink">{error.message} Nothing was changed.</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <Skeleton className="h-4 w-24 bg-sunk" />
      <Skeleton className="h-10 w-2/3 bg-sunk" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-lg bg-sunk" />
      ))}
    </div>
  );
}

/** Wraps a screen's load states: skeleton, error, then the page. */
export function Loaded<T>({ state, children, rows }: { state: { data: T | null; error: ApiError | null; reload: () => Promise<void> }; children: (d: T) => ReactNode; rows?: number }) {
  if (state.error && !state.data) return <LoadError error={state.error} retry={() => void state.reload()} />;
  if (!state.data) return <PageSkeleton rows={rows} />;
  return <>{children(state.data)}</>;
}

/** AI reads, code decides, PayPal moves money: the trust pattern, with this screen's specifics. */
export function TrustStrip({ ai, code, paypal, className }: { ai: ReactNode; code: ReactNode; paypal: ReactNode; className?: string }) {
  const Item = ({ icon, who, children }: { icon: ReactNode; who: string; children: ReactNode }) => (
    <li className="flex gap-3 p-3 sm:p-4">
      <span className="mt-0.5 text-ink-2">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold tracking-wide text-ink-2 uppercase">{who}</span>
        <span className="block text-sm">{children}</span>
      </span>
    </li>
  );
  return (
    <ul className={cn("grid divide-y divide-rule rounded-lg border border-rule bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0", className)} aria-label="Who decides what">
      <Item icon={<ScanText className="size-5" />} who="AI reads">
        {ai}
      </Item>
      <Item icon={<Cpu className="size-5" />} who="Code decides">
        {code}
      </Item>
      <Item icon={<ShieldCheck className="size-5" />} who="PayPal moves money">
        {paypal}
      </Item>
    </ul>
  );
}

/** PayPal actions keep PayPal's colours, so they always mean "PayPal moves money here". */
export function PayPalButton({ children, busy, className, ...p }: React.ComponentProps<"button"> & { busy?: boolean }) {
  return (
    <button
      {...p}
      disabled={busy || p.disabled}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#ffc439] px-5 py-2.5 text-sm font-semibold text-[#111827] transition-[filter,transform] duration-[120ms] hover:brightness-95 active:scale-[.99] disabled:opacity-60",
        className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <PayPalMark />}
      {children}
    </button>
  );
}
export function PayPalMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden>
      <path fill="#003087" d="M7.3 21.3H3.9a.5.5 0 0 1-.5-.6L6.1 3.5a.7.7 0 0 1 .7-.6h6.6c2.9 0 4.6 1.4 4.2 4.1-.5 3.4-2.8 5-6 5H9.1l-1 6.7-.8 2.6Z" />
      <path fill="#0070e0" d="M18.6 7.4c-.6 3.5-3 5.3-6.4 5.3h-1.5l-1.1 7a.6.6 0 0 1-.6.5H6.6l-.1-.6 2.2-14.1a.5.5 0 0 1 .5-.4h5.9c1.6 0 2.8.3 3.5 1.1v1.2Z" />
    </svg>
  );
}

export function Busy({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <>
      {on && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </>
  );
}

export function GoLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cn("inline-flex items-center gap-1 text-sm font-semibold underline decoration-rule-2 underline-offset-4 hover:decoration-ink", className)}>
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-lg border border-rule bg-card p-4">
      <div className="text-xs font-semibold tracking-wide text-ink-2 uppercase">{label}</div>
      <div className={cn("num mt-1 font-display text-2xl", tone === "now" && "text-now", tone === "done" && "text-done", tone === "stop" && "text-stop")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-2">{hint}</div>}
    </div>
  );
}

export function Refused({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-stop">
      <CircleSlash className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function KV({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-2">{k}</dt>
          <dd className="num text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
