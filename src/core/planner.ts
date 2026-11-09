/**
 * Goal planner. Pure. Finds the best complete bundle (not the top item per slot) within budget and deadline by
 * exhaustive search over a few eligible candidates per slot.
 */
export interface PSlot {
  key: string;
  label: string;
  required: boolean;
}

export interface PCand {
  id: string;
  slot: string;
  title: string;
  price_cents: number;
  utility: number; // preference score
  delay_days: number; // backorder delay before it can ship (0 when in stock)
}

export interface Shipping {
  standard_cents: number;
  free_over_cents: number;
  standard_days: number;
  express_cents: number;
  express_days: number;
}

export interface PlanResult {
  feasible: boolean;
  picks: Record<string, PCand | null>;
  items_cents: number;
  shipping_cents: number;
  shipping: "standard" | "express";
  total_cents: number;
  days: number;
  utility: number;
  gap: string | null;
  considered: number;
}

export const OPTIONAL_VALUE = 0.6;

export function shippingFor(items: number, s: Shipping, express: boolean) {
  if (express) return s.express_cents;
  return items >= s.free_over_cents ? 0 : s.standard_cents;
}

export function plan(input: { slots: PSlot[]; cands: Record<string, PCand[]>; budget_cents: number; days_available: number | null; shipping: Shipping; maxPerSlot?: number }): PlanResult {
  const per = input.maxPerSlot ?? 6;
  const slots = input.slots;
  const lists = slots.map((s) => {
    const c = [...(input.cands[s.key] ?? [])].sort((a, b) => b.utility - a.utility).slice(0, per);
    return s.required ? c : [null, ...c];
  });
  let best: PlanResult | null = null;
  let considered = 0;
  let cheapestRequired = Infinity;
  let fastestRequired = Infinity;
  const walk = (i: number, acc: (PCand | null)[]) => {
    if (i === slots.length) {
      considered++;
      const items = acc.reduce((a, c) => a + (c?.price_cents ?? 0), 0);
      const delay = Math.max(0, ...acc.map((c) => c?.delay_days ?? 0));
      const allReqItems = acc.every((c, k) => c || !slots[k].required);
      if (!allReqItems) return;
      const reqOnly = acc.reduce((a, c, k) => a + (slots[k].required ? c?.price_cents ?? 0 : 0), 0);
      cheapestRequired = Math.min(cheapestRequired, reqOnly + shippingFor(reqOnly, input.shipping, false));
      for (const express of [false, true]) {
        const days = delay + (express ? input.shipping.express_days : input.shipping.standard_days);
        fastestRequired = Math.min(fastestRequired, days);
        const ship = shippingFor(items, input.shipping, express);
        const total = items + ship;
        if (total > input.budget_cents) continue;
        if (input.days_available !== null && days > input.days_available) continue;
        const utility = acc.reduce((a, c, k) => a + (c ? c.utility + (slots[k].required ? 0 : OPTIONAL_VALUE) : 0), 0);
        const cand: PlanResult = { feasible: true, picks: Object.fromEntries(slots.map((s, k) => [s.key, acc[k]])), items_cents: items, shipping_cents: ship, shipping: express ? "express" : "standard", total_cents: total, days, utility, gap: null, considered: 0 };
        if (!best || utility > best.utility + 1e-9 || (Math.abs(utility - best.utility) < 1e-9 && (total < best.total_cents || (total === best.total_cents && days < best.days)))) best = cand;
        break; // standard is preferred when it fits
      }
    }
    if (i < slots.length) for (const c of lists[i]) walk(i + 1, [...acc, c]);
  };
  walk(0, []);
  if (best) return { ...(best as PlanResult), considered };
  const missing = slots.filter((s) => s.required && !(input.cands[s.key] ?? []).length).map((s) => s.label);
  const gap = missing.length
    ? `No eligible ${missing.join(", ")} found.`
    : cheapestRequired > input.budget_cents
      ? `The cheapest complete set of essentials costs $${(cheapestRequired / 100).toFixed(2)} with shipping; your budget is $${(input.budget_cents / 100).toFixed(2)} (short $${((cheapestRequired - input.budget_cents) / 100).toFixed(2)}).`
      : `Nothing in budget arrives in time: the fastest complete set needs ${fastestRequired} working day(s); you have ${input.days_available}.`;
  return { feasible: false, picks: {}, items_cents: 0, shipping_cents: 0, shipping: "standard", total_cents: 0, days: 0, utility: 0, gap, considered };
}
