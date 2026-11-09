/** Prints the reproducible preference experiment report (synthetic shoppers). */
import { report } from "../src/core/experiment.js";
const t = Date.now();
const r = report();
console.log(JSON.stringify({ ...r, prior: r.prior.map((x) => Math.round(x * 100) / 100) }, null, 1));
console.log(`${Date.now() - t} ms`);
