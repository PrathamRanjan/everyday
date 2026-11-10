import { useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, CalendarClock, ChevronRight, HelpCircle, PackageCheck, PlayCircle, Siren, X } from "lucide-react";
import { Lifeline, type Band, type Mark } from "@/components/Lifeline";
import { ApprovalCard, type ApprovalView } from "@/components/Approval";
import { Amount, Empty, GoLink, Loaded, PageHead, Panel } from "@/components/kit";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { daysBetween, day, plural, when } from "@/lib/format";
import { seenTour, startTour } from "@/tours/tours";
import { cn } from "@/lib/utils";

interface TodayData {
  first: string;
  today: string;
  clock: string;
  items: { kind: string; title: string; detail: string; href: string; when: string | null; urgency: number }[];
  calendar: { date: string; what: string; href: string }[];
  spending: { limit_cents: number; spent_cents: number; reserved_cents: number; left_cents: number; note: string };
  inbox: { id: number; text: string; at: string; flag: { serious: boolean; words: string[] } | null }[];
  held: ApprovalView[];
  soon: { id: string; title: string; return_until: string; warranty_until: string | null; acquired: string }[];
}

const ICON: Record<string, React.ReactNode> = { recall: <Siren />, approve: <PackageCheck />, question: <HelpCircle />, gap: <AlertTriangle /> };

export function FirstRun({ kind }: { kind: "shopper" | "merchant" }) {
  const [hide, setHide] = useState(seenTour());
  if (hide) return null;
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-rule bg-card p-3 pl-4">
      <PlayCircle className="size-5 shrink-0 text-now" />
      <p className="min-w-0 flex-1 text-sm">
        <b>New here?</b> A one-minute tour shows where things are.
      </p>
      <Button size="sm" onClick={() => void startTour(kind)}>
        Take the tour
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem("ev-toured", "1");
          } catch {
            /* ignore */
          }
          setHide(true);
        }}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

const greet = (clock: string) => {
  const h = Number(/(\d{1,2}):\d{2}/.exec(clock)?.[1] ?? 9);
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

export default function Today() {
  const st = useApi<TodayData>("/api/ui/today");
  return (
    <Loaded state={st}>
      {(d) => {
        const needs = d.items.length + d.held.length;
        const marks: Mark[] = d.calendar
          .filter((c) => daysBetween(d.today, c.date) <= 45 && daysBetween(d.today, c.date) >= -7)
          .slice(0, 5)
          .map((c, i) => ({ key: `c${i}`, label: c.what.replace(/^Goal deadline: /, "Due: ").replace(/^Warranty ends: /, "Warranty: ").slice(0, 22), date: c.date, tone: c.what.startsWith("Goal") ? "now" : "plain" }));
        const bands: Band[] = d.soon.slice(0, 3).map((s) => ({ key: s.id, label: `Return · ${s.title}`, from: s.acquired, to: s.return_until }));
        const used = d.spending.limit_cents ? Math.min(100, Math.round(((d.spending.spent_cents + d.spending.reserved_cents) / d.spending.limit_cents) * 100)) : 0;
        return (
          <div className="ev-rise">
            <FirstRun kind="shopper" />
            <div data-tour="today-head">
              <PageHead
                eyebrow={<span className="num">{d.clock}</span>}
                title={`${greet(d.clock)}, ${d.first}.`}
                lede={needs ? `${plural(needs, "thing needs", "things need")} you. Everything else is in hand.` : "Nothing needs you today."}
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
              <div className="min-w-0 space-y-6">
                {d.held.map((a) => (
                  <ApprovalCard key={a.id} a={a} reload={st.reload} next="/today" />
                ))}

                <Panel title="Needs you" tight>
                  {d.items.length ? (
                    <ul className="divide-y divide-rule">
                      {d.items.map((it, i) => (
                        <li key={i}>
                          <Link to={it.href} className="flex min-h-16 items-start gap-3 px-4 py-3 hover:bg-sunk/60 sm:px-5">
                            <span className={cn("mt-0.5 [&_svg]:size-5", it.kind === "recall" ? "text-stop" : it.kind === "gap" ? "text-wait" : "text-now")}>{ICON[it.kind] ?? <CalendarClock />}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium">{it.title}</span>
                              <span className="block text-sm text-ink-2">{it.detail.replace(/(\d{4}-\d{2}-\d{2})/g, (m) => day(m))}</span>
                            </span>
                            {it.when && <span className="num shrink-0 text-sm text-ink-2">{day(it.when)}</span>}
                            <ChevronRight className="mt-0.5 size-4 shrink-0 text-ink-3" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                      <Empty title="All clear." action={<GoLink to="/discover">Start something new</GoLink>}>
                        Plans ready to approve, questions and recalls show up here.
                      </Empty>
                    </div>
                  )}
                </Panel>

                <Panel title="The next few weeks" sub="Deadlines on the line; return windows under it." id="weeks">
                  <div data-tour="lifeline">
                    {marks.length || bands.length ? (
                      <Lifeline marks={marks} bands={bands} today={d.today} title="Your next few weeks" />
                    ) : (
                      <Empty title="Nothing dated yet.">Once you buy something, its return window and warranty appear here.</Empty>
                    )}
                  </div>
                  {d.calendar.length > 0 && (
                    <ul className="mt-4 divide-y divide-rule border-t border-rule text-sm">
                      {d.calendar.slice(0, 6).map((c, i) => (
                        <li key={i} className="flex items-center gap-3">
                          <span className="num w-16 shrink-0 text-ink-2">{day(c.date)}</span>
                          <Link to={c.href} className="flex min-h-11 min-w-0 flex-1 items-center truncate hover:underline">
                            {c.what}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>

              <aside className="space-y-6">
                <Panel title="This month">
                  <div className="font-display text-3xl">
                    <Amount cents={d.spending.left_cents} /> <span className="font-sans text-sm text-ink-2">left</span>
                  </div>
                  <Progress value={used} className="mt-3 h-2 bg-sunk [&>div]:bg-ink" aria-label={`${used}% of your monthly limit used`} />
                  <dl className="num mt-3 grid grid-cols-2 gap-y-1 text-sm">
                    <dt className="text-ink-2">Spent</dt>
                    <dd className="text-right">
                      <Amount cents={d.spending.spent_cents} />
                    </dd>
                    <dt className="text-ink-2">Waiting to pay</dt>
                    <dd className="text-right">
                      <Amount cents={d.spending.reserved_cents} />
                    </dd>
                    <dt className="text-ink-2">Your limit</dt>
                    <dd className="text-right">
                      <Amount cents={d.spending.limit_cents} />
                    </dd>
                  </dl>
                  <p className="mt-3 text-xs text-ink-2" data-detail>
                    {d.spending.note}
                  </p>
                  <GoLink to="/you#limit" className="mt-2">
                    Change limit
                  </GoLink>
                </Panel>
                <Panel title="Messages">
                  {d.inbox.length ? (
                    <ul className="space-y-3 text-sm">
                      {d.inbox.map((m) => (
                        <li key={m.id} className={cn("rounded-md p-2", m.flag?.serious && "bg-stop-bg")}>
                          <p className="line-clamp-3">{m.text}</p>
                          <p className="num mt-1 text-xs text-ink-2">{when(m.at)}</p>
                          {m.flag && <p className="mt-1 text-xs font-semibold text-stop">Looks like: {m.flag.words.join("; ")}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-2">No messages.</p>
                  )}
                  <GoLink to="/channels" className="mt-3">
                    All messages
                  </GoLink>
                </Panel>
              </aside>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}
