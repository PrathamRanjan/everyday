import { getDb, type Queryable } from "../db.js";
import { recallMatches, repairOrReplace } from "../core/after.js";
import { wall, wallIso } from "../core/time.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { J, logEvent, notify, nowIso, nowOf, type Account } from "../store.js";
import { catalog } from "./catalog.js";
import { currentPlan } from "./plans.js";
import { announceProtections, protectionsFor } from "./protect.js";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const days = (from: string, to: string) => Math.round((wall(to.slice(0, 10)).getTime() - wall(from.slice(0, 10)).getTime()) / 864e5);

export async function owned(q: Queryable, a: Account) {
  return (await q.query<any>("SELECT o.*, r.name AS recipient FROM owned_items o LEFT JOIN recipients r ON r.id = o.recipient_id WHERE o.account_id = $1 ORDER BY o.status, o.acquired DESC", [a.id])).rows.map((o) => ({ ...o, attrs: J<any>(o.attrs) }));
}

export async function addOwned(a: Account, input: { title: string; category: string; brand: string; model: string; inputs: string[]; vesa: number | null; price_cents: number | null; acquired: string }) {
  if (!input.title.trim() || !input.category) throw new GtError("Give the item a name and a kind.", "invalid");
  const db = await getDb();
  const id = newId("own");
  await db.query("INSERT INTO owned_items (id, account_id, recipient_id, title, brand, model, category, attrs, price_cents, acquired, source) VALUES ($1,$2,(SELECT id FROM recipients WHERE account_id = $2 AND is_self),$3,$4,$5,$6,$7,$8,$9,'added by hand')", [id, a.id, input.title.trim(), input.brand, input.model, input.category, JSON.stringify({ inputs: input.inputs.length ? input.inputs : undefined, vesa_mount: input.vesa ?? undefined }), input.price_cents, input.acquired || nowIso(a).slice(0, 10)]);
  await logEvent(db, a, "owned", id, "owned.added", `Added ${input.title} to possessions`, a.name);
  return id;
}

export async function setOwnedStatus(a: Account, id: string, status: "sold" | "given" | "owned" | "recycled") {
  const db = await getDb();
  const r = await db.query("UPDATE owned_items SET status = $3 WHERE id = $1 AND account_id = $2 RETURNING title", [id, a.id, status]);
  if (!r.rows.length) throw new GtError("Item not found", "not_found", 404);
  await logEvent(db, a, "owned", id, "owned.status", `${r.rows[0].title} marked ${status}`, a.name);
}

export async function repairAdvice(a: Account, id: string, quoteCents: number | null) {
  const db = await getDb();
  const o = (await db.query<any>("SELECT * FROM owned_items WHERE id = $1 AND account_id = $2", [id, a.id])).rows[0];
  if (!o) throw new GtError("Item not found", "not_found", 404);
  return repairOrReplace({ category: o.category, price_cents: o.price_cents ?? 0, acquired: wall(o.acquired), warranty_until: o.warranty_until ? wall(o.warranty_until) : null, repair_quote_cents: quoteCents, now: nowOf(a) });
}

export async function recallsFor(q: Queryable, a: Account) {
  const items = (await owned(q, a)).filter((o) => o.status === "owned");
  const recalls = (await q.query<any>("SELECT * FROM recalls")).rows;
  return recallMatches(items, recalls);
}

// ---------- Price watches ----------

export async function watchPrice(a: Account, productId: string, targetCents: number) {
  const db = await getDb();
  const cat = await catalog(db);
  const p = cat.byId.get(productId);
  if (!p) throw new GtError("Product not found", "not_found", 404);
  if (!(targetCents > 0 && targetCents < p.price_cents)) throw new GtError(`Set a target below the current ${money(p.price_cents)}.`, "invalid");
  await db.query("INSERT INTO price_watches (id, account_id, product_id, target_cents) VALUES ($1,$2,$3,$4) ON CONFLICT (account_id, product_id) DO UPDATE SET target_cents = EXCLUDED.target_cents, status = 'watching', fired_at = NULL", [newId("pw"), a.id, p.id, targetCents]);
  await logEvent(db, a, "product", p.id, "watch.set", `Watching ${p.title} for ${money(targetCents)} or less (now ${money(p.price_cents)})`, a.name);
}

