import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { LangPicker } from "./LangPicker";
import { HandsFreeToggle } from "@/handsfree/Toggle";
import { toast } from "sonner";
import { Accessibility, CalendarClock, ChevronRight, Compass, FlaskConical, Gavel, Inbox, LogOut, Map, Menu, MessageSquare, Moon, Package, PlayCircle, ReceiptText, RotateCcw, Route, ShieldCheck, ShoppingBag, Store, Sun, SunMoon, User, Wallet, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
// Loaded just after the first paint: the popover and the phone menu bring positioning and dialog code.
const DisplayHelp = lazy(() => import("./DisplayHelp").then((m) => ({ default: m.DisplayHelp })));
const MenuSheet = lazy(() => import("./MenuSheet"));
import { useSession } from "@/lib/session";
import { usePrefs } from "@/lib/prefs";
import { postAction } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RoleSwitch, switchRole } from "@/journey/RoleSwitch";
import { t } from "@/i18n";

type Item = { to: string; label: string; icon: ReactNode; tour?: string; badge?: number };

function navFor(kind: "shopper" | "merchant" | null, needs: number): { main: Item[]; more: Item[] } {
  if (kind === "shopper")
    return {
      main: [
        { to: "/today", label: t("Today"), icon: <CalendarClock />, tour: "nav-today", badge: needs },
        { to: "/discover", label: t("Find"), icon: <Compass />, tour: "nav-discover" },
        { to: "/plans", label: t("Plans"), icon: <Map />, tour: "nav-plans" },
        { to: "/purchases", label: t("Bought"), icon: <ShoppingBag />, tour: "nav-purchases" },
      ],
      more: [
        { to: "/you", label: t("Things I own"), icon: <Package /> },
        { to: "/receipts", label: t("Add a receipt"), icon: <ReceiptText /> },
        { to: "/passport", label: t("Wallet and repeat buys"), icon: <Wallet /> },
        { to: "/guard", label: t("Rules and approvals"), icon: <Gavel />, tour: "nav-guard" },
        { to: "/safety", label: t("Scam protection"), icon: <ShieldCheck /> },
        { to: "/channels", label: t("Messages"), icon: <MessageSquare /> },
        { to: "/traces", label: t("What the assistant did"), icon: <Route /> },
      ],
    };
  if (kind === "merchant")
    return {
      main: [
        { to: "/merchant", label: t("Orders"), icon: <Inbox />, badge: 0 },
        { to: "/merchant/money", label: t("Money"), icon: <Wallet /> },
        { to: "/merchant/approvals", label: t("Approvals"), icon: <Gavel />, badge: needs },
        { to: "/channels", label: t("Messages"), icon: <MessageSquare /> },
      ],
      more: [{ to: "/traces", label: t("What the assistant did"), icon: <Route /> }],
    };
  return { main: [], more: [] };
}

const DEMO_LINKS: Item[] = [
  { to: "/?home=1#start", get label() { return t("Guided demo"); }, icon: <PlayCircle /> },
  { to: "/demo", get label() { return t("Demo controls"); }, icon: <RotateCcw /> },
  { to: "/console", get label() { return t("Operator console"); }, icon: <FlaskConical /> },
];

function Badge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="num ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-now px-1.5 text-[11px] font-bold text-paper" aria-label={t("{0} need you", n)}>
      {n}
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-xl font-medium tracking-tight", className)}>
      <svg viewBox="0 0 28 14" className="h-3.5 w-7" aria-hidden>
        <line x1="2" y1="7" x2="26" y2="7" stroke="var(--rule-2)" strokeWidth="2" strokeLinecap="round" />
        <line x1="2" y1="7" x2="15" y2="7" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="6" cy="7" r="3" fill="var(--done)" />
        <circle cx="15" cy="7" r="3.5" fill="var(--now)" />
        <circle cx="24" cy="7" r="2.5" fill="var(--card)" stroke="var(--ink-2)" strokeWidth="1.4" />
      </svg>
      <span className="max-[400px]:sr-only">{t("Everyday")}</span>
    </span>
  );
}

