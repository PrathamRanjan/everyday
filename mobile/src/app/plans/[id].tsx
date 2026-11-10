import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Lifeline, type Mark } from "@/components/Lifeline";
import { Button, Card, KV, Loaded, Money, Note, Pill, Screen, StatePill, Title, TrustStrip, Txt, DemoRibbon } from "@/components/ui";
import { day, money, plural, words } from "@/lib/format";
import { useAct } from "@/lib/useAct";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

interface Pick { id: string; title: string; price_cents: number; merchant: string; label: string; reasons: string[]; delay_days: number }
interface Slot {
  key: string;
  label: string;
  outcome: string;
  note: string | null;
  pick: Pick | null;
  alternatives: { id: string; title: string; price_cents: number; over_budget_cents?: number }[];
  excluded: { id: string; title: string; price_cents: number; reasons: string[] }[];
}
interface PlanData {
  intent: { id: string; text: string; status: string; budget_cents: number | null; deadline: string | null; channel: string; created_at: string; read: { reader: string; model: string | null; readings: { field: string; value: string; quote: string }[]; dropped: number } | null };
  recipient: { id: string; name: string; is_self: boolean };
  plan: null | { id: string; version: number; status: string; slots: Slot[]; questions: { key: string; text: string; why: string; choices: { value: string; label: string }[] }[]; total_cents: number; items_cents: number; shipping_cents: number; shipping: string; budget_cents: number | null; arrival: string | null; feasible: boolean; gap: string | null; note: string | null; considered: number };
  open: boolean;
  quote: null | { id: string; hash: string; total_cents: number; expires_at: string; lines: { title: string; qty: number; unit_cents: number }[]; merchant: { name: string } };
  order: { id: string; number: string; status: string; total_cents: number } | null;
}

const FIELD: Record<string, string> = { wants: "Wants", owns: "Already owns", replace: "Replacing", whole_setup: "Whole setup", recipient: "For", deadline_day: "By", comfort: "Comfort", must_have: "Must be" };

