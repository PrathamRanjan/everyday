import { Wallet } from "lucide-react";
import { Busy, PayPalButton } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import type { useAction } from "@/lib/api";
import { useSession } from "@/lib/session";
import { getLang, t, tn } from "@/i18n";

/** B7: PayPal's page follows the language; it has no Hindi page, so it opens in English (India). */
const PayPalLangNote = () => (getLang() === "hi" ? <p className="mt-1 text-xs text-ink-2" data-testid="paypal-lang-note">{t("PayPal has no Hindi checkout page, so PayPal's own page opens in English (India).")}</p> : null);

/**
 * The two ways to pay (A2.1). In a demo, "Pay as the demo shopper" charges the demo's saved sandbox PayPal wallet
 * with no login; "Pay on PayPal's own page" is the normal approval on PayPal's sandbox. When the saved wallet is not
 * available, only PayPal's page is offered, and the page says why.
 */
export function PayChoice({ cents, wallet, page, busy, run, className }: { cents: number; wallet: { path: string; data?: Record<string, string> }; page: { path: string; data?: Record<string, string> }; busy: string | null; run: ReturnType<typeof useAction>["run"]; className?: string }) {
  const { session } = useSession();
  const w = session?.demo ? session.demo_wallet : null;
  if (!w?.usable) {
    return (
      <div className={className}>
        <PayPalButton className="w-full" busy={busy === "pay"} disabled={Boolean(busy)} onClick={() => run("pay", page.path, page.data)}>
          {tn("Pay {0} with PayPal", money(cents))}
        </PayPalButton>
        <p className="mt-2 text-xs text-ink-2">
          {tn("You'll approve on PayPal's sandbox and come straight back. Nothing is charged until you approve there.{0}", session?.demo && w && t(" The demo's saved wallet isn't available right now{0}, so PayPal's own page is the way to pay.", w.detail ? ` (${w.detail.replace(/\s*It needs re-approval.*$/, "")})` : ""))}
        </p>
        <PayPalLangNote />
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="grid gap-2">
        <PayPalButton className="w-full" busy={busy === "pay-wallet"} disabled={Boolean(busy)} onClick={() => run("pay-wallet", wallet.path, wallet.data)}>
          {tn("Pay {0} as the demo shopper", money(cents))}
        </PayPalButton>
        <Button variant="outline" className="min-h-11 w-full" disabled={Boolean(busy)} onClick={() => run("pay", page.path, page.data)}>
          <Busy on={busy === "pay"}>{null}</Busy>
          {t("Pay on PayPal's own page instead")}
        </Button>
      </div>
      <p className="mt-2 flex gap-1.5 text-xs text-ink-2">
        <Wallet className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {tn("The first pays at once from the demo's saved sandbox PayPal{0}, with no login; the order says “Paid from the demo's saved sandbox wallet”. The second opens PayPal's sandbox to approve there. Both are sandbox money only.", w.email ? ` (${w.email})` : "")}
        </span>
      </p>
      <PayPalLangNote />
    </div>
  );
}
