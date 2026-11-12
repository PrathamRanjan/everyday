import { BadgeDollarSign, ClipboardCheck, CreditCard, Eye, MessageSquareText, PackageCheck, Scale, Store, Truck, User, Undo2 } from "lucide-react";
import { t } from "@/i18n";

type Stop = { icon: React.ReactNode; title: string; body: string };

const shopper = (): Stop[] => [
  { icon: <MessageSquareText />, title: t("Says what she needs"), body: t("A sentence, a TikTok or YouTube link, or a screenshot.") },
  { icon: <ClipboardCheck />, title: t("Gets a checked plan"), body: t("AI reads the words; code checks budget, date and what she owns.") },
  { icon: <CreditCard />, title: t("Pays with PayPal"), body: t("One exact total, approved by her on PayPal.") },
  { icon: <Eye />, title: t("Everyday looks after it"), body: t("Return window, price promise, warranty, recalls, scams.") },
  { icon: <BadgeDollarSign />, title: t("Gets money back"), body: t("A price drop or a damaged item becomes a refund.") },
];
const shop = (): Stop[] => [
  { icon: <PackageCheck />, title: t("An order arrives"), body: t("Already paid through PayPal and checked to fit.") },
  { icon: <Truck />, title: t("Ships it"), body: t("Tracking goes to PayPal; the shopper's dates start.") },
  { icon: <Scale />, title: t("A claim arrives"), body: t("With what was observed and the shop's own policy clause.") },
  { icon: <ClipboardCheck />, title: t("Decides under its rules"), body: t("Refund limits and approval lines the shop sets.") },
  { icon: <Undo2 />, title: t("PayPal refunds"), body: t("Counted only once PayPal confirms it.") },
];

function Lane({ role, who, line, stops }: { role: "shopper" | "shop"; who: string; line: string; stops: Stop[] }) {
  return (
    <div data-dock-role={role} className="rounded-xl border border-rule bg-card p-5 sm:p-6" style={{ borderTop: "4px solid var(--role)" }}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--role-bg)", color: "var(--role)" }}>
          {role === "shop" ? <Store className="size-5" /> : <User className="size-5" />}
        </span>
        <div className="min-w-0">
          <p className="eyebrow" style={{ color: "var(--role)" }}>{role === "shop" ? t("The shop") : t("The shopper")}</p>
          <h3 className="font-display text-2xl leading-tight">{who}</h3>
        </div>
      </div>
      <p className="mt-3 text-ink-2">{line}</p>
      <ol className="relative mt-5 space-y-4 border-l-2 pl-5" style={{ borderColor: "var(--role-bg)" }}>
        {stops.map((s, i) => (
          <li key={i} className="relative">
            <span className="absolute top-0.5 -left-[31px] flex size-5 items-center justify-center rounded-full text-[11px] font-bold text-paper" style={{ background: "var(--role)" }}>
              {i + 1}
            </span>
            <p className="flex items-center gap-2 font-medium [&_svg]:size-4 [&_svg]:text-ink-2">
              {s.icon}
              {s.title}
            </p>
            <p className="text-sm text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The landing page's "two people use Everyday": each side's journey, and what passes between them through PayPal. */
export function TwoSides() {
  const flows: [string, string][] = [
    [t("Order and payment"), "→"],
    [t("Shipping and tracking"), "←"],
    [t("A claim, with evidence"), "→"],
    [t("A refund, through PayPal"), "←"],
  ];
  return (
    <section className="mt-20" aria-labelledby="two">
      <p className="eyebrow">{t("Who uses it")}</p>
      <h2 id="two" className="mt-1 text-3xl font-medium">
        {t("Two people use Everyday: a shopper and a shop")}
      </h2>
      <p className="prose-w mt-2 text-ink-2">{t("In the demo you can be both. Maya buys and is looked after; Northlight Supply sells, ships and refunds. PayPal moves the money between them, in the sandbox.")}</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
        <Lane role="shopper" who={t("Maya")} line={t("Buys things online and wants them to fit, to arrive on time, and to be looked after once they do.")} stops={shopper()} />
        <div className="flex flex-row flex-wrap items-center justify-center gap-2 py-2 lg:flex-col lg:flex-nowrap lg:px-1" aria-label={t("What passes between them")}>
          <span className="rounded-full border border-rule bg-white px-3 py-1 text-xs font-semibold text-[#1a1a1a]">
            <span className="italic text-[#003087]">Pay</span>
            <span className="italic text-[#0070E0]">Pal</span> {t("sandbox")}
          </span>
          {flows.map(([label, dir], i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-ink-2 lg:w-40 lg:flex-col lg:gap-0.5 lg:text-center">
              <svg viewBox="0 0 60 10" className="hidden h-2.5 w-14 lg:block" aria-hidden>
                <line className="ev-flow-arrow" x1="4" y1="5" x2="56" y2="5" stroke={dir === "→" ? "var(--now)" : "var(--done)"} strokeWidth="2" />
                {dir === "→" ? <path d="M50 1 L57 5 L50 9" fill="none" stroke="var(--now)" strokeWidth="2" /> : <path d="M10 1 L3 5 L10 9" fill="none" stroke="var(--done)" strokeWidth="2" />}
              </svg>
              <span aria-hidden className="lg:hidden">{dir === "→" ? "→" : "←"}</span>
              {label}
            </div>
          ))}
        </div>
        <Lane role="shop" who={t("Northlight Supply")} line={t("A shop that sells through Everyday. Orders come in already paid and checked; claims come in with the evidence.")} stops={shop()} />
      </div>
    </section>
  );
}