function Countdown({ until, onEnd }: { until: string; onEnd: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(until).getTime() - now);
  useEffect(() => {
    if (left === 0) onEnd();
  }, [left === 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return <Pill tone={left < 120000 ? "now" : "plain"}>{left ? `${m}:${String(s).padStart(2, "0")} left` : "expired"}</Pill>;
}

export default function Plan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const st = useApi<PlanData>(`/api/ui/plans/${id}`);
  const { run, busy } = useAct(st.reload);
  const { who } = useSession();
  const { c } = useTheme();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen options={{ title: "Plan" }} />
      <Screen onRefresh={() => void st.reload()} refreshing={st.loading && Boolean(st.data)}>
        <Loaded st={st}>
          {(d) => {
            const p = d.plan;
            const i = d.intent;
            const q = d.quote;
            const late = Boolean(p?.arrival && i.deadline && p.arrival > i.deadline);
            const over = Boolean(p?.budget_cents && p.total_cents > p.budget_cents);
            const marks: Mark[] = [{ key: "made", label: "Planned", date: i.created_at.slice(0, 10), tone: "done" }];
            if (p?.arrival) marks.push({ key: "arr", label: "Arrives", date: p.arrival, tone: late ? "stop" : "wait", note: p.shipping });
            const today = who?.today && who.today >= i.created_at.slice(0, 10) ? who.today : i.created_at.slice(0, 10);
            return (
              <>
                <Title eyebrow={[d.recipient.is_self ? null : `Gift for ${d.recipient.name}`, p ? `Plan v${p.version}` : null, `from the ${i.channel === "mobile" ? "phone" : i.channel === "app" ? "website" : i.channel}`].filter(Boolean).join(" · ")}>{`“${i.text}”`}</Title>
                <StatePill s={i.status} />

                {d.order && (
                  <Card tone="done" title={`Order ${d.order.number}`} right={<StatePill s={d.order.status} />}>
                    <Money cents={d.order.total_cents} />
                    <Button label="Open the order" kind="secondary" onPress={() => router.push(`/orders/${d.order!.id}`)} />
                  </Card>
                )}

                <Card title="What Everyday understood" sub={i.read?.reader === "model" ? `Read by ${i.read.model ?? "the model"}; each line shows the words it came from.` : "Read by rules (no model on this request)."}>
                  {i.budget_cents ? <KV rows={[["Budget (parsed by code)", money(i.budget_cents)]]} /> : null}
                  {i.deadline ? <KV rows={[["Need by (worked out by code)", day(i.deadline)]]} /> : null}
                  {(i.read?.readings ?? []).map((r, k) => (
                    <View key={k} style={{ borderWidth: 1, borderColor: c.rule, borderRadius: 10, padding: 10, gap: 2 }}>
                      <Txt size={14}>
                        <Txt size={14} color={c.ink2}>
                          {FIELD[r.field] ?? words(r.field)}{" "}
                        </Txt>
                        <Txt size={14} weight="bold">
                          {words(r.value)}
                        </Txt>
                      </Txt>
                      <Txt size={12} color={c.ink2}>
                        “{r.quote}”
                      </Txt>
                    </View>
                  ))}
                  {i.read && i.read.dropped > 0 && (
                    <Txt size={12} color={c.ink2}>
                      {plural(i.read.dropped, "reading was", "readings were")} dropped because the model couldn't quote your words for it.
                    </Txt>
                  )}
                </Card>

                {p?.questions.map((qq) => (
                  <Card key={qq.key} tone="now" title={qq.text} sub={qq.why}>
                    {qq.choices.map((ch) => (
                      <Button key={ch.value} label={ch.label} kind="secondary" busy={busy === ch.value} disabled={Boolean(busy)} onPress={() => void run(ch.value, `/plans/${i.id}/answer`, { key: qq.key, value: ch.value }, { stay: true })} />
                    ))}
                  </Card>
                ))}

                {p ? (
                  <>
                    <Txt weight="display" size={22}>
                      The plan
                    </Txt>
                    <Txt size={12} color={c.ink2}>
                      {plural(p.considered, "product")} considered
                    </Txt>
                    {p.note && <Note tone="wait">{p.note}</Note>}
                    {p.slots.map((s) => (
                      <Card key={s.key} title={s.pick?.title ?? s.label} sub={s.pick ? `${s.label} · ${s.pick.merchant.replace(/\s*\(.*\)$/, "")} · ${s.pick.label}` : undefined} right={s.pick ? <Money cents={s.pick.price_cents} /> : undefined}>
                        {!s.pick && <Txt size={14}>{s.note ?? "Nothing picked."}</Txt>}
                        {s.pick && s.pick.reasons.length > 0 && (
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                            {s.pick.reasons.map((r) => (
                              <Pill key={r} tone={r.endsWith("as you asked") ? "done" : "plain"}>
                                {r}
                              </Pill>
                            ))}
                          </View>
                        )}
                        {s.pick && s.note && <Txt size={13} color={c.ink2}>{s.note}</Txt>}
                        {s.excluded.length > 0 && (
                          <View style={{ backgroundColor: c.sunk, borderRadius: 10, padding: 10, gap: 4 }}>
                            <Txt size={12} weight="bold" color={c.ink2}>
                              RULED OUT BY CODE
                            </Txt>
                            {s.excluded.slice(0, 3).map((x) => (
                              <Txt key={x.id} size={13}>
                                {x.title} · {money(x.price_cents)} — {x.reasons.join("; ")}
                              </Txt>
                            ))}
                            {s.excluded.length > 3 && (
                              <Txt size={12} color={c.ink2}>
                                and {s.excluded.length - 3} more
                              </Txt>
                            )}
                          </View>
                        )}
                      </Card>
                    ))}

                    <Card title="Total">
                      <KV
                        rows={[
                          ["Items", money(p.items_cents)],
                          [`Shipping (${p.shipping})`, money(p.shipping_cents)],
                          ["Total", money(q?.total_cents ?? p.total_cents)],
                          ...(p.budget_cents ? ([["Budget", <Txt key="b" size={14} weight="bold" color={over ? c.stop : c.done}>{money(p.budget_cents)}</Txt>]] as [string, React.ReactNode][]) : []),
                          ["Arrives", <Txt key="a" size={14} weight="bold" color={late ? c.stop : c.ink}>{day(p.arrival)}</Txt>],
                          ...(i.deadline ? ([["Need by", day(i.deadline)]] as [string, string][]) : []),
                        ]}
                      />
                      {!p.feasible && <Note tone="stop">{p.gap ?? "This plan doesn't fit yet."}</Note>}
                      {d.order ? null : q ? (
                        <View style={{ gap: 10 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Txt weight="bold" size={14}>
                              Quote from {q.merchant?.name?.replace(/\s*\(.*\)$/, "") ?? "the shop"}
                            </Txt>
                            <Countdown until={q.expires_at} onEnd={() => void st.reload()} />
                          </View>
                          {q.lines.map((l, k) => (
                            <KV key={k} rows={[[`${l.qty > 1 ? `${l.qty} × ` : ""}${l.title}`, money(l.unit_cents * l.qty)]]} />
                          ))}
                          <Txt size={12} color={c.ink2}>
                            # {q.hash.slice(0, 16)} · this exact total is what PayPal will show
                          </Txt>
                          <Button kind="paypal" label={`Pay ${money(q.total_cents)} with PayPal`} busy={busy === "pay"} disabled={Boolean(busy)} onPress={() => void run("pay", `/quotes/${q.id}/approve`, { hash: q.hash })} />
                          <Txt size={12} color={c.ink2}>
                            PayPal's sandbox opens in a secure browser. Approve there and you come straight back to the order. Nothing is charged until you approve.
                          </Txt>
                        </View>
                      ) : (
                        <Button label="Get the exact quote" busy={busy === "quote"} disabled={!p.feasible || p.questions.length > 0 || !d.open || Boolean(busy)} onPress={() => void run("quote", `/plans/${i.id}/quote`, undefined, { stay: true })} />
                      )}
                    </Card>

                    {p.arrival && (
                      <Card title="Timing">
                        <Lifeline compact marks={marks} today={today} deadline={i.deadline} title="Plan timing" />
                      </Card>
                    )}
                  </>
                ) : (
                  <Card>
                    <Txt>No plan yet. The planner runs when the request is saved; pull down to refresh.</Txt>
                  </Card>
                )}
                <TrustStrip ai="Read the words of your request, with quotes." code="Set the budget, the date, and ruled out what doesn't fit." paypal="Charges only the exact quoted total, after you approve there." />
              </>
            );
          }}
        </Loaded>
      </Screen>
      <DemoRibbon />
    </View>
  );
}
