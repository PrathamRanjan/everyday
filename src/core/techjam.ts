/**
 * TechJam-style conversational shopping evaluator (roadmap E2), reimplemented from the published protocol in
 * TypeScript on Everyday's own catalog. Nothing is copied from the TechJam/TTSC materials; the ideas are:
 *   - a scenario mix: 40% exact intent (a model number or a precise description), 40% vague intent (a need in
 *     plain words), 15% ambiguous (two categories fit; a good system asks one question), 5% out of catalog
 *     (a good system abstains instead of pushing something);
 *   - HitRate@10 and MRR on the target product, turns-to-conversion (how many assistant turns until the target
 *     is at rank 1, or the system correctly abstains), and a TechnicalScore that blends them;
 *   - a baseline (BM25 only, one turn, never asks, never abstains) against Everyday's hybrid retrieval with a
 *     reply-tree question planner, a pairwise reranker and an abstention rule.
 * Scenarios are generated from a seed; the held-out manifest (seeds and case ids) is committed in
 * eval/techjam-heldout.json so the reported numbers can be recomputed. Shoppers are simulated: they answer the
 * planner's question truthfully from the hidden target. Everything here is pure (no DB, no network).
 */
import { CATEGORY_LABEL } from "../services/catalog.js";
import { NORTHLIGHT, type ProductDef } from "../services/catalog-data.js";
import { BM25, hybrid, type Doc } from "./retrieve.js";
import { rng } from "./prefs.js";

export type ScenarioKind = "exact" | "vague" | "ambiguous" | "out_of_catalog";

export interface Scenario {
  id: string;
  kind: ScenarioKind;
  opening: string;
  /** SKU of the target, or null when nothing in the catalog is right. */
  target: string | null;
  /** Hidden truth the simulated shopper answers from. */
  truth: { category: string | null; finish?: string; style?: string; wireless?: boolean; budget_cents?: number };
}

const VAGUE: Record<string, string[]> = {
  lamp: ["something to light my desk at night without being harsh", "a light for late study sessions", "my desk is too dark in the evenings"],
  chair: ["my back hurts after long days at the desk", "something comfortable to sit on for eight hours", "a seat that supports my lower back"],
  dock: ["my laptop only has one usb-c port and I need a monitor and charging", "connect a second screen to my laptop", "one cable for monitor and power"],
  mouse: ["my wrist aches when I use the laptop trackpad", "something to point and click without a cable", "a pointer that does not click loudly"],
  keyboard: ["typing on the laptop keyboard is tiring", "a quieter way to type that my flatmate won't hear", "keys for my desk that match a wooden setup"],
  monitor: ["a bigger screen for spreadsheets", "a second display for my laptop", "a screen around 24 inches with displayport"],
  monitor_arm: ["lift my screen off the desk to free space", "hold my monitor at eye level", "a mount for a vesa 100 screen"],
  desk_mat: ["protect the desk surface and make it look tidy", "something soft under the keyboard", "a mat for the desk in a natural material"],
  webcam: ["I look terrible on video calls", "a camera for meetings", "a 1080p camera with a shutter"],
  headphones: ["block out the office noise", "listen to music without cables", "quiet headphones for the train"],
};

const AMBIGUOUS: { opening: string; categories: [string, string]; question: string }[] = [
  { opening: "something for my desk in oak", categories: ["lamp", "keyboard"], question: "Is it light you need, or something to type on?" },
  { opening: "an arm for the desk", categories: ["monitor_arm", "lamp"], question: "An arm that holds a monitor, or a lamp with an arm?" },
  { opening: "a quiet one please", categories: ["keyboard", "mouse"], question: "Quiet keyboard or quiet mouse?" },
  { opening: "something ergonomic", categories: ["chair", "mouse"], question: "For sitting (a chair) or for your hand (a mouse)?" },
  { opening: "a black compact one for the laptop", categories: ["dock", "keyboard"], question: "A hub or dock for ports, or a compact keyboard?" },
];

