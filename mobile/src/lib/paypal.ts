import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

export type PayPalOutcome = { orderId: string | null; ok: string | null; err: string | null; returned: boolean };

/**
 * Opens PayPal's approval page in the system's secure in-app browser (ASWebAuthenticationSession on iOS, a Custom
 * Tab on Android). PayPal sends the buyer to Everyday's `/paypal/return-app` route, which confirms and captures the
 * payment on the server, then redirects to `everyday://orders/<id>?ok=…`, which closes the browser and lands here.
 * If the browser is closed another way, the caller reloads the order: the server already knows whether it was paid.
 */
export async function payOnPayPal(url: string): Promise<PayPalOutcome> {
  if (Platform.OS === "web") {
    // The browser build (for testing): PayPal opens in a new tab; the order screen offers "Check again" afterwards.
    await WebBrowser.openBrowserAsync(url);
    return { orderId: null, ok: null, err: null, returned: false };
  }
  const r = await WebBrowser.openAuthSessionAsync(url, "everyday://");
  if (r.type !== "success") return { orderId: null, ok: null, err: null, returned: false };
  return { ...parseReturn(r.url), returned: true };
}

/** everyday://orders/ord_1?ok=Paid… → its parts. */
export function parseReturn(u: string): Omit<PayPalOutcome, "returned"> {
  const m = /^everyday:\/\/orders\/([\w-]+)(?:\?(.*))?$/.exec(u);
  if (!m) return { orderId: null, ok: null, err: null };
  const q = new URLSearchParams(m[2] ?? "");
  return { orderId: m[1], ok: q.get("ok"), err: q.get("err") };
}
