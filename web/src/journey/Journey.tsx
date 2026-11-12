import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import type { Driver } from "driver.js";
import { Check, Store, User, X } from "lucide-react";
import { toast } from "sonner";
import { getJson, postAction } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { t, tn } from "@/i18n";
import { JOURNEYS, type Ctx, type JourneyId, type Role, type Step } from "./steps";

/* ---------- state, kept in localStorage so a trip to PayPal's page and back keeps the place ---------- */

type State = { id: JourneyId; i: number; ctx: Ctx; shown?: boolean };
const KEY = "ev-journey";
const read = (): State | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
};
const write = (s: State | null) => {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* the journey still runs in this tab */
  }
  window.dispatchEvent(new Event("ev:journey"));
};

type Personas = { ws: string | null; done: string[]; shopper: { id: string; name: string } | null; shop: { id: string; name: string } | null };

/** Starts a journey: builds the visitor's own demo first when they don't have one. */
export async function startJourney(id: JourneyId) {
  const s = await getJson<{ workspace: unknown; who: unknown }>("/api/ui/session").catch(() => null);
  if (!s?.workspace) await postAction("/demo/start", {});
  write({ id, i: 0, ctx: {} });
}
export const journeyActive = () => Boolean(read());

const pathOf = (route: string) => route.split("?")[0];
const routeOf = (st: Step, ctx: Ctx) => (typeof st.route === "string" ? st.route : st.route(ctx));
const whoRole = (kind?: string | null): Role | null => (kind === "merchant" ? "shop" : kind === "shopper" ? "shopper" : null);

/* ---------- the switch between shopper and shop: a colour wipe and who you are now ---------- */

