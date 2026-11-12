// Step 2: every item's text → 384 numbers (data/emb.f32, rows in the order of data/emb-ids.json).
import { readFileSync, writeFileSync } from "node:fs";
import { DIM, embedder, itemText } from "./embed-lib.mjs";

const items = readFileSync("data/items.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
// The metadata "store" field is the brand as the listing names it; the fetch kept it inside `text` as "by X".
const brand = (it) => it.text.match(/\. by ([^.]+)/)?.[1] ?? null;
const embed = await embedder();
const all = new Float32Array(items.length * DIM);
const t0 = Date.now();
const B = 64;
for (let i = 0; i < items.length; i += B) {
  const batch = items.slice(i, i + B);
  const vs = await embed(batch.map((it) => itemText(it.title, brand(it))));
  vs.forEach((v, k) => all.set(v, (i + k) * DIM));
  if ((i / B) % 100 === 0) console.log(i, "of", items.length, `${Math.round((Date.now() - t0) / 1000)} s`);
}
writeFileSync("data/emb.f32", Buffer.from(all.buffer));
writeFileSync("data/emb-ids.json", JSON.stringify(items.map((it) => it.id)));
writeFileSync("data/embed-log.json", JSON.stringify({ items: items.length, seconds: Math.round((Date.now() - t0) / 1000) }, null, 2));
console.log("done", items.length, Math.round((Date.now() - t0) / 1000), "s");
