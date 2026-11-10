import type { Queryable } from "../db.js";
import { hybrid, type Doc } from "../core/retrieve.js";
import { J } from "../store.js";
import { currentWs } from "../ws.js";
import type { Attrs } from "./catalog-data.js";

export interface Product {
  id: string;
  merchant_id: string;
  sku: string;
  title: string;
  brand: string;
  model: string;
  category: string;
  price_cents: number;
  stock: number;
  backorder_days: number;
  attrs: Attrs;
  description: string;
  warranty_months: number;
  url: string | null;
  train_ok: boolean;
  merchant_name: string;
  merchant_kind: "test_merchant" | "discovery";
  merchant_label: string;
  checkout: boolean;
}

export const CATEGORY_LABEL: Record<string, string> = { lamp: "Desk lamp", chair: "Chair", dock: "Dock", mouse: "Mouse", keyboard: "Keyboard", monitor: "Monitor", monitor_arm: "Monitor arm", desk_mat: "Desk mat", webcam: "Webcam", headphones: "Headphones" };

type Cached = { key: string; products: Product[]; index: ReturnType<typeof hybrid> };
/** One search index per demo workspace (each has its own catalog rows); the oldest is dropped past 64. */
const caches = new Map<string, Cached>();

/** The catalog of the current demo workspace: its own shops' products, with their live stock and prices. */
export async function catalog(q: Queryable, ws: string | null = currentWs()) {
  const rows = (await q.query<any>("SELECT p.*, m.name AS merchant_name, m.kind AS merchant_kind, m.label AS merchant_label, m.caps FROM products p JOIN merchants m ON m.id = p.merchant_id WHERE m.ws_id IS NOT DISTINCT FROM $1 ORDER BY p.category, p.price_cents", [ws])).rows;
  const products: Product[] = rows.map((r) => ({ ...r, attrs: J(r.attrs), checkout: Boolean(J<any>(r.caps).checkout) }));
  const key = products.map((p) => `${p.id}:${p.title}`).join("|");
  const slot = ws ?? "";
  let cache = caches.get(slot);
  if (!cache || cache.key !== key) {
    const docs: Doc[] = products.map((p) => ({ id: p.id, model: p.model, text: `${p.title} ${p.brand} ${p.model} ${p.category.replace("_", " ")} ${CATEGORY_LABEL[p.category] ?? ""} ${p.description} ${p.attrs.finish ?? ""} ${p.attrs.material ?? ""} ${(p.attrs.style ?? []).join(" ")} ${(p.attrs.video_out ?? []).join(" ")} ${(p.attrs.host ?? []).join(" ")}` }));
    cache = { key, products, index: hybrid(docs) };
    caches.delete(slot);
    caches.set(slot, cache);
    while (caches.size > 64) caches.delete(caches.keys().next().value!);
  }
  return { products, byId: new Map(products.map((p) => [p.id, p])), index: cache.index };
}