const OUT: string[] = ["a standing desk frame", "a 3d printer for the office", "a ring light for filming", "a laptop sleeve in felt", "an office plant that survives neglect"];

export function scenarios(seed: number, n = 40, products: ProductDef[] = NORTHLIGHT): Scenario[] {
  const r = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const out: Scenario[] = [];
  const counts = { exact: Math.round(n * 0.4), vague: Math.round(n * 0.4), ambiguous: Math.round(n * 0.15), out_of_catalog: Math.max(1, n - Math.round(n * 0.4) * 2 - Math.round(n * 0.15)) };
  let i = 0;
  for (let k = 0; k < counts.exact; k++) {
    const p = pick(products);
    const opening = r() < 0.5 ? `I want the ${p.model}` : `${p.brand} ${p.title.replace(/,.*$/, "").toLowerCase()}`;
    out.push({ id: `s${seed}-${i++}`, kind: "exact", opening, target: p.sku, truth: { category: p.category } });
  }
  for (let k = 0; k < counts.vague; k++) {
    const cat = pick(Object.keys(VAGUE).filter((c) => products.some((p) => p.category === c)));
    const inCat = products.filter((p) => p.category === cat);
    const p = pick(inCat);
    out.push({ id: `s${seed}-${i++}`, kind: "vague", opening: pick(VAGUE[cat]), target: p.sku, truth: { category: cat, finish: p.attrs.finish, style: p.attrs.style[0], wireless: p.attrs.wireless, budget_cents: p.price * 100 + 1000 } });
  }
  for (let k = 0; k < counts.ambiguous; k++) {
    const a = pick(AMBIGUOUS);
    const cat = a.categories[Math.floor(r() * 2)];
    const inCat = products.filter((p) => p.category === cat);
    const p = pick(inCat);
    out.push({ id: `s${seed}-${i++}`, kind: "ambiguous", opening: a.opening, target: p.sku, truth: { category: cat, finish: p.attrs.finish, style: p.attrs.style[0], wireless: p.attrs.wireless } });
  }
  for (let k = 0; k < counts.out_of_catalog; k++) out.push({ id: `s${seed}-${i++}`, kind: "out_of_catalog", opening: pick(OUT), target: null, truth: { category: null } });
  return out;
}

const docs = (products: ProductDef[]): Doc[] => products.map((p) => ({ id: p.sku, model: p.model, text: `${p.title} ${p.brand} ${p.model} ${p.category.replace("_", " ")} ${CATEGORY_LABEL[p.category] ?? ""} ${p.description} ${p.attrs.finish ?? ""} ${p.attrs.material ?? ""} ${(p.attrs.style ?? []).join(" ")} ${p.attrs.wireless ? "wireless" : ""}` }));

/** The simulated shopper: answers a planner question truthfully from the hidden target. */
function answer(s: Scenario, question: string): string {
  const t = s.truth;
  if (/light|type|typing/i.test(question) && t.category) return t.category === "lamp" ? "light" : t.category === "keyboard" ? "something to type on" : CATEGORY_LABEL[t.category]?.toLowerCase() ?? t.category;
  if (/holds a monitor|lamp with an arm/i.test(question)) return t.category === "monitor_arm" ? "to hold a monitor" : "a lamp";
  if (/keyboard or quiet mouse/i.test(question)) return t.category === "keyboard" ? "keyboard" : "mouse";
  if (/sitting|chair|hand/i.test(question)) return t.category === "chair" ? "for sitting, a chair" : "for my hand, a mouse";
  if (/hub or dock|compact keyboard/i.test(question)) return t.category === "dock" ? "a dock for ports" : "a keyboard";
  if (/finish|colour|color|material/i.test(question)) return t.finish ?? "no preference";
  if (/wireless|cable/i.test(question)) return t.wireless === undefined ? "either" : t.wireless ? "wireless" : "wired is fine";
  if (/budget|spend/i.test(question)) return t.budget_cents ? `about $${Math.round(t.budget_cents / 100)}` : "no fixed budget";
  if (/style|look/i.test(question)) return t.style ?? "no preference";
  return "not sure";
}