function RoleWipe({ role, name }: { role: Role; name: string }) {
  return createPortal(
    <div className="ev-wipe fixed inset-0 z-[100000] flex items-center justify-center" data-role-wipe={role} role="status" aria-live="assertive">
      <div className="ev-wipe-text text-center text-white">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-white/15">{role === "shop" ? <Store className="size-8" /> : <User className="size-8" />}</div>
        <p className="eyebrow text-white/80">{role === "shop" ? t("Switching sides") : t("Back to the shopper")}</p>
        <p className="mt-2 font-display text-4xl sm:text-5xl">{role === "shop" ? tn("You're now {0}", name) : tn("You're Maya again")}</p>
        <p className="mt-2 text-white/80">{role === "shop" ? t("the shop that sold it") : t("the shopper")}</p>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- the host: navigates, highlights, waits for the real action, switches sides ---------- */

export function JourneyHost() {
  const [st, setSt] = useState<State | null>(read);
  const { session, refresh } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [wipe, setWipe] = useState<{ role: Role; name: string } | null>(null);
  const [justDone, setJustDone] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [nonce, setNonce] = useState(0);
  // While a bubble points at the page, the dock shrinks to a pill so it never covers the bubble.
  const [bubble, setBubble] = useState(false);
  const drv = useRef<Driver | null>(null);
  const ro = useRef<ResizeObserver | null>(null);
  const entered = useRef<string>("");
  const doneRef = useRef(false);

  useEffect(() => {
    const on = () => setSt(read());
    window.addEventListener("ev:journey", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("ev:journey", on);
      window.removeEventListener("storage", on);
    };
  }, []);

  // The page wears the colour of who you are: vermilion for the shopper, moss for the shop.
  const myRole = whoRole(session?.who?.kind);
  useEffect(() => {
    if (myRole) document.documentElement.dataset.role = myRole;
    else delete document.documentElement.dataset.role;
  }, [myRole]);

  const steps = st ? JOURNEYS[st.id].steps() : [];
  const step = st ? steps[st.i] : undefined;
  const route = step && st ? routeOf(step, st.ctx) : "";
  const here = Boolean(step && pathOf(route) === loc.pathname);

  const hide = useCallback(() => {
    ro.current?.disconnect();
    drv.current?.destroy();
    drv.current = null;
    setBubble(false);
  }, []);

  const end = useCallback(
    (finished: boolean) => {
      hide();
      write(null);
      if (finished) toast.success(t("That's the whole journey. Everything you did is in your own demo; look around as much as you like."));
    },
    [hide],
  );

  const advance = useCallback(
    (save?: string) => {
      const cur = read();
      if (!cur) return;
      const list = JOURNEYS[cur.id].steps();
      const s = list[cur.i];
      const ctx = { ...cur.ctx };
      if (s?.save && save) ctx[s.save] = save;
      hide();
      if (cur.i + 1 >= list.length) return end(true);
      write({ id: cur.id, i: cur.i + 1, ctx });
    },
    [end, hide],
  );

  const complete = useCallback(
    (save?: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      const cur = read();
      const s = cur ? JOURNEYS[cur.id].steps()[cur.i] : null;
      if (cur && s?.after) {
        // Stay on this step to show what happened, with a Next button.
        hide();
        write({ ...cur, ctx: s.save && save ? { ...cur.ctx, [s.save]: save } : cur.ctx, shown: true });
        return;
      }
      setJustDone(true);
      hide();
      setTimeout(() => {
        setJustDone(false);
        advance(save);
      }, 1100);
    },
    [advance, hide],
  );

  // Switches to the step's side (shopper or shop) with the colour wipe, inside the visitor's own demo.
  const switchTo = useCallback(
    async (role: Role, to: string) => {
      setSwitching(true);
      try {
        const p = await getJson<Personas>("/api/ui/journey");
        const who = role === "shop" ? p.shop : p.shopper;
        if (!who) throw new Error(t("This demo has no {0} to switch to. Start a new demo from the home page.", role === "shop" ? t("shop") : t("shopper")));
        setWipe({ role, name: who.name.replace(/\s*\(.*\)$/, "") });
        // While the cookie changes hands, the page underneath may get a 401; that's not a reason to send anyone to sign in.
        (window as { __evSwitching?: boolean }).__evSwitching = true;
        const [r] = await Promise.all([postAction("/login", { as: `${role === "shop" ? "mer" : "acc"}:${who.id}`, next: pathOf(to) }), new Promise((ok) => setTimeout(ok, 900))]);
        nav(to.includes("?") ? to : r.to || to);
        await refresh();
        setTimeout(() => {
          (window as { __evSwitching?: boolean }).__evSwitching = false;
          setWipe(null);
        }, 650);
      } catch (e) {
        (window as { __evSwitching?: boolean }).__evSwitching = false;
        setWipe(null);
        toast.error((e as Error).message);
      } finally {
        setSwitching(false);
      }
    },
    [nav, refresh],
  );

  // The header's switch (outside a journey too): be the other side, landing on its home screen.
  useEffect(() => {
    const on = (e: Event) => {
      const role = (e as CustomEvent<{ role: Role }>).detail.role;
      const cur = read();
      const s = cur ? JOURNEYS[cur.id].steps()[cur.i] : null;
      void switchTo(role, s && s.role === role ? routeOf(s, cur!.ctx) : role === "shop" ? "/merchant" : "/today");
    };
    window.addEventListener("ev:switch-role", on);
    return () => window.removeEventListener("ev:switch-role", on);
  }, [switchTo]);

  // On entering a step: be the right person, then go to its page (once; the judge may wander off and come back).
  useEffect(() => {
    if (!st || !step || !session) return;
    const key = `${st.id}:${st.i}`;
    if (entered.current === key) return;
    entered.current = key;
    doneRef.current = false;
    if (myRole !== step.role) void switchTo(step.role, route);
    else if (!here || (route.includes("?") && loc.search !== `?${route.split("?")[1]}`)) nav(route);
  }, [st, step, session, myRole, route, here, nav, switchTo, loc.search]);

  // Highlight the step's part of the page once it's there.
  useEffect(() => {
    if (!st || !step || !here || justDone || wipe || switching || myRole !== step.role) {
      if (!here) hide();
      return;
    }
    let gone = false;
    const show = async () => {
      let el: Element | null = null;
      for (let n = 0; n < 50 && !gone; n++) {
        for (const sel of step.el ?? []) {
          const e = document.querySelector(sel);
          if (e && (e as HTMLElement).offsetParent !== null) {
            el = e;
            break;
          }
        }
        if (el || !step.el?.length) break;
        await new Promise((ok) => setTimeout(ok, 150));
      }
      if (gone) return;
      const [{ driver }] = await Promise.all([import("driver.js"), import("driver.js/dist/driver.css")]);
      if (gone) return;
      drv.current?.destroy();
      const last = st.i === steps.length - 1;
      const d = driver({
        popoverClass: "ev-tour ev-journey",
        allowClose: true,
        overlayOpacity: 0.55,
        stagePadding: 8,
        stageRadius: 12,
        smoothScroll: true,
        animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
        // Closing the bubble only hides it; the dock keeps the place.
        onDestroyStarted: () => {
          drv.current?.destroy();
          drv.current = null;
          setBubble(false);
        },
      });
      drv.current = d;
      const shown = Boolean(st.shown && step.after);
      const waiting = Boolean(step.wait && !shown);
      const waitLine = waiting ? `<p class="ev-wait"><span class="ev-wait-dot"></span>${step.wait!.label}</p>` : "";
      d.highlight({
        element: (el as HTMLElement) ?? undefined,
        popover: {
          title: step.title,
          description: `${shown ? `<p class="ev-done">✓ ${t("Done")}</p>${step.after}` : step.body}${waitLine}${el || !step.el?.length ? "" : `<p class="ev-wait-miss">${t("This part isn't on the page yet. If it doesn't appear, press Skip in the box at the bottom.")}</p>`}`,
          progressText: `${st.i + 1} / ${steps.length}`,
          showProgress: true,
          showButtons: waiting ? ["close"] : ["next", "close"],
          nextBtnText: last ? t("Finish") : t("Next"),
          doneBtnText: t("Finish"),
          onNextClick: () => advance(),
        },
      });
      setBubble(true);
      // A part that grows (a pasted message, a result appearing) keeps its bubble beside it, never on top of its buttons.
      ro.current?.disconnect();
      if (el && "ResizeObserver" in window) {
        ro.current = new ResizeObserver(() => drv.current?.refresh());
        ro.current.observe(el);
      }
    };
    void show();
    return () => {
      gone = true;
    };
  }, [st, step, here, justDone, wipe, switching, myRole, steps.length, advance, hide, nonce]);

  // Wait for the real thing: an action the server accepted, the page the app moved to, or a step the server recorded.
  useEffect(() => {
    const w = step?.wait;
    if (!w?.action) return;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ path: string; to: string }>).detail;
      if (w.action!.test(d.path)) complete(step?.save ? d.to?.split("?")[0] : undefined);
    };
    window.addEventListener("ev:action", on);
    return () => window.removeEventListener("ev:action", on);
  }, [step, complete]);
  useEffect(() => {
    const w = step?.wait;
    if (w?.route && w.route.test(loc.pathname)) complete(loc.pathname);
  }, [step, loc.pathname, complete]);
  useEffect(() => {
    const key = step?.wait?.done;
    if (!key) return;
    let stop = false;
    const tick = async () => {
      const p = await getJson<Personas>("/api/ui/journey").catch(() => null);
      if (!stop && p?.done.includes(key)) {
        complete();
        window.dispatchEvent(new Event("ev:reload"));
      }
    };
    void tick();
    const iv = setInterval(tick, 2500);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [step, complete]);

  // A journey that has run past its demo (expired, reset elsewhere) ends quietly.
  useEffect(() => {
    if (st && session && !session.workspace && session.private_demos) end(false);
  }, [st, session, end]);

  useEffect(() => () => hide(), [hide]);

  if (!st || !step) return wipe ? <RoleWipe {...wipe} /> : null;
  const pct = Math.round(((st.i + (justDone ? 1 : 0)) / steps.length) * 100);
  if (bubble && !justDone)
    return (
      <>
        {wipe && <RoleWipe {...wipe} />}
        <button
          data-dock-role={step.role}
          onClick={() => hide()}
          title={t("Hide the bubble and show the guided demo's controls")}
          className="ev-dock fixed bottom-[76px] left-3 z-[10001] flex items-center gap-2 rounded-full border border-rule bg-card py-1.5 pr-3 pl-1.5 text-xs font-semibold shadow-[var(--shadow)] lg:bottom-5 lg:left-5"
        >
          <span className="ev-role-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
            {step.role === "shop" ? <Store className="size-3" /> : <User className="size-3" />}
            {step.role === "shop" ? t("Shop") : t("Shopper")}
          </span>
          <span className="num text-ink-2">{tn("Step {0} of {1}", st.i + 1, steps.length)}</span>
        </button>
      </>
    );
  return (
    <>
      {wipe && <RoleWipe {...wipe} />}
      <aside aria-label={t("Guided demo")} className="ev-dock fixed bottom-[76px] left-3 z-[10001] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-rule bg-card shadow-[var(--shadow)] lg:bottom-5 lg:left-5" data-dock-role={step.role}>
        <div className="h-1 bg-sunk">
          <div className="ev-dock-bar h-1 transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
        <div className="p-3.5">
          <div className="flex items-center gap-2">
            <span className={cn("ev-role-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold")}>
              {step.role === "shop" ? <Store className="size-3" /> : <User className="size-3" />}
              {step.role === "shop" ? t("Shop") : t("Shopper")}
            </span>
            <span className="num text-xs text-ink-2">{tn("{0} · step {1} of {2}", JOURNEYS[st.id].title, st.i + 1, steps.length)}</span>
            <button className="ml-auto rounded-full p-1 text-ink-2 hover:bg-sunk" aria-label={t("End the guided demo")} onClick={() => end(false)}>
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-1.5 font-display text-lg leading-snug">{step.title}</p>
          {justDone ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-done" role="status">
              <Check className="size-4" />{" "}{t("Done. On to the next step…")}
            </p>
          ) : step.wait && !st.shown ? (
            <p className="mt-1 flex items-center gap-2 text-sm text-ink-2" role="status">
              <span className="ev-wait-dot" aria-hidden />
              {step.wait.label}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {!here || myRole !== step.role ? (
              <button className="ev-dock-go min-h-9 rounded-full px-3 text-sm font-semibold" disabled={switching} onClick={() => (myRole !== step.role ? void switchTo(step.role, route) : nav(route))}>
                {t("Take me there")}
              </button>
            ) : (
              <button
                className="ev-dock-go min-h-9 rounded-full px-3 text-sm font-semibold"
                onClick={() => {
                  hide();
                  setNonce((n) => n + 1);
                }}
              >
                {t("Show me")}
              </button>
            )}
            {step.wait && !st.shown ? (
              <button className="min-h-9 rounded-full border border-rule px-3 text-sm font-medium text-ink-2 hover:bg-sunk" onClick={() => advance()}>
                {t("Skip this step")}
              </button>
            ) : (
              <button className="min-h-9 rounded-full border border-rule px-3 text-sm font-medium hover:bg-sunk" onClick={() => advance()}>
                {st.i === steps.length - 1 ? t("Finish") : t("Next")}
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
