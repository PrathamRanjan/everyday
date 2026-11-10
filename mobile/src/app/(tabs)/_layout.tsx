import { Redirect, Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSession } from "@/lib/session";
import { fonts, useTheme } from "@/lib/theme";

const icon = (name: keyof typeof Feather.glyphMap) => ({ color, size }: { color: unknown; size: number }) => <Feather name={name} color={String(color)} size={size} />;

export default function TabsLayout() {
  const { c } = useTheme();
  const { ready, who } = useSession();
  if (ready && !who) return <Redirect href="/sign-in" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.ink2,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.rule, minHeight: 60 },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11 },
        sceneStyle: { backgroundColor: c.paper },
      }}
    >
      <Tabs.Screen name="today" options={{ title: "Today", tabBarIcon: icon("sun") }} />
      <Tabs.Screen name="plans" options={{ title: "Plans", tabBarIcon: icon("edit-3") }} />
      <Tabs.Screen name="find" options={{ title: "Find", tabBarIcon: icon("camera") }} />
      <Tabs.Screen name="bought" options={{ title: "Bought", tabBarIcon: icon("package") }} />
      <Tabs.Screen name="approvals" options={{ title: "Approvals", tabBarIcon: icon("shield"), tabBarBadge: who?.held ? who.held : undefined, tabBarBadgeStyle: { backgroundColor: c.now, color: c.paper } }} />
    </Tabs>
  );
}
