import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Accessibility,
  ArrowRight,
  BadgeCheck,
  Bot,
  BrainCircuit,
  CalendarClock,
  Check,
  Puzzle,
  Cpu,
  CreditCard,
  Hand,
  Languages,
  MessageCircle,
  Receipt,
  ScanText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  Undo2,
  User,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Lifeline, type Band, type Mark } from "@/components/Lifeline";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ThemeToggle, Wordmark } from "@/components/Shell";
import { LangPicker } from "@/components/LangPicker";
import { NumberTicker } from "@/components/magic";
import { Busy } from "@/components/kit";
import { ScamCheck } from "@/components/ScamCheck";
import { postAction, useApi } from "@/lib/api";
import { addDays, day, money } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { TwoSides } from "@/journey/TwoSides";
import { startJourney } from "@/journey/Journey";
import { JOURNEYS } from "@/journey/steps";
import { t, N_, tn } from "@/i18n";

interface Preview {
  line: { title: string; cents: number; status: string; number: string; paid: boolean; capture_id: string | null; dates: { ordered: string | null; eta: string | null; delivered: string | null; return_days: number; protection_days: number } } | null;
  owned: { title: string; price_cents: number; acquired: string; return_until: string | null; warranty_until: string | null; source: string }[];
  today: string;
}
interface PayPalApis {
  apis: { key: string; api: string; endpoint: string; live: { id: string; at: string } | null }[];
}
type Kind = "paypal" | "ai" | "device" | "partner" | "code";

/** The hero's lifeline, read from this instance's newest paid order line, or an example. */
function heroOf(p: Preview | null): { title: string; cents: number | null; marks: Mark[]; bands: Band[]; today: string; caption: string } {
  const today = p?.today ?? new Date().toISOString().slice(0, 10);
  if (p?.line) {
    const d = p.line.dates;
    const start = d.delivered ?? d.eta ?? d.ordered ?? today;
    const marks: Mark[] = [
      { key: "o", label: t("Paid"), date: d.ordered, tone: "done", note: money(p.line.cents) },
      ...(d.delivered ? [{ key: "d", label: t("Delivered"), date: d.delivered, tone: "done" as const }] : d.eta ? [{ key: "e", label: t("Arrives"), date: d.eta, tone: "wait" as const }] : []),
    ];
    const bands: Band[] = [{ key: "r", label: t("Return window"), from: start, to: addDays(start, d.return_days) }];
    if (d.protection_days) bands.push({ key: "p", label: t("Price promise"), from: d.ordered ?? start, to: addDays(d.ordered ?? start, d.protection_days) });
    const w = p.owned.find((o) => o.warranty_until);
    if (w?.warranty_until) bands.push({ key: "w", label: t("Warranty"), from: w.acquired, to: w.warranty_until });
    return { title: p.line.title, cents: p.line.cents, marks, bands, today, caption: p.line.capture_id ? t("Live sandbox order {0} · PayPal capture {1}", p.line.number, p.line.capture_id) : t("Live sandbox order {0}", p.line.number) };
  }
  return {
    title: t("Quiet Keys Wireless Keyboard"),
    cents: 4900,
    marks: [
      { key: "o", label: t("Paid"), date: addDays(today, -9), tone: "done", note: "$49.00" },
      { key: "d", label: t("Delivered"), date: addDays(today, -6), tone: "done" },
    ],
    bands: [
      { key: "r", label: t("Return window"), from: addDays(today, -6), to: addDays(today, 24) },
      { key: "p", label: t("Price promise"), from: addDays(today, -9), to: addDays(today, 21) },
      { key: "w", label: t("Warranty"), from: addDays(today, -6), to: addDays(today, 359) },
    ],
    today,
    caption: t("Example timeline"),
  };
}

const NAV: [string, string][] = [
  ["#why", N_("Why")],
  ["#how", N_("How it works")],
  ["#features", N_("Features")],
  ["#criteria", N_("For judges")],
  ["#pricing", N_("Pricing")],
];

