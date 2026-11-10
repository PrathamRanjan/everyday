import { useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { Lifeline, type Band, type Mark } from "@/components/Lifeline";
import { ApprovalCard, type ApprovalView } from "@/components/Approval";
import { Button, Card, DemoRibbon, Divider, Empty, KV, Loaded, Money, Row, Screen, Title, Txt } from "@/components/ui";
import { appRoute, serverBase } from "@/lib/api";
import { day, daysBetween, money, plural } from "@/lib/format";
import { remindersOn, remindersSupported, schedule, setReminders, type Dated } from "@/lib/reminders";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";

export interface TodayData {
  first: string;
  today: string;
  clock: string;
  items: { kind: string; title: string; detail: string; href: string; when: string | null; urgency: number }[];
  calendar: { date: string; what: string; href: string }[];
  spending: { limit_cents: number; spent_cents: number; reserved_cents: number; left_cents: number; note: string };
  held: ApprovalView[];
  soon: { id: string; title: string; return_until: string; warranty_until: string | null; acquired: string }[];
}

const ICON: Record<string, keyof typeof Feather.glyphMap> = { recall: "alert-octagon", approve: "check-square", question: "help-circle", gap: "alert-triangle", payment: "credit-card", risk: "clock", delivery: "truck", case: "message-square", return: "rotate-ccw", warranty: "tool", price: "tag" };
const greet = (clock: string) => {
  const h = Number(/(\d{1,2}):\d{2}/.exec(clock)?.[1] ?? 9);
  const pm = /pm/i.test(clock) && h < 12;
  const hour = pm ? h + 12 : h;
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
};

/** What the server's calendar says, as phone reminders. */
export function datedOf(cal: TodayData["calendar"]): Dated[] {
  return cal.map((x, i) => {
    const kind: Dated["kind"] = x.what.startsWith("Last day to return") ? "return" : x.what.startsWith("Warranty") ? "warranty" : x.what.startsWith("Expected") ? "delivery" : "deadline";
    const title = x.what.replace(/^(Last day to return|Warranty ends:|Expected:|Goal deadline:)\s*/, "");
    return { id: `${i}-${x.href}`, title, date: x.date, kind };
  });
}

export default function Today() {
  const st = useApi<TodayData>("/api/ui/today");
  const router = useRouter();
  const { c } = useTheme();
  const toast = useToast();
  const [remind, setRemind] = useState(false);

  useEffect(() => {
    void remindersOn().then(setRemind);
  }, []);
  // Keep the phone's reminders in step with the server's dates.
  useEffect(() => {
    if (remind && st.data) void schedule(datedOf(st.data.calendar));
  }, [remind, st.data]);

  const open = (href: string) => {
    const r = appRoute(href);
    if (r) router.push(r as never);
    else void WebBrowser.openBrowserAsync(serverBase() + href);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Screen edges={["top"]} onRefresh={() => void st.reload()} refreshing={st.loading && Boolean(st.data)}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Txt weight="display" size={20} style={{ flex: 1 }}>
            Everyday
          </Txt>
          <Pressable accessibilityRole="button" aria-label="Settings" onPress={() => router.push("/settings")} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
            <Feather name="settings" size={20} color={c.ink2} />
          </Pressable>
        </View>
        <Loaded st={st}>
          {(d) => {
            const needs = d.items.length + d.held.length;
            const marks: Mark[] = d.calendar
              .filter((x) => daysBetween(d.today, x.date) <= 45 && daysBetween(d.today, x.date) >= -7)
              .slice(0, 5)
              .map((x, i) => ({ key: `c${i}`, label: x.what.replace(/^Goal deadline: /, "Due: ").replace(/^Warranty ends: /, "Warranty: ").replace(/^Last day to return /, "Return: ").slice(0, 22), date: x.date, tone: x.what.startsWith("Goal") ? "now" : "plain" }));
            const bands: Band[] = d.soon.slice(0, 3).map((s) => ({ key: s.id, label: `Return · ${s.title}`, from: s.acquired, to: s.return_until }));
            const used = d.spending.limit_cents ? Math.min(100, Math.round(((d.spending.spent_cents + d.spending.reserved_cents) / d.spending.limit_cents) * 100)) : 0;
            return (
              <>
                <Title eyebrow={d.clock} lede={needs ? `${plural(needs, "thing needs", "things need")} you. Everything else is in hand.` : "Nothing needs you today."}>
                  {`${greet(d.clock)}, ${d.first}.`}
                </Title>

                {d.held.map((a) => (
                  <ApprovalCard key={a.id} a={a} reload={st.reload} />
                ))}

                <Card title="Needs you">
                  {d.items.length ? (
                    d.items.map((it, i) => (
                      <View key={i}>
                        {i > 0 && <Divider />}
                        <Row icon={ICON[it.kind] ?? "calendar"} iconColor={it.kind === "recall" ? c.stop : it.kind === "gap" ? c.wait : c.now} title={it.title} detail={it.detail.replace(/(\d{4}-\d{2}-\d{2})/g, (m) => day(m))} right={it.when ? <Txt size={13} color={c.ink2}>{day(it.when)}</Txt> : undefined} onPress={() => open(it.href)} />
                      </View>
                    ))
                  ) : (
                    <Empty title="All clear.">Plans ready to approve, questions and recalls show up here.</Empty>
                  )}
                </Card>

                <Card title="The next few weeks" sub="Deadlines on the line; return windows under it.">
                  {marks.length || bands.length ? <Lifeline marks={marks} bands={bands} today={d.today} title="Your next few weeks" /> : <Empty title="Nothing dated yet.">Once you buy something, its return window and warranty appear here.</Empty>}
                  {d.calendar.slice(0, 5).map((x, i) => (
                    <View key={i}>
                      <Divider />
                      <Row title={x.what} detail={day(x.date)} onPress={() => open(x.href)} />
                    </View>
                  ))}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Txt weight="medium">Remind me on this phone</Txt>
                      <Txt size={13} color={c.ink2}>
                        {remindersSupported ? "Before a return window closes, a warranty ends or a delivery is due. Scheduled on the phone." : "Reminders work in the phone app, not in this browser build."}
                      </Txt>
                    </View>
                    <Switch
                      aria-label="Remind me on this phone"
                      value={remind}
                      disabled={!remindersSupported}
                      onValueChange={async (v) => {
                        const r = await setReminders(v, datedOf(d.calendar));
                        setRemind(r.on);
                        toast(r.message ?? (r.on ? `${plural(r.scheduled, "reminder")} scheduled.` : "Reminders off."), r.message ? "err" : "ok");
                      }}
                    />
                  </View>
                </Card>

                <Card title="This month">
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                    <Money cents={d.spending.left_cents} size={30} weight="display" />
                    <Txt color={c.ink2}>left</Txt>
                  </View>
                  <View accessibilityRole="progressbar" aria-label={`${used}% of your monthly limit used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} style={{ height: 8, borderRadius: 999, backgroundColor: c.sunk, overflow: "hidden" }}>
                    <View style={{ width: `${used}%`, height: "100%", backgroundColor: c.ink }} />
                  </View>
                  <KV
                    rows={[
                      ["Spent", money(d.spending.spent_cents)],
                      ["Waiting to pay", money(d.spending.reserved_cents)],
                      ["Your limit", money(d.spending.limit_cents)],
                    ]}
                  />
                  <Txt size={12} color={c.ink2}>
                    {d.spending.note}
                  </Txt>
                </Card>
                <Button label="Plan something new" icon="plus" onPress={() => router.push("/plans")} />
              </>
            );
          }}
        </Loaded>
      </Screen>
      <DemoRibbon />
    </View>
  );
}
