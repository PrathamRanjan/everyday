import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { fonts, useTheme, type Palette } from "@/lib/theme";
import { money } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Load } from "@/lib/useApi";

export type Tone = "now" | "wait" | "done" | "stop" | "plain";
const toneColors = (c: Palette, t: Tone) => (t === "now" ? [c.now, c.nowBg] : t === "wait" ? [c.wait, c.waitBg] : t === "done" ? [c.done, c.doneBg] : t === "stop" ? [c.stop, c.stopBg] : [c.ink2, c.sunk]);

/** The demo strip: sandbox, test money, demo clock. Shown only when the server is in demo mode. */
export function DemoRibbon() {
  const { c } = useTheme();
  const { info, who } = useSession();
  if (!info?.demo) return null;
  return (
    <View style={{ backgroundColor: c.sunk, paddingHorizontal: 16, paddingVertical: 6 }} accessibilityRole="text">
      <Txt size={12} color={c.ink2}>
        Demo · PayPal {info.paypal_env} · test money{who?.clock ? ` · demo clock ${who.clock}` : ""}
      </Txt>
    </View>
  );
}

/** A scrolling screen with pull to refresh. */
export function Screen({ children, onRefresh, refreshing = false, edges = [] }: { children: ReactNode; onRefresh?: () => void; refreshing?: boolean; edges?: ("top" | "bottom")[] }) {
  const { c } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c.paper }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.ink2} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Txt({ children, size = 15, color, weight = "regular", style, numberOfLines, selectable }: { children: ReactNode; size?: number; color?: string; weight?: "regular" | "medium" | "bold" | "display"; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean }) {
  const { c } = useTheme();
  const family = weight === "display" ? fonts.display : weight === "bold" ? fonts.sansBold : weight === "medium" ? fonts.sansMedium : fonts.sans;
  return (
    <Text selectable={selectable} numberOfLines={numberOfLines} style={[{ fontFamily: family, fontSize: size, lineHeight: Math.round(size * (weight === "display" ? 1.2 : 1.45)), color: color ?? c.ink, fontVariant: ["tabular-nums"] }, style]}>
      {children}
    </Text>
  );
}

export function Title({ eyebrow, children, lede }: { eyebrow?: ReactNode; children: ReactNode; lede?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {eyebrow ? (
        <Txt size={12} color={c.ink2} weight="medium">
          {eyebrow}
        </Txt>
      ) : null}
      <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: c.ink }}>
        {children}
      </Text>
      {lede ? <Txt color={c.ink2}>{lede}</Txt> : null}
    </View>
  );
}

export function Card({ title, sub, children, tone, style, right }: { title?: ReactNode; sub?: ReactNode; children?: ReactNode; tone?: Tone; style?: StyleProp<ViewStyle>; right?: ReactNode }) {
  const { c } = useTheme();
  const border = tone ? toneColors(c, tone)[0] : c.rule;
  return (
    <View style={[{ backgroundColor: c.card, borderColor: border, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 14, padding: 14, gap: 10 }, style]}>
      {title ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text accessibilityRole="header" style={{ fontFamily: fonts.display, fontSize: 19, lineHeight: 24, color: c.ink }}>
              {title}
            </Text>
            {sub ? (
              <Txt size={13} color={c.ink2}>
                {sub}
              </Txt>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Pill({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  const { c } = useTheme();
  const [fg, bg] = toneColors(c, tone);
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" }}>
      <Txt size={12} color={fg} weight="bold">
        {children}
      </Txt>
    </View>
  );
}

const STATE: Record<string, [Tone, string]> = {
  planning: ["now", "Planning"],
  quoted: ["now", "Quoted"],
  ordered: ["done", "Ordered"],
  created: ["wait", "Not paid"],
  approved: ["wait", "Approved on PayPal"],
  paid: ["done", "Paid"],
  delivered: ["done", "Delivered"],
  shipped: ["wait", "On its way"],
  backordered: ["now", "Delayed"],
  returned: ["done", "Returned"],
  refunded: ["done", "Refunded"],
  partially_refunded: ["done", "Part refunded"],
  cancelled: ["plain", "Cancelled"],
  stale: ["plain", "Out of date"],
  failed: ["stop", "Refused"],
  read: ["done", "Read"],
  pending: ["wait", "Waiting on PayPal"],
};
export function StatePill({ s }: { s: string }) {
  const [tone, label] = STATE[s] ?? ["plain", s.replace(/_/g, " ")];
  return <Pill tone={tone}>{label}</Pill>;
}

export function Button({ label, onPress, busy, disabled, kind = "primary", icon, accessibilityHint }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; kind?: "primary" | "secondary" | "paypal" | "danger"; icon?: keyof typeof Feather.glyphMap; accessibilityHint?: string }) {
  const { c } = useTheme();
  const bg = kind === "primary" ? c.ink : kind === "paypal" ? c.paypal : kind === "danger" ? c.stop : "transparent";
  const fg = kind === "primary" ? c.paper : kind === "paypal" ? c.paypalInk : kind === "danger" ? c.paper : c.ink;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      aria-label={label}
      accessibilityHint={accessibilityHint}
      aria-disabled={Boolean(off)} aria-busy={Boolean(busy)}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 48, borderRadius: 999, paddingHorizontal: 18, backgroundColor: bg, borderWidth: kind === "secondary" ? 1 : 0, borderColor: c.rule2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: off ? 0.5 : pressed ? 0.85 : 1 })}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon ? <Feather name={icon} size={18} color={fg} /> : null}
      <Txt color={fg} weight="bold">
        {label}
      </Txt>
    </Pressable>
  );
}