const FAQ = [
  [N_("Does the AI spend my money?"), N_("No. The model reads words and pictures. Code checks budgets, dates and your rules. PayPal moves the money, and only after you approve the exact total. Anything at or above your own approval line waits for a tap.")],
  [N_("Is this real money?"), N_("No. Everything runs on the PayPal sandbox with test accounts, but every call is a real sandbox call: orders, captures, refunds, vaulting, tracking and disputes, each with PayPal's own id.")],
  [N_("Where do the products come from?"), N_("In the demo, from Northlight Supply's catalogue: a sandbox shop that takes PayPal checkout. A live Channel3 product search adds listings from across the web, checked by the same code and marked as links to buy elsewhere.")],
  [N_("How does it know what I like?"), N_("Words you type count as requirements. On top, a small preference model starts from a prior trained on synthetic shoppers and learns from your own this-or-that choices. You can see what it learned, and forget any of it.")],
  [N_("Can I turn it off?"), N_("Yes. One kill switch stops every money move, from the app, the phone app or by sending “stop” to the Telegram bot.")],
];

function Section({ id, n, eyebrow, title, lede, children, className }: { id: string; n: string; eyebrow: string; title: string; lede?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-20 py-20 sm:py-24", className)} aria-labelledby={`${id}-h`}>
      <div className="mx-auto max-w-6xl px-4">
        <p className="flex items-center gap-3 font-mono text-xs tracking-wide text-ink-2 uppercase">
          <span className="rounded-full border border-rule-2 px-2 py-0.5">{n}</span>
          {eyebrow}
        </p>
        <h2 id={`${id}-h`} className="mt-4 max-w-3xl text-4xl font-semibold sm:text-5xl">
          {title}
        </h2>
        {lede && <p className="prose-w mt-4 text-lg text-ink-2">{lede}</p>}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function Pill({ children, kind = "code" }: { children: React.ReactNode; kind?: Kind }) {
  return (
    <span className="ev-tag !m-0 !text-[0.72rem]" data-kind={kind}>
      {children}
    </span>
  );
}

function Feature({ i, h, b, tags, to, href, className }: { i: React.ReactNode; h: string; b: string; tags: [string, Kind][]; to?: string; href?: string; className?: string }) {
  const inner = (
    <>
      <span className="flex size-10 items-center justify-center rounded-xl bg-sunk text-ink [&_svg]:size-5">{i}</span>
      <h3 className="mt-4 text-lg font-semibold">{h}</h3>
      <p className="mt-1.5 flex-1 text-sm text-ink-2">{b}</p>
      <p className="mt-4 flex flex-wrap gap-1.5">
        {tags.map(([l, k]) => (
          <Pill key={l} kind={k}>
            {l}
          </Pill>
        ))}
      </p>
    </>
  );
  const cls = cn("flex min-w-0 flex-col rounded-2xl border border-rule bg-card p-6 transition-shadow [overflow-wrap:anywhere]", (to || href) && "hover:shadow-[var(--shadow)]", className);
  if (to)
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  if (href)
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  return <div className={cls}>{inner}</div>;
}

export default function Landing() {
  const { session, refresh } = useSession();
  const nav = useNavigate();
  const pv = useApi<Preview>("/api/ui/preview");
  const pp = useApi<PayPalApis>("/api/public/paypal");
  const hero = heroOf(pv.data);
  const who = session?.who;
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    document.title = t("Everyday — Buy the right thing once. Then stop worrying about it.");
  }, []);

  const startDemo = async () => {
    setBusy("demo");
    try {
      await startJourney("story");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const explore = async (role: "shopper" | "shop") => {
    setBusy(role);
    try {
      if (!session?.workspace) await postAction("/demo/start", {});
      await refresh();
      if (role === "shop") window.dispatchEvent(new CustomEvent("ev:switch-role", { detail: { role } }));
      else nav("/today");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const live = pp.data?.apis.filter((a) => a.live).length ?? 0;
  const steps = JOURNEYS.story.steps();
  const buyer = session?.sandbox_buyer;
  const onDark = "rounded-full border-white/25 bg-transparent text-[#eef2ec] hover:bg-white/10 hover:text-white";

  const startBtn = () => (
    <Button size="lg" onClick={() => void startDemo()} disabled={Boolean(busy)} className="rounded-full bg-signal text-signal-ink hover:bg-signal/90">
      <Busy on={busy === "demo"}>{null}</Busy>
      {t("Start the guided demo")}
      <ArrowRight className="size-4" />
    </Button>
  );

  return (
    <div className="min-h-dvh bg-paper">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-ink">
        {t("Skip to content")}
      </a>

      {/* ---------- header ---------- */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-night/90 text-[#eef2ec] backdrop-blur supports-[backdrop-filter]:bg-night/75">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-1 px-4 py-2 min-[401px]:gap-2">
          <Link to="/" className="mr-auto rounded-md text-[#eef2ec]" aria-label={t("Everyday home")}>
            <Wordmark />
          </Link>
          <nav aria-label={t("On this page")} className="hidden min-w-0 flex-wrap items-center justify-end gap-1 lg:flex">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} className="rounded-full px-3 py-1.5 text-sm text-[#eef2ec]/75 transition-colors hover:bg-white/10 hover:text-[#eef2ec]">
                {t(label)}
              </a>
            ))}
          </nav>
          <div className="flex items-center [&_button]:text-[#eef2ec] [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
            <LangPicker />
            <ThemeToggle />
          </div>
          {who ? (
            <Button size="sm" className="rounded-full bg-[#eef2ec] text-[#0b0f0d] hover:bg-white" onClick={() => nav(who.kind === "merchant" ? "/merchant" : "/today")}>
              {t("Open my demo")}
            </Button>
          ) : (
            <Button size="sm" className="rounded-full bg-signal text-signal-ink hover:bg-signal/90 max-[420px]:hidden" onClick={() => void startDemo()} disabled={Boolean(busy)}>
              {t("Try it")}
            </Button>
          )}
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        {/* ---------- hero ---------- */}
        <section className="relative overflow-hidden bg-night text-[#eef2ec]" aria-labelledby="hero-h">
          <div className="ev-hero-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pt-16 pb-20 sm:pt-24 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pb-28">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-[#eef2ec]/80">
                <span className="size-1.5 rounded-full bg-signal" aria-hidden />
                {t("Live on the PayPal sandbox · a PayPal Developer hackathon build")}
              </p>
              <h1 id="hero-h" className="mt-6 text-5xl leading-[0.98] font-semibold break-words sm:text-7xl">
                {t("Buy the right thing once.")} <span className="text-signal">{t("Then stop worrying about it.")}</span>
              </h1>
              <p className="prose-w mt-6 text-lg text-[#eef2ec]/75">{t("Everyday is an AI shopping assistant on PayPal that keeps working after checkout. It plans the purchase, pays only inside your own rules, and claims back what you're owed: price drops, late deliveries, damaged items.")}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {startBtn()}
                <Button size="lg" variant="outline" className={onDark} onClick={() => document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" })}>
                  {t("What the demo covers")}
                </Button>
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#eef2ec]/70">
                {[t("No sign-up or key"), t("Your own private copy"), t("Real PayPal sandbox calls")].map((x) => (
                  <li key={x} className="flex items-center gap-1.5">
                    <Check className="size-4 text-signal" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>

            {/* The app, as it looks after checkout: one purchase's line through time. */}
            <figure className="relative min-w-0" aria-label={t("A purchase in Everyday")}>
              <div className="ev-hero-glow pointer-events-none absolute -inset-8" aria-hidden />
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-card text-ink shadow-2xl">
                <div className="flex items-center gap-1.5 border-b border-rule bg-sunk px-4 py-2.5" aria-hidden>
                  <span className="size-2.5 rounded-full bg-rule-2" />
                  <span className="size-2.5 rounded-full bg-rule-2" />
                  <span className="size-2.5 rounded-full bg-rule-2" />
                  <span className="ml-3 truncate font-mono text-[0.7rem] text-ink-2">pph-everyday.onrender.com/today</span>
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow">{t("Maya bought")}</p>
                      <p className="mt-1 truncate font-display text-2xl font-semibold" data-no-i18n>
                        {hero.title}
                      </p>
                    </div>
                    {hero.cents !== null && <NumberTicker value={hero.cents} format={money} className="shrink-0 font-display text-2xl font-semibold" />}
                  </div>
                  <div className="mt-4">
                    <Lifeline marks={hero.marks} bands={hero.bands} today={hero.today} compact title={t("{0} lifeline", hero.title)} />
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-done/30 bg-done-bg p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-done">
                        <Undo2 className="size-3.5" />
                        {t("Money back found")}
                      </p>
                      <p className="mt-1 text-sm">{t("Price dropped $7 inside the shop's price promise. Claim ready, with evidence.")}</p>
                    </div>
                    <div className="rounded-xl border border-wait/30 bg-wait-bg p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-wait">
                        <ShieldCheck className="size-3.5" />
                        {t("Scam held")}
                      </p>
                      <p className="mt-1 text-sm">{t("“Pay our new PayPal” message: hold, don't pay. Checked on this device.")}</p>
                    </div>
                  </div>
                  <p className="id mt-3 text-[0.7rem] text-ink-2">{hero.caption}</p>
                </div>
              </div>
            </figure>
          </div>

          {/* What it's built on. The count is read from this server: an API counts once PayPal has returned a real sandbox id for it. */}
          <div className="relative border-t border-white/10">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-6 text-sm text-[#eef2ec]/70">
              <span className="font-mono text-xs tracking-wide text-[#eef2ec]/55 uppercase">{t("Built on")}</span>
              {["PayPal Orders v2", "Payments v2", "Vault v3", "Disputes v1", "Transaction Search", "Webhooks", "PayPal MCP", "OpenAI Responses + Decisions", "Channel3", "Render"].map((x) => (
                <span key={x} className="font-medium text-[#eef2ec]/85">
                  {x}
                </span>
              ))}
              {pp.data && (
                <Link to="/paypal" className="ml-auto inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-[#eef2ec]/85 hover:bg-white/10">
                  <span className="size-1.5 rounded-full bg-signal" aria-hidden />
                  {tn("{0} of {1} PayPal APIs have a live sandbox id", live, pp.data.apis.length)}
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* ---------- why it exists ---------- */}
        <Section id="why" n="01" eyebrow={t("Why it exists")} title={t("Checkout takes a minute. Owning it takes years.")} lede={t("Shopping apps stop at the receipt. Everything after it, the part where money is actually lost, is left to memory: return windows, price promises, warranties, recalls and the scams that follow a purchase. Everyday is built for that part, for two people at once: the shopper and the small shop that sold to them.")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { i: <CalendarClock />, p: t("Return windows close quietly"), s: t("Every purchase gets a line through time. Everyday counts down the return window and nudges before it shuts.") },
              { i: <Undo2 />, p: t("Price promises go unclaimed"), s: t("When a price drops inside the shop's promise, the claim is filed for you, with the observed price and the policy clause.") },
              { i: <BadgeCheck />, p: t("Warranties and recalls get forgotten"), s: t("Warranty end dates in calendar years, and recalls matched to what you own.") },
              { i: <ShieldCheck />, p: t("Scams arrive right after you buy"), s: t("“Your parcel is held, pay here” messages are checked on your device before you pay anyone.") },
              { i: <Bot />, p: t("AI agents can spend without limits"), s: t("Your limits, approval line and kill switch are enforced in code before any PayPal call, for people and agents alike.") },
              { i: <Store />, p: t("Small shops drown in claims"), s: t("Claims reach the shop pre-checked, with evidence, under refund rules the shop sets.") },
            ].map((x) => (
              <div key={x.p} className="rounded-2xl border border-rule bg-card p-6">
                <span className="flex size-10 items-center justify-center rounded-xl bg-sunk text-ink [&_svg]:size-5">{x.i}</span>
                <h3 className="mt-5 text-xl font-semibold">{x.p}</h3>
                <p className="mt-2 text-ink-2">{x.s}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------- how it works ---------- */}
        <Section id="how" n="02" eyebrow={t("How it works")} title={t("The AI proposes. Code decides. PayPal moves.")} lede={t("Three lanes, kept apart on purpose, on every screen that touches money.")} className="bg-sunk/60">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { i: <ScanText />, h: t("AI proposes"), b: t("Reads a sentence, a screenshot, a TikTok or YouTube link or a receipt photo into a request, quoting the exact words each field came from."), no: t("Its output schema has no money or PayPal fields; a build-time test fails if one is added."), tags: [["OpenAI Responses API", "ai"], ["Decisions API", "ai"], ["Vision", "ai"]] as [string, Kind][] },
              { i: <Cpu />, h: t("Code decides"), b: t("Budget with shipping, arrival before your date, what you already own, your limits, the approval line, the kill switch and the scam screen."), no: t("Every number is parsed by code, never taken from the model."), tags: [["Policy gate", "code"], ["Hash-chained audit", "code"], ["Passkeys", "code"]] as [string, Kind][] },
              { i: <CreditCard />, h: t("PayPal moves"), b: t("You approve one exact, hashed total. Captures and refunds are read back from PayPal before Everyday says they happened."), no: t("Fixed request ids, so a retry can never charge twice."), tags: [["Orders v2", "paypal"], ["Payments v2", "paypal"], ["Vault v3", "paypal"]] as [string, Kind][] },
            ].map((x, k) => (
              <div key={x.h} className="rounded-2xl border border-rule bg-card p-6">
                <span className="font-mono text-xs text-ink-2">0{k + 1}</span>
                <div className="mt-2 flex items-center gap-2 [&_svg]:size-5">
                  {x.i}
                  <h3 className="text-2xl font-semibold">{x.h}</h3>
                </div>
                <p className="mt-3">{x.b}</p>
                <p className="mt-3 border-t border-dashed border-rule-2 pt-3 text-sm text-ink-2">{x.no}</p>
                <p className="mt-4 flex flex-wrap gap-1.5">
                  {x.tags.map(([l, k2]) => (
                    <Pill key={l} kind={k2}>
                      {l}
                    </Pill>
                  ))}
                </p>
              </div>
            ))}
          </div>
          <TwoSides />
        </Section>

        {/* ---------- features ---------- */}
        <Section id="features" n="03" eyebrow={t("Features")} title={t("Everywhere the shopper already is.")} lede={t("The same rules and the same records behind every door: the web app, a phone app, a browser extension, a Telegram bot and outside AI agents.")}>
          <div className="grid gap-4 md:grid-cols-6">
            <div className="rounded-2xl border border-rule bg-card p-6 md:col-span-4 md:row-span-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-5 shrink-0" />
                <h3 className="text-2xl font-semibold">{t("A scam model that runs on your device")}</h3>
              </div>
              <p className="mt-2 text-ink-2">{t("Our own MiniLM model, trained for this project and quantised to 23 MB, scores a message in your browser with ONNX Runtime Web. For that score the words never leave the device. Rules, a second reader and a pay-to check run too; the strictest wins. Try it:")}</p>
              <p className="mt-3 flex flex-wrap gap-1.5">
                <Pill kind="device">{t("On-device · 23 MB")}</Pill>
                <Pill kind="device">ONNX Runtime Web</Pill>
                <Pill kind="ai">OpenAI Decisions API</Pill>
              </p>
              <div className="mt-5 rounded-xl border border-rule bg-paper p-4">
                <ScamCheck context="landing" demo="Hi, hope you're well. Just a heads-up that we've moved banks this month, so please send this month's payment to our new PayPal: accounts.dept@outlook.com. Thanks so much!" />
              </div>
            </div>
            <Feature className="md:col-span-2" i={<Bot />} h={t("An MCP server for agents")} b={t("Outside assistants can plan, quote and start a PayPal approval inside the shopper's rules. They can't refund or change limits. Ask reads PayPal through PayPal's own MCP server.")} tags={[["MCP", "ai"], ["PayPal MCP", "paypal"]]} to="/agents" />
            <Feature className="md:col-span-2" i={<MessageCircle />} h={t("A Telegram bot")} b={t("Share a link with @everyday_paypal_demo_bot and get a plan back. Approvals come with buttons; send “stop” to freeze every payment.")} tags={[["Telegram Bot API", "device"]]} href="https://t.me/everyday_paypal_demo_bot" />
            {(
              [
                { i: <Puzzle />, h: t("A Chrome extension"), b: t("Plan or save a product from any shop page, and check a cart against your rules before you pay."), tags: [["Manifest V3", "device"]], href: "/downloads/everyday-extension.zip" },
                { i: <Smartphone />, h: t("A phone app"), b: t("Today, plans, approvals and the kill switch, with Face ID and a PayPal approval that comes back to the app."), tags: [["Expo · React Native", "device"]] },
                { i: <Hand />, h: t("Hands-free"), b: t("Look and Say: point with your hand and speak; a money move needs “confirm” said back. Hand tracking runs on the device."), tags: [["MediaPipe", "device"]] },
                { i: <Languages />, h: t("Four languages"), b: t("English, Hindi, Bahasa Indonesia and Portuguese, including what the AI writes and what you say."), tags: [["i18n", "code"]] },
                { i: <Accessibility />, h: t("Accessible by default"), b: t("axe on every journey, 200% text at 320 px, keyboard-only checkout, reduced motion and a Display and help panel."), tags: [["axe · WCAG AA", "code"]], to: "/accessibility" },
                { i: <Sparkles />, h: t("A taste model you control"), b: t("Learned from product embeddings, opt-in, and every learned preference can be seen and forgotten."), tags: [["Embeddings", "ai"]] },
                { i: <Receipt />, h: t("Receipts from any shop"), b: t("Photograph a receipt; a vision model reads it and code checks the dates, so things bought elsewhere are looked after too."), tags: [["Vision", "ai"]] },
                { i: <Wallet />, h: t("One-tap sandbox wallet"), b: t("A Vault v3 payment token approved once, so judges can pay without a PayPal login."), tags: [["Vault v3", "paypal"]] },
                { i: <BrainCircuit />, h: t("Evidence, not claims"), b: t("Evaluation suites, every model call and every PayPal call are public, with ids you can check."), tags: [["Evals", "code"]], to: "/proof" },
              ] as { i: React.ReactNode; h: string; b: string; tags: [string, Kind][]; to?: string; href?: string }[]
            ).map((x) => (
              <Feature key={x.h} {...x} className="md:col-span-2" />
            ))}
          </div>
        </Section>

        {/* ---------- the guided demo ---------- */}
        <section id="demo" className="scroll-mt-20 border-y border-white/10 bg-night py-20 text-[#eef2ec] sm:py-24" aria-labelledby="demo-h">
          <div className="mx-auto max-w-6xl px-4">
            <p className="flex items-center gap-3 font-mono text-xs tracking-wide text-[#eef2ec]/65 uppercase">
              <span className="rounded-full border border-white/20 px-2 py-0.5">04</span>
              {t("The guided demo")}
            </p>
            <div className="mt-4 grid gap-10 lg:grid-cols-[1fr_1.1fr]">
              <div className="min-w-0">
                <h2 id="demo-h" className="text-4xl font-semibold sm:text-5xl">
                  {t("Play both sides. Press every button yourself.")}
                </h2>
                <p className="mt-4 text-lg text-[#eef2ec]/75">{tn("One guided demo, about {0} minutes. Where you have to act there's no Next button: the page points at the real button, and moves on only when the server, or PayPal, says it really happened. A colour wipe takes you between Maya and the shop.", JOURNEYS.story.minutes)}</p>
                <div className="mt-8">{startBtn()}</div>
                <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm">
                  <p className="flex items-center gap-2 font-semibold">
                    <CreditCard className="size-4 text-signal" />
                    {t("Paying with PayPal in the demo")}
                  </p>
                  <p className="mt-2 text-[#eef2ec]/75">{t("Every payment and refund is a real PayPal sandbox call with test money. The yellow button pays at once from a sandbox wallet saved for the demo, with no login.")}</p>
                  <p className="mt-2 text-[#eef2ec]/75">
                    {buyer ? (
                      <>
                        {t("“Pay on PayPal's own page” opens PayPal's sandbox checkout. Sign in there with this test buyer:")}{" "}
                        <span className="mt-1 block rounded-md bg-black/30 px-3 py-2 font-mono text-xs">
                          {buyer.email}
                          {buyer.password ? <> · {buyer.password}</> : null}
                        </span>
                      </>
                    ) : (
                      t("“Pay on PayPal's own page” opens PayPal's sandbox checkout, which only accepts sandbox test accounts, never a real PayPal login. Without one, use the one-tap button.")
                    )}
                  </p>
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-[#eef2ec]/65">{t("Or look around on your own:")}</span>
                  <Button size="sm" variant="outline" className={onDark} disabled={Boolean(busy)} onClick={() => void explore("shopper")}>
                    <Busy on={busy === "shopper"}>
                      <User className="size-4" />
                    </Busy>
                    {t("Enter as Maya")}
                  </Button>
                  <Button size="sm" variant="outline" className={onDark} disabled={Boolean(busy)} onClick={() => void explore("shop")}>
                    <Busy on={busy === "shop"}>
                      <Store className="size-4" />
                    </Busy>
                    {t("Enter as the shop")}
                  </Button>
                </div>
              </div>
              <ol className="grid content-start gap-2 sm:grid-cols-2" aria-label={t("The steps of the guided demo")}>
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold", s.role === "shop" ? "bg-[#62d79c] text-[#06210f]" : "bg-[#ff8a4c] text-[#2a0f02]")}>{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{s.title}</span>
                      <span className="block text-xs text-[#eef2ec]/60">
                        {s.role === "shop" ? t("as the shop") : t("as Maya")}
                        {s.wait ? ` · ${t("you act")}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ---------- why it should win ---------- */}
        <Section id="criteria" n="05" eyebrow={t("For the judges")} title={t("Why Everyday deserves to win")} lede={t("The judging criteria, and where to check each claim for yourself.")}>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                h: t("Technological implementation"),
                pts: [t("10 PayPal APIs wired in: Orders v2, Payments v2 captures and refunds, Vault v3, order tracking, Disputes v1, Transaction Search, verified webhooks, and PayPal's MCP server. The PayPal page shows the live sandbox id for each."), t("OpenAI Responses API with a repair attempt and a backup model, the Decisions API as a second reader, vision for receipts, and an agent with read-only tools."), t("Two models of our own that run in the browser: a 23 MB scam model and a taste model."), t("Idempotent payments, PayPal read-back before any state changes, and a hash-chained audit log.")],
                links: [["/paypal", t("Every PayPal call")], ["/ai", t("Every model call")]],
              },
              {
                h: t("Design"),
                pts: [t("A complete product for two people, not a proof of concept: the shopper's app and the shop's console share one set of records."), t("Every payment screen shows one exact total, who decides what, and what happens next."), t("Phone app, Chrome extension, Telegram, hands-free and four languages, all on the same rules."), t("Accessibility tested: axe on every journey, 200% text, keyboard-only checkout.")],
                links: [["/accessibility", t("Accessibility results")]],
              },
              {
                h: t("Potential impact"),
                pts: [t("For online shoppers who lose money after checkout: missed returns, unclaimed price promises, forgotten warranties, scams."), t("For small shops: claims arrive checked, with evidence, under their own refund rules, instead of as angry emails."), t("Shown end to end in the guided demo: a price drop found, claimed, approved by the shop and refunded by PayPal.")],
                links: [["/proof", t("Evaluation results")]],
              },
              {
                h: t("Innovation"),
                pts: [t("Commerce that keeps working after the sale, on both sides of it."), t("Agentic commerce with a leash: the same limits bind a person, our assistant and any outside agent over MCP."), t("Every AI reading quotes its source words, and every pick explains itself, including what was ruled out and why.")],
                links: [["/agents", t("Connect an agent")]],
              },
            ].map((c, k) => (
              <div key={c.h} className="rounded-2xl border border-rule bg-card p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-signal font-mono text-xs font-bold text-signal-ink">{k + 1}</span>
                  <h3 className="text-2xl font-semibold">{c.h}</h3>
                </div>
                <ul className="mt-4 space-y-2.5">
                  {c.pts.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <Check className="mt-1 size-4 shrink-0 text-done" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 flex flex-wrap gap-4 border-t border-rule pt-4 text-sm">
                  {c.links.map(([to, l]) => (
                    <Link key={to} to={to} className="inline-flex items-center gap-1 font-medium underline underline-offset-4">
                      {l}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  ))}
                </p>
              </div>
            ))}
          </div>

          <h3 className="mt-14 text-2xl font-semibold">{t("Built for these tracks")}</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                { h: t("Best Use of PayPal + AI"), b: t("The AI never touches money; PayPal is the only thing that moves it, and every result is read back. Ask answers questions about your orders through PayPal's MCP server."), kind: "paypal" },
                { h: t("Best Use of Agentic Commerce"), b: t("Everyday is an MCP server: agents plan, quote and start PayPal approvals inside the shopper's limits, and are refused anything else."), kind: "ai" },
                { h: t("Best Use of Channel3"), b: t("Live Channel3 product search adds listings from across the web. Code checks each listing's own words for what you asked, and doesn't trust the category."), kind: "partner" },
                { h: t("Best Use of Render"), b: t("Web service and Postgres on Render, a render.yaml blueprint, a health check, and a private workspace per visitor, deleted after 48 hours."), kind: "partner" },
                { h: t("Most Impactful"), b: t("Money people are owed, found and claimed for them, and scams held before they pay."), kind: "code" },
                { h: t("Most Creative"), b: t("A guided demo you play from both sides, switching with a colour wipe, moving on only when PayPal says so."), kind: "device" },
              ] as { h: string; b: string; kind: Kind }[]
            ).map((x) => (
              <div key={x.h} className="rounded-2xl border border-rule bg-card p-5">
                <Pill kind={x.kind}>{t("Track")}</Pill>
                <h4 className="mt-3 font-display text-lg font-semibold">{x.h}</h4>
                <p className="mt-1.5 text-sm text-ink-2">{x.b}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------- pricing ---------- */}
        <Section id="pricing" n="06" eyebrow={t("Pricing")} title={t("Free for shoppers. Shops pay when it works.")} lede={t("Illustrative pricing for after the hackathon. Nothing is for sale, and nothing in the demo is charged for real.")} className="bg-sunk/60">
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              { h: t("Shopper"), p: "$0", u: t("forever"), pts: [t("Plans, exact quotes and PayPal checkout"), t("Every return, price-promise and warranty date"), t("Price-drop claims and cases"), t("Scam checks and your own spending rules")], cta: t("Start the guided demo"), hi: false },
              { h: t("Shop"), p: "1%", u: t("of orders that come through Everyday"), pts: [t("Orders arrive already checked for fit"), t("Claims arrive with evidence and your policy clause"), t("Refund rules, approvals and passkeys"), t("PayPal tracking and disputes in one place")], cta: t("Try the shop's side"), hi: true },
              { h: t("Assistants"), p: t("Custom"), u: t("for AI platforms"), pts: [t("MCP access to plan, quote and start approvals"), t("Always inside the shopper's limits"), t("Refunds and limits stay with people"), t("A full audit trail per agent")], cta: t("Connect an agent"), hi: false },
            ].map((x, k) => (
              <div key={x.h} className={cn("flex flex-col rounded-2xl border p-6", x.hi ? "border-night bg-night text-[#eef2ec] ring-2 ring-signal/70" : "border-rule bg-card")}>
                <h3 className="text-xl font-semibold">{x.h}</h3>
                <p className="mt-3 font-display text-5xl font-semibold">{x.p}</p>
                <p className={cn("mt-1 text-sm", x.hi ? "text-[#eef2ec]/70" : "text-ink-2")}>{x.u}</p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {x.pts.map((p) => (
                    <li key={p} className="flex gap-2">
                      <Check className={cn("mt-0.5 size-4 shrink-0", x.hi ? "text-signal" : "text-done")} />
                      {p}
                    </li>
                  ))}
                </ul>
                <Button className={cn("mt-6 rounded-full", x.hi && "bg-signal text-signal-ink hover:bg-signal/90")} variant={x.hi ? "default" : "outline"} disabled={Boolean(busy)} onClick={() => (k === 0 ? void startDemo() : k === 1 ? void explore("shop") : nav("/agents"))}>
                  {x.cta}
                </Button>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------- questions ---------- */}
        <Section id="faq" n="07" eyebrow={t("Questions")} title={t("What people ask first")}>
          <Accordion type="single" collapsible className="max-w-3xl rounded-2xl border border-rule bg-card px-5">
            {FAQ.map(([q, a]) => (
              <AccordionItem key={q} value={q} className="border-rule">
                <AccordionTrigger className="min-h-12 text-base font-medium">{t(q)}</AccordionTrigger>
                <AccordionContent className="prose-w text-ink-2">{t(a)}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Section>

        <section className="px-4 pb-20" aria-labelledby="end-h">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-night px-6 py-14 text-center text-[#eef2ec] sm:px-12">
            <div className="ev-hero-grid pointer-events-none absolute inset-0" aria-hidden />
            <h2 id="end-h" className="relative text-4xl font-semibold sm:text-5xl">
              {t("See it with real sandbox money.")}
            </h2>
            <p className="relative mx-auto mt-3 max-w-2xl text-[#eef2ec]/75">{tn("Ask, pay, ship, claim and refund, from both sides, in about {0} minutes.", JOURNEYS.story.minutes)}</p>
            <div className="relative mt-8 flex justify-center">{startBtn()}</div>
            {pv.data?.line && <p className="relative mt-4 text-xs text-[#eef2ec]/55">{tn("The purchase at the top is read from the showcase demo. Its clock reads {0}.", day(hero.today))}</p>}
          </div>
        </section>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-8 text-sm text-ink-2">
          <span className="text-ink">
            <Wordmark className="text-base" />
          </span>
          <span>{t("A hackathon build on the PayPal sandbox")}</span>
          <Link className="underline underline-offset-4" to="/proof">
            {t("Proof")}
          </Link>
          <Link className="underline underline-offset-4" to="/paypal">
            {t("PayPal calls")}
          </Link>
          <Link className="underline underline-offset-4" to="/ai">
            {t("AI calls")}
          </Link>
          <Link className="underline underline-offset-4" to="/who-can-move-money">
            {t("Who can move money")}
          </Link>
          <Link className="underline underline-offset-4" to="/safety/model-card">
            {t("Scam model card")}
          </Link>
          <a className="underline underline-offset-4" href="/llms.txt">
            llms.txt
          </a>
        </div>
      </footer>
    </div>
  );
}
