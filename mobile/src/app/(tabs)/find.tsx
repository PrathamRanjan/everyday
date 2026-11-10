import { useState } from "react";
import { Image, Platform, View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Button, Card, DemoRibbon, Divider, Empty, Field, Loaded, Row, Screen, StatePill, Title, Txt } from "@/components/ui";
import { when } from "@/lib/format";
import { useAct } from "@/lib/useAct";
import { useApi } from "@/lib/useApi";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";

type DiscoverData = { captures: { id: string; url: string | null; title: string | null; status: string; channel: string; platform: string; created_at: string; objects: number }[]; clips: { url: string; title: string }[]; ai: boolean };
type Shot = { uri: string; name: string; type: string; file?: Blob | null };

/**
 * Find: save something you saw. A Reel, TikTok or product link, a screenshot from the camera roll, or a few words.
 * The vision model reads a screenshot into objects; text inside an image that tries to give instructions is set
 * aside. Posts to the website's /discover/capture route, tagged as from the phone.
 */
export default function Find() {
  const st = useApi<DiscoverData>("/api/ui/discover");
  const { c } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { run, busy } = useAct(st.reload);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [shot, setShot] = useState<Shot | null>(null);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: false });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    if (a.fileSize && a.fileSize > 5 * 1024 * 1024) return toast("That image is over 5 MB. Choose a smaller screenshot.", "err");
    setShot({ uri: a.uri, name: a.fileName ?? "screenshot.jpg", type: a.mimeType ?? "image/jpeg", file: (a as { file?: Blob }).file ?? null });
  };

  const save = async () => {
    const fd = new FormData();
    if (url.trim()) fd.append("url", url.trim());
    if (text.trim()) fd.append("text", text.trim());
    if (shot) {
      if (Platform.OS === "web") fd.append("shot", shot.file ?? (await (await fetch(shot.uri)).blob()), shot.name);
      // React Native's FormData takes a file as { uri, name, type }.
      else fd.append("shot", { uri: shot.uri, name: shot.name, type: shot.type } as unknown as Blob);
    }
    const out = await run("save", "/discover/capture", fd);
    if (out) {
      setUrl("");
      setText("");
      setShot(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Screen edges={["top"]} onRefresh={() => void st.reload()} refreshing={st.loading && Boolean(st.data)}>
        <Title lede="Save something you saw. Everyday works out what it is, then you say what you want to do with it.">Find</Title>
        <Card title="Save it">
          <Field label="A Reel, TikTok, Short or product link" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://" />
          <View style={{ gap: 8 }}>
            <Txt weight="bold" size={14}>
              A screenshot of the moment
            </Txt>
            {shot ? (
              <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <Image source={{ uri: shot.uri }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: c.sunk }} accessibilityIgnoresInvertColors aria-label="The screenshot you chose" />
                <Button label="Remove" kind="secondary" onPress={() => setShot(null)} />
              </View>
            ) : (
              <Button label="Choose a screenshot" kind="secondary" icon="image" onPress={() => void pick()} />
            )}
          </View>
          <Field label="Or describe it" value={text} onChangeText={setText} multiline placeholder="The walnut desk lamp in the video, about $50" />
          <Button label="Save to Find" icon="bookmark" busy={busy === "save"} disabled={!url.trim() && !text.trim() && !shot} onPress={() => void save()} />
          <Txt size={12} color={c.ink2}>
            {st.data?.ai === false ? "No model on this server: links and words are read by rules." : "The model reads the link's title or the screenshot; text in an image that tries to give instructions is set aside."}
          </Txt>
        </Card>
        <Loaded st={st}>
          {(d) => (
            <>
              <Card title="Saved">
                {d.captures.length ? (
                  d.captures.slice(0, 15).map((x, i) => (
                    <View key={x.id}>
                      {i > 0 && <Divider />}
                      <Row title={x.title || x.url || "Your description"} detail={`${x.objects} item${x.objects === 1 ? "" : "s"} · ${when(x.created_at)}`} right={<StatePill s={x.status} />} onPress={() => router.push(`/captures/${x.id}`)} />
                    </View>
                  ))
                ) : (
                  <Empty title="Nothing saved yet." />
                )}
              </Card>
              {d.clips.length > 0 && (
                <Card title="Demo clips" sub="Sample videos with authored items, labelled as demo clips. Real links are read for real.">
                  {d.clips.slice(0, 4).map((x, i) => (
                    <View key={x.url}>
                      {i > 0 && <Divider />}
                      <Row title={x.title} detail="Tap to put the link in the box" onPress={() => setUrl(x.url)} />
                    </View>
                  ))}
                </Card>
              )}
            </>
          )}
        </Loaded>
      </Screen>
      <DemoRibbon />
    </View>
  );
}
