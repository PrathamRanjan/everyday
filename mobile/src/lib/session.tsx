import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, configure, getJson, postJson, SERVERS } from "./api";
import { getItem, setItem } from "./storage";

export type Who = { kind: "shopper"; id: string; name: string; first: string; clock: string; today: string; needs: number; held: number };
export type SessionInfo = { demo: boolean; paypal_env: string; who: Who | null };

type Ctx = {
  ready: boolean;
  base: string;
  info: SessionInfo | null;
  who: Who | null;
  /** The last reason the app couldn't check the session (offline, or the key was refused). */
  problem: string | null;
  refresh: () => Promise<void>;
  setServer: (base: string) => Promise<void>;
  signInDemo: (accountId: string) => Promise<void>;
  signInKey: (key: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionCtx = createContext<Ctx | null>(null);
const K_BASE = "everyday.base";
const K_KEY = "everyday.key";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<string>(SERVERS.live);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const s = await getJson<SessionInfo>("/api/ui/session");
      setInfo(s);
      setProblem(null);
      return s;
    } catch (e) {
      setProblem((e as Error).message);
      if (e instanceof ApiError && e.code === "signin") setInfo((i) => (i ? { ...i, who: null } : i));
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const b = (await getItem(K_BASE)) || SERVERS.live;
      const k = (await getItem(K_KEY)) || "";
      setBase(b);
      configure(b, k);
      await check();
      setReady(true);
    })();
  }, [check]);

  const useKey = useCallback(
    async (key: string) => {
      configure(base, key);
      const s = await check();
      if (!s?.who) {
        configure(base, "");
        throw new ApiError("That key isn't accepted. Make a new one on Everyday → Messages → Connect the phone app.", 401, "signin");
      }
      await setItem(K_KEY, key);
    },
    [base, check],
  );

  const value = useMemo<Ctx>(
    () => ({
      ready,
      base,
      info,
      who: info?.who ?? null,
      problem,
      refresh: async () => void (await check()),
      setServer: async (b: string) => {
        const clean = b.trim().replace(/\/+$/, "");
        // Point the client at the new server before the screen re-renders and asks it anything.
        configure(clean, "");
        setInfo(null);
        setBase(clean);
        await setItem(K_BASE, clean);
        await setItem(K_KEY, null);
        await check();
      },
      signInDemo: async (accountId: string) => {
        configure(base, "");
        const made = await postJson<{ key: string }>("/api/ui/devices/demo", { account_id: accountId });
        await useKey(made.key);
      },
      signInKey: async (key: string) => {
        const k = key.trim();
        if (!/^evd_[\w-]{10,}$/.test(k)) throw new ApiError("A phone key starts with evd_. Copy it from Everyday → Messages.", 400, "refused");
        await useKey(k);
      },
      signOut: async () => {
        // The key stops working on the server too, not just on this phone.
        await postJson("/api/ui/devices/self/revoke", {}).catch(() => undefined);
        await setItem(K_KEY, null);
        configure(base, "");
        await check();
      },
    }),
    [ready, base, info, problem, check, useKey],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
