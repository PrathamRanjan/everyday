import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Txt } from "@/components/ui";
import { useTheme } from "./theme";

type Msg = { text: string; kind: "ok" | "err" } | null;
const Ctx = createContext<(text: string, kind?: "ok" | "err") => void>(() => undefined);

/** A short message at the bottom after an action, read out by screen readers. Errors stay until tapped. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<Msg>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const show = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    if (t.current) clearTimeout(t.current);
    setMsg({ text, kind });
    AccessibilityInfo.announceForAccessibility(text);
    if (kind === "ok") t.current = setTimeout(() => setMsg(null), 4000);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {msg && (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 16, right: 16, bottom: insets.bottom + 72, alignItems: "center" }}>
          <Pressable accessibilityRole="alert" onPress={() => setMsg(null)} style={{ maxWidth: 560, width: "100%", flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: msg.kind === "err" ? c.stopBg : c.ink, borderRadius: 12, padding: 14, borderWidth: msg.kind === "err" ? 1 : 0, borderColor: c.stop }}>
            <Feather name={msg.kind === "err" ? "alert-circle" : "check-circle"} size={18} color={msg.kind === "err" ? c.stop : c.paper} />
            <Txt color={msg.kind === "err" ? c.stop : c.paper} style={{ flex: 1 }}>
              {msg.text}
            </Txt>
          </Pressable>
        </View>
      )}
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