/** A merchant price change is recorded first; a watch fires only on that recorded change. */
export async function setPrice(productId: string, cents: number, wallNow: string) {
  const db = await getDb();
  const p = (await db.query<any>("UPDATE products SET price_cents = $2 WHERE id = $1 RETURNING *", [productId, cents])).rows[0];
  if (!p) throw new GtError("Product not found", "not_found", 404);
  await db.query("INSERT INTO price_history (product_id, price_cents, wall) VALUES ($1,$2,$3)", [p.id, cents, wallNow]);
  const hits = (await db.query<any>("SELECT w.*, a.name FROM price_watches w JOIN accounts a ON a.id = w.account_id WHERE w.product_id = $1 AND w.status = 'watching' AND w.target_cents >= $2", [p.id, cents])).rows;
  for (const h of hits) {
    await db.query("UPDATE price_watches SET status = 'fired', fired_at = $2 WHERE id = $1", [h.id, wallNow]);
    await notify(db, h.account_id, "telegram", `🔔 ${p.title} is now ${money(cents)} (your target ${money(h.target_cents)}). Recorded by Northlight at ${wallNow.replace("T", " ")}.`);
  }
  const protections = await announceProtections(p.id);
  return hits.length + protections;
}

// ---------- Today and the calendar ----------

export interface TodayItem {
  kind: string;
  title: string;
  detail: string;
  href: string;
  when: string | null;
  urgency: number;
}

