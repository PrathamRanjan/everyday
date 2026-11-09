import type { Queryable } from "../db.js";
import { report } from "../core/experiment.js";
import { changes, dot, featurize, label, mask, update, zeros, DIM, FEATURES, PRICE, type Reason, type Weights } from "../core/prefs.js";
import { newId } from "../lib/ids.js";
import { GtError } from "../lib/util.js";
import { J, logEvent, type Account } from "../store.js";
import type { Product } from "./catalog.js";

/** Trains (or loads) the promoted global prior: the report from 5 seeds on synthetic shoppers, with its manifest. */
export async function ensurePrior(q: Queryable): Promise<{ id: string; weights: Weights }> {
  const cur = (await q.query<any>("SELECT * FROM model_artifacts WHERE kind = 'pref_prior' AND promoted ORDER BY created_at DESC LIMIT 1")).rows[0];
  if (cur) return { id: cur.id, weights: J(cur.weights) };
  const r = report();
  const id = `prior-${new Date().toISOString().slice(0, 10)}-s1`;
  const manifest = { data: r.data, features: FEATURES, seeds: r.seeds, train_shoppers: r.train_shoppers, train_pairs: r.train_pairs, test_shoppers: r.test_shoppers, split: "70/30 by shopper", model: "pairwise logistic regression, L2 0.01, 300 epochs full batch", channel3_or_discovery_data: "none (excluded by policy)" };
  const { prior, ...rest } = r;
  await q.query("INSERT INTO model_artifacts (id, kind, weights, manifest, report, promoted) VALUES ($1,'pref_prior',$2,$3,$4,true)", [id, JSON.stringify(prior), JSON.stringify(manifest), JSON.stringify(rest)]);
  return { id, weights: prior };
}

export async function modelFor(q: Queryable, recipientId: string): Promise<{ weights: Weights; prior: Weights; version: number; prior_id: string }> {
  const prior = await ensurePrior(q);
  const m = (await q.query<any>("SELECT * FROM pref_models WHERE recipient_id = $1", [recipientId])).rows[0];
  if (!m) {
    await q.query("INSERT INTO pref_models (recipient_id, version, weights, prior_version) VALUES ($1,0,$2,$3) ON CONFLICT DO NOTHING", [recipientId, JSON.stringify(prior.weights), prior.id]);
    return { weights: [...prior.weights], prior: prior.weights, version: 0, prior_id: prior.id };
  }
  return { weights: J(m.weights), prior: prior.weights, version: m.version, prior_id: m.prior_version };
}

export const medianPrice = (ps: Product[]) => {
  const v = ps.map((p) => p.price_cents).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 1;
};

export const featuresOf = (p: Product, median: number) => featurize({ attrs: p.attrs, price_cents: p.price_cents }, median);

/**
 * Records an explicit choice and, only when eligible, updates the recipient's weights.
 * Ineligible: discovery-sourced products (data-use terms), reasons that say nothing about taste.
 */
