import { Platform, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as WebBrowser from "expo-web-browser";
import { Button, Card, Money, Note, Txt } from "./ui";
import { serverBase } from "@/lib/api";
import { money, when } from "@/lib/format";
import { useAct } from "@/lib/useAct";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";

export interface ApprovalView {
  id: string;
  action: string;
  cents: number;
  entity: string | null;
  entity_id: string | null;
  to: string | null;
  title: string | null;
  status: string;
  created_at: string;
  level: "hold" | "caution";
  reasons: string[];
  passkey: boolean;
}

const UNDO: Record<string, string> = {
  "repeat buy": "Declining means nothing is charged. If you approve and change your mind, ask for a refund from the order; PayPal returns it to the same account.",
  checkout: "Declining cancels the checkout; nothing is charged. After paying, the return window on the order is your undo.",
};

/**
 * Confirms it's the phone's owner before approving: Face ID, Touch ID or the device passcode. This is a check on the
 * phone; the server still applies the shopper's written rules before anything reaches PayPal. When the phone has
 * no biometrics or passcode set up, the tap alone approves, as on the website.
 */
async function confirmOwner(amount: string): Promise<{ ok: boolean; message?: string }> {
  if (Platform.OS === "web") return { ok: true };
  const [hw, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  if (!hw || !enrolled) return { ok: true };
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: `Approve ${amount}`, cancelLabel: "Not now" });
  return r.success ? { ok: true } : { ok: false, message: "Not approved: the phone didn't confirm it's you. Nothing moved." };
}

/**
 * A money move that waited for the shopper. Says what moves, how much, to whom, why it waited and how to undo it,
 * before the buttons. Amounts over the countersign limit need the passkey registered on the website: the server
 * checks that signature, so the phone sends those to the website instead of approving here.
 */
export function ApprovalCard({ a, reload }: { a: ApprovalView; reload?: () => Promise<void> }) {
  const { c } = useTheme();
  const { run, busy } = useAct(reload);
  const toast = useToast();
  const hold = a.level === "hold";
  const amount = money(a.cents);
  return (
    <Card tone={hold ? "stop" : "now"} title={a.title ?? a.action} sub={`${hold ? "Held: this looks like a scam pattern" : "Waiting for you"} · ${when(a.created_at)}`}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "baseline" }}>
          <Money cents={a.cents} />
          <Txt color={c.ink2}>· {a.action}</Txt>
        </View>
        <Txt size={14}>To {a.to ?? "the merchant, through PayPal"}</Txt>
        <Txt size={14} color={c.ink2}>
          Why it waited:
        </Txt>
        {a.reasons.map((r) => (
          <Txt key={r} size={14}>
            • {r}
          </Txt>
        ))}
        <Txt size={13} color={c.ink2}>
          Undo: {UNDO[a.action] ?? "Declining means nothing moves. Approving runs the same checks again before PayPal is called."}
        </Txt>
      </View>
      {a.passkey ? (
        <>
          <Note tone="wait" icon="key">
            Over the countersign limit: approve it with your passkey on the website. The server checks that signature.
          </Note>
          <Button label="Open on the website" kind="secondary" icon="external-link" onPress={() => void WebBrowser.openBrowserAsync(`${serverBase()}/guard`)} />
        </>
      ) : (
        <Button
          label={`Approve ${amount}`}
          icon="check"
          busy={busy === "approve"}
          disabled={Boolean(busy)}
          accessibilityHint="Asks Face ID or your passcode first"
          onPress={async () => {
            const ok = await confirmOwner(amount);
            if (!ok.ok) return toast(ok.message!, "err");
            await run("approve", `/guard/approvals/${a.id}/approve`, { next: "/today" }, { stay: true });
          }}
        />
      )}
      <Button label="Decline" kind="secondary" busy={busy === "decline"} disabled={Boolean(busy)} onPress={() => void run("decline", `/guard/approvals/${a.id}/decline`, { next: "/today" }, { stay: true })} />
    </Card>
  );
}
