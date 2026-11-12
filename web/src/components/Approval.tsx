import { useState } from "react";
import { toast } from "sonner";
import { Fingerprint, ShieldAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Amount, Busy } from "./kit";
import { useAction } from "@/lib/api";
import { countersign, passkeySupported } from "@/lib/passkey";
import { when } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

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
  get refund() {
    return t("A refund can't be pulled back once PayPal sends it. Declining now leaves the money where it is.");
  },
  get "repeat buy"() {
    return t("Declining means nothing is charged. If you approve and change your mind, ask for a refund from the order; PayPal returns it to the same account.");
  },
  get checkout() {
    return t("Declining cancels the checkout; nothing is charged. After paying, the return window on the order is your undo.");
  },
};

/**
 * A money move that waited for a person. It says what moves, how much, to whom, why it waited and how to undo it,
 * before the two buttons. Large amounts need a passkey countersign (the server checks the signed payload hash).
 */
export function ApprovalCard({ a, merchant = false, reload, next, className }: { a: ApprovalView; merchant?: boolean; reload?: () => Promise<void>; next?: string; className?: string }) {
  const { run, busy } = useAction(reload);
  const [signing, setSigning] = useState(false);
  const base = merchant ? "/merchant/approvals" : "/guard/approvals";
  const hold = a.level === "hold";
  const undo = UNDO[a.action] ?? (merchant ? UNDO.refund : t("Declining means nothing moves. Approving runs the same checks again before PayPal is called."));
  const sign = async () => {
    setSigning(true);
    try {
      const r = await countersign(a.id, merchant);
      toast.success(t("Approved with your passkey. Signed payload {0}…", r.payload_hash.slice(0, 12)));
      await reload?.();
      window.dispatchEvent(new Event("ev:changed"));
    } catch (e) {
      toast.error(t("Passkey didn't complete: {0}. Nothing moved.", (e as Error).message));
    } finally {
      setSigning(false);
    }
  };
  return (
    <article data-tour="approval" aria-labelledby={`ap-${a.id}`} className={cn("rounded-lg border bg-card", hold ? "border-stop/50" : "border-now/40", className)}>
      <div className={cn("flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-semibold", hold ? "bg-stop-bg text-stop" : "bg-now-bg text-now")}>
        <ShieldAlert className="size-4" />
        {hold ? t("Held: this looks like a scam pattern") : t("Waiting for you")}
        <span className="ml-auto text-xs font-normal text-ink-2">{when(a.created_at)}</span>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <div className="min-w-0">
          <h3 id={`ap-${a.id}`} className="font-display text-xl">
            {a.title ?? a.action}
          </h3>
          <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-2">{t("What moves")}</dt>
            <dd>
              <Amount cents={a.cents} strong /> · {a.action}
            </dd>
            <dt className="text-ink-2">{t("To")}</dt>
            <dd className="min-w-0 break-words">{a.to ?? (merchant ? t("the customer's PayPal") : t("the merchant, through PayPal"))}</dd>
            <dt className="text-ink-2">{t("Why it waited")}</dt>
            <dd>
              <ul className="list-disc space-y-0.5 pl-4">
                {a.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </dd>
            <dt className="text-ink-2">{t("Undo")}</dt>
            <dd className="flex gap-1.5">
              <Undo2 className="mt-0.5 size-3.5 shrink-0 text-ink-2" />
              <span>{undo}</span>
            </dd>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {a.passkey && passkeySupported() ? (
            <Button onClick={sign} disabled={signing || Boolean(busy)}>
              <Busy on={signing}>
                <Fingerprint className="size-4" />
              </Busy>
              {t("Approve with passkey")}
            </Button>
          ) : (
            <Button onClick={() => run("approve", `${base}/${a.id}/approve`, { next: next ?? location.pathname })} disabled={Boolean(busy)}>
              <Busy on={busy === "approve"}>{null}</Busy>
              {t("Approve")}{" "}{a.cents ? <Amount cents={a.cents} /> : null}
            </Button>
          )}
          <Button variant="outline" onClick={() => run("decline", `${base}/${a.id}/decline`, { next: next ?? location.pathname })} disabled={Boolean(busy)}>
            <Busy on={busy === "decline"}>{null}</Busy>
            {t("Decline")}
          </Button>
          {a.passkey && <p className="max-w-56 text-xs text-ink-2">{t("Over your passkey limit, so a passkey on this device signs this exact amount and payee.")}</p>}
        </div>
      </div>
    </article>
  );
}
