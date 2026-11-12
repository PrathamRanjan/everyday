import { t } from "@/i18n";

/**
 * The guided demo: the judge does every step themselves (types the request, presses Plan it, pays on PayPal, ships as
 * the shop, approves the refund). A step with `wait` moves on only when that really happened: an action the server
 * accepted, a page the app moved to, or a step the server recorded (a refund PayPal confirmed).
 * How it works, and how to port it: docs/GUIDED_TOUR.md.
 */
export type Role = "shopper" | "shop";
export type JourneyId = "story";
export type Ctx = { plan?: string; order?: string };

/** A small label for the technology a step shows. The kind picks its colour. */
export type Tag = { label: string; kind: "paypal" | "ai" | "device" | "partner" | "code" };
/** One line on why the step matters to a judge, under one criterion. */
export type Why = { kind: "tech" | "impact" | "innovation"; text: string };

export interface Step {
  role: Role;
  /** Page for the step; a function reads what the judge made earlier (their plan, their order). */
  route: string | ((c: Ctx) => string);
  /** What to highlight; the first that is on screen wins. */
  el?: string[];
  title: string;
  body: string;
  tags?: Tag[];
  why?: Why;
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
  /** Asked of the server on entering the step, to make sure there is something to press. "open" = already done. */
  prepare?: string;
}

const pp = (label: string): Tag => ({ label, kind: "paypal" });
const ai = (label: string): Tag => ({ label, kind: "ai" });
const dev = (label: string): Tag => ({ label, kind: "device" });
const partner = (label: string): Tag => ({ label, kind: "partner" });
const code = (label: string): Tag => ({ label, kind: "code" });

