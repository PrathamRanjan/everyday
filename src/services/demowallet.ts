/**
 * A2.1: the demo's saved sandbox wallet. One Vault v3 payment token (approved once by the owner as a sandbox buyer)
 * lets a demo visitor pay a real sandbox order with no PayPal login. It is used only in demo mode, every order paid
 * from it is labelled "Paid from the demo's saved sandbox wallet", and a daily job reads the token back from PayPal.
 *
 * Where the token comes from: a re-approval made on /admin/paypal/wallet (stored in settings) wins over the
 * PAYPAL_DEMO_VAULT_TOKEN setting. The operator can switch it off on /admin to show the PayPal-page path alone.
 */
import { config } from "../config.js";
import { getDb, type Queryable } from "../db.js";
import { paypal, PayPalError } from "../paypal/index.js";
import { J, putSetting, setting } from "../store.js";

export type WalletState = "ok" | "unchecked" | "gone" | "off" | "missing";
export interface DemoWallet {
  token: string | null;
  email: string | null;
  source: "admin" | "setting" | null;
  state: WalletState;
  checked_at: string | null;
  detail: string | null;
}

const KEY = "demo_wallet";

interface Stored {
  token?: string;
  email?: string;
  customer_id?: string;
  /** Result of the last read-back, per token (so a new token is checked afresh). */
  checked?: { token: string; ok: boolean; at: string; detail?: string | null };
  off?: boolean;
}

async function stored(q: Queryable): Promise<Stored> {
  const v = await setting(q, KEY).catch(() => null);
  return v ? (J<Stored>(v) ?? {}) : {};
}

/** The wallet as it stands: which token, where it came from, and what the last read-back from PayPal said. */
export async function demoWallet(q?: Queryable): Promise<DemoWallet> {
  const db = q ?? (await getDb());
  const s = await stored(db);
  const token = s.token || config.paypal.demoVaultToken || null;
  const source = s.token ? "admin" : config.paypal.demoVaultToken ? "setting" : null;
  const email = (s.token ? s.email : config.paypal.demoVaultEmail) || s.email || null;
  if (!token) return { token: null, email: null, source: null, state: "missing", checked_at: null, detail: "No saved wallet is set up." };
  const c = s.checked?.token === token ? s.checked : null;
  const state: WalletState = s.off ? "off" : !c ? "unchecked" : c.ok ? "ok" : "gone";
  return { token, email, source, state, checked_at: c?.at ?? null, detail: s.off ? "Switched off by the operator." : c && !c.ok ? (c.detail ?? "PayPal no longer has this saved wallet.") : null };
}

/** Pay-from-wallet is offered only in demo mode, only with a token, and not after PayPal said the token is gone. */
export function walletUsable(w: DemoWallet) {
  return config.demoMode && Boolean(w.token) && (w.state === "ok" || w.state === "unchecked");
}

/** Reads the payment token back from PayPal and records the result. Run daily, at start, and from /admin. */
export async function checkDemoWallet(q?: Queryable): Promise<DemoWallet> {
  const db = q ?? (await getDb());
  const w = await demoWallet(db);
  if (!w.token) return w;
  const s = await stored(db);
  const at = new Date().toISOString();
  try {
    const t = await paypal().getPaymentToken(w.token);
    s.checked = { token: w.token, ok: true, at, detail: null };
    if (t.email && !s.email) s.email = t.email;
  } catch (e) {
    const gone = e instanceof PayPalError && (e.status === 404 || e.status === 422 || e.status === 403);
    // A network blip is not "gone": leave the last result alone so a temporary failure doesn't hide the button.
    if (!gone) return w;
    s.checked = { token: w.token, ok: false, at, detail: `PayPal could not find the saved wallet (${(e as Error).message.slice(0, 120)}). It needs re-approval on /admin/paypal/wallet.` };
  }
  await putSetting(db, KEY, JSON.stringify(s));
  return demoWallet(db);
}

/** Marks the token unusable right away when a payment shows PayPal no longer accepts it. */
export async function markWalletGone(detail: string, q?: Queryable) {
  const db = q ?? (await getDb());
  const w = await demoWallet(db);
  if (!w.token) return;
  const s = await stored(db);
  s.checked = { token: w.token, ok: false, at: new Date().toISOString(), detail };
  await putSetting(db, KEY, JSON.stringify(s));
}

export async function setWalletOff(off: boolean, q?: Queryable) {
  const db = q ?? (await getDb());
  const s = await stored(db);
  s.off = off;
  await putSetting(db, KEY, JSON.stringify(s));
}

/** Stores a token the operator just approved on PayPal (from /admin/paypal/wallet/return). */
export async function saveWalletToken(token: string, customerId: string | null, q?: Queryable) {
  const db = q ?? (await getDb());
  const s = await stored(db);
  s.token = token;
  s.customer_id = customerId ?? undefined;
  s.email = undefined;
  s.checked = undefined;
  s.off = false;
  await putSetting(db, KEY, JSON.stringify(s));
  return checkDemoWallet(db);
}

/** What the pages may show: never the token itself. */
export function walletView(w: DemoWallet) {
  return { usable: walletUsable(w), state: w.state, email: w.email, checked_at: w.checked_at, detail: w.detail };
}
