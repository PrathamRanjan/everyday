import { Alert, Platform, View } from "react-native";
import { ApprovalCard, type ApprovalView } from "@/components/Approval";
import { Button, Card, DemoRibbon, Divider, Empty, KV, Loaded, Note, Screen, Title, Txt } from "@/components/ui";
import { money } from "@/lib/format";
import { useAct } from "@/lib/useAct";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/lib/theme";

type GuardData = {
  rules: { key: string; label: string; value: unknown }[];
  kill: { engaged: boolean; reason: string | null };
  approvals: ApprovalView[];
  countersign_cents: number;
  policy: { text: string } | null;
};

const valueOf = (key: string, v: unknown) => (typeof v === "boolean" ? (v ? "Yes" : "No") : key.endsWith("_cents") ? money(Number(v)) : Array.isArray(v) ? (v.length ? v.join(", ") : "Any") : String(v ?? "—"));

function confirm(title: string, body: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${body}`) ?? true);
  return new Promise((res) => Alert.alert(title, body, [{ text: "Cancel", style: "cancel", onPress: () => res(false) }, { text: "Stop everything", style: "destructive", onPress: () => res(true) }]));
}

/**
 * Approvals: money moves waiting for the shopper, the rules an assistant must follow, and the kill switch that stops
 * every assistant from planning or paying for this shopper until it's released.
 */
export default function Approvals() {
  const st = useApi<GuardData>("/api/ui/guard");
  const { c } = useTheme();
  const { run, busy } = useAct(st.reload);
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Screen edges={["top"]} onRefresh={() => void st.reload()} refreshing={st.loading && Boolean(st.data)}>
        <Title lede="What waits for you, the rules assistants follow for you, and the switch that stops them.">Approvals</Title>
        <Loaded st={st}>
          {(d) => (
            <>
              {d.approvals.length ? (
                d.approvals.map((a) => <ApprovalCard key={a.id} a={a} reload={st.reload} />)
              ) : (
                <Card>
                  <Empty title="Nothing waiting.">Repeat buys at or over your limit, and anything that looks like a scam, wait here for you.</Empty>
                </Card>
              )}

              <Card title="Kill switch" tone={d.kill.engaged ? "stop" : undefined} sub={d.kill.engaged ? `On${d.kill.reason ? `: ${d.kill.reason}` : ""}. No assistant can plan, quote or pay for you.` : "Off. Assistants work inside your rules."}>
                {d.kill.engaged ? (
                  <Button label="Release the kill switch" kind="secondary" busy={busy === "kill"} onPress={() => void run("kill", "/guard/kill", { scope: "account", engaged: "0" }, { stay: true })} />
                ) : (
                  <Button
                    label="Stop all assistants"
                    kind="danger"
                    icon="octagon"
                    busy={busy === "kill"}
                    onPress={async () => {
                      if (await confirm("Stop all assistants?", "No assistant will plan, quote or pay for you until you release it. Orders already paid aren't touched.")) await run("kill", "/guard/kill", { scope: "account", engaged: "1", reason: "Stopped from the phone app" }, { stay: true });
                    }}
                  />
                )}
              </Card>

              <Card title="Your rules" sub={d.policy ? `Written by you: “${d.policy.text}”` : "The default rules. Write your own on the website."}>
                <KV rows={d.rules.map((r) => [r.label, valueOf(r.key, r.value)] as [string, string])} />
                <Divider />
                <Txt size={12} color={c.ink2}>
                  Above {money(d.countersign_cents)} an approval needs your passkey on the website. Smaller ones ask for Face ID or your passcode here.
                </Txt>
              </Card>
              <Note icon="info">Face ID confirms it's you on this phone. The server still applies these rules before anything reaches PayPal.</Note>
            </>
          )}
        </Loaded>
      </Screen>
      <DemoRibbon />
    </View>
  );
}
