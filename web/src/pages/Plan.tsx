import { useEffect, useState } from "react";
import { LocalEstimate } from "@/components/LocalEstimate";
import { Link, useParams } from "react-router";
import { ArrowLeft, CircleSlash, ExternalLink, Gift, Hash, HelpCircle, Package, Quote, Timer } from "lucide-react";
import { Lifeline, type Mark } from "@/components/Lifeline";
import { Amount, Busy, Empty, GoLink, KV, Loaded, PageHead, Panel, State, TrustStrip } from "@/components/kit";
import { PayChoice } from "@/components/PayChoice";
import { Button } from "@/components/ui/button";
import { postJson, useAction, useApi } from "@/lib/api";
import { announce } from "@/lib/announce";
import { toast } from "sonner";
import { day, money, plural, words } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { useToday } from "@/lib/session";
import { cn } from "@/lib/utils";
import { t, N_, tn } from "@/i18n";
import { TasteSort, type TasteResult } from "@/taste/TasteSort";

interface Pick { id: string; title: string; price_cents: number; merchant: string; label: string; reasons: string[]; exact: boolean; delay_days: number }
interface Slot {
  key: string;
  label: string;
  required: boolean;
  outcome: "buy" | "use_owned" | "skip" | "none" | "not_needed" | "suggested";
  note: string | null;
  pick: Pick | null;
  alternatives: { id: string; title: string; price_cents: number; reasons: string[]; total_if_chosen_cents?: number | null; over_budget_cents?: number }[];
  excluded: { id: string; title: string; price_cents: number; reasons: string[] }[];
  unknown: { id: string; title: string; unknown: string[] }[];
  discovery: { id: string; title: string; price_cents: number; label: string; url: string | null }[];
}
interface PlanData {
  intent: { id: string; text: string; status: string; budget_cents: number | null; deadline: string | null; channel: string; created_at: string; read: { reader: string; model: string | null; readings: { field: string; value: string; quote: string }[]; dropped: number } | null; must_have: string[] };
  recipient: { id: string; name: string; relation: string; is_self: boolean };
  capture: { id: string; title: string | null; url: string } | null;
  plan: null | { id: string; version: number; status: string; slots: Slot[]; questions: { key: string; text: string; why: string; choices: { value: string; label: string }[] }[]; total_cents: number; items_cents: number; shipping_cents: number; shipping: string; budget_cents: number | null; arrival: string | null; deadline: string | null; feasible: boolean; gap: string | null; note: string | null; avoided: string[]; considered: number };
  open: boolean;
  pairs: [PairItem, PairItem][];
  answered: number;
  quote: null | { id: string; hash: string; total_cents: number; expires_at: string | null; expires_on_clock?: string | null; lines: { title: string; qty: number; unit_cents: number }[]; shipping: { method: string; cents: number }; items_cents: number; merchant: { name: string } };
  order: { id: string; number: string; status: string; total_cents: number } | null;
  shipping: { standard_days: number; standard_cents: number; express_days: number; express_cents: number; free_over_cents: number };
  runs: { id: string; subject: string; status: string }[];
}
interface PairItem { id: string; title: string; price_cents: number; finish: string; style: string }

const FIELD: Record<string, string> = { get wants() { return t("Wants"); }, get owns() { return t("Already owns"); }, get replace() { return t("Replacing"); }, get whole_setup() { return t("Whole setup"); }, get recipient() { return t("For"); }, get deadline_day() { return t("By"); }, get comfort() { return t("Comfort"); }, get must_have() { return t("Must be"); } };

function Countdown({ until, onEnd }: { until: string; onEnd?: () => void }) {
  const { prefs } = usePrefs();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(until).getTime() - now);
  useEffect(() => {
    if (left === 0 && !prefs.extraTime) onEnd?.();
  }, [left === 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span className={cn("num", left < 120000 && "font-semibold text-now")} role="timer" aria-live="off">
      {left ? t("{0}:{1} left", m, String(s).padStart(2, "0")) : t("expired")}
    </span>
  );
}