/** A tappable row: title, detail, optional right side, chevron. */
export function Row({ title, detail, right, onPress, icon, iconColor, testID }: { title: string; detail?: string; right?: ReactNode; onPress?: () => void; icon?: keyof typeof Feather.glyphMap; iconColor?: string; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole={onPress ? "button" : undefined} onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}>
      {icon ? <Feather name={icon} size={20} color={iconColor ?? c.now} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="medium">{title}</Txt>
        {detail ? (
          <Txt size={13} color={c.ink2}>
            {detail}
          </Txt>
        ) : null}
      </View>
      {right}
      {onPress ? <Feather name="chevron-right" size={18} color={c.ink3} /> : null}
    </Pressable>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.rule }} />;
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {rows.map(([k, v]) => (
        <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <Txt color={c.ink2} size={14}>
            {k}
          </Txt>
          {typeof v === "string" ? (
            <Txt size={14} weight="bold" style={{ textAlign: "right", flexShrink: 1 }}>
              {v}
            </Txt>
          ) : (
            v
          )}
        </View>
      ))}
    </View>
  );
}

export const Money = ({ cents, size = 15, color, weight = "bold" }: { cents: number | null | undefined; size?: number; color?: string; weight?: "regular" | "bold" | "display" }) => (
  <Txt size={size} color={color} weight={weight}>
    {money(cents)}
  </Txt>
);

export function Note({ tone = "plain", children, icon }: { tone?: Tone; children: ReactNode; icon?: keyof typeof Feather.glyphMap }) {
  const { c } = useTheme();
  const [fg, bg] = toneColors(c, tone);
  return (
    <View accessibilityRole={tone === "stop" || tone === "now" ? "alert" : undefined} style={{ backgroundColor: bg, borderRadius: 10, padding: 12, flexDirection: "row", gap: 8 }}>
      {icon ? <Feather name={icon} size={16} color={fg} style={{ marginTop: 2 }} /> : null}
      <View style={{ flex: 1 }}>{typeof children === "string" ? <Txt color={tone === "plain" ? c.ink : fg} size={14}>{children}</Txt> : children}</View>
    </View>
  );
}

export function Field({ label, hint, ...p }: TextInputProps & { label: string; hint?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt weight="bold" size={14}>
        {label}
      </Txt>
      <TextInput
        aria-label={label}
        placeholderTextColor={c.ink3}
        {...p}
        style={[{ minHeight: p.multiline ? 84 : 48, borderWidth: 1, borderColor: c.rule2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: c.card, color: c.ink, fontFamily: fonts.sans, fontSize: 16, textAlignVertical: p.multiline ? "top" : "center" }, p.style]}
      />
      {hint ? (
        <Txt size={12} color={c.ink2}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/** Choice chips (radio group). */
export function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }} accessibilityRole="radiogroup" aria-label={label}>
      <Txt weight="bold" size={14}>
        {label}
      </Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} accessibilityRole="radio" aria-checked={on} onPress={() => onChange(o.value)} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: on ? c.ink : c.rule2, backgroundColor: on ? c.ink : c.card, justifyContent: "center" }}>
              <Txt color={on ? c.paper : c.ink} size={14} weight="medium">
                {o.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The three-part trust line used across Everyday: what the AI did, what code decided, what PayPal does. */
export function TrustStrip({ ai, code, paypal }: { ai: string; code: string; paypal: string }) {
  const { c } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: c.rule, borderRadius: 12, overflow: "hidden" }}>
      {(
        [
          ["AI", ai],
          ["Code", code],
          ["PayPal", paypal],
        ] as const
      ).map(([k, v], i) => (
        <View key={k} style={{ flexDirection: "row", gap: 10, padding: 10, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderColor: c.rule }}>
          <Txt size={12} weight="bold" color={c.ink2} style={{ width: 52 }}>
            {k}
          </Txt>
          <Txt size={13} style={{ flex: 1 }}>
            {v}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** Loading, error and empty states for a screen's data. */
export function Loaded<T>({ st, children }: { st: Load<T>; children: (d: T) => ReactNode }) {
  const { c } = useTheme();
  if (st.data) return <>{children(st.data)}</>;
  if (st.error)
    return (
      <Card title={st.error.code === "offline" ? "Can't reach Everyday" : "That didn't load"} tone="stop">
        <Txt color={c.ink2}>{st.error.message}</Txt>
        <Button label="Try again" kind="secondary" onPress={() => void st.reload()} icon="refresh-cw" />
      </Card>
    );
  return (
    <View style={{ gap: 12 }} aria-label="Loading" accessible>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ height: i ? 90 : 46, borderRadius: 14, backgroundColor: c.sunk }} />
      ))}
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ paddingVertical: 12, gap: 4 }}>
      <Txt weight="bold">{title}</Txt>
      {children ? <Txt color={c.ink2}>{children}</Txt> : null}
    </View>
  );
}