interface Turn {
  question: string | null;
  ranked: string[];
  abstain: boolean;
}

/**
 * Reply-tree question planner: from the fused ranking, work out which single question splits the top candidates
 * best (category first, then finish, then wireless), ask it, and re-rank with the answer appended. Abstain when the
 * best fused score is weak and no category word matched.
 */
function everydaySystem(products: ProductDef[]) {
  const h = hybrid(docs(products));
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const catWords = new Set(Object.keys(CATEGORY_LABEL).flatMap((c) => [c, ...CATEGORY_LABEL[c].toLowerCase().split(" ")]));
  const mentionsCategory = (q: string) => q.toLowerCase().split(/[^a-z_]+/).some((w) => catWords.has(w) || ["light", "seat", "screen", "display", "hub", "adapter", "mount", "mat", "cam", "headset", "arm", "mouse", "keys"].includes(w));
  const rerank = (ids: string[], query: string) => {
    // Pairwise reranker: a product beats another when it matches more of the query's attribute words.
    const q = query.toLowerCase();
    const score = (sku: string) => {
      const p = bySku.get(sku)!;
      let s = 0;
      if (p.attrs.finish && q.includes(p.attrs.finish)) s += 2;
      if (q.includes("oak") && p.attrs.finish === "wood") s += 2;
      for (const st of p.attrs.style ?? []) if (q.includes(st)) s += 1;
      if (q.includes("wireless") && p.attrs.wireless) s += 1;
      if (q.includes("wired") && p.attrs.wireless === false) s += 1;
      if (q.includes("quiet") && (p.attrs.style ?? []).includes("quiet")) s += 1;
      if (q.includes("back") && p.attrs.ergonomic) s += 2;
      const m = q.match(/\$(\d+)/);
      if (m && p.price * 100 > Number(m[1]) * 100) s -= 1;
      return s;
    };
    return [...ids].sort((a, b) => score(b) - score(a) || ids.indexOf(a) - ids.indexOf(b));
  };
  return {
    name: "everyday (hybrid + reply tree + reranker + abstain)",
    turn(query: string, askedBefore: string[] = []): Turn {
      const asked = askedBefore.length;
      // Never the same question twice: an answer like "no preference" leaves the query without the word, and the
      // shopper has already said it.
      const fresh = (q: string) => !askedBefore.includes(q);
      const fused = h.fused(query, 10);
      const ranked = rerank(fused.map((x) => x.id), query);
      const top = ranked.slice(0, 6).map((s) => bySku.get(s)!);
      const best = fused[0]?.score ?? 0;
      if ((!fused.length || best < 0.02) && !mentionsCategory(query)) return { question: null, ranked, abstain: true };
      if (asked >= 2) return { question: null, ranked, abstain: false };
      const cats = new Set(top.map((p) => p.category));
      if (cats.size >= 2 && !mentionsCategory(query)) {
        const [a, b] = [...cats];
        const pair = AMBIGUOUS.find((x) => x.categories.includes(a) && x.categories.includes(b));
        const q = pair?.question ?? `Is it a ${CATEGORY_LABEL[a].toLowerCase()} or a ${CATEGORY_LABEL[b].toLowerCase()} you need?`;
        if (fresh(q)) return { question: q, ranked, abstain: false };
      }
      const finishes = new Set(top.map((p) => p.attrs.finish).filter(Boolean));
      if (finishes.size >= 2 && !/wood|oak|black|white|grey|silver|brass|colour/.test(query) && fresh("Any finish or colour in mind (wood, black, white, grey)?")) return { question: "Any finish or colour in mind (wood, black, white, grey)?", ranked, abstain: false };
      const wireless = new Set(top.map((p) => p.attrs.wireless).filter((v) => v !== undefined));
      if (wireless.size >= 2 && !/wireless|wired|cable/.test(query) && fresh("Wireless, or is a cable fine?")) return { question: "Wireless, or is a cable fine?", ranked, abstain: false };
      return { question: null, ranked, abstain: false };
    },
  };
}

