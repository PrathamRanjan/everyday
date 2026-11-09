import { readFileSync, writeFileSync } from "node:fs";
import { runTechjam } from "../src/core/techjam.js";
const manifest = JSON.parse(readFileSync("eval/techjam-heldout.json", "utf8"));
const r = runTechjam(manifest.seeds, manifest.per_seed);
writeFileSync("eval/techjam.md", r.markdown);
console.log(r.markdown);
