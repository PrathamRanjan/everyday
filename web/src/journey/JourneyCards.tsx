import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Clock, CreditCard, Store, User, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Busy } from "@/components/kit";
import { postAction } from "@/lib/api";
import { useSession } from "@/lib/session";
import { t, tn } from "@/i18n";
import { startJourney } from "./Journey";
import { JOURNEYS, type JourneyId } from "./steps";

const CARDS: { id: JourneyId; best?: boolean; sides: ("shopper" | "shop")[]; what: () => string[] }[] = [
  { id: "story", best: true, sides: ["shopper", "shop"], what: () => [t("Ask for a keyboard in a sentence"), t("Pay on PayPal's sandbox"), t("Switch sides and ship it as the shop"), t("Claim a price drop as Maya"), t("Approve the refund as the shop"), t("See PayPal confirm it"), t("Check a scam message")] },
  { id: "shopper", sides: ["shopper"], what: () => [t("Ask in a sentence"), t("See what the AI read and what code decided"), t("Pay on PayPal's sandbox"), t("Watch the dates start"), t("Check a scam message")] },
  { id: "shop", sides: ["shop"], what: () => [t("Orders that arrive paid and checked"), t("Cases with the evidence"), t("Refund rules and approvals"), t("Money and disputes from PayPal")] },
];

/** The landing page's "Try it yourself": each journey is done by you, step by step, with the page pointing the way. */
export function JourneyCards() {
  const { session, refresh } = useSession();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (id: JourneyId) => {
    setBusy(id);
    try {
      await startJourney(id);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const explore = async (role: "shopper" | "shop") => {
    setBusy(`x-${role}`);
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
  const buyer = session?.sandbox_buyer;
  return (
    <section id="start" className="mt-20 scroll-mt-24" aria-labelledby="start-h">
      <p className="eyebrow">{t("Try it yourself")}</p>
      <h2 id="start-h" className="mt-1 text-3xl font-medium">
        {t("Pick a guided walk-through")}
      </h2>
      <p className="prose-w mt-2 text-ink-2">{t("You press every button yourself: the request, the PayPal payment, shipping, the claim, the refund. The page points to the next thing to do and moves on when it has really happened. You can leave a walk-through and come back to it at any time.")}</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {CARDS.map((c) => {
          const j = JOURNEYS[c.id];
          return (
            <div key={c.id} className="relative flex flex-col rounded-xl border bg-card p-5" style={{ borderColor: c.best ? "var(--ink)" : "var(--rule)" }}>
              {c.best && <span className="absolute -top-3 left-5 rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-paper">{t("Start here")}</span>}
              <div className="flex items-center gap-2">
                {c.sides.map((s) => (
                  <span key={s} data-dock-role={s} className="ev-role-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
                    {s === "shop" ? <Store className="size-3" /> : <User className="size-3" />}
                    {s === "shop" ? t("Shop") : t("Shopper")}
                  </span>
                ))}
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-2">
                  <Clock className="size-3.5" />
                  {tn("about {0} min", j.minutes)}
                </span>
              </div>
              <h3 className="mt-3 font-display text-2xl">{j.title}</h3>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm">
                {c.what().map((w) => (
                  <li key={w} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-2" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
              <Button className="mt-5 self-start" variant={c.best ? "default" : "outline"} disabled={Boolean(busy)} onClick={() => void go(c.id)}>
                <Busy on={busy === c.id}>{null}</Busy>
                {t("Start")} <ArrowRight className="size-4" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-rule bg-card p-5">
          <h3 className="flex items-center gap-2 font-display text-xl">
            <CreditCard className="size-5" />
            {t("Paying with PayPal in the demo")}
          </h3>
          <p className="mt-2 text-sm text-ink-2">{t("Every payment and refund is a real call to PayPal's sandbox, PayPal's test system with test money. Nothing is faked; each capture and refund id is PayPal's own. You pay one of two ways:")}</p>
          <ol className="mt-3 space-y-3 text-sm">
            <li className="flex gap-3">
              <Wallet className="mt-0.5 size-4 shrink-0" />
              <span>
                <b>{t("One tap, as the demo shopper.")}</b>{" "}
                {t("Everyday charges a PayPal sandbox wallet saved for the demo, with no login. It's the quickest way to see the whole loop.")}
              </span>
            </li>
            <li className="flex gap-3">
              <CreditCard className="mt-0.5 size-4 shrink-0" />
              <span>
                <b>{t("On PayPal's own checkout page.")}</b>{" "}
                {buyer ? (
                  <>
                    {t("PayPal's sandbox only accepts sandbox test accounts, so sign in there with this test buyer:")}{" "}
                    <span className="mt-1 block rounded-md bg-sunk px-3 py-2 font-mono text-xs">
                      {buyer.email}
                      {buyer.password ? <> · {buyer.password}</> : null}
                    </span>
                  </>
                ) : (
                  t("PayPal's sandbox only accepts sandbox test accounts, not a real PayPal login. If you have a PayPal developer account, sign in with one of your own sandbox buyers; otherwise use the one-tap option.")
                )}
              </span>
            </li>
          </ol>
        </div>
        <div className="rounded-xl border border-rule bg-card p-5">
          <h3 className="font-display text-xl">{t("Or look around on your own")}</h3>
          <p className="mt-2 text-sm text-ink-2">{t("No account or key needed. Your own private demo is made for you and deleted 48 hours after your last visit. Switch sides any time with the Maya / shop switch at the top.")}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => void explore("shopper")}>
              <Busy on={busy === "x-shopper"}>
                <User className="size-4" />
              </Busy>
              {t("Enter as Maya")}
            </Button>
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => void explore("shop")}>
              <Busy on={busy === "x-shop"}>
                <Store className="size-4" />
              </Busy>
              {t("Enter as the shop")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
