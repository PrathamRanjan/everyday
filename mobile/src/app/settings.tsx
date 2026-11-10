import { View } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Button, Card, KV, Screen, Txt } from "@/components/ui";
import { hostOf, serverBase } from "@/lib/api";
import { setReminders } from "@/lib/reminders";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { useAct } from "@/lib/useAct";

export default function Settings() {
  const s = useSession();
  const router = useRouter();
  const { c } = useTheme();
  const { run, busy } = useAct();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Screen edges={["bottom"]}>
        <Card title="Signed in">
          <KV
            rows={[
              ["Shopper", s.who?.name ?? "—"],
              ["Server", hostOf(s.base)],
              ["PayPal", s.info?.paypal_env ?? "—"],
            ]}
          />
          <Txt size={13} color={c.ink2}>
            This phone signs in with its own key, kept in the phone's secure storage. Signing out disconnects the key on the server too.
          </Txt>
          <Button
            label="Sign out of this phone"
            kind="secondary"
            onPress={async () => {
              await setReminders(false);
              await s.signOut();
              router.replace("/sign-in");
            }}
          />
        </Card>
        <Card title="On the website" sub="Writing your own rules, passkeys, Telegram and the full evidence are on the website.">
          <Button label="Open Everyday on the web" kind="secondary" icon="external-link" onPress={() => void WebBrowser.openBrowserAsync(`${serverBase()}/today`)} />
        </Card>
        {s.info?.demo && (
          <Card title="Demo" sub="Move the demo clock to see return windows close and price promises run out. Reset puts the demo back as it started and signs this phone out.">
            <Button label="+1 day" kind="secondary" busy={busy === "day"} onPress={() => void run("day", "/demo/clock", { step: "day" }, { stay: true })} />
            <Button label="+1 week" kind="secondary" busy={busy === "week"} onPress={() => void run("week", "/demo/clock", { step: "week" }, { stay: true })} />
            <Button
              label="Reset the demo"
              kind="secondary"
              busy={busy === "reset"}
              onPress={async () => {
                await run("reset", "/demo/reset", undefined, { stay: true });
                await s.refresh();
                router.replace("/sign-in");
              }}
            />
          </Card>
        )}
      </Screen>
    </View>
  );
}
