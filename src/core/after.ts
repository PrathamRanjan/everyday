/** Returns eligibility (Rebuy-style), warranty, repair-or-replace and recall matching. Pure. */
export interface ReturnPolicy {
  window_days: number;
  restock_pct: number; // change of mind
  final_sale_when_opened: string[]; // categories
  version: string;
}

export function returnEligibility(p: ReturnPolicy, line: { category: string; price_cents: number; delivered_at: Date | null; opened: boolean }, issue: "damaged" | "wrong" | "late" | "change_of_mind" | "defective", now: Date) {
  const reasons: string[] = [];
  if (!line.delivered_at) return { eligible: false, until: null as Date | null, fee_cents: 0, reasons: ["Not delivered yet: cancel or wait instead."] };
  const until = new Date(line.delivered_at.getTime() + p.window_days * 864e5);
  const fault = issue !== "change_of_mind";
  if (now > until && !(issue === "defective")) reasons.push(`The ${p.window_days}-day return window ended ${until.toISOString().slice(0, 10)}.`);
  if (!fault && line.opened && p.final_sale_when_opened.includes(line.category)) reasons.push(`Opened ${line.category} are final sale.`);
  const fee = fault ? 0 : Math.round((line.price_cents * p.restock_pct) / 100);
  if (fee) reasons.push(`${p.restock_pct}% restocking fee for change of mind.`);
  if (fault) reasons.push(`No fee: the item arrived ${issue}.`);
  const blocked = reasons.some((r) => r.startsWith("The ") || r.startsWith("Opened"));
  return { eligible: !blocked, until, fee_cents: fee, reasons, policy_version: p.version };
}

export const addMonths = (d: Date, m: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate()));

const LIFE_MONTHS: Record<string, number> = { lamp: 72, chair: 84, dock: 48, mouse: 36, keyboard: 60, monitor: 72, monitor_arm: 96, desk_mat: 36, webcam: 48, headphones: 48 };

export function repairOrReplace(o: { category: string; price_cents: number; acquired: Date; warranty_until: Date | null; repair_quote_cents: number | null; now: Date }) {
  const age = (o.now.getTime() - o.acquired.getTime()) / (30.44 * 864e5);
  const life = LIFE_MONTHS[o.category] ?? 60;
  const remaining = Math.max(0, o.price_cents * (1 - age / life));
  const reasons = [`About ${Math.round(age)} months old of a typical ${life}-month life; remaining value about $${(remaining / 100).toFixed(2)}.`];
  if (o.warranty_until && o.now <= o.warranty_until) return { decision: "warranty", reasons: [...reasons, `Under warranty until ${o.warranty_until.toISOString().slice(0, 10)}: claim a free repair or replacement first.`] };
  if (o.repair_quote_cents === null) return { decision: "get_quote", reasons: [...reasons, "Get a repair quote to compare."] };
  if (o.repair_quote_cents < 0.5 * remaining) return { decision: "repair", reasons: [...reasons, `Repair at $${(o.repair_quote_cents / 100).toFixed(2)} is under half the remaining value.`] };
  return { decision: "replace", reasons: [...reasons, `Repair at $${(o.repair_quote_cents / 100).toFixed(2)} costs more than half the remaining value.`] };
}

export function recallMatches<T extends { brand: string; model: string }>(owned: T[], recalls: { brand: string; model: string; title: string; remedy: string; url: string }[]) {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return owned.flatMap((o) => recalls.filter((r) => n(r.brand) === n(o.brand) && n(o.model).startsWith(n(r.model))).map((r) => ({ item: o, recall: r })));
}
