import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { getJson, postAction } from "@/lib/api";

/**
 * Guided tours (Driver.js, MIT). A tour is a list of steps; each step names the page it lives on, so the tour can
 * move between screens. Progress is kept in sessionStorage, which also survives the round trip to PayPal and back.
 */
export type TourKind = "shopper" | "merchant" | "judge";
interface Step {
  /** Page for the step; a function resolves ids from live data (the newest plan or order). */
  route: string | (() => Promise<string>);
  el?: string;
  title: string;
  body: string;
  /** The tour waits here for the person to act (e.g. pay with PayPal) and resumes on `resumeOn`. */
  waitFor?: { label: string; resumeOn: RegExp };
}

const KEY = "ev-tour";
type State = { kind: TourKind; i: number; waiting?: boolean; started: number };
const read = (): State | null => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
};
const write = (s: State | null) => {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* tours still run, they just won't resume */
  }
};

const newestPlan = async () => {
  const d = await getJson<{ plans: { id: string; status: string }[] }>("/api/ui/plans").catch(() => ({ plans: [] as any[] }));
  const p = d.plans.find((x) => x.status === "planning") ?? d.plans[0];
  return p ? `/plans/${p.id}` : "/plans";
};
const newestOrder = async () => {
  const d = await getJson<{ orders: { id: string; status: string }[] }>("/api/ui/purchases").catch(() => ({ orders: [] as any[] }));
  const o = d.orders.find((x) => x.status !== "created") ?? d.orders[0];
  return o ? `/orders/${o.id}` : "/purchases";
};

