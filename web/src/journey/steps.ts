import { t } from "@/i18n";

/**
 * Guided journeys: the judge does every step themselves (types the request, presses Plan it, pays on PayPal, ships as
 * the shop, approves the refund). A step with `wait` moves on only when that really happened: an action the server
 * accepted, a page the app moved to, or a step the server recorded (a refund PayPal confirmed).
 */
export type Role = "shopper" | "shop";
export type JourneyId = "story" | "shopper" | "shop";
export type Ctx = { plan?: string; order?: string };

export interface Step {
  role: Role;
  /** Page for the step; a function reads what the judge made earlier (their plan, their order). */
  route: string | ((c: Ctx) => string);
  /** What to highlight; the first that is on screen wins. */
  el?: string[];
  title: string;
  body: string;
  /** What the judge has to do. Without it, the step has a Next button. */
  wait?: {
    label: string;
    action?: RegExp;
    route?: RegExp;
    done?: string;
  };
  /** Once the action happened, the step stays to show the result with this text and a Next button. */
  after?: string;
  /** Saves the page the judge reached (their new plan or order) for later steps. */
  save?: keyof Ctx;
}

const S = {
  get meet(): Step {
    return { role: "shopper", route: "/today", el: ["[data-tour=today-head]"], title: t("You're Maya, a shopper"), body: t("Today is her home screen: what needs her, what she can still get back, and the dates that matter on everything she owns. Everything here is a private copy just for you, on PayPal's sandbox: real PayPal calls, test money.") };
  },
  get ask(): Step {
    return { role: "shopper", route: "/plans?text=a%20wireless%20keyboard%20under%20%2480", el: ["[data-tour=plan-form]", "[data-tour=plan-new]"], title: t("Ask for something in a sentence"), body: t("Maya wants a wireless keyboard under $80. The sentence is typed in for you; change it if you like. Press Plan it."), wait: { label: t("Press Plan it"), route: /^\/plans\/[\w-]+$/ }, save: "plan" };
  },
  get read(): Step {
    return { role: "shopper", route: (c) => c.plan ?? "/plans", el: ["[data-tour=plan-read]"], title: t("The AI reads, with receipts"), body: t("A model read the sentence. Every field shows the exact words it came from, and the budget is parsed by code, not the model. Anything it can't quote is dropped.") };
  },
  get pick(): Step {
    return { role: "shopper", route: (c) => c.plan ?? "/plans", el: ["[data-tour=plan-pick]"], title: t("Code decides"), body: t("Code checks every product against the budget with shipping, the date and what Maya already owns. Each pick says why; open “Other options” to see what was ruled out and why.") };
  },
  get quote(): Step {
    return { role: "shopper", route: (c) => c.plan ?? "/plans", el: ["[data-tour=plan-quote]"], title: t("Lock the exact total"), body: t("Press Get the exact quote. The total is fixed and hashed, so PayPal can only ever be asked for this amount."), wait: { label: t("Press Get the exact quote"), action: /\/plans\/[^/]+\/quote$/ } };
  },
  get pay(): Step {
    return { role: "shopper", route: (c) => c.plan ?? "/plans", el: ["[data-tour=pay]", "[data-tour=plan-quote]"], title: t("Pay with PayPal"), body: t("Two real PayPal sandbox payments to choose from. The yellow button pays at once from the demo's saved sandbox PayPal wallet, with no login. “Pay on PayPal's own page” takes you to PayPal's sandbox checkout to approve it yourself, then brings you straight back here."), wait: { label: t("Pay, either way"), route: /^\/orders\/[\w-]+$/ }, save: "order" };
  },
  get paid(): Step {
    return { role: "shopper", route: (c) => c.order ?? "/purchases", el: ["[data-tour=order-status]"], title: t("PayPal moved the money"), body: t("Everyday reads the capture back from PayPal before it says the order is paid. The capture id here is PayPal's own; it's also on the PayPal page in the menu.") };
  },
  get line(): Step {
    return { role: "shopper", route: (c) => c.order ?? "/purchases", el: ["[data-tour=lifeline]", "[data-tour=order-status]"], title: t("Then it looks after it"), body: t("Every purchase becomes a line through time: when it arrives, the return window, the shop's price promise and the warranty. Everyday watches each one for Maya.") };
  },
  get ship(): Step {
    return { role: "shop", route: "/merchant", el: ["[data-tour=ship]", "[data-tour=merchant-orders]"], title: t("Now you're the shop"), body: t("Northlight Supply sells through Everyday. Maya's order is here, already paid through PayPal and already checked to fit what she asked for. Press Ship."), wait: { label: t("Press Ship"), action: /\/merchant\/lines\/[^/]+\/ship$/ }, get after() { return t("Shipped. The line moves on, the tracking goes to PayPal, and Maya's arrival date and return window update on her side."); } };
  },
  get claim(): Step {
    return { role: "shopper", route: "/today", el: ["[data-tour=claim-drop]", "#money-back"], title: t("Money she can still get back"), body: t("Something Maya bought is cheaper now, and the shop's price promise still covers it. Everyday spotted it. Press Ask for … back."), wait: { label: t("Press Ask for … back"), action: /\/lines\/[^/]+\/price-protection$/ } };
  },
  get approve(): Step {
    return { role: "shop", route: "/merchant", el: ["[data-tour=approve-case]", "[data-tour=merchant-cases]"], title: t("The claim reaches the shop"), body: t("It arrives with what was observed and the shop's own policy clause. Press Approve: Everyday sends the refund through PayPal, under the shop's refund rules."), wait: { label: t("Press Approve"), action: /\/merchant\/cases\/[^/]+$/ } };
  },
  get rules(): Step {
    return { role: "shop", route: "/merchant/approvals", el: ["[data-tour=merchant-rules]"], title: t("The shop's refund rules"), body: t("The shop sets the largest refund share and an approval line. A refund at or above it waits here for a person; above the passkey line it needs a passkey.") };
  },
  get refunded(): Step {
    return { role: "shopper", route: "/today", el: ["#money-back"], title: t("PayPal confirmed the refund"), body: t("Back as Maya. The refund counts only once PayPal reports it completed, which usually takes a few seconds. The amount moves to “already asked for” and then off the list."), wait: { label: t("Waiting for PayPal to confirm the refund"), done: "refund_confirmed" } };
  },
  get scam(): Step {
    return { role: "shopper", route: "/safety", el: ["[data-tour=scam-page]"], title: t("A second pair of eyes"), body: t("Press Paste the demo scam, then Check this message. A model on this device, rules and a look for pay-to details each judge it, and the strictest wins."), wait: { label: t("Press Check this message"), action: /^\/safety\/scan$/ }, get after() { return t("That's the verdict. Each reader's result is in its own box, with the reasons underneath. A message that names somewhere to pay is never shown as clear."); } };
  },
  get guard(): Step {
    return { role: "shopper", route: "/guard", el: ["[data-tour=rules]"], title: t("Maya's own rules"), body: t("Limits in her own words, an approval line for anything an assistant suggests, and a kill switch that stops every money move at once. That's the whole loop: ask, check, pay, look after, get money back.") };
  },
  get shopHome(): Step {
    return { role: "shop", route: "/merchant", el: ["[data-tour=merchant-orders]"], title: t("You're Northlight Supply, the shop"), body: t("Orders arrive here already paid through PayPal and already checked to fit what the shopper asked for. Ship and deliver each line; a backorder offers the shopper a checked swap.") };
  },
  get shopCases(): Step {
    return { role: "shop", route: "/merchant", el: ["[data-tour=merchant-cases]"], title: t("Cases"), body: t("Returns, damage and price-promise claims arrive with what was observed and the policy clause. Approving one sends the refund through PayPal.") };
  },
  get shopMoney(): Step {
    return { role: "shop", route: "/merchant/money", el: ["[data-tour=merchant-money]"], title: t("Money and disputes"), body: t("Captured totals and fees read from PayPal, tracking sent to PayPal, and disputes synced from the sandbox.") };
  },
};

export const JOURNEYS: Record<JourneyId, { title: string; minutes: number; steps: () => Step[] }> = {
  story: { get title() { return t("The whole story, both sides"); }, minutes: 6, steps: () => [S.meet, S.ask, S.read, S.pick, S.quote, S.pay, S.paid, S.line, S.ship, S.claim, S.approve, S.rules, S.refunded, S.scam, S.guard] },
  shopper: { get title() { return t("As the shopper"); }, minutes: 3, steps: () => [S.meet, S.ask, S.read, S.pick, S.quote, S.pay, S.paid, S.line, S.scam, S.guard] },
  shop: { get title() { return t("As the shop"); }, minutes: 2, steps: () => [S.shopHome, S.shopCases, S.rules, S.shopMoney] },
};
