/**
 * B5: what a dollar amount is roughly worth in the shopper's own currency, for reading only. Everyday charges and
 * refunds in US dollars; this never sets, converts or rounds an amount anyone pays. Rates are the European Central
 * Bank's reference rates (via Frankfurter, no key), fetched at most every 12 hours. When they can't be fetched, there
 * is no estimate and the page shows none (never an old or made-up rate presented as current).
 */
const URL = "https://api.frankfurter.dev/v1/latest?from=USD&to=INR,IDR,BRL";
const FRESH_MS = 12 * 3600_000;
const STALE_MS = 4 * 86400_000; // ECB publishes on working days; older than four days is not shown.

export type Fx = { base: "USD"; date: string; rates: { INR: number; IDR: number; BRL: number }; source: string; fetched_at: string };
let cache: { at: number; fx: Fx } | null = null;
let fetcher: (url: string) => Promise<any> = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`rates ${r.status}`);
  return r.json();
};
/** Tests swap the network for a fixed answer. */
export const setFxFetcher = (f: typeof fetcher) => ((fetcher = f), (cache = null));

export async function fxRates(now = Date.now()): Promise<{ fx: Fx | null; why: string | null }> {
  if (cache && now - cache.at < FRESH_MS) return { fx: cache.fx, why: null };
  try {
    const j = await fetcher(URL);
    const r = j?.rates ?? {};
    const ok = ["INR", "IDR", "BRL"].every((c) => typeof r[c] === "number" && r[c] > 0) && /^\d{4}-\d{2}-\d{2}$/.test(String(j?.date));
    if (!ok) throw new Error("rates missing");
    if (now - Date.parse(`${j.date}T16:00:00Z`) > STALE_MS) throw new Error(`rates are from ${j.date}`);
    cache = { at: now, fx: { base: "USD", date: j.date, rates: { INR: r.INR, IDR: r.IDR, BRL: r.BRL }, source: "European Central Bank reference rates (frankfurter.dev)", fetched_at: new Date(now).toISOString() } };
    return { fx: cache.fx, why: null };
  } catch (e) {
    // A cached rate under four days old is still shown, with its own date; nothing older.
    if (cache && now - Date.parse(`${cache.fx.date}T16:00:00Z`) <= STALE_MS) return { fx: cache.fx, why: null };
    return { fx: null, why: `No exchange rate right now (${(e as Error).message}); no estimate is shown.` };
  }
}