export async function today(q: Queryable, a: Account): Promise<TodayItem[]> {
  const now = nowIso(a);
  const out: TodayItem[] = [];
  const intents = (await q.query<any>("SELECT * FROM intents WHERE account_id = $1 AND status IN ('planning') ORDER BY created_at DESC", [a.id])).rows;
  for (const i of intents) {
    const p = await currentPlan(q, i.id);
    if (!p) continue;
    if (p.body.questions.length) out.push({ kind: "question", title: `One question about "${i.text.slice(0, 50)}"`, detail: p.body.questions[0].text, href: `/plans/${i.id}`, when: i.deadline, urgency: 3 });
    else if (p.body.feasible) out.push({ kind: "approve", title: `Plan ready: $${(p.body.total_cents / 100).toFixed(2)}`, detail: `${p.body.slots.filter((s: any) => s.outcome === "buy").length} items, arrives ${p.body.arrival ?? "—"}${i.deadline ? ` for your ${i.deadline} deadline` : ""}`, href: `/plans/${i.id}`, when: i.deadline, urgency: 3 });
    else out.push({ kind: "gap", title: "Plan doesn't fit yet", detail: p.body.gap ?? "", href: `/plans/${i.id}`, when: i.deadline, urgency: 2 });
  }
  const unpaid = (await q.query<any>("SELECT * FROM orders WHERE account_id = $1 AND status = 'created'", [a.id])).rows;
  for (const o of unpaid) {
    const held = (await q.query<any>("SELECT 1 FROM approvals WHERE owner_id = $1 AND status = 'pending' AND payload->>'entity_id' = $2", [a.id, o.id])).rows.length > 0;
    out.push({ kind: "payment", title: `${o.number}: not paid yet`, detail: `$${(o.total_cents / 100).toFixed(2)} due. ${held ? "Paused for a scam check: read why and approve or cancel it on the order." : o.paypal_order_id ? "PayPal checkout was started but not approved. Nothing has been charged." : "Pay with PayPal when you're ready."}`, href: `/orders/${o.id}`, when: null, urgency: 4 });
  }
  const lines = (await q.query<any>("SELECT l.*, o.number, o.id AS oid, i.deadline FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN intents i ON i.id = o.intent_id WHERE o.account_id = $1 AND l.status IN ('backordered','ordered','shipped')", [a.id])).rows;
  for (const l of lines) {
    if (l.status === "backordered") out.push({ kind: "risk", title: `${l.title} delayed to ${l.eta}`, detail: `${l.deadline && l.eta > l.deadline ? `Misses your ${l.deadline} deadline. ` : ""}${J<any>(l.swap_offer) ? `In stock instead: ${J<any>(l.swap_offer).title}.` : "No in-stock alternative yet."}`, href: `/orders/${l.oid}`, when: l.eta, urgency: 5 });
    else if (l.eta && days(now, l.eta) <= 1) out.push({ kind: "delivery", title: `${l.title} arrives ${l.eta}`, detail: `${l.number} · ${l.status}`, href: `/orders/${l.oid}`, when: l.eta, urgency: 1 });
  }
  const cases = (await q.query<any>("SELECT c.*, o.id AS oid FROM cases c JOIN orders o ON o.id = c.order_id WHERE o.account_id = $1 AND c.status IN ('needs_info','choose')", [a.id])).rows;
  for (const c of cases) out.push({ kind: "case", title: `${c.number}: ${c.status === "choose" ? "choose a remedy" : "add the missing evidence"}`, detail: c.claim.slice(0, 80), href: `/orders/${c.oid}#cases`, when: null, urgency: 4 });
  for (const o of (await owned(q, a)).filter((x) => x.status === "owned")) {
    if (o.return_until && days(now, o.return_until) >= 0 && days(now, o.return_until) <= 5) out.push({ kind: "return", title: `Return window for ${o.title} closes ${o.return_until}`, detail: `${days(now, o.return_until)} day(s) left`, href: `/you#owned`, when: o.return_until, urgency: 2 });
    if (o.warranty_until && days(now, o.warranty_until) >= 0 && days(now, o.warranty_until) <= 30) out.push({ kind: "warranty", title: `Warranty on ${o.title} ends ${o.warranty_until}`, detail: "Check it works as it should before then.", href: `/you#owned`, when: o.warranty_until, urgency: 1 });
  }
  for (const r of await recallsFor(q, a)) out.push({ kind: "recall", title: `Recall: ${r.item.title}`, detail: `${r.recall.title}. ${r.recall.remedy}.`, href: `/you#owned`, when: null, urgency: 5 });
  const watches = (await q.query<any>("SELECT w.*, p.title, p.price_cents FROM price_watches w JOIN products p ON p.id = w.product_id WHERE w.account_id = $1 AND w.status = 'fired'", [a.id])).rows;
  for (const w of watches) out.push({ kind: "price", title: `${w.title} dropped to $${(w.price_cents / 100).toFixed(2)}`, detail: `Your target was $${(w.target_cents / 100).toFixed(2)} (recorded ${w.fired_at?.replace("T", " ")}).`, href: `/discover`, when: null, urgency: 2 });
  for (const pr of (await protectionsFor(q, a)).filter((x) => x.eligible)) out.push({ kind: "price", title: `${pr.title} is cheaper now: ${money(pr.amount_cents)} back is available`, detail: `You paid ${money(pr.protected_unit_cents)}; Northlight now charges ${money(pr.now_cents)}. ${pr.policy_version} price protection applies.`, href: `/orders/${pr.order_id}`, when: null, urgency: 3 });
  return out.sort((x, y) => y.urgency - x.urgency);
}

/** One dated list of commitments: plan deadlines, deliveries, return windows, warranties. */
export async function calendar(q: Queryable, a: Account) {
  const rows: { date: string; what: string; href: string }[] = [];
  for (const i of (await q.query<any>("SELECT * FROM intents WHERE account_id = $1 AND deadline IS NOT NULL AND status <> 'stale'", [a.id])).rows) rows.push({ date: i.deadline, what: `Goal deadline: ${i.text.slice(0, 50)}`, href: `/plans/${i.id}` });
  for (const l of (await q.query<any>("SELECT l.*, o.id AS oid FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.account_id = $1 AND l.status IN ('ordered','backordered','shipped')", [a.id])).rows) if (l.eta) rows.push({ date: l.eta, what: `Expected: ${l.title}`, href: `/orders/${l.oid}` });
  for (const o of (await owned(q, a)).filter((x) => x.status === "owned")) {
    if (o.return_until) rows.push({ date: o.return_until, what: `Last day to return ${o.title}`, href: "/you#owned" });
    if (o.warranty_until) rows.push({ date: o.warranty_until, what: `Warranty ends: ${o.title}`, href: "/you#owned" });
  }
  const today = nowIso(a).slice(0, 10);
  return rows.filter((r) => r.date >= today).sort((x, y) => x.date.localeCompare(y.date)).slice(0, 20);
}

export { wallIso };
