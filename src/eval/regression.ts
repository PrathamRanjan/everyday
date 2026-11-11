/**
 * A5.6 and B6: the off-script requests from the 10 Nov review, kept as permanent regression cases. Each goes through
 * the real reader (the model) and the real planner; code then checks the plan against what a careful person would
 * accept. The model never grades itself.
 */
import { getDb } from "../db.js";
import { catalog } from "../services/catalog.js";
import { createIntent, currentPlan, meetsWord } from "../services/plans.js";
import type { Account } from "../store.js";
import { clearSuite, recordEval } from "./store.js";

interface Seen {
  read: any;
  body: any;
  error: string | null;
  picks: { title: string; category: string; attrs: any; price_cents: number; description: string }[];
}
export interface RegCase {
  id: string;
  input: string;
  expected: string;
  check: (s: Seen) => { ok: boolean; why: string };
}

const quotable = (b: any) => Boolean(b?.feasible) && (b?.items_cents ?? 0) > 0;
const text = (b: any) => `${b?.gap ?? ""} ${(b?.slots ?? []).map((s: any) => s.note ?? "").join(" ")}`;

export const REGRESSION: RegCase[] = [
  {
    id: "earbuds",
    input: "sweat-proof wireless earbuds for running, under $80, need them by next Friday",
    expected: "No $0 plan. Either a pick shown to be sweat-proof and wireless within $80, or a plan that can't be quoted and names what's unmet.",
    check: (s) => {
      if (s.error) return { ok: false, why: s.error };
      if (quotable(s.body)) {
        const bad = s.picks.filter((p) => !meetsWord("sweat-proof", p) || !meetsWord("wireless", p));
        return bad.length ? { ok: false, why: `Quotable plan with ${bad.map((p) => p.title).join(", ")}, not shown to be sweat-proof and wireless` } : { ok: true, why: `Picks ${s.picks.map((p) => p.title).join(", ")}, each shown to be sweat-proof and wireless` };
      }
      return /sweat-proof/i.test(text(s.body)) ? { ok: true, why: "Not quotable, and says why (sweat-proof not shown)" } : { ok: false, why: `Not quotable but doesn't name the unmet quality: ${text(s.body).slice(0, 160)}` };
    },
  },
  {
    id: "monitor-arm",
    input: "a monitor arm for a 34-inch ultrawide, VESA 100, under $90",
    expected: "A monitor arm that fits VESA 100 within $90, or a plan that says which part is unmet.",
    check: (s) => {
      if (s.error) return { ok: false, why: s.error };
      if (!(s.read?.categories ?? []).includes("monitor_arm")) return { ok: false, why: `Read as ${(s.read?.categories ?? []).join(", ") || "nothing"}, not a monitor arm` };
      if (s.read?.budget_cents !== 9000) return { ok: false, why: `Budget read as ${s.read?.budget_cents}` };
      if (quotable(s.body)) {
        const arm = s.picks.find((p) => p.category === "monitor_arm");
        if (!arm) return { ok: false, why: "Quotable but no arm picked" };
        return (arm.attrs?.vesa ?? []).includes(100) ? { ok: true, why: `${arm.title}, VESA ${(arm.attrs.vesa ?? []).join("/")}` } : { ok: false, why: `${arm.title} doesn't list VESA 100` };
      }
      return text(s.body).trim() ? { ok: true, why: `Not quotable, with the reason: ${text(s.body).slice(0, 140)}` } : { ok: false, why: "Not quotable and no reason" };
    },
  },
  {
    id: "gift-brother",
    input: "a gift for my brother who already has a mechanical keyboard",
    expected: "Read as a gift for a brother; never proposes another keyboard.",
    check: (s) => {
      if (s.error) return /what kind of gift for your brother/i.test(s.error) ? { ok: true, why: `Read the brother and the keyboard he has, and asks what kind of gift: "${s.error.slice(0, 140)}"` } : { ok: false, why: s.error };
      if ((s.read?.categories ?? []).includes("keyboard")) return { ok: false, why: "Read the keyboard he already has as the thing wanted" };
      const kb = s.picks.find((p) => p.category === "keyboard");
      if (kb) return { ok: false, why: `Proposes a keyboard (${kb.title}) though he has one` };
      return { ok: true, why: quotable(s.body) ? `Picks ${s.picks.map((p) => p.title).join(", ")}` : `Not quotable: ${text(s.body).slice(0, 120) || "asks a question"}` };
    },
  },
  {
    id: "dock-hdmi",
    input: "the cheapest USB-C dock with two HDMI ports by Thursday",
    expected: "A USB-C dock; two HDMI ports either shown in its details or said to be unconfirmed; the date read.",
    check: (s) => {
      if (s.error) return { ok: false, why: s.error };
      if (!(s.read?.categories ?? []).includes("dock")) return { ok: false, why: `Read as ${(s.read?.categories ?? []).join(", ") || "nothing"}` };
      if (!s.read?.deadline) return { ok: false, why: "The date wasn't read" };
      const dock = s.picks.find((p) => p.category === "dock");
      if (!dock) return text(s.body).trim() ? { ok: true, why: `No dock fits, and it says why: ${text(s.body).slice(0, 140)}` } : { ok: false, why: "No dock and no reason" };
      const twoHdmi = /\b(two|2|dual)\s*(x\s*)?hdmi\b/i.test(`${dock.title} ${dock.description}`) || ((dock.attrs?.video_out ?? []).filter((v: string) => v === "hdmi").length ?? 0) >= 2;
      return twoHdmi || /not confirmed/i.test(text(s.body)) ? { ok: true, why: `${dock.title}: ${twoHdmi ? "two HDMI shown" : "two HDMI said to be unconfirmed"}` } : { ok: false, why: `${dock.title}: two HDMI neither shown nor flagged` };
    },
  },
  {
    id: "kayak",
    input: "a kayak",
    expected: "Nothing in the stores Everyday can search fits; no plan to pay for.",
    check: (s) => {
      if (s.error) return { ok: true, why: `Says so: "${s.error.slice(0, 120)}"` };
      return !quotable(s.body) ? { ok: true, why: `Not quotable: ${text(s.body).slice(0, 140)}` } : { ok: false, why: `Quotable plan for a kayak: ${s.picks.map((p) => p.title).join(", ")}` };
    },
  },
];

