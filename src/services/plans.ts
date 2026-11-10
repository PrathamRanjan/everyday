import { getDb, type Queryable } from "../db.js";
import { scanText } from "../ai/scan.js";
import { check, type Ctx } from "../core/constraints.js";
import { plan as planBundle, shippingFor, type PCand, type PSlot } from "../core/planner.js";
import { changes, dot, explain, pickPairs, type Reason } from "../core/prefs.js";
import { addWorkDays, fmtWall, wall, wallIso, workHoursBetween } from "../core/time.js";
import { newId } from "../lib/ids.js";
import { money as dollars } from "../lib/money.js";
import { GtError } from "../lib/util.js";
import { accountById, J, logEvent, notify, nowOf, selfRecipient, type Account } from "../store.js";
import { catalog, CATEGORY_LABEL, type Product } from "./catalog.js";
import { featuresOf, medianPrice, modelFor, recordChoice } from "./ml.js";
import { dateForDay, readRequest, type Reading } from "../ai/request.js";

// ---------- Parsing a goal ----------

const CAT_WORDS: [RegExp, string][] = [
  [/\b(monitor|screen|display)s?\b/, "monitor"],
  [/\b(chair|seat|stool)s?\b/, "chair"],
  [/\b(lamp|light)s?\b/, "lamp"],
  [/\b(dock|hub|adapter)s?\b/, "dock"],
  [/\bkeyboards?\b/, "keyboard"],
  [/\b(mouse|mice)\b/, "mouse"],
  [/\bmonitor arms?\b|\bmount\b/, "monitor_arm"],
  [/\bdesk mats?\b/, "desk_mat"],
  [/\bwebcams?\b/, "webcam"],
  [/\bheadphones?\b/, "headphones"],
];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface Reqs {
  goal: "desk_setup" | "single";
  categories: string[]; // single: what to buy
  require_ergonomic: boolean;
  laptop_port: Ctx["laptop_port"];
  replace: string[];
  style_words: string[];
  focus: { key: string; label: string; query: string; category: string | null; match_sku: string | null } | null;
  owned_mentioned: string[];
  addons: string[]; // optional slots the person asked for
  /** Qualities the person asked for in words ("quiet", "oak"): ranked as stated requirements, not taste. */
  must_have?: string[];
  /** Who read the request: the model (with the quotes it was grounded on) or the rules parser. */
  read?: { reader: "model" | "rules"; model: string | null; readings: Reading[]; dropped: number };
}

