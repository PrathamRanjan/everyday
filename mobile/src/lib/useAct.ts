import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { act, ApiError, appRoute, serverBase, type ActResult } from "./api";
import { payOnPayPal } from "./paypal";
import { useSession } from "./session";
import { useToast } from "./toast";
import * as WebBrowser from "expo-web-browser";

/**
 * A button's action: busy state, the server's message, then where to go. A PayPal link opens PayPal in the secure
 * in-app browser and comes back to the order; a page the app has no screen for opens on the website.
 */
export function useAct(reload?: () => Promise<void> | void) {
  const [busy, setBusy] = useState<string | null>(null);
  /** The last refusal's sentence, so a screen can offer what comes next (A5.5: a retry and the manual form). */
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useSession();
  const run = useCallback(
    async (key: string, path: string, data?: Parameters<typeof act>[1], opts: { stay?: boolean } = {}): Promise<ActResult | null> => {
      setBusy(key);
      setError(null);
      try {
        const out = await act(path, data);
        if (out.external) {
          const back = await payOnPayPal(out.to);
          if (back.err) toast(back.err, "err");
          else if (back.ok) toast(back.ok);
          if (back.orderId) router.push(`/orders/${back.orderId}`);
          await reload?.();
          await refresh();
          return out;
        }
        if (out.ok) toast(out.ok);
        const dest = appRoute(out.to);
        if (!opts.stay && dest && dest !== path) router.push(dest as never);
        else if (!dest && !opts.stay) await WebBrowser.openBrowserAsync(serverBase() + out.to);
        await reload?.();
        void refresh();
        return out;
      } catch (e) {
        setError((e as Error).message);
        toast((e as Error).message, "err");
        if (e instanceof ApiError && e.code === "signin") {
          await refresh();
          router.replace("/sign-in");
        }
        return null;
      } finally {
        setBusy(null);
      }
    },
    [reload, refresh, router, toast],
  );
  return { run, busy, error };
}
