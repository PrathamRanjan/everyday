import { useEffect } from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { useFonts, Newsreader_500Medium } from "@expo-google-fonts/newsreader";
import { PublicSans_400Regular, PublicSans_500Medium, PublicSans_600SemiBold } from "@expo-google-fonts/public-sans";
import { SessionProvider } from "@/lib/session";
import { ToastProvider } from "@/lib/toast";
import { fonts, useTheme } from "@/lib/theme";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export default function Root() {
  const [loaded] = useFonts({ Newsreader_500Medium, PublicSans_400Regular, PublicSans_500Medium, PublicSans_600SemiBold });
  const { c, dark } = useTheme();
  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") document.title = "Everyday";
  }, []);
  if (!loaded) return <View style={{ flex: 1, backgroundColor: c.paper }} />;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <ToastProvider>
          <StatusBar style={dark ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: c.paper },
              headerShadowVisible: false,
              headerTintColor: c.ink,
              headerTitleStyle: { fontFamily: fonts.display, fontSize: 18 },
              headerBackButtonDisplayMode: "minimal",
              contentStyle: { backgroundColor: c.paper },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="plans/[id]" options={{ title: "Plan" }} />
            <Stack.Screen name="orders/[id]" options={{ title: "Order" }} />
            <Stack.Screen name="captures/[id]" options={{ title: "Saved" }} />
            <Stack.Screen name="settings" options={{ title: "Settings", presentation: "modal" }} />
          </Stack>
        </ToastProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