export function parseGoal(text: string, now: Date) {
  const t = text.toLowerCase();
  const budget = t.match(/(?:\$\s?|budget(?: of)?\s?\$?|under\s\$?|for\s\$)(\d[\d,]*)(?:\.\d{2})?\b/);
  const budget_cents = budget ? Number(budget[1].replace(/,/g, "")) * 100 : null;
  let deadline: string | null = null;
  const d = t.match(new RegExp(`\\b(?:by|before|on|for)?\\s*(this |next )?(${DAYS.join("|")})\\b`));
  if (d) {
    let delta = (DAYS.indexOf(d[2]) - now.getUTCDay() + 7) % 7 || 7;
    if (d[1]?.trim() === "next" && delta < 7) delta += 7;
    deadline = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta)).toISOString().slice(0, 10);
  } else if (/\btomorrow\b/.test(t)) deadline = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);
  const owned: string[] = [];
  for (const m of t.matchAll(/\b(?:already (?:own|have)|i (?:own|have|got)|we have|keep(?:ing)? my(?: existing)?)\s+(?:an?\s+|my\s+|the\s+)?([a-z ]{3,30}?)(?:[.,;!]|$| and | but )/g)) {
    const hit = CAT_WORDS.find(([re]) => re.test(m[1]));
    if (hit) owned.push(hit[1]);
  }
  const replace = [...t.matchAll(/\breplace (?:my |the )?([a-z ]{3,20})/g)].map((m) => CAT_WORDS.find(([re]) => re.test(m[1]))?.[1]).filter((x): x is string => Boolean(x));
  const setup = /\b(setup|set-up|set up|desk|workspace|study space|work from home|this look)\b/.test(t);
  // "monitor arm" is not a monitor, and "my monitor" refers to something already owned, not something to buy.
  const t2 = t.replace(/\bmonitor arms?\b/g, "monitor_arm").replace(/\b(?:for |with |on |to )?my ([a-z]+)\b/g, (_m, w) => `owned_${w}`);
  const cats = CAT_WORDS.filter(([re]) => re.test(t2)).map(([, c]) => c).filter((c) => !owned.includes(c));
  if (/monitor_arm/.test(t2) && !cats.includes("monitor_arm")) cats.push("monitor_arm");
  const mentioned = cats;
  const style_words = ["wood", "oak", "black", "white", "minimal", "warm", "cosy", "cozy", "quiet", "playful", "premium", "compact"].filter((w) => t.includes(w));
  // Items the person names are what gets planned; the full desk template is only for an open "set up my desk" ask.
  const named = cats.length > 0 && !(setup && cats.length >= 3);
  return { mentioned, goal: (setup && !named ? "desk_setup" : "single") as Reqs["goal"], budget_cents, deadline, owned, replace, categories: named ? cats : setup ? [] : cats, require_ergonomic: /\b(comfortable|comfort|ergonomic|back pain|posture|long hours)\b/.test(t), style_words, recipient: t.match(/\bfor my (sister|brother|mum|mom|dad|friend|partner|son|daughter)\b/)?.[1] ?? null };
}

// ---------- Context ----------

export async function ownedOf(q: Queryable, accountId: string, recipientId: string) {
  return (await q.query<any>("SELECT * FROM owned_items WHERE account_id = $1 AND (recipient_id = $2 OR recipient_id IS NULL) AND status = 'owned' ORDER BY acquired DESC", [accountId, recipientId])).rows.map((o) => ({ ...o, attrs: J<any>(o.attrs) }));
}

async function ctxFor(q: Queryable, intent: any): Promise<Ctx> {
  const reqs = J<Reqs>(intent.reqs);
  const owned = await ownedOf(q, intent.account_id, intent.recipient_id);
  const mon = owned.find((o) => o.category === "monitor");
  return {
    laptop_port: reqs.laptop_port,
    monitor: mon ? { title: mon.title, inputs: mon.attrs.inputs ?? [], vesa: mon.attrs.vesa_mount ?? null } : null,
    require_ergonomic: reqs.require_ergonomic,
    owned_categories: new Map(owned.map((o) => [o.category, o.title])),
    replace_categories: new Set(reqs.replace),
  };
}

function slotsFor(reqs: Reqs, ctx: Ctx): (PSlot & { category: string; outcome?: string })[] {
  if (reqs.goal === "single") return reqs.categories.map((c) => ({ key: c, category: c, label: CATEGORY_LABEL[c] ?? c, required: true }));
  const s: (PSlot & { category: string; outcome?: string })[] = [
    { key: "lamp", category: "lamp", label: "Desk lamp", required: true },
    { key: "chair", category: "chair", label: "Chair", required: true },
  ];
  if (ctx.owned_categories.has("monitor") && !ctx.replace_categories.has("monitor")) {
    if (ctx.laptop_port === "hdmi") s.push({ key: "dock", category: "dock", label: "Dock", required: false, outcome: "Use your laptop's HDMI port: no dock needed." });
    else s.push({ key: "dock", category: "dock", label: "Dock (laptop to monitor)", required: true });
  } else s.push({ key: "monitor", category: "monitor", label: "Monitor", required: true });
  s.push({ key: "mouse", category: "mouse", label: "Mouse", required: false }, { key: "keyboard", category: "keyboard", label: "Keyboard", required: false });
  if (ctx.monitor?.vesa) s.push({ key: "monitor_arm", category: "monitor_arm", label: "Monitor arm", required: false });
  return s;
}