export async function runRegression(a: Account) {
  const db = await getDb();
  await clearSuite("regression", db);
  const rows: { id: string; input: string; expected: string; ok: boolean; why: string; reader: string | null; ms: number }[] = [];
  for (const c of REGRESSION) {
    const t0 = Date.now();
    let s: Seen = { read: null, body: null, error: null, picks: [] };
    try {
      const id = await createIntent(a, { text: c.input, channel: "app" });
      const i = (await db.query<any>("SELECT reqs, budget_cents, deadline FROM intents WHERE id = $1", [id])).rows[0];
      const reqs = typeof i.reqs === "string" ? JSON.parse(i.reqs) : i.reqs;
      const p = await currentPlan(db, id);
      const cat = await catalog(db);
      const picks = ((p?.body?.slots ?? []) as any[])
        .filter((v) => v.pick && v.outcome === "buy")
        .map((v) => cat.byId.get(v.pick.id))
        .filter(Boolean)
        .map((x: any) => ({ title: x.title, category: x.category, attrs: x.attrs, price_cents: x.price_cents, description: x.description }));
      s = { read: { ...reqs, budget_cents: i.budget_cents, deadline: i.deadline }, body: p?.body ?? null, error: null, picks };
    } catch (e) {
      s.error = (e as Error).message;
    }
    const v = c.check(s);
    const ms = Date.now() - t0;
    rows.push({ id: c.id, input: c.input, expected: c.expected, ok: v.ok, why: v.why, reader: s.read?.read?.model ?? (s.error ? null : "rules"), ms });
    await recordEval({ suite: "regression", arm: "live planner", caseId: c.id, expected: c.expected, actual: v.why, correct: v.ok, latencyMs: ms, detail: { input: c.input, reader: s.read?.read?.reader ?? null, model: s.read?.read?.model ?? null } }, db);
  }
  return rows;
}
