import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowRight, Cpu, ScanText, ShieldCheck } from "lucide-react";
import { Lifeline, type Band, type Mark } from "@/components/Lifeline";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { PublicFooter } from "@/components/Shell";
import { BorderBeam, NumberTicker } from "@/components/magic";
import { Amount, Busy, State } from "@/components/kit";
import { useAction, useApi } from "@/lib/api";
import { addDays, day, money } from "@/lib/format";
import { useSession } from "@/lib/session";
import { ScamCheck } from "@/components/ScamCheck";
import { LangLinks } from "@/components/LangPicker";
import { t, N_, tn } from "@/i18n";

interface Preview {
  line: { title: string; cents: number; status: string; number: string; paid: boolean; capture_id: string | null; dates: { ordered: string | null; eta: string | null; delivered: string | null; return_days: number; protection_days: number } } | null;
  owned: { title: string; price_cents: number; acquired: string; return_until: string | null; warranty_until: string | null; source: string }[];
  today: string;
}

/** Builds the hero lifeline from this instance's newest paid order line, or an owned item. */
function heroOf(p: Preview | null): { title: string; cents: number | null; marks: Mark[]; bands: Band[]; today: string; live: boolean; caption: string } {
  const today = p?.today ?? new Date().toISOString().slice(0, 10);
  if (p?.line) {
    const d = p.line.dates;
    const arrived = d.delivered ?? d.eta;
    const start = arrived ?? d.ordered ?? today;
    const marks: Mark[] = [
      { key: "o", label: t("Paid"), date: d.ordered, tone: "done", note: money(p.line.cents) },
      ...(d.delivered ? [{ key: "d", label: t("Delivered"), date: d.delivered, tone: "done" as const }] : d.eta ? [{ key: "e", label: t("Arrives"), date: d.eta, tone: "wait" as const }] : []),
    ];
    const bands: Band[] = [{ key: "r", label: t("Return window"), from: start, to: addDays(start, d.return_days) }];
    if (d.protection_days) bands.push({ key: "p", label: t("Price promise"), from: d.ordered ?? start, to: addDays(d.ordered ?? start, d.protection_days) });
    const w = p.owned.find((o) => o.warranty_until);
    if (w?.warranty_until) bands.push({ key: "w", label: t("Warranty · {0}", w.title), from: w.acquired, to: w.warranty_until });
    return { title: p.line.title, cents: p.line.cents, marks, bands, today, live: true, caption: t("Live from this demo: order {0}{1}.", p.line.number, p.line.capture_id ? t(", PayPal capture {0}", p.line.capture_id) : "") };
  }
  const o = p?.owned[0];
  if (o) {
    const bands: Band[] = [];
    if (o.return_until) bands.push({ key: "r", label: t("Return window"), from: o.acquired, to: o.return_until });
    if (o.warranty_until) bands.push({ key: "w", label: t("Warranty"), from: o.acquired, to: o.warranty_until });
    return { title: o.title, cents: o.price_cents, marks: [{ key: "a", label: t("Bought"), date: o.acquired, tone: "done", note: money(o.price_cents) }], bands, today, live: true, caption: t("Live from this demo: an item Maya owns.") };
  }
  return {
    title: t("Arc Desk Lamp"),
    cents: 6400,
    marks: [
      { key: "o", label: t("Paid"), date: addDays(today, -9), tone: "done", note: "$64.00" },
      { key: "d", label: t("Delivered"), date: addDays(today, -6), tone: "done" },
    ],
    bands: [
      { key: "r", label: t("Return window"), from: addDays(today, -6), to: addDays(today, 24) },
      { key: "w", label: t("Warranty"), from: addDays(today, -6), to: addDays(today, 724) },
    ],
    today,
    live: false,
    caption: t("Example. This demo has no orders yet."),
  };
}

const STEPS = [
  { n: "1", get t() { return t("Show it"); }, get b() { return t("Paste a TikTok or YouTube link, add a screenshot, or just say “a quiet mouse under $45 by Thursday”."); } },
  { n: "2", get t() { return t("Check the plan"); }, get b() { return t("Everyday rules out what won't fit — over budget once shipping's added, too late for your date, the monitor you already own — and says why. You approve one exact total on PayPal."); } },
  { n: "3", get t() { return t("Let it watch"); }, get b() { return t("Delays, damage, a lower price, a recall: each becomes a swap, a case or money back. Every return window, price promise and warranty date stays in one line."); } },
];

