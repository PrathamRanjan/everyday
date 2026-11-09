import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, CircleSlash, ExternalLink, Gift, Hash, HelpCircle, Package, Quote, Timer } from "lucide-react";
import { Lifeline, type Mark } from "@/components/Lifeline";
import { Amount, Busy, Empty, GoLink, KV, Loaded, PageHead, Panel, PayPalButton, State, TrustStrip } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useAction, useApi } from "@/lib/api";
import { day, money, plural, words } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { useToday } from "@/lib/session";
import { cn } from "@/lib/utils";

interface Pick { id: string; title: string; price_cents: number; merchant: string; label: string; reasons: string[]; exact: boolean; delay_days: number }
interface Slot {
  key: string;
  label: string;
  required: boolean;
  outcome: "buy" | "use_owned" | "skip" | "none" | "not_needed" | "suggested";
  note: string | null;
  pick: Pick | null;
  alternatives: { id: string; title: string; price_cents: number; reasons: string[] }[];
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
  quote: null | { id: string; hash: string; total_cents: number; expires_at: string; lines: { title: string; qty: number; unit_cents: number }[]; shipping: { method: string; cents: number }; items_cents: number; merchant: { name: string } };
  order: { id: string; number: string; status: string; total_cents: number } | null;
  shipping: { standard_days: number; standard_cents: number; express_days: number; express_cents: number; free_over_cents: number };
  runs: { id: string; subject: string; status: string }[];
}
interface PairItem { id: string; title: string; price_cents: number; finish: string; style: string }

