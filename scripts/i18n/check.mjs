// B8.1: fails when any sentence the code shows has no translation, or a translation lost a numbered blank.
// Usage: node scripts/i18n/check.mjs   (CI runs it; `npm test` runs the same check)
import { check } from "./lib.mjs";

let failed = 0;
for (const target of ["web", "server"]) {
  const r = check(target);
  console.log(`${target}: ${r.keys} sentences, ${r.problems.length} problems`);
  for (const p of r.problems.slice(0, 40)) console.log(`  [${p.lang}] ${p.problem}: ${JSON.stringify(p.key).slice(0, 100)} (${p.where})`);
  failed += r.problems.length;
}
process.exit(failed ? 1 : 0);
