import type { Driver } from "driver.js";
import { toast } from "sonner";
import { getJson } from "@/lib/api";
import { t } from "@/i18n";

/**
 * Guided tours (Driver.js, MIT). A tour is a list of steps; each step names the page it lives on. A3.3: a tour is
 * started only from a button, shows only the steps of the page it was started on, ends on any route change and never
 * calls the router. The judge page's self-ticking paths are the way through the whole product.
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
    { route: "/today", el: "[data-tour=today-head]", get title() { return t("Today"); }, get body() { return t("What needs you, at the top: plans ready to approve, questions, recalls and windows about to close. Everything else waits."); } },
    { route: "/today", el: "[data-tour=lifeline]", get title() { return t("The lifeline"); }, get body() { return t("Every purchase is a line through time. Marks are things that happened; the bands under it are your return window, price promise and warranty, with today's tick. The band turns vermilion in its last week."); } },
    { route: "/discover", el: "[data-tour=capture-form]", get title() { return t("Start from a clip or a sentence"); }, get body() { return t("Paste a TikTok or YouTube link, add a screenshot, or just say what you need. The model reads the words; code reads every number."); } },
    { route: newestPlan, el: "[data-tour=plan-pick]", get title() { return t("A checked plan"); }, get body() { return t("Each pick says why, in your words. Anything ruled out says why too — over budget once shipping is added, too slow for your deadline, or something you already own."); } },
    { route: "/purchases", el: "[data-tour=purchases]", get title() { return t("What you bought"); }, get body() { return t("Paid orders, each with PayPal's own status read back after capture."); } },
    { route: "/guard", el: "[data-tour=rules]", get title() { return t("Your rules"); }, get body() { return t("Limits in plain words. Anything at or above your approval line waits for a tap here; the kill switch stops all money moves at once."); } },
  ],
  merchant: [
    { route: "/merchant", el: "[data-tour=merchant-orders]", get title() { return t("Orders to fulfil"); }, get body() { return t("Ship, deliver or mark a line backordered. A backorder offers the shopper a checked swap and refunds any difference."); } },
    { route: "/merchant", el: "[data-tour=merchant-cases]", get title() { return t("Cases"); }, get body() { return t("Returns and price-protection claims arrive with what was observed and what the policy says. Your decision runs under your refund rules."); } },
    { route: "/merchant/approvals", el: "[data-tour=merchant-rules]", get title() { return t("Your refund rules"); }, get body() { return t("The largest refund share and the approval line. A refund at or above it waits here; above the passkey line it needs a passkey."); } },
    { route: "/merchant/money", el: "[data-tour=merchant-money]", get title() { return t("Money and disputes"); }, get body() { return t("Captured totals and fees from PayPal, tracking numbers sent to PayPal, and disputes synced from the sandbox."); } },
  ],
  judge: [
    { route: "/today", el: "[data-tour=today-head]", get title() { return t("1 · What needs Maya"); }, get body() { return t("Plans waiting for approval, a recall on headphones she owns, and her monthly limit. Numbers come from the data, not the copy."); } },
    { route: "/plans", el: "[data-tour=plan-new]", get title() { return t("2 · Say it in a sentence"); }, get body() { return t("Type “A quiet mouse under $45 by Thursday” and press Plan it. The model reads the words, with quotes as evidence; anything it can't quote is dropped. Budget and dates are parsed by code. The tour picks up on the plan."); }, waitFor: { get label() { return t("I'll write one"); }, resumeOn: /^\/plans\/[\w-]+$/ } },
    { route: newestPlan, el: "[data-tour=plan-read]", get title() { return t("3 · AI reads, with receipts"); }, get body() { return t("Each thing the model understood shows the exact words it came from. No quote, no field."); } },
    { route: newestPlan, el: "[data-tour=plan-pick]", get title() { return t("4 · Code decides"); }, get body() { return t("Candidates are filtered by hard rules (budget with shipping, deadline, what she owns), then ranked by her taste model. Ruled-out items say why."); } },
    { route: newestPlan, el: "[data-tour=plan-quote]", get title() { return t("5 · The live PayPal step"); }, get body() { return t("Get an exact quote (hashed, 15 minutes), then press “Pay with PayPal”. Sign in to the sandbox as the buyer and approve. The tour picks up when you're back."); }, waitFor: { get label() { return t("I'll pay now"); }, resumeOn: /^\/orders\// } },
    { route: newestOrder, el: "[data-tour=order-status]", get title() { return t("6 · PayPal moved the money"); }, get body() { return t("The capture is read back from PayPal and recorded once, even if the return redirect is lost. Its capture id is on the payment record."); } },
    { route: newestOrder, el: "[data-tour=lifeline]", get title() { return t("7 · After the sale"); }, get body() { return t("The return window, price promise and warranty start now. Use the demo clock in the ribbon to jump a week and watch the bands move."); } },
    { route: "/guard", el: "[data-tour=rules]", get title() { return t("8 · Try to break it"); }, get body() { return t("Flip the kill switch, or set a low approval line, then try a repeat buy from Wallet. The gate refuses before PayPal is asked. The evidence console shows every real count."); } },
  ],
};

let current: Driver | null = null;
let page: string | null = null;

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

/** The steps of a tour that live on this page; a tour never moves between pages (A3.3). */
async function stepsHere(kind: TourKind): Promise<Step[]> {
  const out: Step[] = [];
  for (const st of TOURS[kind]) {
    const route = typeof st.route === "string" ? st.route : await st.route().catch(() => "");
    if (route.split("?")[0] === location.pathname) out.push(st);
  }
  return out;
}