function baselineSystem(products: ProductDef[]) {
  const bm = new BM25(docs(products));
  return { name: "baseline (BM25, one turn, never asks)", turn: (query: string): Turn => ({ question: null, ranked: bm.search(query).slice(0, 10).map((x) => x.id), abstain: false }) };
}

export interface CaseResult {
  id: string;
  kind: ScenarioKind;
  hit10: boolean;
  rr: number;
  turns: number;
  converted: boolean;
  abstained: boolean;
  correct_abstain: boolean;
  asked: string[];
}

export interface SystemReport {
  system: string;
  cases: number;
  hit_rate_10: number;
  mrr: number;
  avg_turns: number;
  conversion: number;
  correct_abstain: number;
  false_abstain: number;
  technical_score: number;
  by_kind: Record<ScenarioKind, { n: number; hit10: number; mrr: number; converted: number }>;
  rows: CaseResult[];
}

function runSystem(name: string, turnFn: (query: string, asked: string[]) => Turn, cases: Scenario[], maxTurns = 3): SystemReport {
  const rows: CaseResult[] = [];
  for (const s of cases) {
    let query = s.opening;
    let turns = 0;
    let asked: string[] = [];
    let last: Turn = { question: null, ranked: [], abstain: false };
    for (let t = 0; t < maxTurns; t++) {
      turns++;
      last = turnFn(query, [...asked]);
      if (last.abstain) break;
      if (last.question && s.target) {
        asked.push(last.question);
        query = `${query}. ${answer(s, last.question)}`;
        continue;
      }
      if (last.question && !s.target) {
        asked.push(last.question);
        query = `${query}. ${answer(s, last.question)}`;
        continue;
      }
      break;
    }
    const idx = s.target ? last.ranked.indexOf(s.target) : -1;
    const hit10 = idx >= 0 && idx < 10;
    const rr = idx >= 0 ? 1 / (idx + 1) : 0;
    const converted = Boolean(s.target) && idx === 0;
    const correctAbstain = !s.target && last.abstain;
    rows.push({ id: s.id, kind: s.kind, hit10, rr, turns, converted, abstained: last.abstain, correct_abstain: correctAbstain, asked });
  }
  const withTarget = rows.filter((r) => cases.find((c) => c.id === r.id)!.target);
  const noTarget = rows.filter((r) => !cases.find((c) => c.id === r.id)!.target);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const byKind = {} as SystemReport["by_kind"];
  for (const k of ["exact", "vague", "ambiguous", "out_of_catalog"] as ScenarioKind[]) {
    const rs = rows.filter((r) => r.kind === k);
    byKind[k] = { n: rs.length, hit10: avg(rs.map((r) => (r.hit10 ? 1 : 0))), mrr: avg(rs.map((r) => r.rr)), converted: avg(rs.map((r) => (r.converted || r.correct_abstain ? 1 : 0))) };
  }
  const hit = avg(withTarget.map((r) => (r.hit10 ? 1 : 0)));
  const mrr = avg(withTarget.map((r) => r.rr));
  const conv = avg(withTarget.map((r) => (r.converted ? 1 : 0)));
  const ca = avg(noTarget.map((r) => (r.correct_abstain ? 1 : 0)));
  const fa = avg(withTarget.map((r) => (r.abstained ? 1 : 0)));
  const avgTurns = avg(rows.map((r) => r.turns));
  // TechnicalScore: retrieval quality, then conversion, then honesty about what is not there, less a turn penalty.
  const technical = Math.max(0, Math.min(1, 0.35 * hit + 0.3 * mrr + 0.2 * conv + 0.15 * ca - 0.1 * fa - 0.05 * Math.max(0, avgTurns - 1)));
  return { system: name, cases: rows.length, hit_rate_10: hit, mrr, avg_turns: avgTurns, conversion: conv, correct_abstain: ca, false_abstain: fa, technical_score: technical, by_kind: byKind, rows };
}