const FIELD: Record<string, string> = { wants: "Wants", owns: "Already owns", replace: "Replacing", whole_setup: "Whole setup", recipient: "For", deadline_day: "By", comfort: "Comfort", must_have: "Must be" };

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
      {left ? `${m}:${String(s).padStart(2, "0")} left` : "expired"}
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
                {s.pick.delay_days ? ` · ${plural(s.pick.delay_days, "day")} extra` : ""}
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
          <p className="text-sm">{s.note ?? "Nothing picked."}</p>
        )}
        {s.pick && s.note && <p className="mt-2 text-sm text-ink-2">{s.note}</p>}

        {s.excluded.length > 0 && (
          <div className="mt-4 rounded-md bg-sunk/70 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-2 uppercase">
              <CircleSlash className="size-3.5" /> Ruled out by code
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
                {more ? "Show fewer" : `Show all ${s.excluded.length}`}
              </button>
            )}
          </div>
        )}
        {s.alternatives.length > 0 && (
          <details className="mt-3 text-sm" data-detail>
            <summary className="min-h-9 cursor-pointer py-1 font-semibold">Also fits ({s.alternatives.length})</summary>
            <ul className="mt-1 space-y-1">
              {s.alternatives.map((x) => (
                <li key={x.id} className="flex flex-wrap gap-x-2">
                  <span>{x.title}</span>
                  <Amount cents={x.price_cents} className="text-ink-2" />
                  {x.reasons.length > 0 && <span className="text-ink-2">— {x.reasons.join("; ")}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
        {s.unknown.length > 0 && (
          <p className="mt-3 text-sm text-wait">
            Can't confirm yet: {s.unknown.map((u) => `${u.title} (${u.unknown.join(", ")})`).join("; ")}
          </p>
        )}
        {s.discovery.length > 0 && (
          <div className="mt-3 text-sm">
            <p className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Elsewhere (not checked, not buyable here)</p>
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
        const needs = !p ? "Waiting for a plan" : p.questions.length ? "Answer one question" : d.order ? undefined : !p.feasible ? "Change the plan" : q ? "Pay on PayPal" : "Get the exact quote";
        const marks: Mark[] = [{ key: "made", label: "Planned", date: i.created_at.slice(0, 10), tone: "done" }];
        if (p?.arrival) marks.push({ key: "arr", label: "Arrives", date: p.arrival, tone: late ? "stop" : "wait", note: p.shipping });
        return (
          <div className="ev-rise">
            <Link to="/plans" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-ink-2 hover:text-ink">
              <ArrowLeft className="size-4" /> Plans
            </Link>
            <PageHead
              eyebrow={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {!d.recipient.is_self && (
                    <span className="inline-flex items-center gap-1">
                      <Gift className="size-3.5" /> Gift for {d.recipient.name}
                    </span>
                  )}
                  {p && <span className="num">Plan v{p.version}</span>}
                  <State s={i.status} />
                </span>
              }
              title={`“${i.text}”`}
              needs={needs}
              next={d.order ? `Order ${d.order.number}` : q ? "Approve on PayPal, then the order's dates start" : "A 15-minute quote with an exact total"}
            />

            {d.order && (
              <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-done/40 bg-done-bg p-4">
                <State s={d.order.status} />
                <p className="min-w-0 flex-1 text-sm">
                  Order <b className="id">{d.order.number}</b> · <Amount cents={d.order.total_cents} />
                </p>
                <GoLink to={`/orders/${d.order.id}`}>Open order</GoLink>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
              <div className="min-w-0 space-y-6">
                <Panel title="What Everyday understood" sub={i.read?.reader === "model" ? `Read by ${i.read.model ?? "the model"}; each line shows the words it came from.` : "Read by rules (no model on this request)."}>
                  <div data-tour="plan-read">
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {i.budget_cents ? (
                        <li className="rounded-md border border-rule p-2.5 text-sm">
                          <span className="text-ink-2">Budget</span> <Amount cents={i.budget_cents} strong />
                          <span className="block text-xs text-ink-2">parsed by code</span>
                        </li>
                      ) : null}
                      {i.deadline && (
                        <li className="rounded-md border border-rule p-2.5 text-sm">
                          <span className="text-ink-2">Need by</span> <b className="num">{day(i.deadline)}</b>
                          <span className="block text-xs text-ink-2">date worked out by code</span>
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
                    {i.read && i.read.dropped > 0 && <p className="mt-2 text-xs text-ink-2">{plural(i.read.dropped, "reading was", "readings were")} dropped because the model couldn't quote your words for it.</p>}
                    {!i.read?.readings.length && !i.budget_cents && !i.deadline && <p className="text-sm text-ink-2">Nothing specific was read from the words; the plan uses your profile.</p>}
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
                        The plan
                      </h2>
                      <span className="text-xs text-ink-2">{plural(p.considered, "product")} considered</span>
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
                  <Empty title="No plan yet.">The planner runs when the request is saved. Refresh in a moment.</Empty>
                )}

                {d.pairs.length > 0 && (
                  <Panel title="Which would you rather have?" sub={d.recipient.is_self ? "One tap teaches the ranking your taste. It never changes the budget or the rules." : `For ${d.recipient.name}. This teaches ${d.recipient.name}'s ranking, not yours.`}>
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
                          <span className="text-ink-2">Or neither, because:</span>
                          {[
                            ["too_expensive", "too expensive"],
                            ["already_own", d.recipient.is_self ? "I already have one" : "they already have one"],
                            ["wrong_recipient", "wrong person"],
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
                  <Panel title="Total" id="quote">
                    <div data-tour="plan-quote">
                      <KV
                        rows={[
                          ["Items", money(p.items_cents)],
                          [`Shipping (${p.shipping})`, money(p.shipping_cents)],
                          ["Total", <b key="t">{money(q?.total_cents ?? p.total_cents)}</b>],
                          ...(p.budget_cents ? ([["Budget", <span key="b" className={over ? "text-stop" : "text-done"}>{money(p.budget_cents)}</span>]] as [React.ReactNode, React.ReactNode][]) : []),
                          ["Arrives", <span key="a" className={late ? "text-stop" : ""}>{day(p.arrival)}</span>],
                          ...(i.deadline ? ([["Need by", day(i.deadline)]] as [React.ReactNode, React.ReactNode][]) : []),
                        ]}
                      />
                      {!p.feasible && <p className="mt-3 rounded-md bg-stop-bg p-3 text-sm text-stop">{p.gap ?? "This plan doesn't fit yet."}</p>}
                      <div className="mt-4 border-t border-rule pt-4">
                        {d.order ? (
                          <GoLink to={`/orders/${d.order.id}`}>Open order {d.order.number}</GoLink>
                        ) : q ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="inline-flex items-center gap-1.5 font-semibold">
                                <Timer className="size-4" /> Quote from {q.merchant?.name?.replace(/\s*\(.*\)$/, "") ?? "the shop"}
                              </span>
                              <Countdown until={q.expires_at} onEnd={st.reload} />
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
                              <Hash className="size-3" /> <span className="id">{q.hash.slice(0, 16)}</span> · this exact total is what PayPal will show
                            </p>
                            <PayPalButton className="w-full" busy={busy === "pay"} onClick={() => run("pay", `/quotes/${q.id}/approve`, { hash: q.hash })}>
                              Pay {money(q.total_cents)} with PayPal
                            </PayPalButton>
                            <p className="text-xs text-ink-2">You'll approve on PayPal's sandbox and come straight back. Nothing is charged until you approve there.</p>
                          </div>
                        ) : (
                          <Button className="w-full" disabled={!p.feasible || p.questions.length > 0 || !d.open || Boolean(busy)} onClick={() => run("quote", `/plans/${i.id}/quote`, undefined, { stay: true })}>
                            <Busy on={busy === "quote"}>{null}</Busy>
                            Get the exact quote
                          </Button>
                        )}
                      </div>
                    </div>
                  </Panel>
                )}
                {p?.arrival && (
                  <Panel title="Timing">
                    <Lifeline compact marks={marks} today={today < i.created_at.slice(0, 10) ? i.created_at.slice(0, 10) : today} deadline={i.deadline} title="Plan timing" />
                    <p className="mt-2 text-xs text-ink-2">
                      Standard {plural(d.shipping.standard_days, "working day")} ({money(d.shipping.standard_cents)}), express {plural(d.shipping.express_days, "day")} ({money(d.shipping.express_cents)}); free over {money(d.shipping.free_over_cents)}.
                    </p>
                  </Panel>
                )}
                <TrustStrip className="sm:grid-cols-1 sm:divide-x-0 sm:divide-y" ai="Read the words of your request, with quotes." code="Set the budget, the date, and ruled out what doesn't fit." paypal="Charges only the exact quoted total, after you approve there." />
                {d.runs.length > 0 && (
                  <div className="text-sm" data-detail>
                    <GoLink to={`/trace/${d.runs[0].id}`}>See every step the assistant took</GoLink>
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
