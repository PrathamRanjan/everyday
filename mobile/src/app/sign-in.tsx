import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, Chips, DemoRibbon, Field, Note, Screen, Title, Txt } from "@/components/ui";
import { getJson, hostOf, SERVERS } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

type Personas = { demo: boolean; accounts: { id: string; name: string }[] };
type Where = "live" | "local" | "other";

/**
 * Signing in on the phone. In the demo: "Continue as Maya", like the website. Otherwise: paste the key made on
 * Everyday → Messages → Connect the phone app. The key is kept in the phone's Keychain / Keystore.
 */
export default function SignIn() {
  const { c } = useTheme();
  const router = useRouter();
  const s = useSession();
  const whereOf = (b: string): Where => (b === SERVERS.live ? "live" : b === SERVERS.local ? "local" : "other");
  const [where, setWhere] = useState<Where>(whereOf(s.base));
  const [other, setOther] = useState(where === "other" ? s.base : "http://192.168.1.10:4111");
  const [people, setPeople] = useState<Personas | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (s.ready) setWhere(whereOf(s.base));
  }, [s.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (s.who) router.replace("/today");
  }, [s.who]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!s.ready) return;
    let off = false;
    setPeople(null);
    setProblem(null);
    getJson<Personas>("/api/ui/personas")
      .then((p) => !off && setPeople(p))
      .catch((e) => !off && setProblem((e as Error).message));
    return () => {
      off = true;
    };
  }, [s.base, s.ready]);

  const choose = async (w: Where) => {
    setWhere(w);
    if (w !== "other") await s.setServer(SERVERS[w]);
  };
  const go = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setProblem(null);
    try {
      await fn();
      router.replace("/today");
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Screen edges={["top", "bottom"]}>
        <View style={{ gap: 10, paddingTop: 12 }}>
          <Txt weight="display" size={22}>
            Everyday
          </Txt>
          <Title lede="Say what you need. Everyday plans it inside your budget and dates, PayPal moves the money only after you approve, and every item keeps its return window and price promise in view.">Your purchases, after the sale.</Title>
        </View>

        <Card title="Server">
          <Chips<Where>
            label="Everyday server"
            value={where}
            onChange={(w) => void choose(w)}
            options={[
              { value: "live", label: "Live demo" },
              { value: "local", label: "This computer" },
              { value: "other", label: "Other" },
            ]}
          />
          {where === "other" && (
            <View style={{ gap: 8 }}>
              <Field label="Server address" value={other} onChangeText={setOther} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint="For a phone on the same Wi-Fi as your laptop: http://<laptop's IP>:4111" />
              <Button label="Use this server" kind="secondary" onPress={() => void s.setServer(other)} />
            </View>
          )}
          <Txt size={13} color={c.ink2}>
            Connected to {hostOf(s.base)}
          </Txt>
        </Card>

        {people?.demo && people.accounts.length > 0 && (
          <Card title="Try the demo" sub="Sandbox PayPal and test money. Signing in makes a key for this phone; you can disconnect it from Messages on the website.">
            {people.accounts.map((a) => (
              <Button key={a.id} label={`Continue as ${a.name.split(" ")[0]}`} busy={busy === a.id} disabled={Boolean(busy)} onPress={() => void go(a.id, () => s.signInDemo(a.id))} />
            ))}
          </Card>
        )}

        <Card title="Connect with a key" sub="On Everyday open Messages → Phone app and browser extension → Connect the phone app, then paste the key here. It's shown once.">
          <Field label="Phone key" value={key} onChangeText={setKey} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="evd_…" />
          <Button label="Connect" kind="secondary" busy={busy === "key"} disabled={!key.trim() || Boolean(busy)} onPress={() => void go("key", () => s.signInKey(key))} />
        </Card>

        {(problem || s.problem) && <Note tone="stop" icon="alert-circle">{problem ?? s.problem ?? ""}</Note>}
        <DemoRibbon />
      </Screen>
    </View>
  );
}
