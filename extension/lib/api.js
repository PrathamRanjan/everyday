// Talking to the Everyday server. Two ways to be signed in:
//  - the site's own sign-in in this browser (the session cookie; nothing to set up), or
//  - a device key made on Everyday → Messages → "Connect the extension" (stored only in this browser, never synced).
// The extension uses the same routes as the website, so every rule and gate on the server applies unchanged.

export const SERVERS = {
  live: "https://pph-everyday.onrender.com",
  local: "http://localhost:4111",
};

export async function settings() {
  const s = await chrome.storage.local.get({ base: SERVERS.live, key: "" });
  return { base: String(s.base || SERVERS.live).replace(/\/+$/, ""), key: String(s.key || "") };
}

export async function saveSettings(next) {
  await chrome.storage.local.set(next);
}

export class EverydayError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function request(path, init = {}) {
  const { base, key } = await settings();
  const headers = { accept: "application/json", "x-everyday-client": "extension", ...(init.headers || {}) };
  if (key) headers.authorization = `Bearer ${key}`;
  let res;
  try {
    // With a key, the cookie is not sent: the key alone says who this is.
    res = await fetch(base + path, { ...init, headers, credentials: key ? "omit" : "include" });
  } catch {
    throw new EverydayError(`Can't reach Everyday at ${new URL(base).host}. Check your connection or the server in Settings.`, "offline");
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401) throw new EverydayError(key ? "This device key doesn't work any more. Connect the extension again." : "Sign in to Everyday first.", "signin");
  if (!res.ok) throw new EverydayError(body?.message || `Everyday answered ${res.status}.`, "server");
  return body;
}

export const getJson = (path) => request(path);

/**
 * Post to a website route through the server's bridge: the answer is {to, ok, err, external} instead of a redirect.
 * `to` is where the website would go next (a plan, a capture), opened in a tab by the caller.
 */
export async function act(path, body) {
  const out = await request(path, { method: "POST", body, headers: { "x-everyday-ui": "1" } });
  if (out?.err) throw new EverydayError(out.err, "refused");
  // A route that needs a signed-in shopper answers "go to /login" rather than 401.
  if (typeof out?.to === "string" && out.to.startsWith("/login")) throw new EverydayError("Sign in to Everyday first.", "signin");
  return out;
}

export async function openOnSite(path) {
  const { base } = await settings();
  await chrome.tabs.create({ url: /^https?:\/\//.test(path) ? path : base + path });
}
