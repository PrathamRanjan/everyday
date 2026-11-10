/**
 * Talking to the Everyday server. The app signs in with a device key (`Authorization: Bearer evd_…`), never a
 * cookie, and tags every request `x-everyday-client: mobile` so plans and captures say they came from the phone and
 * PayPal sends the buyer back into the app. Actions post to the same routes the website uses, through the server's
 * bridge (`x-everyday-ui: 1`), so every rule and gate on the server applies unchanged.
 */

export const SERVERS = {
  live: "https://pph-everyday.onrender.com",
  local: "http://localhost:4111",
} as const;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: "offline" | "signin" | "server" | "refused" = "server",
  ) {
    super(message);
  }
}

let current = { base: SERVERS.live as string, key: "" };
export const configure = (base: string, key: string) => {
  current = { base: base.replace(/\/+$/, ""), key };
};
export const serverBase = () => current.base;

async function request(path: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}) {
  const { base, key } = current;
  const headers: Record<string, string> = { accept: "application/json", "x-everyday-client": "mobile", ...(init.headers ?? {}) };
  if (key) headers.authorization = `Bearer ${key}`;
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers, credentials: "omit" });
  } catch {
    throw new ApiError(`Can't reach Everyday at ${hostOf(base)}. Nothing was sent.`, 0, "offline");
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (res.status === 401) throw new ApiError("Sign in again: this phone's key isn't accepted any more.", 401, "signin");
  if (!res.ok) throw new ApiError(body?.message ?? (res.status >= 500 ? "Something went wrong on Everyday's side. Nothing was charged." : `Everyday answered ${res.status}.`), res.status);
  return body;
}

export const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

export const getJson = <T,>(path: string): Promise<T> => request(path);
export const postJson = <T,>(path: string, json: unknown): Promise<T> => request(path, { method: "POST", body: JSON.stringify(json), headers: { "content-type": "application/json" } });

export type ActResult = { to: string; ok: string | null; err: string | null; external: boolean };
type Val = string | number | boolean | null | undefined;

/** Runs a website action. The answer says where the website would go next, and the message to show. */
export async function act(path: string, data?: Record<string, Val> | FormData): Promise<ActResult> {
  let body: any;
  const headers: Record<string, string> = { "x-everyday-ui": "1" };
  if (data instanceof FormData) body = data;
  else if (data) {
    body = Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  const out = (await request(path, { method: "POST", body, headers })) as ActResult | null;
  if (!out || typeof out.to !== "string") throw new ApiError("Everyday didn't answer as expected. Nothing was charged.", 500);
  // A route that needs a signed-in shopper answers "go to /login" rather than 401.
  if (out.to.startsWith("/login") && !out.ok) throw new ApiError("Sign in again: this phone's key isn't accepted any more.", 401, "signin");
  if (out.err) throw new ApiError(out.err, 200, "refused");
  return out;
}

/** "/plans/int_1#quote" → the app's own screen for it, or null when the app has no such screen. */
export function appRoute(to: string): string | null {
  const path = to.split("#")[0].split("?")[0];
  if (/^\/(plans|orders|captures)\/[\w-]+$/.test(path)) return path;
  const tabs: Record<string, string> = { "/today": "/today", "/plans": "/plans", "/discover": "/find", "/purchases": "/bought", "/guard": "/approvals" };
  return tabs[path] ?? null;
}