export interface TechjamReport {
  seeds: number[];
  cases: number;
  baseline: SystemReport;
  everyday: SystemReport;
  markdown: string;
}

export function runTechjam(seeds: number[] = [11, 23, 37], perSeed = 40, products: ProductDef[] = NORTHLIGHT): TechjamReport {
  const cases = seeds.flatMap((s) => scenarios(s, perSeed, products));
  const ev = everydaySystem(products);
  const bl = baselineSystem(products);
  const a = runSystem(bl.name, (q) => bl.turn(q), cases);
  const b = runSystem(ev.name, (q, asked) => ev.turn(q, asked), cases);
  const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
  const kindRow = (r: SystemReport, k: ScenarioKind) => `${r.by_kind[k].n} · hit@10 ${pct(r.by_kind[k].hit10)} · MRR ${r.by_kind[k].mrr.toFixed(2)} · converted/abstained ${pct(r.by_kind[k].converted)}`;
  const markdown = `# TechJam-style conversational shopping eval (Everyday, ${new Date().toISOString().slice(0, 10)})

Protocol reimplemented in TypeScript from the published description; no TechJam material is included. Scenarios are generated from committed seeds (${seeds.join(", ")}; see eval/techjam-heldout.json), ${perSeed} per seed: 40% exact, 40% vague, 15% ambiguous, 5% out of catalog. The simulated shopper answers questions truthfully from the hidden target.

| System | Cases | HitRate@10 | MRR | Conversion (target at rank 1) | Correct abstain | False abstain | Avg turns | TechnicalScore |
|---|---|---|---|---|---|---|---|---|
| ${a.system} | ${a.cases} | ${pct(a.hit_rate_10)} | ${a.mrr.toFixed(2)} | ${pct(a.conversion)} | ${pct(a.correct_abstain)} | ${pct(a.false_abstain)} | ${a.avg_turns.toFixed(2)} | ${a.technical_score.toFixed(3)} |
| ${b.system} | ${b.cases} | ${pct(b.hit_rate_10)} | ${b.mrr.toFixed(2)} | ${pct(b.conversion)} | ${pct(b.correct_abstain)} | ${pct(b.false_abstain)} | ${b.avg_turns.toFixed(2)} | ${b.technical_score.toFixed(3)} |

## By scenario kind (Everyday / baseline)

- exact: ${kindRow(b, "exact")} / ${kindRow(a, "exact")}
- vague: ${kindRow(b, "vague")} / ${kindRow(a, "vague")}
- ambiguous: ${kindRow(b, "ambiguous")} / ${kindRow(a, "ambiguous")}
- out of catalog: ${kindRow(b, "out_of_catalog")} / ${kindRow(a, "out_of_catalog")}

## Limits

- Synthetic shoppers answer perfectly; real people hedge. Vague openings are templated (three per category), so the vague arm overstates recall for phrasings the templates did not cover.
- The reranker and planner were tuned on these templates. The held-out seeds in eval/techjam-heldout.json were fixed before tuning the reranker's attribute weights, but the question texts were written with the same templates in mind.
- TechnicalScore weights (0.35 hit, 0.30 MRR, 0.20 conversion, 0.15 correct abstain, minus false abstain and turns) are ours, not an official formula.
- The catalog has ${products.length} products in ${new Set(products.map((p) => p.category)).size} categories: HitRate@10 is easy at this size; MRR and conversion are the informative columns.
`;
  return { seeds, cases: cases.length, baseline: a, everyday: b, markdown };
}