function SlotCard({ s, recipient }: { s: Slot; recipient: PlanData["recipient"] }) {
  const [more, setMore] = useState(false);
  return (
    <article className="rounded-lg border border-rule bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
        <h3 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{s.label}</h3>
        {s.outcome !== "buy" && <State s={s.outcome === "use_owned" ? "owned" : s.outcome === "not_needed" ? "done" : "stale"} label={words(s.outcome === "use_owned" ? (recipient.is_self ? "you own one" : `${recipient.name} owns one`) : s.outcome)} />}
      </header>
      <div className="p-4">
        {s.pick ? (
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl">{s.pick.title}</p>
              <p className="text-xs text-ink-2">
                {s.pick.merchant.replace(/\s*\(.*\)$/, "")} · {s.pick.label}
                {s.pick.delay_days ? t(" · {0} extra", plural(s.pick.delay_days, "day")) : ""}
              </p>
              {s.pick.reasons.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {s.pick.reasons.map((r) => (
                    <li key={r} className={cn("rounded-full px-2.5 py-1 text-xs", r.endsWith("as you asked") ? "bg-done-bg font-semibold text-done" : "bg-sunk text-ink-2")}>
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Amount cents={s.pick.price_cents} strong className="font-display text-xl" />
          </div>
        ) : (
          <p className="text-sm">{s.note ?? t("Nothing picked.")}</p>
        )}
        {s.pick && s.note && <p className={cn("mt-2 text-sm", s.note.startsWith("Nothing ") ? "rounded-md bg-wait-bg p-2.5 text-wait" : "text-ink-2")}>{s.note}</p>}

        {s.excluded.length > 0 && (
          <div className="mt-4 rounded-md bg-sunk/70 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-2 uppercase">
              <CircleSlash className="size-3.5" />{" "}{t("Ruled out by code")}
            </p>
            <ul className="mt-1.5 space-y-1 text-sm">
              {(more ? s.excluded : s.excluded.slice(0, 3)).map((x) => (
                <li key={x.id} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{x.title}</span>
                  <Amount cents={x.price_cents} className="text-ink-2" />
                  <span className="text-ink-2">— {x.reasons.join("; ")}</span>
                </li>
              ))}
            </ul>
            {s.excluded.length > 3 && (
              <button className="mt-1 min-h-9 text-xs font-semibold underline underline-offset-4" onClick={() => setMore(!more)}>
                {more ? t("Show fewer") : t("Show all {0}", s.excluded.length)}
              </button>
            )}
          </div>
        )}
        {s.alternatives.length > 0 && (
          <details className="mt-3 text-sm" data-detail>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">{tn("Other options ({0})", s.alternatives.length)}</summary>
            <ul className="mt-1 space-y-1">
              {s.alternatives.map((x) => (
                <li key={x.id} className="flex flex-wrap gap-x-2">
                  <span>{x.title}</span>
                  <Amount cents={x.price_cents} className="text-ink-2" />
                  {x.over_budget_cents ? <span className="font-semibold text-stop">{tn("{0} over budget with shipping", money(x.over_budget_cents))}</span> : x.total_if_chosen_cents ? <span className="text-done">{t("fits the budget")}</span> : null}
                  {x.reasons.length > 0 && <span className="text-ink-2">— {x.reasons.join("; ")}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
        {s.unknown.length > 0 && (
          <p className="mt-3 text-sm text-wait">
            {tn("Can't confirm yet: {0}", s.unknown.map((u) => `${u.title} (${u.unknown.join(", ")})`).join("; "))}
          </p>
        )}
        {s.discovery.length > 0 && (
          <div className="mt-3 text-sm">
            <p className="text-xs font-semibold tracking-wide text-ink-2 uppercase">{t("Elsewhere (not checked, not buyable here)")}</p>
            <ul className="mt-1 space-y-1">
              {s.discovery.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-2">
                  {x.url ? (
                    <a href={x.url} target="_blank" rel="noopener nofollow noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
                      {x.title} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    x.title
                  )}
                  <Amount cents={x.price_cents} className="text-ink-2" />
                  <span className="text-xs text-ink-2">{x.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

type Check = { word: string; state: "shown" | "likely" | "unknown"; where: string | null; quote: string | null; how: string };
type Verdict = "fits" | "unconfirmed" | "unknown" | "over_budget" | "off_topic";
interface WebPicks {
  source: "channel3" | "cache" | "catalog" | "off";
  note: string;
  query: string;
  query_en: string;
  translated: boolean;
  label: string;
  must: string[];
  budget_cents: number | null;
  answer: string;
  picks: { title: string; brand: string | null; merchant: string | null; price_cents: number | null; currency: string; url: string | null; image: string | null; rating: { value: number; count: number } | null; commission_rate: number | null; checks: Check[]; budget: string; verdict: Verdict; why: string }[];
  at: string;
}
const VERDICT: Record<Verdict, [string, string]> = {
  fits: [N_("Fits what you asked"), "text-done"],
  unconfirmed: [N_("Check with the seller"), "text-wait"],
  over_budget: [N_("Over budget"), "text-wait"],
  unknown: [N_("Unknown"), "text-ink-2"],
  off_topic: [N_("Something else"), "text-stop"],
};

/**
 * B6: the second buying tier. Web results checked in code against the same must-haves, with the words each check came
 * from. A hand-off ("Buy at walmart.com"), never a checkout; "I bought it there" adds it to what you own.
 */
function WebTier({ intentId }: { intentId: string }) {
  const st = useApi<WebPicks>(`/api/ui/plans/${intentId}/web`);
  const [tracked, setTracked] = useState<Record<string, string>>({});
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [taste, setTaste] = useState<TasteResult>(null);
  if (st.loading && !st.data) return <Panel title={t("Also found on the web")}><p className="text-sm text-ink-2">{t("Searching Channel3 and checking each listing…")}</p></Panel>;
  if (st.error) return <Panel title={t("Also found on the web")}><p className="text-sm text-stop">{st.error.message}</p></Panel>;
  const d = st.data;
  if (!d) return null;
  const bought = async (url: string) => {
    setBusyUrl(url);
    const r = await postJson(`/api/ui/plans/${intentId}/web/bought`, { url });
    setBusyUrl(null);
    if (!r.ok) {
      toast.error(r.j?.message ?? t("Couldn't add it."));
      announce(r.j?.message ?? t("Couldn't add it."));
      return;
    }
    setTracked((t) => ({ ...t, [url]: r.j.id }));
    toast.success(t("Added {0} to what you own.", r.j.title));
    announce(t("Added {0} to what you own. Add its receipt for the return and warranty dates.", r.j.title));
    window.dispatchEvent(new Event("ev:changed"));
  };
  const shown = d.picks.filter((x) => x.verdict !== "off_topic");
  const offTopic = d.picks.length - shown.length;
  // Taste (opt-in) reorders inside each verdict group, keeping the groups in the order code put them.
  const groups = [...new Set(shown.map((x) => x.verdict))];
  const scored = shown.map((x, n) => ({ x, s: taste && taste.scores.length === shown.length ? taste.scores[n] : null }));
  const ordered = taste ? [...scored].sort((a, b) => groups.indexOf(a.x.verdict) - groups.indexOf(b.x.verdict) || (b.s ?? 0) - (a.s ?? 0)) : scored;
  return (
    <Panel id="web" title={t("Also found on the web")} sub={t("{0}. Searched Channel3 for “{1}”{2}; each listing is checked in code for {3}{4}.", d.label, d.query_en, d.translated ? t(" (your words: “{0}”)", d.query) : "", d.must.length ? d.must.join(", ") : t("what you asked"), d.budget_cents ? t(" and your {0} budget", money(d.budget_cents)) : "")}>
      <p className="mb-3 rounded-md border border-rule bg-paper-2 p-3 text-sm font-medium" data-testid="web-answer">{d.answer}</p>
      {shown.length > 1 && <TasteSort listings={shown.map((x) => ({ title: x.title, brand: x.brand }))} onResult={setTaste} />}
      {taste?.nothingFits && <p className="mb-3 rounded-md border border-wait/50 bg-wait-bg p-3 text-sm" role="status" data-testid="taste-nothing-fits">{t("Nothing here looks much like what you usually keep. That's the taste model's guess, not a rule; the verdicts above still stand.")}</p>}
      {!d.picks.length ? (
        <p className="text-sm text-ink-2">{d.note}</p>
      ) : (
        <ul className="space-y-3">
          {ordered.map(({ x, s }, n) => (
            <li key={x.url ?? `${x.title}${n}`} data-taste={s === null ? undefined : s.toFixed(3)} className={cn("rounded-md border p-3 text-sm", x.verdict === "fits" ? "border-done/50" : "border-rule")}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{x.title}</span>
                <span className="num">{x.price_cents !== null ? money(x.price_cents, x.currency) : t("no price")}</span>
              </div>
              <div className="text-xs text-ink-2" data-no-i18n>
                {[x.brand, x.merchant, x.rating ? `${x.rating.value.toFixed(1)}★ (${x.rating.count})` : null].filter(Boolean).join(" · ")}
              </div>
              <p className={cn("mt-1 font-semibold", VERDICT[x.verdict][1])}>
                {t(VERDICT[x.verdict][0])}: <span className="font-normal text-ink">{x.why}</span>
              </p>
              {x.checks.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs">
                  {x.checks.map((c) => (
                    <li key={c.word} className={c.state === "shown" ? "text-done" : c.state === "likely" ? "text-wait" : "text-ink-2"}>
                      <span aria-hidden>{c.state === "shown" ? "✓" : "?"}</span> <span className="font-semibold">{c.word}</span>: {c.how}
                    </li>
                  ))}
                </ul>
              )}
              {x.url && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <a href={x.url} target="_blank" rel="noopener nofollow noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold underline underline-offset-4">
                    {tn("Buy at {0}", x.merchant ?? t("the retailer"))}{" "}<ExternalLink className="size-3.5" />
                    <span className="sr-only">{t("(opens a new tab; paid with that shop, not here)")}</span>
                  </a>
                  {tracked[x.url] ? (
                    <Link to="/receipts" className="inline-flex min-h-11 items-center text-sm text-done underline underline-offset-4">{t("Tracked. Add its receipt for the dates")}</Link>
                  ) : (
                    <Button variant="outline" size="sm" className="min-h-11" disabled={busyUrl === x.url} onClick={() => void bought(x.url!)}>{t("I bought it there")}</Button>
                  )}
                  {x.commission_rate !== null && <span className="text-xs text-ink-2">{tn("Channel3 lists up to {0}% referral commission from {1}; Everyday earns none of it in this demo.", Math.round(x.commission_rate * 1000) / 10, x.merchant ?? t("this shop"))}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {offTopic > 0 && <p className="mt-3 text-xs text-ink-2">{tn("{0}: its own title and features name something else, whatever Channel3's category says.", offTopic === 1 ? t("1 listing was left out") : t("{0} listings were left out", offTopic))}</p>}
      <p className="mt-3 text-xs text-ink-2">{t("Only the demo shop above is paid through PayPal here. These listings are a hand-off: once you say you bought one, Everyday tracks it with what you own, but it can't open a claim with that shop for you.")}</p>
    </Panel>
  );
}

export default function Plan() {
  const { id } = useParams();
  const st = useApi<PlanData>(`/api/ui/plans/${id}`);
  const { run, busy } = useAction(st.reload);
  const today = useToday();
  return (
    <Loaded state={st} rows={4}>
      {(d) => {
        const p = d.plan;
        const i = d.intent;
        const q = d.quote;
        const late = p?.arrival && i.deadline && p.arrival > i.deadline;
        const over = p?.budget_cents && p.total_cents > p.budget_cents;
        const needs = !p ? t("Waiting for a plan") : p.questions.length ? t("Answer one question") : d.order ? undefined : !p.feasible ? t("Change the plan") : q ? t("Pay on PayPal") : t("Get the exact quote");
        const marks: Mark[] = [{ key: "made", label: t("Planned"), date: i.created_at.slice(0, 10), tone: "done" }];
        if (p?.arrival) marks.push({ key: "arr", label: t("Arrives"), date: p.arrival, tone: late ? "stop" : "wait", note: p.shipping });
        return (
          <div className="ev-rise">
            <Link to="/plans" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-ink-2 hover:text-ink">
              <ArrowLeft className="size-4" />{" "}{t("Plans")}
            </Link>
            <PageHead
              eyebrow={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {!d.recipient.is_self && (
                    <span className="inline-flex items-center gap-1">
                      <Gift className="size-3.5" />{" "}{tn("Gift for {0}", d.recipient.name)}
                    </span>
                  )}
                  {p && <span className="num">{tn("Plan v{0}", p.version)}</span>}
                  <State s={i.status} />
                </span>
              }
              title={`“${i.text}”`}
              needs={needs}
              next={d.order ? t("Order {0}", d.order.number) : q ? t("Approve on PayPal, then the order's dates start") : p && !p.feasible ? t("Change the budget, the date or what it must be") : t("A 15-minute quote with an exact total")}
            />

            {d.order && (
              <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-done/40 bg-done-bg p-4">
                <State s={d.order.status} />
                <p className="min-w-0 flex-1 text-sm">
                  {t("Order")}{" "}<b className="id">{d.order.number}</b> · <Amount cents={d.order.total_cents} />
                </p>
                <GoLink to={`/orders/${d.order.id}`}>{t("Open order")}</GoLink>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
              <div className="min-w-0 space-y-6">
                <Panel title={t("What Everyday understood")} sub={i.read?.reader === "model" ? t("Read by {0}; each line shows the words it came from.", i.read.model ?? t("the model")) : i.read?.reader === "manual" ? t("Filled in by you on the form; no model read it.") : t("Not read by a model: the fields below are from the words and numbers you typed.")}>
                  <div data-tour="plan-read">
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {i.budget_cents ? (
                        <li className="rounded-md border border-rule p-2.5 text-sm">
                          <span className="text-ink-2">{t("Budget")}</span> <Amount cents={i.budget_cents} strong />
                          <span className="block text-xs text-ink-2">{t("parsed by code")}</span>
                        </li>
                      ) : null}
                      {i.deadline && (
                        <li className="rounded-md border border-rule p-2.5 text-sm">
                          <span className="text-ink-2">{t("Need by")}</span> <b className="num">{day(i.deadline)}</b>
                          <span className="block text-xs text-ink-2">{t("date worked out by code")}</span>
                        </li>
                      )}
                      {(i.read?.readings ?? []).map((r, k) => (
                        <li key={k} className="rounded-md border border-rule p-2.5 text-sm">
                          <span className="text-ink-2">{FIELD[r.field] ?? words(r.field)}</span> <b>{words(r.value)}</b>
                          <span className="mt-0.5 flex items-start gap-1 text-xs text-ink-2">
                            <Quote className="mt-0.5 size-3 shrink-0" />“{r.quote}”
                          </span>
                        </li>
                      ))}
                    </ul>
                    {i.read && i.read.dropped > 0 && <p className="mt-2 text-xs text-ink-2">{tn("{0} dropped because the model couldn't quote your words for it.", plural(i.read.dropped, "reading was", "readings were"))}</p>}
                    {!i.read?.readings.length && !i.budget_cents && !i.deadline && <p className="text-sm text-ink-2">{t("Nothing specific was read from the words; the plan uses your profile.")}</p>}
                  </div>
                </Panel>

                {p?.questions.map((qq) => (
                  <Panel key={qq.key} title={<span className="inline-flex items-center gap-2"><HelpCircle className="size-5 text-now" />{qq.text}</span>} sub={qq.why} className="border-now/40">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {qq.choices.map((c) => (
                        <Button key={c.value} variant="outline" className="h-auto justify-start py-3 text-left whitespace-normal" disabled={Boolean(busy)} onClick={() => run(c.value, `/plans/${i.id}/answer`, { key: qq.key, value: c.value }, { stay: true })}>
                          <Busy on={busy === c.value}>{null}</Busy>
                          {c.label}
                        </Button>
                      ))}
                    </div>
                  </Panel>
                ))}

                {p ? (
                  <section aria-labelledby="picks" data-tour="plan-pick" className="space-y-3">
                    <div className="flex items-end justify-between gap-3">
                      <h2 id="picks" className="text-xl font-medium">
                        {t("The plan")}
                      </h2>
                      <span className="text-xs text-ink-2">{tn("{0} considered", plural(p.considered, "product"))}</span>
                    </div>
                    {p.note && <p className="rounded-md bg-wait-bg p-3 text-sm text-ink">{p.note}</p>}
                    {p.slots.map((s) => (
                      <SlotCard key={s.key} s={s} recipient={d.recipient} />
                    ))}
                    {p.avoided.length > 0 && (
                      <p className="flex items-start gap-2 text-sm text-ink-2">
                        <Package className="mt-0.5 size-4 shrink-0" />
                        {p.avoided.join(" ")}
                      </p>
                    )}
                  </section>
                ) : (
                  <Empty title={t("No plan yet.")}>{t("The planner runs when the request is saved. Refresh in a moment.")}</Empty>
                )}

                {p && <WebTier intentId={i.id} />}

                {d.pairs.length > 0 && (
                  <Panel title={t("Which would you rather have?")} sub={d.recipient.is_self ? t("One tap teaches the ranking your taste. It never changes the budget or the rules.") : t("For {0}. This teaches {1}'s ranking, not yours.", d.recipient.name, d.recipient.name)}>
                    {d.pairs.map(([a, b]) => (
                      <div key={a.id + b.id} className="grid gap-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          {[a, b].map((x, k) => (
                            <button key={x.id} disabled={Boolean(busy)} onClick={() => run(`pair${k}`, `/plans/${i.id}/choose`, { a: a.id, b: b.id, chosen: k ? "b" : "a", reason: "style" }, { stay: true })} className="flex min-h-20 flex-col items-start gap-1 rounded-lg border border-rule-2 bg-card p-3 text-left hover:border-ink">
                              <span className="font-medium">{x.title}</span>
                              <span className="text-xs text-ink-2">
                                {x.finish} · {x.style}
                              </span>
                              <Amount cents={x.price_cents} className="text-sm" />
                            </button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 text-sm">
                          <span className="text-ink-2">{t("Or neither, because:")}</span>
                          {[
                            ["too_expensive", t("too expensive")],
                            ["already_own", d.recipient.is_self ? t("I already have one") : t("they already have one")],
                            ["wrong_recipient", t("wrong person")],
                          ].map(([r, l]) => (
                            <button key={r} disabled={Boolean(busy)} onClick={() => run(r, `/plans/${i.id}/choose`, { a: a.id, b: b.id, chosen: "a", reason: r }, { stay: true })} className="min-h-9 rounded-full border border-rule-2 px-3 text-xs hover:bg-sunk">
                              {l}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </Panel>
                )}
              </div>

              <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
                {p && (
                  <Panel title={t("Total")} id="quote">
                    <div data-tour="plan-quote">
                      <KV
                        rows={[
                          [t("Items"), money(p.items_cents)],
                          [t("Shipping ({0})", words(p.shipping)), money(p.shipping_cents)],
                          [t("Total"), <span key="t"><b>{money(q?.total_cents ?? p.total_cents)}</b><LocalEstimate cents={q?.total_cents ?? p.total_cents} /></span>],
                          ...(p.budget_cents ? ([[t("Budget"), <span key="b" className={over ? "text-stop" : "text-done"}>{money(p.budget_cents)}</span>]] as [React.ReactNode, React.ReactNode][]) : []),
                          [t("Arrives"), <span key="a" className={late ? "text-stop" : ""}>{day(p.arrival)}</span>],
                          ...(i.deadline ? ([[t("Need by"), day(i.deadline)]] as [React.ReactNode, React.ReactNode][]) : []),
                        ]}
                      />
                      {!p.feasible && <p className="mt-3 rounded-md bg-stop-bg p-3 text-sm text-stop">{p.gap ?? t("This plan doesn't fit yet.")}</p>}
                      <div className="mt-4 border-t border-rule pt-4">
                        {d.order ? (
                          <GoLink to={`/orders/${d.order.id}`}>{tn("Open order {0}", d.order.number)}</GoLink>
                        ) : q ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="inline-flex items-center gap-1.5 font-semibold">
                                <Timer className="size-4" />{" "}{tn("Quote from {0}", q.merchant?.name?.replace(/\s*\(.*\)$/, "") ?? t("the shop"))}
                              </span>
                              {q.expires_at ? <Countdown until={q.expires_at} onEnd={st.reload} /> : <span className="text-xs text-ink-2">{tn("Good until {0} on the demo clock", q.expires_on_clock)}</span>}
                            </div>
                            <ul className="space-y-1 text-sm">
                              {q.lines.map((l, k) => (
                                <li key={k} className="flex justify-between gap-3">
                                  <span className="min-w-0">
                                    {l.qty > 1 ? `${l.qty} × ` : ""}
                                    {l.title}
                                  </span>
                                  <Amount cents={l.unit_cents * l.qty} />
                                </li>
                              ))}
                            </ul>
                            <p className="flex items-center gap-1 text-xs text-ink-2" data-detail>
                              <Hash className="size-3" /> <span className="id">{q.hash.slice(0, 16)}</span>{" "}{t("· this exact total is what PayPal will show")}
                            </p>
                            <PayChoice cents={q.total_cents} busy={busy} run={run} wallet={{ path: `/quotes/${q.id}/approve-demo`, data: { hash: q.hash } }} page={{ path: `/quotes/${q.id}/approve`, data: { hash: q.hash } }} />
                          </div>
                        ) : (
                          <Button className="w-full" disabled={!p.feasible || p.questions.length > 0 || !d.open || Boolean(busy)} onClick={() => run("quote", `/plans/${i.id}/quote`, undefined, { stay: true })}>
                            <Busy on={busy === "quote"}>{null}</Busy>
                            {t("Get the exact quote")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Panel>
                )}
                {p?.arrival && (
                  <Panel title={t("Timing")}>
                    <Lifeline compact marks={marks} today={today < i.created_at.slice(0, 10) ? i.created_at.slice(0, 10) : today} deadline={i.deadline} title={t("Plan timing")} />
                    <p className="mt-2 text-xs text-ink-2">
                      {tn("Standard {0} ({1}), express {2} ({3}); free over {4}.", plural(d.shipping.standard_days, "working day"), money(d.shipping.standard_cents), plural(d.shipping.express_days, "day"), money(d.shipping.express_cents), money(d.shipping.free_over_cents))}
                    </p>
                  </Panel>
                )}
                <TrustStrip className="sm:grid-cols-1 sm:divide-x-0 sm:divide-y" ai={i.read?.reader === "model" ? t("Read the words of your request, with quotes.") : i.read?.reader === "manual" ? t("Not used: you filled in the form.") : t("Not used on this request.")} code={t("Set the budget, the date, and ruled out what doesn't fit.")} paypal={t("Charges only the exact quoted total, after you approve there.")} />
                {d.runs.length > 0 && (
                  <div className="text-sm" data-detail>
                    <GoLink to={`/trace/${d.runs[0].id}`}>{t("See every step the assistant took")}</GoLink>
                  </div>
                )}
              </aside>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}