export function ThemeToggle() {
  const { prefs, set } = usePrefs();
  const next = prefs.theme === "system" ? "light" : prefs.theme === "light" ? "dark" : "system";
  const Icon = prefs.theme === "light" ? Sun : prefs.theme === "dark" ? Moon : SunMoon;
  return (
    <Button variant="ghost" size="icon-sm" onClick={() => set({ theme: next })} aria-label={t("Theme: {0}. Switch to {1}.", prefs.theme, next)} title={t("Theme: {0}", prefs.theme)}>
      <Icon className="size-4" />
    </Button>
  );
}

/** The honest demo ribbon: says this is a sandbox, shows the demo clock, and resets. */
function DemoRibbon() {
  const { session, refresh } = useSession();
  const nav = useNavigate();
  // E9: no Reset on the public landing page; it lives on the app's own screens and on /demo.
  const onLanding = useLocation().pathname === "/";
  const [busy, setBusy] = useState<string | null>(null);
  // The server puts the demo flag in the page, so the ribbon is there on first paint and nothing below it shifts.
  const boot = (window as { __EV_BOOT__?: { demo: boolean; paypal_env: string; who: { kind: string; clock?: string } | null } }).__EV_BOOT__;
  if (!(session ? session.demo : boot?.demo)) return null;
  const act = async (k: string, path: string, data?: Record<string, string>) => {
    setBusy(k);
    try {
      const r = await postAction(path, data);
      toast.success(r.ok ?? t("Done"));
      await refresh();
      window.dispatchEvent(new Event("ev:changed"));
      if (k === "reset") nav("/today");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const clock = session ? (session.who?.kind === "shopper" ? session.who.clock : null) : (boot?.who?.clock ?? null);
  return (
    <div data-tour="ribbon" className="border-b border-rule bg-sunk text-xs text-ink-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 px-4">
        <span className="font-semibold text-ink">{t("Demo")}</span>
        <span>
          {t("PayPal")}{" "}<b className="font-semibold text-ink">{session?.paypal_env ?? boot?.paypal_env}</b>{t(", test money only")}
        </span>
        {clock && (
          <span className="num">
            {t("· demo clock")}{" "}<b className="font-semibold text-ink">{clock}</b>
          </span>
        )}
        {session?.workspace?.progress_line && !session.workspace.finished && (
          <span role="status" aria-live="polite">· {session.workspace.progress_line}</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {clock && (
            <>
              <button className="min-h-11 rounded-full px-2.5 font-semibold text-ink hover:bg-card disabled:opacity-50" disabled={Boolean(busy)} onClick={() => act("day", "/demo/clock", { step: "day" })}>
                {t("+1 day")}
              </button>
              <button className="min-h-11 rounded-full px-2.5 font-semibold text-ink hover:bg-card disabled:opacity-50" disabled={Boolean(busy)} onClick={() => act("week", "/demo/clock", { step: "week" })}>
                {t("+1 week")}
              </button>
            </>
          )}
          {session?.workspace && onLanding ? null : session?.workspace ? (
            <button
              className="min-h-11 rounded-full px-2.5 font-semibold text-ink hover:bg-card disabled:opacity-50"
              disabled={Boolean(busy)}
              onClick={() => {
                if (confirm(t("Rebuild your own demo from the start? Only yours changes; nobody else's demo is touched."))) void act("reset", "/demo/reset");
              }}
            >
              <RotateCcw className="mr-1 inline size-3" />
              {t("Reset my demo")}
            </button>
          ) : session?.private_demos ? (
            <button className="min-h-11 rounded-full px-2.5 font-semibold text-ink hover:bg-card disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void act("start", "/demo/start", {}).then(() => nav("/today"))}>
              {t("Try the live demo")}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function NavItem({ i, onClick, compact }: { i: Item; onClick?: () => void; compact?: boolean }) {
  return (
    <NavLink
      to={i.to}
      end={i.to === "/merchant"}
      onClick={onClick}
      data-tour={i.tour}
      className={({ isActive }) =>
        cn(
          "flex min-h-11 items-center gap-3 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-sunk hover:text-ink [&_svg]:size-[18px]",
          isActive && "bg-ink text-paper hover:bg-ink hover:text-paper",
          compact && "rounded-md",
        )
      }
    >
      {i.icon}
      <span className="truncate">{i.label}</span>
      <Badge n={i.badge} />
    </NavLink>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { session, offline } = useSession();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const who = session?.who ?? null;
  const { main, more } = navFor(who?.kind ?? null, who?.needs ?? 0);
  useEffect(() => setOpen(false), [loc.pathname]);
  const signOut = async () => {
    await postAction("/logout").catch(() => undefined);
    window.location.assign("/");
  };
  const nav = useNavigate();
  // "Take the tour" opens the guided journeys on the home page: both sides, every step done by you.
  const tour = () => nav("/?home=1#start");
  const menuButton = (
    <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t("Menu")}>
      <Menu className="size-5" />
    </Button>
  );

  return (
    <div className="min-h-dvh bg-paper">
      <a href="#main" className="sr-only z-50 rounded bg-ink px-3 py-2 text-paper focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        {t("Skip to content")}
      </a>
      <DemoRibbon />
      {offline && (
        <div role="status" className="flex items-center justify-center gap-2 bg-wait-bg px-4 py-1.5 text-sm text-wait">
          <WifiOff className="size-4" />{" "}{t("You're offline. What's on screen may be out of date, and nothing can be paid or sent until you're back.")}
        </div>
      )}
      <header className="ev-role-bar sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4 min-[401px]:gap-2">
          <Link to={who ? (who.kind === "merchant" ? "/merchant" : "/today") : "/"} className="mr-auto rounded-md" aria-label={t("Everyday home")}>
            <Wordmark />
          </Link>
          {who && session?.demo ? (
            <div className="max-[399px]:hidden">
              <RoleSwitch />
            </div>
          ) : who ? (
            <span className="hidden text-sm text-ink-2 sm:inline">
              {who.kind === "merchant" ? t("Merchant · ") : ""}
              {who.first}
            </span>
          ) : null}
          <Suspense
            fallback={
              <Button variant="ghost" size="icon-sm" aria-label={t("Display and help")} title={t("Display and help")} disabled className="disabled:opacity-100">
                <Accessibility className="size-[18px]" />
              </Button>
            }
          >
            <DisplayHelp />
          </Suspense>
          <HandsFreeToggle />
          <LangPicker />
          <ThemeToggle />
          {who ? (
            <Suspense fallback={menuButton}>
              <MenuSheet open={open} onOpenChange={setOpen} trigger={menuButton} title={who.name} description={who.kind === "merchant" ? t("Merchant console") : t("Shopper")}>
                <nav className="flex flex-col gap-1 overflow-y-auto p-3" aria-label={t("More")}>
                  {[...main, ...more].map((i) => (
                    <NavItem key={i.to} i={i} onClick={() => setOpen(false)} />
                  ))}
                  {session?.demo && (
                    <>
                      <div className="eyebrow mt-4 px-3">{t("Demo")}</div>
                      <button
                        onClick={() => {
                          setOpen(false);
                          switchRole(who.kind === "merchant" ? "shopper" : "shop");
                        }}
                        className="flex min-h-11 items-center gap-3 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-sunk min-[400px]:hidden"
                      >
                        {who.kind === "merchant" ? <User className="size-[18px]" /> : <Store className="size-[18px]" />}{" "}
                        {who.kind === "merchant" ? t("Switch to the shopper") : t("Switch to the shop")}
                      </button>
                      {DEMO_LINKS.map((i) => (
                        <NavItem key={i.to} i={i} onClick={() => setOpen(false)} />
                      ))}
                    </>
                  )}
                  <button onClick={tour} className="flex min-h-11 items-center gap-3 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-sunk">
                    <PlayCircle className="size-[18px]" />{" "}{t("Take the tour")}
                  </button>
                  <button onClick={signOut} className="flex min-h-11 items-center gap-3 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-sunk">
                    <LogOut className="size-[18px]" />{" "}{t("Sign out")}
                  </button>
                </nav>
              </MenuSheet>
            </Suspense>
          ) : (
            <Button asChild size="sm" variant="outline" className="hidden sm:inline-flex">
              <Link to="/login">{t("Sign in")}</Link>
            </Button>
          )}
        </div>
      </header>

      <div className={cn("mx-auto max-w-6xl px-4", who && "lg:grid lg:grid-cols-[220px_1fr] lg:gap-8")}>
        {who && (
          <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] flex-col gap-1 overflow-y-auto py-6 lg:flex" aria-label={t("Main")}>
            {main.map((i) => (
              <NavItem key={i.to} i={i} />
            ))}
            <div className="my-2 border-t border-rule" />
            {more.map((i) => (
              <NavItem key={i.to} i={i} />
            ))}
            {session?.demo && (
              <>
                <div className="eyebrow mt-4 px-3">{t("Demo")}</div>
                {DEMO_LINKS.map((i) => (
                  <NavItem key={i.to} i={i} />
                ))}
              </>
            )}
            <div className="mt-auto flex flex-col gap-1 pt-4">
              <button data-tour="take-tour" onClick={tour} className="flex min-h-11 items-center gap-3 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-sunk">
                <PlayCircle className="size-[18px]" />{" "}{t("Take the tour")}
              </button>
              <button onClick={signOut} className="flex min-h-11 items-center gap-3 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-sunk">
                <LogOut className="size-[18px]" />{" "}{t("Sign out")}
              </button>
            </div>
          </aside>
        )}
        <main id="main" tabIndex={-1} className={cn("min-w-0 py-6 outline-none sm:py-8", who && "pb-28 lg:pb-10")}>
          {children}
        </main>
        {/* A7: the one live region every payment result and status change is announced through. */}
        <div id="ev-announce" role="status" aria-live="polite" aria-atomic="true" className="sr-only" />
      </div>

      {who && (
        <nav aria-label={t("Main")} className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper/95 backdrop-blur lg:hidden">
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {main.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === "/merchant"}
                data-tour={i.tour ? `${i.tour}-m` : undefined}
                className={({ isActive }) => cn("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-ink-2 [&_svg]:size-5", isActive && "text-ink")}
              >
                {({ isActive }) => (
                  <>
                    <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", isActive && "bg-ink text-paper")}>{i.icon}</span>
                    {i.label}
                    {i.badge ? <span className="num absolute top-1.5 right-[calc(50%-22px)] min-w-4 rounded-full bg-now px-1 text-center text-[10px] leading-4 text-paper">{i.badge}</span> : null}
                  </>
                )}
              </NavLink>
            ))}
            <button onClick={() => setOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-ink-2">
              <span className="flex h-7 w-12 items-center justify-center">
                <ChevronRight className="size-5 rotate-[-90deg]" />
              </span>
              {t("More")}
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

/** A small footer for public pages. */
export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-rule py-8 text-sm text-ink-2">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <span>{t("Everyday · a hackathon build on the PayPal sandbox")}</span>
        <a className="underline underline-offset-4" href="/llms.txt">
          {t("llms.txt")}
        </a>
        <a className="underline underline-offset-4" href="/skill.md">
          {t("skill.md")}
        </a>
        <Link className="underline underline-offset-4" to="/safety/model-card">
          {t("Scam model card")}
        </Link>
        <a className="underline underline-offset-4" href="https://github.com/PrathamRanjan/everyday">
          {t("Source (MIT)")}
        </a>
        <span className="inline-flex items-center gap-1">
          <Accessibility className="size-4" />{" "}{t("Display and help is in the header")}
        </span>
      </div>
    </footer>
  );
}
