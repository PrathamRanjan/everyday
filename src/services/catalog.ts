import type { Queryable } from "../db.js";
import { hybrid, type Doc } from "../core/retrieve.js";
import { J } from "../store.js";
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

let cache: { key: string; products: Product[]; index: ReturnType<typeof hybrid> } | null = null;

export async function catalog(q: Queryable) {
  const rows = (await q.query<any>("SELECT p.*, m.name AS merchant_name, m.kind AS merchant_kind, m.label AS merchant_label, m.caps FROM products p JOIN merchants m ON m.id = p.merchant_id ORDER BY p.category, p.price_cents")).rows;
  const products: Product[] = rows.map((r) => ({ ...r, attrs: J(r.attrs), checkout: Boolean(J<any>(r.caps).checkout) }));
  const key = products.map((p) => `${p.id}:${p.title}`).join("|");
  if (!cache || cache.key !== key) {
    const docs: Doc[] = products.map((p) => ({ id: p.id, model: p.model, text: `${p.title} ${p.brand} ${p.model} ${p.category.replace("_", " ")} ${CATEGORY_LABEL[p.category] ?? ""} ${p.description} ${p.attrs.finish ?? ""} ${p.attrs.material ?? ""} ${(p.attrs.style ?? []).join(" ")} ${(p.attrs.video_out ?? []).join(" ")} ${(p.attrs.host ?? []).join(" ")}` }));
    cache = { key, products, index: hybrid(docs) };
  }
  return { products: cache.key === key ? products : cache.products, byId: new Map(products.map((p) => [p.id, p])), index: cache.index };
}
