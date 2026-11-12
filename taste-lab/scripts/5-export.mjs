// Step 5: export what ships, for the server (src/taste/model.json) and the browser (web/public/taste/model.json, the
// same file), plus parity fixtures (src/taste/parity.json): four texts in four languages, their raw embeddings from
// this lab, and the final vectors and scores the exported (rounded) model must reproduce. The server test checks the
// server's maths against them; e2e/tests/taste-parity.spec.ts checks the browser's embedding against them.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { embedder, itemText, MODEL_ID, DTYPE } from "./embed-lib.mjs";
import { dot, itemVec, tasteVec } from "./score.mjs";

const ship = JSON.parse(readFileSync("data/ship.json", "utf8"));
const res = JSON.parse(readFileSync(`data/results-${ship.tag}.json`, "utf8"));
const w = JSON.parse(readFileSync(`data/W-${ship.tag}.json`, "utf8"));
const lang = JSON.parse(readFileSync("data/language.json", "utf8"));
const fetchLog = JSON.parse(readFileSync("data/fetch-log.json", "utf8"));
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const full = { dim: w.dim, k: w.k, centred: w.centred, mean: Float32Array.from(w.mean), W: w.ships === "raw_cosine" ? null : Float32Array.from(w.W) };
const model = {
  version: `taste-${res.trained_at.slice(0, 10)}-${ship.tag}`,
  embedding: { model_id: MODEL_ID, dtype: DTYPE, pooling: "mean", normalize: true, text: "title, then '. by <brand>' when known", dim: w.dim },
  dim: w.dim,
  k: w.ships === "raw_cosine" ? w.dim : w.k,
  centred: w.centred,
  mean: w.mean.map(r6),
  W: full.W ? Array.from(full.W, r6) : null,
  tau: res.nothing_fits.tau,
  weights: { liked: 1, fine: 0.3, disliked: -0.5 },
  ships: w.ships,
  chosen_on: "validation NDCG@10 among the configurations tried",
  compared: ship.compared_on_validation,
  test: Object.fromEntries(Object.entries(res.results).map(([k, v]) => [k, { all: v.test, cold_items: v.test_cold_items }])),
  nothing_fits: res.nothing_fits,
  language: lang,
  data: { source: fetchLog.source, categories: fetchLog.categories, bytes_downloaded: fetchLog.total_bytes, people: res.users, items: res.items },
  trained_at: res.trained_at,
};
const exported = { ...model, mean: Float32Array.from(model.mean), W: model.W ? Float32Array.from(model.W) : null, k: w.ships === "raw_cosine" ? w.dim : w.k };

// Parity: the same four listings in four languages, and a two-item history.
const texts = [itemText("Ergonomic Wireless Mouse with Silent Clicks", "Logitech"), itemText("एर्गोनोमिक वायरलेस माउस, साइलेंट क्लिक के साथ", "Logitech"), itemText("Mouse Nirkabel Ergonomis dengan Klik Senyap", "Logitech"), itemText("Panela de Pressão Elétrica 6 Litros", "Mondial")];
const embed = await embedder();
const raw = await embed(texts);
const hist = [{ v: raw[0], stars: 5 }, { v: raw[3], stars: 2 }];
const tasteFull = tasteVec(full, hist), tasteExp = tasteVec(exported, hist);
const scores = raw.map((v) => dot(tasteExp, itemVec(exported, v)));
const drift = Math.max(...raw.map((v) => Math.abs(dot(tasteFull, itemVec(full, v)) - dot(tasteExp, itemVec(exported, v)))));
const parity = { texts, raw: raw.map((v) => Array.from(v, r6)), history: [{ text: 0, stars: 5 }, { text: 3, stars: 2 }], scores: scores.map(r6), rounding_drift: drift };
console.log("rounding drift", drift, "scores", scores.map((x) => x.toFixed(4)).join(" "));
if (drift > 1e-4) throw new Error("rounding changed the scores by more than 1e-4");
for (const dir of ["../src/taste", "../web/public/taste"]) mkdirSync(dir, { recursive: true });
const json = JSON.stringify(model);
writeFileSync("../src/taste/model.json", json);
writeFileSync("../web/public/taste/model.json", json);
writeFileSync("../src/taste/parity.json", JSON.stringify(parity));
console.log("exported", model.version, `${(json.length / 1024).toFixed(0)} KB`);
