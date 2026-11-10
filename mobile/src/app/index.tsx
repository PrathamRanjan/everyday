import { Redirect } from "expo-router";
import { View } from "react-native";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

export default function Index() {
  const { ready, who } = useSession();
  const { c } = useTheme();
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.paper }} />;
  return <Redirect href={who ? "/today" : "/sign-in"} />;
}