const FAQ = [
  [N_("Does the AI spend my money?"), N_("No. The model reads words and pictures. Code checks budgets, dates and your rules. PayPal moves the money, and only after you approve the exact total on PayPal. Anything at or above your own approval line waits for a tap.")],
  [N_("What does the AI actually read?"), N_("Your request (what, for whom, by when, which qualities), a screenshot, or a video's public cover image. Every reading carries the exact words it came from; anything it can't quote is dropped. It never sets a price, a refund or a payee.")],
  [N_("Which shops does it work with?"), N_("In this demo, one sandbox test merchant (Northlight Supply) takes PayPal checkout. Other results come from a product search (Channel3) and are shown as links to buy elsewhere, clearly marked.")],
  [N_("Is this real money?"), N_("No. Everything runs on the PayPal sandbox with test accounts. The PayPal calls are real sandbox calls: orders, captures, refunds, vaulting, tracking and disputes.")],
  [N_("What happens when a delivery is late?"), N_("If a line is backordered past your date, Everyday offers an in-stock swap that passes the same checks, and refunds any difference to your PayPal once PayPal confirms it.")],
  [N_("Can I turn it off?"), N_("Yes. One kill switch on Rules stops every money move. You can also forget what it learned about your taste, item by item or all at once.")],
];

export default function Landing() {
  const { session } = useSession();
  const nav = useNavigate();
  const pv = useApi<Preview>("/api/ui/preview");
  const hero = heroOf(pv.data);
  useEffect(() => {
    document.title = t("Everyday — Buy the right thing once. Then stop worrying about it.");
  }, []);
  const who = session?.who;
  const { run: act, busy } = useAction();
  // A1: one tap builds the visitor's own private copy of the demo and signs them in as its Maya.
  // E10: it lands on Ask with a question typed, so the first thing a visitor sees is the assistant at work.
  const tryDemo = () => void act("start", "/demo/start", { next: `/ask?q=${encodeURIComponent(t("What can I still get money back on?"))}` });

  return (
    <div className="ev-rise">
      <section className="grid gap-8 pt-2 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12 lg:pt-8">
        <div className="min-w-0">
          <div className="eyebrow mb-3">{t("For the things you buy online")}</div>
          <h1 className="text-[2.5rem] leading-[1.05] font-medium break-words sm:text-6xl">
            {t("Buy the right thing once.")}{" "}<span className="text-ink-2">{t("Then stop worrying about it.")}</span>
          </h1>
          <p className="prose-w mt-5 text-lg text-ink-2">
            {t("Show Everyday something you liked. It works out what fits your life, buys it only with your approval on PayPal, and looks after it until the return window, the price promise and the warranty run out.")}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" onClick={tryDemo} data-tour="try-demo" disabled={Boolean(busy)}>
              <Busy on={busy === "start"}>{null}</Busy>{t("Try the live demo")}{" "}<ArrowRight className="size-4" />
            </Button>
            {who ? (
              <Button size="lg" variant="outline" onClick={() => nav(who.kind === "merchant" ? "/merchant" : "/today")}>
                {tn("Open my {0}", who.kind === "merchant" ? t("console") : t("day"))}
              </Button>
            ) : (
              <Button size="lg" variant="outline" asChild>
                <Link to="/login">{t("Sign in with a key")}</Link>
              </Button>
            )}
          </div>
          <LangLinks className="mt-4" />
          <p className="mt-3 text-sm text-ink-2">{t("Your own private copy of the demo: Maya, her shop and real PayPal sandbox payments. Nobody else sees what you do in it, and it is deleted 48 hours after your last visit. No real money.")}</p>
        </div>

        <figure className="relative min-w-0 rounded-xl border border-rule bg-card p-4 shadow-[var(--shadow)] sm:p-5" aria-label={t("Live preview")}>
          <BorderBeam />
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="eyebrow">
                {hero.live ? t("Live preview") : t("Preview")} <span className="ml-1 rounded-full border border-rule px-1.5 py-px text-[0.65rem] normal-case">{t("Sample data")}</span>
              </div>
              <p className="mt-1 truncate font-display text-2xl">{hero.title}</p>
            </div>
            {hero.cents !== null && (
              <div className="shrink-0 text-right">
                <div className="eyebrow">{t("Paid")}</div>
                <NumberTicker value={hero.cents} format={money} className="font-display text-2xl" />
              </div>
            )}
          </div>
          <Lifeline marks={hero.marks} bands={hero.bands} today={hero.today} compact title={`${hero.title} lifeline`} />
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2" aria-label={t("What the timeline shows")}>
            {hero.marks.filter((m) => m.date).map((m) => (
              <div key={m.key} className="flex justify-between gap-2 border-b border-rule/60 py-1">
                <dt className="text-ink-2">{m.label}</dt>
                <dd className="num">{day(m.date!)}</dd>
              </div>
            ))}
            {hero.bands.map((b) => (
              <div key={b.key} className="flex justify-between gap-2 border-b border-rule/60 py-1">
                <dt className="min-w-0 truncate text-ink-2">{tn("{0} ends", b.label)}</dt>
                <dd className="num shrink-0">{day(b.to)}</dd>
              </div>
            ))}
          </dl>
          <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-2">
            {pv.data?.line && <State s={pv.data.line.paid ? "COMPLETED" : pv.data.line.status} />}
            <span className="id">{hero.caption}</span>
          </figcaption>
        </figure>
      </section>

      <section className="mt-20" aria-labelledby="how">
        <h2 id="how" className="text-3xl font-medium">
          {t("Three steps")}
        </h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="relative rounded-lg border border-rule bg-card p-5">
              <span className="num font-display text-4xl text-now">{s.n}</span>
              <h3 className="mt-2 text-xl font-medium">{s.t}</h3>
              <p className="mt-2 text-ink-2">{s.b}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20" aria-labelledby="trust">
        <h2 id="trust" className="text-3xl font-medium">
          {t("Who decides what")}
        </h2>
        <p className="prose-w mt-2 text-ink-2">{t("The same three-way split runs through every screen that touches money.")}</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { i: <ScanText />, t: "AI reads", b: "Names the product in a screenshot or cover image, and reads your request — what, for whom, by when, which qualities — with the words it came from.", no: "Never sets a price, a refund, a payee or approves anything." },
            { i: <Cpu />, t: "Code decides", b: "Budget including shipping, arrival before your date, ports and sizes, what you already own, your rules and limits, and scam patterns.", no: "Every number is parsed by code, not the model." },
            { i: <ShieldCheck />, t: "PayPal moves money", b: "You approve the exact total on PayPal. Captures and refunds are read back from PayPal before Everyday says they happened.", no: "Sandbox only in this demo." },
          ].map((x) => (
            <div key={x.t} className="rounded-lg border border-rule bg-card p-5">
              <div className="flex items-center gap-2 text-ink [&_svg]:size-5">
                {x.i}
                <h3 className="text-xl font-medium">{x.t}</h3>
              </div>
              <p className="mt-3">{x.b}</p>
              <p className="mt-3 border-t border-rule pt-3 text-sm text-ink-2">{x.no}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20" aria-labelledby="try-scam">
        <h2 id="try-scam" className="text-3xl font-medium">
          {t("Try the scam check")}
        </h2>
        <p className="prose-w mt-2 text-ink-2">
          {t("Paste any message a seller or a \"courier\" sent you. A trained model checks it on this device first (nothing leaves your browser for that score), then rules, a second reader and a look for pay-to details. The strictest wins, and nothing that names somewhere to pay is ever shown as clear.")}
        </p>
        <div className="mt-6 max-w-3xl rounded-lg border border-rule bg-card p-5">
          <ScamCheck context="landing" demo="Hi, hope you're well. Just a heads-up that we've moved banks this month, so please send this month's payment to our new PayPal: accounts.dept@outlook.com. Thanks so much!" />
        </div>
      </section>

      <section className="mt-20" aria-labelledby="pricing">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="pricing" className="text-3xl font-medium">
            {t("Pricing")}
          </h2>
          <span className="rounded-full bg-wait-bg px-3 py-1 text-xs font-semibold text-wait">{t("Illustrative — nothing is for sale")}</span>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-rule bg-card p-5">
            <h3 className="text-xl font-medium">{t("Shopper")}</h3>
            <p className="mt-1 font-display text-4xl">
              <Amount cents={0} />
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>{t("Plans, quotes and PayPal checkout")}</li>
              <li>{t("Every return, price-promise and warranty date")}</li>
              <li>{t("Cases, swaps and price-drop claims")}</li>
              <li>{t("Scam holds and your own spending rules")}</li>
            </ul>
          </div>
          <div className="rounded-lg border border-rule bg-card p-5">
            <h3 className="text-xl font-medium">{t("Merchant")}</h3>
            <p className="mt-1 font-display text-4xl">
              1% <span className="text-base font-normal text-ink-2">{t("of orders that come through Everyday")}</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>{t("Orders arrive already checked for fit")}</li>
              <li>{t("Cases arrive with what was observed and the policy clause")}</li>
              <li>{t("Refunds follow rules you set, with approvals")}</li>
              <li>{t("PayPal tracking and disputes in one place")}</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mt-20" aria-labelledby="faq">
        <h2 id="faq" className="text-3xl font-medium">
          {t("Questions")}
        </h2>
        <Accordion type="single" collapsible className="mt-4 rounded-lg border border-rule bg-card px-4">
          {FAQ.map(([q, a]) => (
            <AccordionItem key={q} value={q} className="border-rule">
              <AccordionTrigger className="min-h-12 text-base font-medium">{t(q)}</AccordionTrigger>
              <AccordionContent className="prose-w text-ink-2">{t(a)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section className="mt-20 rounded-xl bg-ink p-6 text-paper sm:p-10">
        <h2 className="text-3xl font-medium text-paper">{t("See it with real sandbox money")}</h2>
        <p className="prose-w mt-2 opacity-80">{t("A guided three-minute walk: a request becomes a checked plan, you pay on PayPal's sandbox, and the order's dates start running.")}</p>
        <Button size="lg" className="mt-6 bg-paper text-ink hover:bg-paper/90" onClick={tryDemo} disabled={Boolean(busy)}>
          <Busy on={busy === "start"}>{null}</Busy>{t("Try the live demo")}{" "}<ArrowRight className="size-4" />
        </Button>
        <p className="mt-3 text-sm opacity-70">{tn("The preview above is read from the showcase demo, built the same way as yours. Its clock reads {0}.", day(hero.today))}</p>
      </section>
      <PublicFooter />
    </div>
  );
}
