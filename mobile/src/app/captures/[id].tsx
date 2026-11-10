import { Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { PlanForm, type Recipient } from "@/components/PlanForm";
import { Button, Card, DemoRibbon, Divider, Empty, Loaded, Note, Row, Screen, StatePill, Title, Txt } from "@/components/ui";
import { cap, money, when, words } from "@/lib/format";
import { useAct } from "@/lib/useAct";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/lib/theme";

interface CaptureData {
  capture: { id: string; url: string; title: string | null; platform: string; channel: string; status: string; basis: string; selected: string | null; reader: string; created_at: string; quarantined: string[] };
  objects: { key: string; label: string; category: string | null; price_seen: number | null }[];
  intents: { id: string; text: string; status: string }[];
}

export default function Capture() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const st = useApi<CaptureData>(`/api/ui/captures/${id}`);
  const rc = useApi<{ recipients: Recipient[] }>("/api/ui/plans");
  const { run, busy } = useAct(st.reload);
  const { c } = useTheme();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Screen onRefresh={() => void st.reload()} refreshing={st.loading && Boolean(st.data)}>
        <Loaded st={st}>
          {(d) => {
            const x = d.capture;
            const need = d.objects.length > 0 && !x.selected;
            return (
              <>
                <Title eyebrow={`${cap(x.platform)} · saved from the ${x.channel === "mobile" ? "phone" : x.channel === "app" ? "website" : x.channel} · ${when(x.created_at)}`}>{x.title || x.url || "Your description"}</Title>
                <Card>
                  <StatePill s={x.status} />
                  <Txt size={14}>{x.basis}</Txt>
                  {x.url ? <Button label="Open the link" kind="secondary" icon="external-link" onPress={() => void WebBrowser.openBrowserAsync(x.url)} /> : null}
                </Card>
                {x.quarantined.length > 0 && (
                  <Note tone="stop" icon="shield">
                    {`Text in the image tried to give instructions. It was set aside and not used: ${x.quarantined.map((t) => `“${t}”`).join(", ")}`}
                  </Note>
                )}
                <Card title="Which item do you mean?" sub={x.reader !== "rules" ? `Read by ${x.reader}.` : undefined}>
                  {d.objects.length ? (
                    <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                      {d.objects.map((o) => {
                        const on = x.selected === o.key;
                        return (
                          <Pressable key={o.key} accessibilityRole="radio" aria-checked={on} aria-busy={busy === o.key} disabled={Boolean(busy)} onPress={() => void run(o.key, `/captures/${x.id}/select`, { key: o.key }, { stay: true })} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: on ? c.ink : c.rule2, backgroundColor: on ? c.ink : c.card }}>
                            <Feather name={on ? "check-circle" : "circle"} size={20} color={on ? c.paper : c.ink3} />
                            <View style={{ flex: 1 }}>
                              <Txt weight="medium" color={on ? c.paper : c.ink}>
                                {o.label}
                              </Txt>
                              <Txt size={12} color={on ? c.paper : c.ink2}>
                                {(o.category ? words(o.category) : "other") + (o.price_seen ? ` · ${money(o.price_seen * 100)} seen` : "")}
                              </Txt>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <Empty title="No items read from this.">Describe what you want below, or save a screenshot of the exact moment.</Empty>
                  )}
                </Card>
                <Card title="What would you like to do?" sub={need ? "Pick an item first." : undefined}>
                  {rc.data && <PlanForm recipients={rc.data.recipients} captureId={x.id} disabled={need} label="Your goal" placeholder="Help me get this by Friday for under $60" />}
                </Card>
                {d.intents.length > 0 && (
                  <Card title="Plans from this">
                    {d.intents.map((i, k) => (
                      <View key={i.id}>
                        {k > 0 && <Divider />}
                        <Row title={i.text} right={<StatePill s={i.status} />} onPress={() => router.push(`/plans/${i.id}`)} />
                      </View>
                    ))}
                  </Card>
                )}
              </>
            );
          }}
        </Loaded>
      </Screen>
      <DemoRibbon />
    </View>
  );
}
