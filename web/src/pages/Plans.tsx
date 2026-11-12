import { Link } from "react-router";
import { ChevronRight, Gift } from "lucide-react";
import { Amount, Empty, Loaded, PageHead, Panel, State } from "@/components/kit";
import { PlanForm, type Recipient } from "@/components/forms";
import { useApi } from "@/lib/api";
import { day, when } from "@/lib/format";
import { t, tn } from "@/i18n";

interface PlansData {
  plans: { id: string; text: string; status: string; channel: string; created_at: string; budget_cents: number | null; deadline: string | null; recipient: string; is_self: boolean }[];
  recipients: Recipient[];
}

export default function Plans() {
  const st = useApi<PlansData>("/api/ui/plans");
  return (
    <Loaded state={st}>
      {(d) => (
        <div className="ev-rise">
          <PageHead eyebrow={t("Plans")} title={t("What you're working towards")} lede={t("Each plan is checked against your budget, your dates and what you already own before you see a price.")} />
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <Panel title={t("Your plans")} tight>
              {d.plans.length ? (
                <ul className="divide-y divide-rule">
                  {d.plans.map((p) => (
                    <li key={p.id}>
                      <Link to={`/plans/${p.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-sunk/60 sm:px-5">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{p.text}</span>
                          <span className="num mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                            {!p.is_self && (
                              <span className="inline-flex items-center gap-1">
                                <Gift className="size-3.5" />{" "}{tn("for {0}", p.recipient)}
                              </span>
                            )}
                            {p.budget_cents ? (
                              <span>
                                {t("up to")}{" "}<Amount cents={p.budget_cents} />
                              </span>
                            ) : null}
                            {p.deadline && <span>{tn("by {0}", day(p.deadline))}</span>}
                            <span>
                              {tn("via {0} · {1}", p.channel, when(p.created_at))}
                            </span>
                          </span>
                        </span>
                        <State s={p.status} />
                        <ChevronRight className="size-4 shrink-0 text-ink-3" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                  <Empty title={t("No plans yet.")}>{t("Say what you need, or start from a clip in Find.")}</Empty>
                </div>
              )}
            </Panel>
            <Panel title={t("New plan")}>
              <div data-tour="plan-new">
                <PlanForm recipients={d.recipients} />
              </div>
            </Panel>
          </div>
        </div>
      )}
    </Loaded>
  );
}
