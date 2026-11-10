import { View } from "react-native";
import { useRouter } from "expo-router";
import { PlanForm, type Recipient } from "@/components/PlanForm";
import { Card, DemoRibbon, Divider, Empty, Loaded, Row, Screen, StatePill, Title } from "@/components/ui";
import { day, money } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/lib/theme";

type PlansData = { plans: { id: string; text: string; status: string; channel: string; created_at: string; budget_cents: number | null; deadline: string | null; recipient: string; is_self: boolean }[]; recipients: Recipient[] };
const VIA: Record<string, string> = { app: "website", mobile: "phone", extension: "extension", telegram: "Telegram", mcp: "assistant" };

export default function Plans() {
  const st = useApi<PlansData>("/api/ui/plans");
  const router = useRouter();
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Screen edges={["top"]} onRefresh={() => void st.reload()} refreshing={st.loading && Boolean(st.data)}>
        <Title lede="Say it in a sentence. Everyday reads it, checks your budget, dates and what you own, and shows its working.">Plans</Title>
        <Loaded st={st}>
          {(d) => (
            <>
              <Card title="Start a plan">
                <PlanForm recipients={d.recipients} />
              </Card>
              <Card title="Your plans">
                {d.plans.length ? (
                  d.plans.map((p, i) => (
                    <View key={p.id}>
                      {i > 0 && <Divider />}
                      <Row
                        testID={`plan-${p.id}`}
                        title={p.text}
                        detail={[p.is_self ? null : `for ${p.recipient}`, p.budget_cents ? `under ${money(p.budget_cents)}` : null, p.deadline ? `by ${day(p.deadline)}` : null, `from the ${VIA[p.channel] ?? p.channel}`].filter(Boolean).join(" · ")}
                        right={<StatePill s={p.status} />}
                        onPress={() => router.push(`/plans/${p.id}`)}
                      />
                    </View>
                  ))
                ) : (
                  <Empty title="No plans yet.">Your first one takes a sentence.</Empty>
                )}
              </Card>
            </>
          )}
        </Loaded>
      </Screen>
      <DemoRibbon />
    </View>
  );
}