/**
 * Questions that would change an eligibility decision; nothing else is asked. Each answer is tried against the
 * catalog first: a question whose answers all leave the same products eligible is not asked at all.
 */
function questionsFor(slots: { category: string; outcome?: string }[], ctx: Ctx, products: { category: string; attrs: any; stock: number; checkout: boolean }[]) {
  const qs: { key: string; text: string; why: string; choices: { value: string; label: string }[] }[] = [];
  if (slots.some((s) => s.category === "dock" && !s.outcome) && !ctx.laptop_port) {
    const choices = [{ value: "usb-c-dp", label: "USB-C (with the display/DP symbol)" }, { value: "thunderbolt", label: "Thunderbolt (lightning-bolt symbol)" }, { value: "hdmi", label: "It has an HDMI port" }, { value: "usb-a", label: "Only USB-A (rectangular)" }];
    const docks = products.filter((p) => p.category === "dock");
    const counts = choices.map((c) => (c.value === "hdmi" ? null : docks.filter((p) => check({ category: p.category, attrs: p.attrs, stock: p.stock, checkout: p.checkout }, { ...ctx, laptop_port: c.value as Ctx["laptop_port"] }).ok).length));
    if (new Set(counts.map(String)).size > 1)
      qs.push({
        key: "laptop_port",
        text: ctx.monitor ? `How does your laptop connect to your ${ctx.monitor.title}? Look at its ports.` : "Which ports does your laptop have?",
        why: `Your answer changes what fits: ${choices.map((c, k) => `${c.label.split(" (")[0].replace("It has an ", "").replace("Only ", "")} → ${counts[k] === null ? "no dock needed" : `${counts[k]} dock${counts[k] === 1 ? "" : "s"} work`}`).join(" · ")}.`,
        choices,
      });
  }
  return qs;
}

// ---------- Intents ----------