const TOURS: Record<TourKind, Step[]> = {
  shopper: [
    { route: "/today", el: "[data-tour=today-head]", title: "Today", body: "What needs you, at the top: plans ready to approve, questions, recalls and windows about to close. Everything else waits." },
    { route: "/today", el: "[data-tour=lifeline]", title: "The lifeline", body: "Every purchase is a line through time. Marks are things that happened; the bands under it are your return window, price promise and warranty, with today's tick. The band turns vermilion in its last week." },
    { route: "/discover", el: "[data-tour=capture-form]", title: "Start from a clip or a sentence", body: "Paste a TikTok or YouTube link, add a screenshot, or just say what you need. The model reads the words; code reads every number." },
    { route: newestPlan, el: "[data-tour=plan-pick]", title: "A checked plan", body: "Each pick says why, in your words. Anything ruled out says why too — over budget once shipping is added, too slow for your deadline, or something you already own." },
    { route: "/purchases", el: "[data-tour=purchases]", title: "What you bought", body: "Paid orders, each with PayPal's own status read back after capture." },
    { route: "/guard", el: "[data-tour=rules]", title: "Your rules", body: "Limits in plain words. Anything at or above your approval line waits for a tap here; the kill switch stops all money moves at once." },
  ],
  merchant: [
    { route: "/merchant", el: "[data-tour=merchant-orders]", title: "Orders to fulfil", body: "Ship, deliver or mark a line backordered. A backorder offers the shopper a checked swap and refunds any difference." },
    { route: "/merchant", el: "[data-tour=merchant-cases]", title: "Cases", body: "Returns and price-protection claims arrive with what was observed and what the policy says. Your decision runs under your refund mandate." },
    { route: "/merchant/approvals", el: "[data-tour=merchant-rules]", title: "Your refund mandate", body: "The largest refund share and the approval line. A refund at or above it waits here; above the countersign line it needs a passkey." },
    { route: "/merchant/money", el: "[data-tour=merchant-money]", title: "Money and disputes", body: "Captured totals and fees from PayPal, tracking numbers sent to PayPal, and disputes synced from the sandbox." },
  ],
  judge: [
    { route: "/judge", el: "[data-tour=judge-head]", title: "Judge mode · about 3 minutes", body: "You're Maya, a demo shopper, on the PayPal sandbox. Eight stops. The live PayPal step is real sandbox money. Use the arrow keys or the buttons." },
    { route: "/today", el: "[data-tour=today-head]", title: "1 · What needs Maya", body: "Plans waiting for approval, a recall on headphones she owns, and her monthly limit. Numbers come from the data, not the copy." },
    { route: "/discover", el: "[data-tour=capture-form]", title: "2 · A clip or a sentence", body: "Try “A quiet mouse under $45 by Thursday”. The model reads the words with quotes as evidence; anything it can't quote is dropped. Budget and dates are parsed by code." },
    { route: newestPlan, el: "[data-tour=plan-read]", title: "3 · AI reads, with receipts", body: "Each thing the model understood shows the exact words it came from. No quote, no field." },
    { route: newestPlan, el: "[data-tour=plan-pick]", title: "4 · Code decides", body: "Candidates are filtered by hard rules (budget with shipping, deadline, what she owns), then ranked by her taste model. Ruled-out items say why." },
    { route: newestPlan, el: "[data-tour=plan-quote]", title: "5 · The live PayPal step", body: "Get an exact quote (hashed, 15 minutes), then press “Pay with PayPal”. Sign in to the sandbox as the buyer and approve. The tour picks up when you're back.", waitFor: { label: "I'll pay now", resumeOn: /^\/orders\// } },
    { route: newestOrder, el: "[data-tour=order-status]", title: "6 · PayPal moved the money", body: "The capture is read back from PayPal and recorded once, even if the return redirect is lost. Its capture id is on the payment record." },
    { route: newestOrder, el: "[data-tour=lifeline]", title: "7 · After the sale", body: "The return window, price promise and warranty start now. Use the demo clock in the ribbon to jump a week and watch the bands move." },
    { route: "/guard", el: "[data-tour=rules]", title: "8 · Try to break it", body: "Flip the kill switch, or set a low approval line, then try a repeat buy from Wallet. The gate refuses before PayPal is asked. The evidence console shows every real count." },
  ],
};

let nav: ((to: string) => void) | null = null;
let current: Driver | null = null;
/** The router registers its navigate function so tours can move between pages. */
export const registerTourNav = (fn: (to: string) => void) => {
  nav = fn;
};

const wait = (sel: string, ms = 5000) =>
  new Promise<Element | null>((res) => {
    const t0 = Date.now();
    const tick = () => {
      const el = document.querySelector(sel);
      if (el && (el as HTMLElement).offsetParent !== null) return res(el);
      if (Date.now() - t0 > ms) return res(null);
      setTimeout(tick, 120);
    };
    tick();
  });

let showing = false;
async function show(s: State) {
  showing = true;
  try {
    await showStep(s);
  } finally {
    showing = false;
  }
}
async function showStep(s: State) {
  const steps = TOURS[s.kind];
  const step = steps[s.i];
  if (!step) return end();
  const route = typeof step.route === "string" ? step.route : await step.route();
  if (location.pathname !== route.split("?")[0]) nav?.(route);
  const el = step.el ? await wait(step.el) : null;
  current?.destroy();
  const last = s.i === steps.length - 1;
  const d = driver({
    popoverClass: "ev-tour",
    allowClose: true,
    overlayOpacity: 0.45,
    stagePadding: 6,
    stageRadius: 10,
    animate: !matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.a11yMotion !== "off",
    onDestroyStarted: () => end(),
  });
  current = d;
  d.highlight({
    element: (el as HTMLElement) ?? undefined,
    popover: {
      title: step.title,
      description: step.body + (step.el && !el ? " (This part isn't on screen yet — it appears once there's data.)" : ""),
      progressText: `${s.i + 1} of ${steps.length}`,
      showProgress: true,
      showButtons: s.i === 0 ? ["next", "close"] : ["previous", "next", "close"],
      nextBtnText: step.waitFor ? step.waitFor.label : last ? "Finish" : "Next",
      prevBtnText: "Back",
      doneBtnText: "Finish",
      onNextClick: () => {
        if (step.waitFor) {
          write({ ...s, i: s.i + 1, waiting: true });
          d.destroy();
          return;
        }
        if (last) return end();
        const n = { ...s, i: s.i + 1 };
        write(n);
        void show(n);
      },
      onPrevClick: () => {
        const n = { ...s, i: Math.max(0, s.i - 1), waiting: false };
        write(n);
        void show(n);
      },
      onCloseClick: () => end(),
    },
  });
}

function end() {
  current?.destroy();
  current = null;
  write(null);
  try {
    localStorage.setItem("ev-toured", "1");
  } catch {
    /* ignore */
  }
}

/** Start a tour from the first step. The judge tour signs in as the demo shopper first. */
export async function startTour(kind: TourKind) {
  if (kind === "judge") {
    const s = await getJson<{ who: { kind: string } | null }>("/api/ui/session").catch(() => null);
    if (s?.who?.kind !== "shopper") {
      const p = await getJson<{ accounts: { id: string }[] }>("/api/ui/personas").catch(() => null);
      if (p?.accounts[0]) {
        await postAction("/login", { as: `acc:${p.accounts[0].id}`, next: "/judge" }).catch(() => undefined);
        window.dispatchEvent(new Event("ev:changed"));
      }
    }
  }
  const s: State = { kind, i: 0, started: Date.now() };
  write(s);
  await show(s);
}

/** Called on every navigation: resumes a tour after a page change or the PayPal round trip. */
export function resumeTour(pathname: string) {
  const s = read();
  if (!s) return;
  const steps = TOURS[s.kind];
  if (s.waiting) {
    const prev = steps[s.i - 1];
    if (prev?.waitFor && prev.waitFor.resumeOn.test(pathname)) {
      const n = { ...s, waiting: false };
      write(n);
      setTimeout(() => void show(n), 400);
    }
    return;
  }
  if (!showing && !current?.isActive()) setTimeout(() => !showing && !current?.isActive() && void show(s), 300);
}

export const tourActive = () => Boolean(read());
export const seenTour = () => {
  try {
    return localStorage.getItem("ev-toured") === "1";
  } catch {
    return true;
  }
};
