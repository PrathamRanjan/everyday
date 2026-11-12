import { useEffect, useState } from "react";
import { getLang, t, useLang } from "@/i18n";
import { day, money } from "@/lib/format";

/**
 * B5: "≈ ₹7,450, an estimate" under a dollar total, in Hindi, Bahasa Indonesia and Português. Reading only: Everyday
 * charges and refunds in US dollars, and this never changes an amount. Shown only with a current ECB rate; otherwise
 * nothing is shown.
 */
type Fx = { date: string; rates: Record<"INR" | "IDR" | "BRL", number> } | null;
const CURRENCY = { hi: "INR", id: "IDR", pt: "BRL" } as const;
let once: Promise<Fx> | null = null;
const load = () =>
  (once ??= fetch("/api/ui/fx", { headers: { accept: "application/json" }, credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => j?.fx ?? null)
    .catch(() => null));

export function LocalEstimate({ cents, className }: { cents: number; className?: string }) {
  useLang();
  const [fx, setFx] = useState<Fx>(null);
  const l = getLang();
  useEffect(() => {
    if (l !== "en") void load().then(setFx);
  }, [l]);
  if (l === "en" || !fx || !cents) return null;
  const cur = CURRENCY[l];
  const local = Math.round(cents * fx.rates[cur]);
  return (
    <div className={className ?? "mt-1 text-xs text-ink-2"} data-testid="local-estimate">
      {t("≈ {0}, an estimate at the European Central Bank rate of {1}. You pay in US dollars.", money(local, cur), day(fx.date))}
    </div>
  );
}
