import { useEffect, useState } from "react";
import { Store, User } from "lucide-react";
import { getJson } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import type { Role } from "./steps";

/** Asks the journey host to switch sides (it plays the colour wipe and signs in as the other persona). */
export const switchRole = (role: Role) => window.dispatchEvent(new CustomEvent("ev:switch-role", { detail: { role } }));

/** Header control in a demo: who you are now, and one tap to be the other side. */
export function RoleSwitch() {
  const { session } = useSession();
  const who = session?.who;
  const [names, setNames] = useState<{ shopper: string; shop: string } | null>(null);
  useEffect(() => {
    if (!session?.workspace) return;
    getJson<{ shopper: { name: string } | null; shop: { name: string } | null }>("/api/ui/journey")
      .then((p) => setNames({ shopper: p.shopper?.name.split(" ")[0] ?? t("Shopper"), shop: (p.shop?.name ?? t("Shop")).replace(/\s*\(.*\)$/, "") }))
      .catch(() => setNames(null));
  }, [session?.workspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!who) return null;
  const me: Role = who.kind === "merchant" ? "shop" : "shopper";
  const opt = (role: Role, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={me === role}
      disabled={me === role || !names}
      onClick={() => switchRole(role)}
      title={me === role ? t("You are viewing as this person") : t("Switch to this side of the demo")}
      className={cn(
        "flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-colors [&_svg]:size-3.5",
        me === role ? "bg-[var(--role)] text-paper" : "text-ink-2 hover:bg-sunk hover:text-ink",
      )}
    >
      {icon}
      <span className="max-[520px]:sr-only">{label}</span>
    </button>
  );
  return (
    <div role="group" aria-label={t("Which side of the demo you're on")} className="flex items-center gap-0.5 rounded-full border border-rule bg-card p-0.5">
      {opt("shopper", names?.shopper ?? (who.kind === "shopper" ? who.first : t("Shopper")), <User />)}
      {opt("shop", names?.shop ?? (who.kind === "merchant" ? who.first : t("Shop")), <Store />)}
    </div>
  );
}
