import { readFileSync, writeFileSync } from "node:fs";
import { runTechjam, scenarios } from "../src/core/techjam.js";
const manifest = JSON.parse(readFileSync("eval/techjam-heldout.json", "utf8"));
const r = runTechjam(manifest.seeds, manifest.per_seed);
writeFileSync("eval/techjam.md", r.markdown);
// A5.6: every case, both systems, so /proof can list them.
const all = manifest.seeds.flatMap((s: number) => scenarios(s, manifest.per_seed));
const ev = new Map(r.everyday.rows.map((x) => [x.id, x]));
const bl = new Map(r.baseline.rows.map((x) => [x.id, x]));
const sys = (s: typeof r.everyday) => ({ system: s.system, cases: s.cases, hit_rate_10: s.hit_rate_10, mrr: s.mrr, conversion: s.conversion, correct_abstain: s.correct_abstain, false_abstain: s.false_abstain, avg_turns: s.avg_turns, technical_score: s.technical_score });
writeFileSync(
  "eval/techjam.json",
  JSON.stringify(
    {
      suite: "techjam",
      run_on: new Date().toISOString(),
      provider: "no model (retrieval, reply tree and reranker in code)",
      seeds: manifest.seeds,
      systems: [sys(r.baseline), sys(r.everyday)],
      cases: all.map((c: any) => ({ id: c.id, kind: c.kind, query: c.opening, target: c.target ?? null, everyday: ev.get(c.id) ?? null, baseline: bl.get(c.id) ?? null })),
    },
    null,
    2,
  ) + "\n",
);
console.log(r.markdown);
