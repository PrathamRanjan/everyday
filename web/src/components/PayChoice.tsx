import { Wallet } from "lucide-react";
import { Busy, PayPalButton } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import type { useAction } from "@/lib/api";
import { useSession } from "@/lib/session";

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
          Pay {money(cents)} with PayPal
        </PayPalButton>
        <p className="mt-2 text-xs text-ink-2">
          You'll approve on PayPal's sandbox and come straight back. Nothing is charged until you approve there.
          {session?.demo && w && ` The demo's saved wallet isn't available right now${w.detail ? ` (${w.detail.replace(/\s*It needs re-approval.*$/, "")})` : ""}, so PayPal's own page is the way to pay.`}
        </p>
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="grid gap-2">
        <PayPalButton className="w-full" busy={busy === "pay-wallet"} disabled={Boolean(busy)} onClick={() => run("pay-wallet", wallet.path, wallet.data)}>
          Pay {money(cents)} as the demo shopper
        </PayPalButton>
        <Button variant="outline" className="min-h-11 w-full" disabled={Boolean(busy)} onClick={() => run("pay", page.path, page.data)}>
          <Busy on={busy === "pay"}>{null}</Busy>
          Pay on PayPal's own page instead
        </Button>
      </div>
      <p className="mt-2 flex gap-1.5 text-xs text-ink-2">
        <Wallet className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          The first pays at once from the demo's saved sandbox PayPal{w.email ? ` (${w.email})` : ""}, with no login; the order says “Paid from the demo's saved sandbox wallet”. The second opens PayPal's sandbox to approve there. Both are sandbox money only.
        </span>
      </p>
    </div>
  );
}
