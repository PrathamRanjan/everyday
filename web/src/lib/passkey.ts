/** WebAuthn client for registering a passkey and countersigning a large approval (server: src/guard/passkey.ts). */
const b64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const post = async (url: string, body?: unknown) => {
  const r = await fetch(url, { method: "POST", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.message || j.error || `Failed (${r.status})`);
  return j;
};
const base = (merchant: boolean) => (merchant ? "/merchant/approvals/passkey" : "/guard/passkey");
export const passkeySupported = () => typeof window !== "undefined" && "PublicKeyCredential" in window;

export async function registerPasskey(merchant = false) {
  const r = await post(`${base(merchant)}/register/start`);
  const cred = (await navigator.credentials.create({ publicKey: { challenge: fromB64u(r.challenge), rp: { name: r.rpName }, user: { id: fromB64u(r.userId), name: r.userName, displayName: r.userName }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], authenticatorSelection: { userVerification: "preferred" } } })) as PublicKeyCredential;
  const res = cred.response as AuthenticatorAttestationResponse;
  return post(`${base(merchant)}/register/finish`, { chalId: r.id, rawId: b64u(cred.rawId), clientDataJSON: b64u(res.clientDataJSON), authenticatorData: b64u(res.getAuthenticatorData()) });
}

export async function countersign(approvalId: string, merchant = false): Promise<{ payload_hash: string }> {
  const r = await post(`${base(merchant)}/sign/start`, { approvalId });
  const cred = (await navigator.credentials.get({ publicKey: { challenge: fromB64u(r.challenge), userVerification: "preferred" } })) as PublicKeyCredential;
  const res = cred.response as AuthenticatorAssertionResponse;
  return post(`${base(merchant)}/sign/finish`, { chalId: r.id, approvalId, rawId: b64u(cred.rawId), clientDataJSON: b64u(res.clientDataJSON), authenticatorData: b64u(res.authenticatorData), signature: b64u(res.signature) });
}

/** Register the service worker; subscribe to web push on request. */
export async function registerSW() {
  if ("serviceWorker" in navigator) await navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
export async function subscribePush(): Promise<string> {
  const { key } = await fetch("/push/public-key").then((r) => r.json());
  if (!key) return "Web push isn't configured on this server (no VAPID keys). The message log at /channels shows every message instead.";
  const reg = await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== "granted") return "Notifications weren't allowed, so nothing changed.";
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
  const r = await post("/push/subscribe", sub.toJSON());
  return r.subscribed ? "Notifications are on for this device." : "Subscribing failed.";
}