export async function createIntent(account: Account, input: { text: string; capture_id?: string | null; recipient_id?: string | null; channel: "app" | "telegram" | "mobile" | "extension" }) {
  const db = await getDb();
  if (!input.text.trim() && !input.capture_id) throw new GtError("Tell Everyday what you want to do.", "invalid");
  // The model reads the words (outside the transaction: it is a network call); code reads every number.
  const read = await readRequest(input.text);
  return db.tx(async (q) => {
    const now = nowOf(account);
    const g = parseGoal(input.text, now);
    if (read.reader === "model") {
      g.owned = [...new Set([...g.owned, ...read.owns])];
      g.replace = [...new Set([...g.replace, ...read.replace])];
      g.mentioned = [...new Set([...g.mentioned, ...read.wants])].filter((c) => !g.owned.includes(c) || g.replace.includes(c));
      if (g.goal === "single" || read.whole_setup === false) {
        const named = [...new Set([...g.categories, ...read.wants])].filter((c) => !g.owned.includes(c) || g.replace.includes(c));
        if (read.whole_setup && named.length < 3) {
          g.goal = "desk_setup";
          g.categories = [];
        } else if (named.length) {
          g.goal = "single";
          g.categories = named;
        }
      }
      if (read.deadline_day) g.deadline = dateForDay(read.deadline_day, now);
      if (read.recipient) g.recipient = read.recipient;
      if (read.comfort) g.require_ergonomic = true;
    }
    const must = [...new Set([...g.style_words, ...read.must_have])].slice(0, 8);
    let recipientId = input.recipient_id ?? null;
    if (!recipientId && g.recipient) {
      const r = (await q.query<{ id: string }>("SELECT id FROM recipients WHERE account_id = $1 AND lower(relation) = $2", [account.id, g.recipient])).rows[0];
      recipientId = r?.id ?? null;
    }
    recipientId = recipientId ?? (await selfRecipient(q, account.id)).id;
    let focus: Reqs["focus"] = null;
    if (input.capture_id) {
      const c = (await q.query<any>("SELECT * FROM captures WHERE id = $1 AND account_id = $2", [input.capture_id, account.id])).rows[0];
      if (!c) throw new GtError("Capture not found", "not_found", 404);
      const obj = J<any[]>(c.objects).find((o) => o.key === c.selected);
      if (obj) focus = { key: obj.key, label: obj.label, query: obj.query, category: obj.category, match_sku: obj.match_sku };
    }
    // Possessions mentioned in passing become profile facts; an unknown model stays unknown.
    for (const cat of g.owned) {
      const has = (await q.query("SELECT 1 FROM owned_items WHERE account_id = $1 AND category = $2 AND status = 'owned'", [account.id, cat])).rows.length;
      if (!has) await q.query("INSERT INTO owned_items (id, account_id, recipient_id, title, category, acquired, source) VALUES ($1,$2,$3,$4,$5,$6,'mentioned in a request')", [newId("own"), account.id, recipientId, `${CATEGORY_LABEL[cat] ?? cat} (model not given)`, cat, wallIso(now).slice(0, 10)]);
    }
    const categories = g.goal === "single" ? (g.categories.length ? g.categories : focus?.category ? [focus.category] : []) : [];
    if (g.goal === "single" && !categories.length) throw new GtError("What kind of item is it? Try “a desk lamp under $60” or pick an object in a saved clip.", "invalid");
    const reqs: Reqs = { goal: g.goal, categories, require_ergonomic: g.require_ergonomic, laptop_port: null, replace: g.replace, style_words: g.style_words, focus, owned_mentioned: g.owned, addons: g.goal === "desk_setup" ? g.mentioned.filter((c) => ["mouse", "keyboard", "monitor_arm", "desk_mat", "webcam"].includes(c)) : [], must_have: must, read: { reader: read.reader, model: read.model, readings: read.readings, dropped: read.dropped } };
    const id = newId("int");
    const flags = scanText(input.text);
    await q.query("INSERT INTO intents (id, account_id, recipient_id, capture_id, goal, text, budget_cents, deadline, reqs, channel) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, account.id, recipientId, input.capture_id ?? null, g.goal, input.text.slice(0, 1000), g.budget_cents, g.deadline, JSON.stringify(reqs), input.channel]);
    await logEvent(q, account, "intent", id, "intent.created", `New goal${g.goal === "desk_setup" ? " (desk setup)" : ""}: "${input.text.slice(0, 120)}"${g.budget_cents ? `; budget $${g.budget_cents / 100}` : ""}${g.deadline ? `; by ${g.deadline}` : ""}${g.owned.length ? `; already owns ${g.owned.join(", ")}` : ""}${flags.length ? `; ${flags.length} instruction-like phrase(s) ignored` : ""}`, `${account.name} (${input.channel})`);
    await buildPlan(q, account, id, null);
    return id;
  });
}

export async function answer(account: Account, intentId: string, key: string, value: string) {
  const db = await getDb();
  await db.tx(async (q) => {
    const i = await intentRow(q, account, intentId);
    const reqs = J<Reqs>(i.reqs);
    if (key === "laptop_port") {
      if (!["usb-c-dp", "thunderbolt", "hdmi", "usb-a"].includes(value)) throw new GtError("Pick one of the options.", "invalid");
      reqs.laptop_port = value as Reqs["laptop_port"];
      await q.query("INSERT INTO profile_facts (id, account_id, recipient_id, key, value, source) VALUES ($1,$2,$3,'laptop_port',$4,'answered')", [newId("fct"), account.id, i.recipient_id, value]);
    } else if (key === "addon") {
      const addons = new Set(reqs.addons ?? []);
      if (addons.has(value)) addons.delete(value);
      else addons.add(value);
      reqs.addons = [...addons];
    }
    await q.query("UPDATE intents SET reqs = $2, version = version + 1 WHERE id = $1", [i.id, JSON.stringify(reqs)]);
    if (key === "budget") await q.query("UPDATE intents SET budget_cents = $2 WHERE id = $1", [i.id, Math.round(Number(value) * 100)]);
    if (key === "deadline") await q.query("UPDATE intents SET deadline = $2 WHERE id = $1", [i.id, value || null]);
    await logEvent(q, account, "intent", i.id, "intent.answer", `Answered ${key.replace("_", " ")}: ${value}`, account.name);
    await buildPlan(q, account, i.id, null);
  });
}

export async function intentRow(q: Queryable, account: Account, id: string) {
  const i = (await q.query<any>("SELECT * FROM intents WHERE id = $1 AND account_id = $2", [id, account.id])).rows[0];
  if (!i) throw new GtError("Plan not found", "not_found", 404);
  return i;
}

// ---------- Plans ----------

export interface SlotView {
  key: string;
  label: string;
  required: boolean;
  outcome: "buy" | "use_owned" | "skip" | "none" | "not_needed" | "suggested";
  note: string | null;
  pick: { id: string; title: string; price_cents: number; merchant: string; label: string; reasons: string[]; exact: boolean; delay_days: number } | null;
  alternatives: { id: string; title: string; price_cents: number; reasons: string[]; total_if_chosen_cents?: number | null; over_budget_cents: number }[];
  excluded: { id: string; title: string; price_cents: number; reasons: string[] }[];
  unknown: { id: string; title: string; unknown: string[] }[];
  discovery: { id: string; title: string; price_cents: number; label: string; url: string | null }[];
}

/** Builds plan vN for an intent: retrieve, constrain, rank with the recipient's model, search for the best bundle. */
export async function buildPlan(q: Queryable, account: Account, intentId: string, note: string | null) {
  const i = await intentRow(q, account, intentId);
  const reqs = J<Reqs>(i.reqs);
  const ctx = await ctxFor(q, i);
  const cat = await catalog(q);
  const model = await modelFor(q, i.recipient_id);
  const slots = slotsFor(reqs, ctx);
  const questions = questionsFor(slots, ctx, cat.products);
  const now = nowOf(account);
  const nl = (await q.query<any>("SELECT shipping FROM merchants WHERE kind = 'test_merchant' LIMIT 1")).rows[0];
  const shipping = J<any>(nl.shipping);
  const views: SlotView[] = [];
  const cands: Record<string, PCand[]> = {};
  const owned = await ownedOf(q, i.account_id, i.recipient_id);
  const rcp = (await q.query<any>("SELECT name, is_self FROM recipients WHERE id = $1", [i.recipient_id])).rows[0];
  const owns = rcp && !rcp.is_self ? `${rcp.name} owns` : "You own";
  for (const s of slots) {
    const inCat = cat.products.filter((p) => p.category === s.category);
    const median = medianPrice(inCat);
    const query = reqs.focus && reqs.focus.category === s.category ? `${reqs.focus.query} ${reqs.style_words.join(" ")}` : `${CATEGORY_LABEL[s.category]} ${reqs.style_words.join(" ")}`;
    const rank = new Map(cat.index.fused(query, 60).map((r, k) => [r.id, k]));
    const view: SlotView = { key: s.key, label: s.label, required: s.required, outcome: "none", note: s.outcome ?? null, pick: null, alternatives: [], excluded: [], unknown: [], discovery: [] };
    const ownedHere = owned.find((o) => o.category === s.category);
    if (s.outcome) {
      view.outcome = "not_needed";
      views.push(view);
      continue;
    }
    if (ownedHere && !ctx.replace_categories.has(s.category)) {
      // You already have one: it fills this slot rather than blocking the plan.
      view.outcome = "use_owned";
      view.note = `${owns} ${ownedHere.title}; it fills this slot.`;
      views.push(view);
      continue;
    }
    const avg = inCat.length ? inCat.map((p) => featuresOf(p, median)).reduce((a, x) => a.map((v, k) => v + x[k] / inCat.length), new Array(x0len()).fill(0)) : [];
    for (const p of inCat) {
      const c = check({ category: p.category, attrs: p.attrs, stock: p.stock, checkout: p.checkout }, ctx);
      const exact = Boolean(reqs.focus?.match_sku && reqs.focus.match_sku === p.sku);
      const x = featuresOf(p, median);
      const has = (w: string) => p.attrs.finish === w || p.attrs.material === w || (w === "oak" && (p.attrs.finish === "wood" || p.attrs.material === "wood")) || (p.attrs.style ?? []).includes(w) || new RegExp(`\\b${w.replace(/[^a-z -]/g, "")}\\b`, "i").test(`${p.title} ${p.description ?? ""}`);
      const stated = (reqs.must_have ?? reqs.style_words).filter(has);
      // Words the person typed are requirements they stated, so they outweigh learned taste (whose weights stay below ~1).
      const style = stated.length * 1.2;
      const utility = dot(model.weights, x) + (exact ? 0.8 : 0) + style + (rank.has(p.id) ? 0.3 / (1 + rank.get(p.id)!) : 0);
      if (!p.checkout) {
        if (c.reasons.length === 0) view.discovery.push({ id: p.id, title: p.title, price_cents: p.price_cents, label: p.merchant_label, url: p.url });
        continue;
      }
      if (c.reasons.length) view.excluded.push({ id: p.id, title: p.title, price_cents: p.price_cents, reasons: c.reasons });
      else if (c.unknown.length) view.unknown.push({ id: p.id, title: p.title, unknown: c.unknown });
      else {
        if (p.stock <= 0 && p.backorder_days <= 0) {
          view.excluded.push({ id: p.id, title: p.title, price_cents: p.price_cents, reasons: ["out of stock"] });
          continue;
        }
        cands[s.key] = [...(cands[s.key] ?? []), { id: p.id, slot: s.key, title: p.title, price_cents: p.price_cents, utility, delay_days: p.stock > 0 ? 0 : p.backorder_days }];
        (view as any)._why = { ...(view as any)._why, [p.id]: [...(exact ? ["exact match for the item in your clip"] : []), ...stated.map((w) => `${w}, as you asked`), ...explain(model.weights, x, avg)] };
        (view as any)._exact = { ...(view as any)._exact, [p.id]: exact };
      }
    }
    if (ownedHere && !ctx.replace_categories.has(s.category)) view.note = `${owns} ${ownedHere.title}.`;
    views.push(view);
  }
  const daysAvailable = i.deadline ? Math.max(0, Math.floor(workHoursBetween(now, wall(`${i.deadline}T17:00`)) / 8)) : null;
  const blockingQuestions = questions.length > 0;
  const addons = new Set(reqs.addons ?? []);
  const owning = new Set(views.filter((v) => v.outcome === "use_owned").map((v) => v.key));
  const inPlan = slots.filter((s) => !s.outcome && !owning.has(s.key) && (s.required || addons.has(s.key)));
  const result = planBundle({ slots: inPlan.map((s) => ({ key: s.key, label: s.label, required: (s.required || addons.has(s.key)) && !(blockingQuestions && s.category === "dock") })), cands, budget_cents: i.budget_cents ?? 10_000_000, days_available: daysAvailable, shipping });
  const headroom = (i.budget_cents ?? 10_000_000) - result.total_cents;
  for (const v of views) {
    const c = result.picks[v.key];
    const pool = (cands[v.key] ?? []).sort((a, b) => b.utility - a.utility);
    const why = (v as any)._why ?? {};
    if (c) {
      const p = cat.byId.get(c.id)!;
      v.outcome = "buy";
      v.pick = { id: p.id, title: p.title, price_cents: p.price_cents, merchant: p.merchant_name, label: p.merchant_label, reasons: why[p.id] ?? [], exact: Boolean((v as any)._exact?.[p.id]), delay_days: c.delay_days };
    } else if (v.outcome === "none" && !v.required && !addons.has(v.key) && result.feasible) {
      // Not asked for: suggest the best add-on that still fits the budget, outside the total.
      const fit = pool.find((x) => x.price_cents <= headroom + (result.shipping_cents && result.items_cents + x.price_cents >= shipping.free_over_cents ? result.shipping_cents : 0));
      v.outcome = "suggested";
      if (fit) {
        const p = cat.byId.get(fit.id)!;
        v.pick = { id: p.id, title: p.title, price_cents: p.price_cents, merchant: p.merchant_name, label: p.merchant_label, reasons: why[p.id] ?? [], exact: false, delay_days: fit.delay_days };
      }
    } else if (v.outcome === "none") v.outcome = v.required ? "none" : "skip";
    // What the total would be with each alternative swapped in, so "over budget" is said, not implied.
    const swapTotal = (price: number) => {
      if (!c || !result.feasible) return null;
      const items = result.items_cents - c.price_cents + price;
      return items + shippingFor(items, shipping, result.shipping === "express");
    };
    v.alternatives = pool.filter((x) => x.id !== c?.id).slice(0, 3).map((x) => {
      const t = swapTotal(x.price_cents);
      return { id: x.id, title: x.title, price_cents: x.price_cents, reasons: why[x.id] ?? [], total_if_chosen_cents: t, over_budget_cents: t !== null && i.budget_cents ? Math.max(0, t - i.budget_cents) : 0 };
    });
    // A quality the person asked for that the pick lacks, but an over-budget option has: say so plainly.
    const asked = reqs.must_have ?? reqs.style_words;
    if (c && asked.length) {
      const pickWhy: string[] = why[c.id] ?? [];
      const missing = asked.filter((w) => !pickWhy.includes(`${w}, as you asked`));
      const better = v.alternatives.find((x) => x.over_budget_cents > 0 && missing.some((w) => x.reasons.includes(`${w}, as you asked`)));
      if (missing.length && better) v.note = `Nothing ${missing.join(" and ")} fits the budget: ${better.title} comes to ${dollars(better.total_if_chosen_cents ?? 0)} with shipping, ${dollars(better.over_budget_cents)} over. Raise the budget to get it.`;
    }
    delete (v as any)._why;
    delete (v as any)._exact;
  }
  const arrival = result.feasible ? wallIso(addWorkDays(now, result.days)).slice(0, 10) : null;
  const prev = (await q.query<any>("SELECT * FROM plans WHERE intent_id = $1 AND status = 'current'", [i.id])).rows[0];
  const version = ((await q.query<{ v: number }>("SELECT COALESCE(MAX(version),0)::int AS v FROM plans WHERE intent_id = $1", [i.id])).rows[0].v ?? 0) + 1;
  const body = {
    slots: views,
    questions,
    feasible: result.feasible,
    gap: result.gap,
    items_cents: result.items_cents,
    shipping_cents: result.shipping_cents,
    shipping: result.shipping,
    total_cents: result.total_cents,
    budget_cents: i.budget_cents,
    deadline: i.deadline,
    arrival,
    considered: result.considered,
    model: { version: model.version, prior: model.prior_id },
    note,
    avoided: [...new Set([...(reqs.goal === "desk_setup" ? ["monitor"] : []), ...(reqs.owned_mentioned ?? []), ...(reqs.focus?.category ? [reqs.focus.category] : [])])].filter((c) => ctx.owned_categories.has(c) && !ctx.replace_categories.has(c)).map((c) => `${owns} ${ctx.owned_categories.get(c)}.`),
  };
  if (prev) await q.query("UPDATE plans SET status = 'superseded' WHERE id = $1", [prev.id]);
  await q.query("UPDATE quotes SET status = 'superseded' WHERE plan_id IN (SELECT id FROM plans WHERE intent_id = $1) AND status IN ('open','approved')", [i.id]);
  await q.query("INSERT INTO plans (id, intent_id, version, intent_version, body, status) VALUES ($1,$2,$3,$4,$5,'current')", [newId("pln"), i.id, version, i.version, JSON.stringify(body)]);
  await logEvent(q, account, "intent", i.id, "plan.built", result.feasible ? `Plan v${version}: ${views.filter((v) => v.outcome === "buy").map((v) => v.pick!.title).join(", ")} = $${(result.total_cents / 100).toFixed(2)}${arrival ? `, arrives ${arrival}` : ""} (searched ${result.considered} bundles)` : `Plan v${version}: ${result.gap ?? "needs an answer first"}`);
  return version;
}

const x0len = () => 21;

export async function currentPlan(q: Queryable, intentId: string) {
  const p = (await q.query<any>("SELECT * FROM plans WHERE intent_id = $1 AND status IN ('current','ordered') ORDER BY version DESC LIMIT 1", [intentId])).rows[0];
  return p ? { ...p, body: J<any>(p.body) } : null;
}

/** This-or-that pairs from the plan's eligible candidates, chosen where the model is least sure. */
export async function tastePairs(q: Queryable, account: Account, intentId: string, n = 5) {
  const i = await intentRow(q, account, intentId);
  const p = await currentPlan(q, intentId);
  if (!p) return [];
  const cat = await catalog(q);
  const model = await modelFor(q, i.recipient_id);
  const asked = new Set((await q.query<any>("SELECT a_product, b_product FROM pref_events WHERE intent_id = $1", [intentId])).rows.flatMap((r) => [r.a_product, r.b_product]));
  const items = (p.body.slots as SlotView[]).filter((s) => s.outcome !== "suggested").flatMap((s) => [s.pick, ...s.alternatives].filter(Boolean).map((x: any) => cat.byId.get(x.id)!)).filter((x) => x && !asked.has(x.id));
  const byCat = new Map<string, Product[]>();
  for (const it of cat.products) byCat.set(it.category, [...(byCat.get(it.category) ?? []), it]);
  return pickPairs(items.map((it) => ({ id: it.id, slot: it.category, x: featuresOf(it, medianPrice(byCat.get(it.category)!)), p: it })), model.weights, n).map(([a, b]) => [a.p, b.p] as [Product, Product]);
}

export async function choose(account: Account, intentId: string, aId: string, bId: string, chosen: "a" | "b" | null, reason: Reason) {
  const db = await getDb();
  return db.tx(async (q) => {
    const i = await intentRow(q, account, intentId);
    const cat = await catalog(q);
    const a = cat.byId.get(aId);
    const b = cat.byId.get(bId);
    if (!a || !b || a.category !== b.category) throw new GtError("Choose between two items of the same kind.", "invalid");
    const r = await recordChoice(q, account, i.recipient_id, i.id, a, b, chosen, reason, medianPrice(cat.products.filter((p) => p.category === a.category)));
    const before = (await currentPlan(q, i.id))?.body.slots.filter((s: SlotView) => s.pick && s.outcome === "buy").map((s: SlotView) => s.pick!.id) ?? [];
    const msg = r.excluded ? null : changes(r.before, r.after);
    await buildPlan(q, account, i.id, msg?.length ? `Updated from your choice: ${msg.join("; ")}.` : null);
    const after = (await currentPlan(q, i.id))!.body.slots.filter((s: SlotView) => s.pick && s.outcome === "buy").map((s: SlotView) => s.pick!.id);
    return { changed: before.join() !== after.join(), excluded: r.excluded };
  });
}

export async function deadlineRisk(q: Queryable, account: Account, intentId: string) {
  const i = await intentRow(q, account, intentId);
  if (!i.deadline) return null;
  const lines = (await q.query<any>("SELECT l.* FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.intent_id = $1 AND l.status IN ('ordered','backordered','shipped')", [intentId])).rows;
  const late = lines.filter((l) => l.eta && l.eta.slice(0, 10) > i.deadline);
  return late.length ? { late: late.map((l) => ({ id: l.id, title: l.title, eta: l.eta })), deadline: i.deadline } : null;
}

export { fmtWall };
export async function reloadAccount(id: string) {
  return accountById(await getDb(), id);
}
void notify;
