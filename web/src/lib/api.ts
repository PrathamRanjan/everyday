import { announce } from "@/lib/announce";
import { wireLang } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** GET one screen's data. A 401 means "sign in first". */
export async function getJson<T>(path: string, signal?: AbortSignal, again = false): Promise<T> {
  const r = await fetch(path, { headers: { accept: "application/json", "x-everyday-lang": wireLang() }, credentials: "same-origin", signal });
  // The first screen's data is preloaded with the page, worded in the cookie's language; if that isn't the language
  // chosen here (the server says which it used), ask again.
  const served = r.headers.get("x-everyday-lang");
  if (!again && served && served !== wireLang()) return getJson<T>(path, signal, true);
  const text = await r.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!r.ok) throw new ApiError(body?.message ?? (r.status >= 500 ? "Something went wrong on our side." : `Request failed (${r.status})`), r.status);
  return body as T;
}

/** POST JSON to an /api/ui route; never throws (the page says what went wrong). */
export async function postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; j: any }> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-everyday-ui": "1", "x-everyday-lang": wireLang() }, credentials: "same-origin", body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j };
}

export type LoadState<T> = { data: T | null; error: ApiError | null; loading: boolean; reload: () => Promise<void> };

/** Loads `path` (null = don't load). Keeps the last data while reloading so pages don't flash. */
export function useApi<T>(path: string | null): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const nav = useNavigate();
  const loc = useLocation();
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await getJson<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n !== seq.current) return;
      const err = e instanceof ApiError ? e : new ApiError(navigator.onLine ? "Couldn't reach Everyday." : "You're offline.", 0);
      if (err.status === 401) {
        nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
        return;
      }
      setError(err);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
  }, [load]);
  // B1.3: a language switch refetches in place, so the server's own sentences follow without a reload.
  useEffect(() => {
    const on = () => void load();
    window.addEventListener("ev:lang", on);
    return () => window.removeEventListener("ev:lang", on);
  }, [load]);
  return { data, error, loading, reload: load };
}

export type ActResult = { to: string; ok: string | null; err: string | null; external: boolean };

/**
 * Runs one of the server's actions (the same routes the old forms posted to). The server answers with where to go
 * next and the message; PayPal links leave the app, everything else stays in it.
 */
type Val = string | number | boolean | null | undefined;
export async function postAction(path: string, data?: Record<string, Val | Val[]> | FormData): Promise<ActResult> {
  let body: BodyInit | undefined;
  const headers: Record<string, string> = { "x-everyday-ui": "1", accept: "application/json", "x-everyday-lang": wireLang() };
  if (data instanceof FormData) body = data;
  else if (data) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined && x !== null) p.append(k, String(x));
    body = p.toString();
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  let r: Response;
  try {
    r = await fetch(path, { method: "POST", headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(navigator.onLine ? "Couldn't reach Everyday. Nothing was sent; try again." : "You're offline. Nothing was sent.", 0);
  }
  const text = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {
    j = null;
  }
  if (r.ok && j && "to" in j) return j as ActResult;
  if (j?.message) throw new ApiError(j.message, r.status);
  if (r.status === 404) throw new ApiError("That isn't there any more. Refresh and try again.", 404);
  if (r.status === 401) throw new ApiError("Sign in first.", 401);
  throw new ApiError(r.status >= 500 ? "Something went wrong on our side. Nothing was charged." : text.slice(0, 200) || `Failed (${r.status})`, r.status);
}

/** A button's action with busy state, the toast, navigation and a reload of the current screen. */
export function useAction(reload?: () => Promise<void> | void) {
  const nav = useNavigate();
  const loc = useLocation();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, path: string, data?: Parameters<typeof postAction>[1], opts: { stay?: boolean; success?: string } = {}) => {
      setBusy(key);
      try {
        const out = await postAction(path, data);
        if (out.external) {
          toast.message("Opening PayPal…", { description: "Approve there; you'll come straight back." });
          window.location.assign(out.to);
          return out;
        }
        if (out.err) toast.error(out.err);
        else if (out.ok || opts.success) toast.success(out.ok ?? opts.success!);
        announce(out.err ?? out.ok ?? opts.success);
        const [path2, hash] = out.to.split("#");
        const here = loc.pathname + loc.search;
        if (!opts.stay && path2 && path2 !== here && path2 !== loc.pathname) nav(out.to);
        else {
          await reload?.();
          if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        }
        window.dispatchEvent(new Event("ev:changed"));
        return out;
      } catch (e) {
        toast.error((e as Error).message);
        announce((e as Error).message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [nav, loc.pathname, loc.search, reload],
  );
  return { run, busy };
}

/** Reads ?ok= / ?err= left by a server redirect (PayPal return) once, shows it, and cleans the URL. */
export function useFlash() {
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const ok = q.get("ok");
    const err = q.get("err");
    if (!ok && !err) return;
    if (ok) toast.success(ok);
    if (err) toast.error(err);
    q.delete("ok");
    q.delete("err");
    const s = q.toString();
    nav({ pathname: loc.pathname, search: s ? `?${s}` : "", hash: loc.hash }, { replace: true });
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps
}
