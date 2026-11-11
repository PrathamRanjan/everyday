/**
 * Channel3 product search (roadmap E1). With CHANNEL3_API_KEY the shopper's query goes to Channel3 and the results
 * are cached; without a key the seeded catalog is the only source and every page that shows results says so.
 * Channel3 results are discovery only: they never get a PayPal checkout here (no merchant relationship), so they
 * cannot move money. Response text is data; it is never fed to a model as instructions.
 */
import { config } from "../config.js";
import { getDb, type Queryable } from "../db.js";
import { catalog } from "./catalog.js";

export interface ExternalProduct {
  title: string;
  brand: string | null;
  price_cents: number | null;
  currency: string;
  url: string | null;
  merchant: string | null;
  image: string | null;
  source: "channel3" | "catalog";
  /** B6: what the listing says, so code can check each must-have against it (Channel3 v1 fields). */
  description?: string | null;
  key_features?: string[];
  attributes?: Record<string, string[]>;
  category?: string | null;
  rating?: { value: number; count: number } | null;
}

let fetchImpl: typeof fetch | null = null;
export function setChannel3Fetch(f: typeof fetch | null) {
  fetchImpl = f;
}
export const channel3Ready = () => Boolean(config.channel3.apiKey);

const TTL_MS = 6 * 60 * 60_000;

export async function searchProducts(query: string, q?: Queryable): Promise<{ results: ExternalProduct[]; source: "channel3" | "catalog" | "cache"; note: string }> {
  const db = q ?? (await getDb());
  const key = query.trim().toLowerCase().slice(0, 200);
  if (!key) return { results: [], source: "catalog", note: "Empty query." };
  const cached = (await db.query<any>("SELECT results, source, fetched_at FROM channel3_cache WHERE query = $1", [key])).rows[0];
  const fresh = cached && Array.isArray(cached.results) && cached.results.every((r: ExternalProduct) => r.source !== "channel3" || "key_features" in r);
  if (cached && fresh && Date.now() - new Date(cached.fetched_at).getTime() < TTL_MS && cached.source === "channel3") return { results: cached.results, source: "cache", note: "Channel3 results from the cache (under six hours old)." };
  if (channel3Ready()) {
    try {
      const f = fetchImpl ?? fetch;
      const res = await f(`${config.channel3.baseUrl}/v1/search`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": config.channel3.apiKey }, body: JSON.stringify({ query: key, limit: 10 }), signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Channel3 ${res.status}`);
      const data = (await res.json()) as any;
      const items: any[] = Array.isArray(data) ? data : (data.products ?? data.results ?? []);
      const results: ExternalProduct[] = items.slice(0, 10).map((p) => {
        // v1 shape: brands[], images[] (prefer a cleaned hero shot), offers[] with price { price, currency }, url and domain.
        const offer = Array.isArray(p.offers) ? p.offers.find((o: any) => o?.availability === "InStock") ?? p.offers[0] : null;
        const imgs: any[] = Array.isArray(p.images) ? p.images : [];
        const img = imgs.find((i) => i?.shot_type === "hero" && i?.cleaned_url) ?? imgs.find((i) => i?.is_main_image) ?? imgs[0];
        const imgUrl = img?.cleaned_url ?? img?.url ?? p.image_url;
        const url = offer?.url ?? p.url ?? p.link;
        return {
          title: String(p.title ?? p.name ?? "Untitled").slice(0, 160),
          brand: p.brands?.[0]?.name ? String(p.brands[0].name).slice(0, 60) : p.brand ? String(p.brand).slice(0, 60) : null,
          price_cents: priceCents(offer?.price?.price ?? offer?.price ?? p.price ?? null),
          currency: String(offer?.price?.currency ?? p.currency ?? "USD").slice(0, 3),
          url: typeof url === "string" && /^https?:\/\//.test(url) ? url.slice(0, 500) : null,
          merchant: offer?.domain ? String(offer.domain).slice(0, 80) : p.merchant?.name ? String(p.merchant.name).slice(0, 80) : null,
          image: typeof imgUrl === "string" && /^https:\/\//.test(imgUrl) ? imgUrl.slice(0, 500) : null,
          source: "channel3" as const,
          description: typeof p.description === "string" ? p.description.slice(0, 1200) : null,
          key_features: Array.isArray(p.key_features) ? p.key_features.filter((x: unknown) => typeof x === "string").slice(0, 12).map((x: string) => x.slice(0, 160)) : [],
          attributes: p.structured_attributes && typeof p.structured_attributes === "object" ? Object.fromEntries(Object.entries(p.structured_attributes).slice(0, 20).map(([k, v]) => [String(k).slice(0, 60), (Array.isArray(v) ? v : [v]).map((x) => String(x).slice(0, 80)).slice(0, 8)])) : {},
          category: p.category?.title ? String(p.category.title).slice(0, 80) : null,
          rating: p.ratings?.value ? { value: Number(p.ratings.value), count: Number(p.ratings.count ?? 0) } : null,
        };
      });
      await db.query("INSERT INTO channel3_cache (query, results, source, fetched_at) VALUES ($1,$2,'channel3',now()) ON CONFLICT (query) DO UPDATE SET results = EXCLUDED.results, source = 'channel3', fetched_at = now()", [key, JSON.stringify(results)]);
      return { results, source: "channel3", note: "Live Channel3 results. Discovery only: buying happens with the merchant, not here." };
    } catch (e) {
      if (cached?.source === "channel3") return { results: cached.results, source: "cache", note: `Channel3 unreachable (${(e as Error).message.slice(0, 80)}); showing older cached results.` };
    }
  }
  const cat = await catalog(db);
  const hits = cat.index.fused(key, 10).map((r) => cat.byId.get(r.id)!).filter(Boolean);
  const results: ExternalProduct[] = hits.map((p) => ({ title: p.title, brand: p.brand, price_cents: p.price_cents, currency: "USD", url: p.url, merchant: p.merchant_name, image: null, source: "catalog" }));
  return { results, source: "catalog", note: channel3Ready() ? "Channel3 did not answer; seeded catalog results shown." : "No Channel3 key configured: these are the seeded catalog's results, not a live web search." };
}

function priceCents(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
