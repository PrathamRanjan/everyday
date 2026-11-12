import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getJson } from "./api";

export type Who =
  | { kind: "shopper"; id: string; name: string; first: string; clock: string; today: string; needs: number; held: number }
  | { kind: "merchant"; id: string; name: string; first: string; needs: number };

export interface Session {
  who: Who | null;
  demo: boolean;
  paypal_env: string;
  /** A2.1: the demo's saved sandbox wallet (demo mode only). `usable` means pay-with-no-login is offered. */
  demo_wallet: { usable: boolean; state: string; email: string | null; checked_at: string | null; detail: string | null } | null;
  /** The PayPal sandbox test buyer a judge signs in as on PayPal's own page (set by the owner; demo only). */
  sandbox_buyer?: { email: string; password: string | null } | null;
  telegram_bot: string;
  /** A1: every visitor gets a private demo workspace (POST /demo/start). */
  private_demos: boolean;
  workspace: { id: string; kind: string; state: string; expires_at: string; progress_line: string | null; finished: boolean; join_url: string | null } | null;
  live: { telegram: boolean; push: boolean; channel3: boolean; ai: boolean; ai_label: string; paypal: boolean };
}

const Ctx = createContext<{ session: Session | null; refresh: () => Promise<void>; offline: boolean }>({ session: null, refresh: async () => {}, offline: false });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [offline, setOffline] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  const refresh = useCallback(async () => {
    try {
      setSession(await getJson<Session>("/api/ui/session"));
    } catch {
      /* keep the last session; the offline banner says why */
    }
  }, []);
  useEffect(() => {
    void refresh();
    const on = () => {
      setOffline(false);
      void refresh();
    };
    const off = () => setOffline(true);
    const changed = () => void refresh();
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("ev:changed", changed);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("ev:changed", changed);
    };
  }, [refresh]);
  // A1: while the seed's sandbox payments are still going, check back every few seconds so the progress line moves.
  const seeding = Boolean(session?.workspace && !session.workspace.finished);
  useEffect(() => {
    if (!seeding) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [seeding, refresh]);
  return <Ctx.Provider value={{ session, refresh, offline }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

/** "Today" on the demo clock when a shopper is signed in (the demo can move time), else the real date. */
export function useToday() {
  const { session } = useSession();
  return session?.who?.kind === "shopper" ? session.who.today : new Date().toISOString().slice(0, 10);
}