export async function recordChoice(q: Queryable, a: Account, recipientId: string, intentId: string | null, pa: Product, pb: Product, chosen: "a" | "b" | null, reason: Reason, median: number) {
  const m = await modelFor(q, recipientId);
  const mk = mask(reason);
  let excluded: string | null = null;
  if (!pa.train_ok || !pb.train_ok) excluded = "a product came from a discovery source whose terms forbid model training";
  else if (!mk) excluded = reason === "already_own" ? "'already own' adds a possession, not a taste signal" : "'wrong recipient' is not a signal about this person";
  else if (!chosen) excluded = "no choice made";
  const before = m.weights;
  let after = before;
  const xa = featuresOf(pa, median);
  const xb = featuresOf(pb, median);
  if (!excluded) {
    after = chosen === "a" ? update(before, m.prior, xa, xb, 1, mk!) : update(before, m.prior, xa, xb, 0, mk!);
    await q.query("UPDATE pref_models SET weights = $2, version = version + 1, updated_at = now() WHERE recipient_id = $1", [recipientId, JSON.stringify(after)]);
  }
  // The features as they were when the choice was made: undo replays these, so later catalog edits change nothing.
  await q.query("INSERT INTO pref_events (recipient_id, intent_id, a_product, b_product, chosen, reason, eligible, excluded_reason, weights_before, weights_after, median, features_a, features_b) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [recipientId, intentId, pa.id, pb.id, chosen === "a" ? pa.id : chosen === "b" ? pb.id : null, reason, !excluded, excluded, JSON.stringify(before), JSON.stringify(after), median, JSON.stringify(xa), JSON.stringify(xb)]);
  await logEvent(q, a, "recipient", recipientId, "pref.choice", excluded ? `Choice recorded, not used for learning: ${excluded}` : `Chose ${chosen === "a" ? pa.title : pb.title} over ${chosen === "a" ? pb.title : pa.title}${changes(before, after).length ? ` (${changes(before, after).join("; ")})` : ""}`);
  return { before, after, excluded };
}

/** Plain-language view of what the model has learned relative to the population prior. */
export function whyPanel(w: Weights, prior: Weights) {
  return w
    .map((v, i) => ({ i, feature: FEATURES[i], label: label(i), delta: v - prior[i], weight: v }))
    .filter((x) => Math.abs(x.delta) > 0.1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .map((x) => ({ ...x, text: x.i === PRICE ? (x.delta < 0 ? "You lean toward lower prices" : "You'll pay more for quality") : `${x.delta > 0 ? "You like" : "You're less keen on"} ${x.label}` }));
}

export async function forgetFeature(q: Queryable, a: Account, recipientId: string, feature: string) {
  const m = await modelFor(q, recipientId);
  const i = FEATURES.indexOf(feature as any);
  if (i < 0) throw new GtError("Unknown preference", "invalid");
  const w = [...m.weights];
  w[i] = m.prior[i];
  await q.query("UPDATE pref_models SET weights = $2, version = version + 1 WHERE recipient_id = $1", [recipientId, JSON.stringify(w)]);
  await logEvent(q, a, "recipient", recipientId, "pref.forget", `Removed what Everyday learned about ${label(i)}`, a.name);
}

export async function deleteMemory(q: Queryable, a: Account, recipientId: string) {
  const prior = await ensurePrior(q);
  await q.query("UPDATE pref_models SET weights = $2, version = version + 1 WHERE recipient_id = $1", [recipientId, JSON.stringify(prior.weights)]);
  await q.query("UPDATE pref_events SET eligible = false, excluded_reason = 'deleted by the person' WHERE recipient_id = $1", [recipientId]);
  await logEvent(q, a, "recipient", recipientId, "pref.deleted", "Preference memory deleted; personal weights reset to the population prior and past choices excluded from any future training", a.name);
}

export { dot, zeros, DIM };

/**
 * Undo one choice: it is marked undone (kept as a receipt) and the model is rebuilt by replaying every remaining
 * learning event from the population prior, in order. The same inputs give the same weights, so undoing the latest
 * choice restores exactly the model as it was before it.
 */
export async function undoChoice(q: Queryable, a: Account, eventId: number, products: Map<string, Product>) {
  const ev = (await q.query<any>("SELECT e.* FROM pref_events e JOIN recipients r ON r.id = e.recipient_id WHERE e.id = $1 AND r.account_id = $2", [eventId, a.id])).rows[0];
  if (!ev) throw new GtError("Choice not found", "not_found", 404);
  if (ev.undone) return;
  await q.query("UPDATE pref_events SET undone = true WHERE id = $1", [eventId]);
  const m = await modelFor(q, ev.recipient_id);
  let w: Weights = [...m.prior];
  for (const e of (await q.query<any>("SELECT * FROM pref_events WHERE recipient_id = $1 AND eligible AND NOT undone ORDER BY id", [ev.recipient_id])).rows) {
    const mk = mask(e.reason as Reason);
    if (!mk || !e.chosen) continue;
    const xa = e.features_a ? J<number[]>(e.features_a) : products.get(e.a_product) ? featuresOf(products.get(e.a_product)!, e.median) : null;
    const xb = e.features_b ? J<number[]>(e.features_b) : products.get(e.b_product) ? featuresOf(products.get(e.b_product)!, e.median) : null;
    if (!xa || !xb) continue;
    w = update(w, m.prior, xa, xb, e.chosen === e.a_product ? 1 : 0, mk);
  }
  await q.query("UPDATE pref_models SET weights = $2, version = version + 1, updated_at = now() WHERE recipient_id = $1", [ev.recipient_id, JSON.stringify(w)]);
  const name = (id: string) => products.get(id)?.title ?? id;
  await logEvent(q, a, "recipient", ev.recipient_id, "pref.undo", `Undid the choice of ${name(ev.chosen ?? ev.a_product)} over ${name(ev.chosen === ev.a_product ? ev.b_product : ev.a_product)}; model rebuilt from the remaining choices`, a.name);
}

export async function choiceReceipts(q: Queryable, recipientId: string, products: Map<string, Product>) {
  const rows = (await q.query<any>("SELECT * FROM pref_events WHERE recipient_id = $1 ORDER BY id DESC LIMIT 10", [recipientId])).rows;
  return rows.map((e) => {
    const chosen = products.get(e.chosen ?? "")?.title ?? null;
    const other = products.get(e.chosen === e.a_product ? e.b_product : e.a_product)?.title ?? null;
    return { id: Number(e.id), chosen, other, reason: e.reason as string, used: e.eligible && !e.undone, undone: e.undone as boolean, why_not: e.excluded_reason as string | null, changed: e.eligible && e.weights_before && e.weights_after ? changes(J<Weights>(e.weights_before), J<Weights>(e.weights_after)) : [] };
  });
}