const S = {
  get meet(): Step {
    return {
      role: "shopper",
      route: "/today",
      el: ["[data-tour=today-head]"],
      title: t("You're Maya, a shopper"),
      body: t("Today is Maya's home screen for everything she has bought. At the top: what needs her. Then money she can still get back, like a price drop a shop promised to match. Then the dates that matter: arrivals, return windows, warranties. Everything here is your own private copy, on PayPal's sandbox: real PayPal calls, test money."),
      tags: [pp("PayPal sandbox"), partner("Render: web + Postgres")],
      why: { kind: "impact", text: t("Most of what a purchase is worth is lost after checkout: return windows missed, price drops never claimed, warranties forgotten. Everyday works that side.") },
    };
  },
  get guard(): Step {
    return {
      role: "shopper",
      route: "/guard",
      el: ["[data-tour=rules]"],
      title: t("First, Maya's own rules"),
      body: t("Before anything is bought: a monthly limit in her own words, an approval line for anything an assistant suggests, and a kill switch that stops every money move at once. Code checks these before every PayPal call; no model can talk its way past them."),
      tags: [code("Policy gate in code"), code("Kill switch"), code("Passkey above a line")],
      why: { kind: "innovation", text: t("Agentic commerce with a leash: the AI proposes, code decides, PayPal moves. You'll see each one in turn.") },
    };
  },
  get ask(): Step {
    return {
      role: "shopper",
      route: "/plans?text=a%20wireless%20keyboard%20under%20%2480",
      el: ["[data-tour=plan-form]", "[data-tour=plan-new]"],
      title: t("Ask for something in a sentence"),
      body: t("Maya wants a wireless keyboard under $80. The sentence is typed in for you; change it if you like. Press Plan it. She could also paste a TikTok or YouTube link, a screenshot, or send it from Telegram or the Chrome extension."),
      tags: [ai("OpenAI Responses API"), dev("Telegram bot"), dev("Chrome extension")],
      wait: { label: t("Press Plan it"), route: /^\/plans\/[\w-]+$/ },
      save: "plan",
    };
  },
  get read(): Step {
    return {
      role: "shopper",
      route: (c) => c.plan ?? "/plans",
      el: ["[data-tour=plan-read]"],
      title: t("The AI reads, with receipts"),
      body: t("A model read the sentence into a request. Every field shows the exact words it came from; anything it can't quote is dropped. The budget is parsed by code, not the model."),
      tags: [ai("Structured output"), code("Quote-or-drop check")],
      why: { kind: "tech", text: t("The model's output schema has no money or PayPal fields at all, and a build-time test fails if one is ever added.") },
    };
  },
  get pick(): Step {
    return {
      role: "shopper",
      route: (c) => c.plan ?? "/plans",
      el: ["[data-tour=plan-pick]"],
      title: t("Code decides, and says why"),
      body: t("These products come from Northlight Supply's catalogue, the shop you'll play in a minute. Code checks each one against her budget with shipping, the date, and what she already owns. “As you asked” means words she typed. “Most shoppers like…” comes from a small preference model: it starts from a prior trained on synthetic shoppers and learns from Maya's own this-or-that choices. Further down, “Also found on the web” searches Channel3 live and checks each listing the same way."),
      tags: [partner("Channel3 product search"), ai("Preference model"), code("Hard rules")],
      why: { kind: "innovation", text: t("Every pick explains itself, and “Other options” shows what was ruled out and the exact reason.") },
    };
  },
  get quote(): Step {
    return {
      role: "shopper",
      route: (c) => c.plan ?? "/plans",
      el: ["[data-tour=plan-quote]"],
      title: t("Lock the exact total"),
      body: t("Press Get the exact quote. The total is fixed and hashed, so PayPal can only ever be asked for this amount."),
      tags: [code("Hashed quote"), pp("PayPal Orders v2")],
      wait: { label: t("Press Get the exact quote"), action: /\/plans\/[^/]+\/quote$/ },
    };
  },
  get pay(): Step {
    return {
      role: "shopper",
      route: (c) => c.plan ?? "/plans",
      el: ["[data-tour=pay]", "[data-tour=plan-quote]"],
      title: t("Pay with PayPal"),
      body: t("Two real PayPal sandbox payments to choose from. The yellow button pays at once from the demo's saved sandbox PayPal wallet, with no login. “Pay on PayPal's own page” opens PayPal's sandbox checkout, which needs a sandbox test account, then brings you straight back here."),
      tags: [pp("PayPal Vault v3"), pp("Orders v2"), pp("Payments v2")],
      why: { kind: "tech", text: t("The saved wallet is a Vault v3 payment token the owner approved once; each payment uses a fixed request id, so a retry can never charge twice.") },
      wait: { label: t("Pay, either way"), route: /^\/orders\/[\w-]+$/ },
      save: "order",
    };
  },
  get paid(): Step {
    return {
      role: "shopper",
      route: (c) => c.order ?? "/purchases",
      el: ["[data-tour=order-status]"],
      title: t("PayPal moved the money"),
      body: t("Everyday reads the capture back from PayPal before it says the order is paid. The capture id here is PayPal's own; it's also on the PayPal page in the menu."),
      tags: [pp("Capture read-back"), pp("Verified webhooks")],
      why: { kind: "tech", text: t("Paid is what PayPal says, never what the redirect says. Webhooks are signature-checked and only ever logged next to the read-back.") },
    };
  },
  get line(): Step {
    return {
      role: "shopper",
      route: (c) => c.order ?? "/purchases",
      el: ["[data-tour=lifeline]", "[data-tour=order-status]"],
      title: t("Then it looks after it"),
      body: t("Every purchase becomes a line through time: when it arrives, the return window, the shop's price promise and the warranty. Everyday watches each one and tells Maya on Telegram, by phone notification or in the app when something needs her."),
      tags: [dev("Telegram"), dev("Web push"), dev("Phone app (Expo)")],
      why: { kind: "impact", text: t("Nobody tracks return windows and price promises by hand. Everyday does it for every purchase, automatically.") },
    };
  },
  get ship(): Step {
    return {
      role: "shop",
      route: "/merchant",
      el: ["[data-tour=ship]", "[data-tour=merchant-orders]"],
      title: t("Now you're the shop"),
      body: t("Northlight Supply sells through Everyday. Maya's order is here, already paid through PayPal and already checked to fit what she asked for. Press Ship."),
      tags: [pp("PayPal order tracking")],
      wait: { label: t("Press Ship"), action: /\/merchant\/lines\/[^/]+\/ship$/ },
      get after() {
        return t("Shipped. The tracking number goes to PayPal, and Maya's arrival date and return window update on her side.");
      },
    };
  },
  get claim(): Step {
    return {
      role: "shopper",
      route: "/today",
      el: ["[data-tour=claim-drop]", "#money-back"],
      title: t("Money she can still get back"),
      body: t("Something Maya bought is cheaper now, and the shop's price promise still covers it. Everyday spotted it and has the evidence ready. Press Ask for … back."),
      tags: [code("Price-promise check")],
      why: { kind: "impact", text: t("Price-match promises only pay out if someone notices and asks. Everyday notices, and files the claim with the evidence.") },
      wait: { label: t("Press Ask for … back"), action: /\/lines\/[^/]+\/price-protection$/ },
      prepare: "/api/ui/journey/claim-ready",
    };
  },
  get approve(): Step {
    return {
      role: "shop",
      route: "/merchant",
      el: ["[data-tour=approve-case]", "[data-tour=merchant-cases]"],
      title: t("The claim reaches the shop"),
      body: t("It arrives with what was observed and the shop's own policy clause. Press Approve: Everyday sends the refund through PayPal, under the shop's refund rules."),
      tags: [pp("Payments v2 refunds")],
      wait: { label: t("Press Approve"), action: /\/merchant\/cases\/[^/]+$/ },
    };
  },
  get rules(): Step {
    return {
      role: "shop",
      route: "/merchant/approvals",
      el: ["[data-tour=merchant-rules]"],
      title: t("The shop has rules too"),
      body: t("The shop sets the largest refund share and an approval line. A refund at or above it waits here for a person; above the passkey line it needs a passkey. Every decision is written to a hash-chained audit log."),
      tags: [code("Hash-chained audit"), code("Passkey")],
      why: { kind: "innovation", text: t("Both sides of the sale get guardrails, not just the shopper.") },
    };
  },
  get refunded(): Step {
    return {
      role: "shopper",
      route: "/today",
      el: ["#money-back"],
      title: t("PayPal confirmed the refund"),
      body: t("Back as Maya. The refund counts only once PayPal reports it completed, which usually takes a few seconds. The amount moves to “already asked for” and then off the list."),
      tags: [pp("Refund read-back")],
      wait: { label: t("Waiting for PayPal to confirm the refund"), done: "refund_confirmed" },
    };
  },
  get scam(): Step {
    return {
      role: "shopper",
      route: "/safety",
      el: ["[data-tour=scam-page]"],
      title: t("A second pair of eyes"),
      body: t("Press Paste the demo scam, then Check this message. A scam model we trained ourselves runs right here in your browser, so for it the words never leave this device. Rules, a second reader on the server and a look for pay-to details judge it too, and the strictest wins."),
      tags: [dev("On-device model · 23 MB"), dev("ONNX in the browser"), ai("OpenAI Decisions API")],
      wait: { label: t("Press Check this message"), action: /^\/safety\/scan$/ },
      get after() {
        return t("That's the verdict. Each reader's result is in its own box, with the reasons underneath. A message that names somewhere to pay is never shown as clear.");
      },
      why: { kind: "tech", text: t("Our own MiniLM model, trained for this project and quantised to 23 MB, scores the message in the browser with no server call.") },
    };
  },
  get agents(): Step {
    return {
      role: "shopper",
      route: "/agents",
      el: ["main h1"],
      title: t("Agents shop inside the same rules"),
      body: t("Everyday is also an MCP server. An outside assistant can plan, quote and start a PayPal approval for Maya, inside her limits; it can't refund or change them. The Ask assistant reads PayPal through PayPal's own MCP server, with read-only tools."),
      tags: [ai("MCP server"), pp("PayPal MCP server")],
      why: { kind: "innovation", text: t("The same leash works for a person, our assistant, and any outside agent. That's the whole loop: ask, check, pay, look after, get money back.") },
    };
  },
};

export const JOURNEYS: Record<JourneyId, { title: string; minutes: number; steps: () => Step[] }> = {
  story: {
    get title() {
      return t("Guided demo");
    },
    minutes: 6,
    steps: () => [S.meet, S.guard, S.ask, S.read, S.pick, S.quote, S.pay, S.paid, S.line, S.ship, S.claim, S.approve, S.rules, S.refunded, S.scam, S.agents],
  },
};

/** The guided demo's steps, for the landing page's overview. */
export const STORY_COUNT = () => JOURNEYS.story.steps().length;
