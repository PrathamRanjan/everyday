import { View } from "react-native";
import { useRouter } from "expo-router";
import { Card, DemoRibbon, Empty, Loaded, Money, Screen, StatePill, Title, Txt } from "@/components/ui";
import { day, when } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/lib/theme";
import { Pressable } from "react-native";

type PurchasesData = { orders: { id: string; number: string; status: string; total_cents: number; refunded_cents: number; created_at: string; placed_at: string | null; capture_id: string | null; lines: { title: string; status: string; eta: string | null }[] }[] };

export default function Bought() {
  const st = useApi<PurchasesData>("/api/ui/purchases");
  const router = useRouter();
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Screen edges={["top"]} onRefresh={() => void st.reload()} refreshing={st.loading && Boolean(st.data)}>
        <Title lede="Every order with its delivery, return window and price promise.">Bought</Title>
        <Loaded st={st}>
          {(d) =>
            d.orders.length ? (
              d.orders.map((o) => (
                <Pressable key={o.id} accessibilityRole="button" aria-label={`Order ${o.number}`} onPress={() => router.push(`/orders/${o.id}`)} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                  <Card title={o.lines.map((l) => l.title).join(", ") || o.number} sub={`${o.number} · ${when(o.placed_at ?? o.created_at)}`} right={<StatePill s={o.status} />}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                      <Money cents={o.total_cents} />
                      {o.refunded_cents > 0 && (
                        <Txt size={13} color={c.done} weight="bold">
                          <Money cents={o.refunded_cents} size={13} color={c.done} /> back
                        </Txt>
                      )}
                      {o.lines[0]?.eta && o.status === "paid" && (
                        <Txt size={13} color={c.ink2}>
                          arrives {day(o.lines[0].eta)}
                        </Txt>
                      )}
                    </View>
                  </Card>
                </Pressable>
              ))
            ) : (
              <Card>
                <Empty title="Nothing bought yet.">Orders appear here after you approve them on PayPal.</Empty>
              </Card>
            )
          }
        </Loaded>
      </Screen>
      <DemoRibbon />
    </View>
  );
}
