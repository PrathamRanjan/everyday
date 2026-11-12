import { Link, useParams } from "react-router";
import { ArrowLeft, Check, ExternalLink, ShieldAlert } from "lucide-react";
import { Busy, Empty, Loaded, PageHead, Panel, State } from "@/components/kit";
import { PlanForm, type Recipient } from "@/components/forms";
import { useAction, useApi } from "@/lib/api";
import { cap, money, when, words } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

interface CaptureData {
  capture: { id: string; url: string; title: string | null; platform: string; channel: string; status: string; basis: string; selected: string | null; reader: string; created_at: string; quarantined: string[]; flags: { kind: string; text?: string }[] };
  objects: { key: string; label: string; query: string; category: string | null; price_seen: number | null }[];
  intents: { id: string; text: string; status: string; created_at: string }[];
}

export default function Capture() {
  const { id } = useParams();
  const st = useApi<CaptureData>(`/api/ui/captures/${id}`);
  const rc = useApi<{ recipients: Recipient[] }>("/api/ui/plans");
  const { run, busy } = useAction(st.reload);
  return (
    <Loaded state={st}>
      {(d) => {
        const c = d.capture;
        const need = d.objects.length > 0 && !c.selected;
        return (
          <div className="ev-rise">
            <Link to="/discover" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-ink-2 hover:text-ink">
              <ArrowLeft className="size-4" />{" "}{t("Find")}
            </Link>
            <PageHead
              eyebrow={t("{0} · saved via {1} · {2}", cap(c.platform), c.channel, when(c.created_at))}
              title={c.title || c.url || t("Your description")}
              needs={need ? t("Pick the item you mean") : undefined}
              next={need ? t("Then say what you want to do with it") : t("Say what you want to do with it")}
            />
            <div className="mb-6 flex flex-wrap items-start gap-3 rounded-lg border border-rule bg-card p-4">
              <State s={c.status} />
              <p className="min-w-0 flex-1 text-sm">{c.basis}</p>
              {c.url && (
                <a href={c.url} rel="noopener nofollow noreferrer" target="_blank" className="inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4">
                  {t("Open link")}{" "}<ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
            {c.quarantined.length > 0 && (
              <div role="note" className="mb-6 flex gap-3 rounded-lg border border-stop/40 bg-stop-bg p-4 text-sm">
                <ShieldAlert className="size-5 shrink-0 text-stop" />
                <div>
                  <p className="font-semibold text-stop">{t("Text in the image tried to give instructions. It was set aside and not used.")}</p>
                  <ul className="mt-1 list-disc pl-4 text-ink">
                    {c.quarantined.map((t) => (
                      <li key={t} className="break-words">
                        “{t}”
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title={t("Which item do you mean?")} sub={c.reader !== "rules" ? t("Read by {0}.", c.reader) : undefined}>
                {d.objects.length ? (
                  <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={t("Items found")}>
                    {d.objects.map((o) => {
                      const on = c.selected === o.key;
                      return (
                        <button
                          key={o.key}
                          aria-pressed={on}
                          disabled={Boolean(busy)}
                          onClick={() => run(o.key, `/captures/${c.id}/select`, { key: o.key }, { stay: true })}
                          className={cn("flex min-h-14 items-center gap-3 rounded-lg border p-3 text-left", on ? "border-ink bg-ink text-paper" : "border-rule-2 bg-card hover:bg-sunk")}
                        >
                          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border", on ? "border-paper" : "border-rule-2")}>{on ? <Check className="size-4" /> : <Busy on={busy === o.key}>{null}</Busy>}</span>
                          <span className="min-w-0">
                            <span className="block font-medium">{o.label}</span>
                            <span className={cn("block text-xs", on ? "opacity-80" : "text-ink-2")}>
                              {o.category ? words(o.category) : t("other")}
                              {o.price_seen ? t(" · {0} seen", money(o.price_seen * 100)) : ""}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <Empty title={t("No items read from this.")}>{t("Describe what you want on the right, or go back and add a screenshot of the exact moment.")}</Empty>
                )}
              </Panel>
              <Panel title={t("What would you like to do?")}>
                {rc.data && <PlanForm recipients={rc.data.recipients} captureId={c.id} disabled={need} hint={need ? t("Pick an item first.") : undefined} placeholder={t("Help me create this setup by Friday for $350. I already own a monitor.")} label={t("Your goal")} />}
              </Panel>
            </div>
            {d.intents.length > 0 && (
              <Panel title={t("Plans from this")} className="mt-6">
                <ul className="divide-y divide-rule">
                  {d.intents.map((i) => (
                    <li key={i.id}>
                      <Link to={`/plans/${i.id}`} className="flex min-h-12 items-center gap-3 py-2 hover:underline">
                        <span className="min-w-0 flex-1">{i.text}</span>
                        <State s={i.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}