async function show(steps: Step[], i: number) {
  const step = steps[i];
  if (!step) return end();
  const el = step.el ? await wait(step.el) : null;
  if (page !== location.pathname) return end();
  current?.destroy();
  const last = i === steps.length - 1;
  // Loaded on first use, so the tour library isn't in the first page load.
  const [{ driver }] = await Promise.all([import("driver.js"), import("driver.js/dist/driver.css")]);
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
      title: step.title.replace(/^\d+ · /, ""),
      description: step.body + (step.el && !el ? " (This part isn't on screen yet; it appears once there's data.)" : ""),
      progressText: `${i + 1} of ${steps.length}`,
      showProgress: true,
      showButtons: i === 0 ? ["next", "close"] : ["previous", "next", "close"],
      nextBtnText: last ? "Finish" : "Next",
      prevBtnText: "Back",
      doneBtnText: "Finish",
      onNextClick: () => (last ? end() : void show(steps, i + 1)),
      onPrevClick: () => void show(steps, Math.max(0, i - 1)),
      onCloseClick: () => end(),
    },
  });
}

function end() {
  current?.destroy();
  current = null;
  page = null;
  write(null);
  try {
    localStorage.setItem("ev-toured", "1");
  } catch {
    /* ignore */
  }
}

/**
 * A3.3: a tour starts only from a button, explains the page it was started on, and never calls the router. Returns
 * false when this page has no tour steps (the caller says so).
 */
export async function startTour(kind: TourKind): Promise<boolean> {
  const steps = await stepsHere(kind);
  if (!steps.length) {
    toast(t("This page has no tour. The guided walk-throughs on the home page go through the whole demo."));
    return false;
  }
  page = location.pathname;
  write({ kind, i: 0, started: Date.now() });
  await show(steps, 0);
  return true;
}

/** Called on every navigation: a running tour ends on any route change. */
export function endTourOnRouteChange(pathname: string) {
  if (page && page !== pathname) end();
  else if (!page && read()) write(null);
}

export const tourActive = () => Boolean(read());
export const seenTour = () => {
  try {
    return localStorage.getItem("ev-toured") === "1";
  } catch {
    return true;
  }
};
