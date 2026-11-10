import { View } from "react-native";
import { Button, Txt } from "@/components/ui";
import { money } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { useAct } from "@/lib/useAct";

type Run = ReturnType<typeof useAct>["run"];

/**
 * The two ways to pay (A2.1), as on the website. In a demo: pay at once from the demo's saved sandbox PayPal with no
 * login, or approve on PayPal's own page in the secure browser. Without a usable saved wallet, only PayPal's page.
 */
export function PayChoice({ cents, wallet, page, busy, run }: { cents: number; wallet: { path: string; data?: Record<string, string> }; page: { path: string; data?: Record<string, string> }; busy: string | null; run: Run }) {
  const { info } = useSession();
  const { c } = useTheme();
  const w = info?.demo ? info.demo_wallet : null;
  if (!w?.usable)
    return (
      <View style={{ gap: 8 }}>
        <Button kind="paypal" label={`Pay ${money(cents)} with PayPal`} busy={busy === "pay"} disabled={Boolean(busy)} onPress={() => void run("pay", page.path, page.data)} />
        <Txt size={12} color={c.ink2}>
          {`PayPal's sandbox opens in a secure browser. Approve there and you come straight back to the order. Nothing is charged until you approve.${info?.demo && w ? " The demo's saved wallet isn't available right now, so PayPal's own page is the way to pay." : ""}`}
        </Txt>
      </View>
    );
  return (
    <View style={{ gap: 8 }}>
      <Button kind="paypal" label={`Pay ${money(cents)} as the demo shopper`} busy={busy === "pay-wallet"} disabled={Boolean(busy)} onPress={() => void run("pay-wallet", wallet.path, wallet.data)} />
      <Button kind="secondary" label="Pay on PayPal's own page instead" busy={busy === "pay"} disabled={Boolean(busy)} onPress={() => void run("pay", page.path, page.data)} />
      <Txt size={12} color={c.ink2}>
        {`The first pays at once from the demo's saved sandbox PayPal${w.email ? ` (${w.email})` : ""}, with no login; the order says "Paid from the demo's saved sandbox wallet". The second opens PayPal's sandbox in a secure browser. Both are sandbox money only.`}
      </Txt>
    </View>
  );
}
