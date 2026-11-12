// Step 1: a sample of Amazon Reviews 2023 (McAuley Lab, https://amazon-reviews-2023.github.io/), three categories.
// The full files are ~79 GB, so this reads only what it needs, and reports every byte it downloaded:
//   - ratings: the published 5-core rating files (user, item, stars, time), grouped by user in time order. Office
//     Products is read whole (104 MB); Electronics and Home and Kitchen only their first 160 MB each (whole users).
//   - item text: each category's metadata file is streamed once, keeping only the items those ratings mention
//     (title, store, first features, main category). Nothing else from the stream is kept.
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const BASE = "https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023/resolve/main";
const CATS = [
  { name: "Office_Products", ratingBytes: null },
  { name: "Electronics", ratingBytes: 160e6 },
  { name: "Home_and_Kitchen", ratingBytes: 160e6 },
];
const USERS_PER_CAT = 4000; // users with 6+ ratings, enough history to hold two out
mkdirSync("data", { recursive: true });
const log = { started: new Date().toISOString(), source: BASE, categories: {} };

async function lines(url, maxBytes, onLine) {
  const headers = maxBytes ? { range: `bytes=0-${Math.floor(maxBytes) - 1}` } : {};
  const r = await fetch(url, { headers });
  if (!r.ok && r.status !== 206) throw new Error(`${url}: ${r.status}`);
  let bytes = 0;
  const body = Readable.fromWeb(r.body);
  body.on("data", (c) => (bytes += c.length));
  const rl = createInterface({ input: body, crlfDelay: Infinity });
  for await (const line of rl) if (onLine(line) === false) {
    rl.close();
    body.destroy();
    break;
  }
  return bytes;
}

const ratingsOut = createWriteStream("data/ratings.jsonl");
const itemsOut = createWriteStream("data/items.jsonl");
for (const cat of CATS) {
  const t0 = Date.now();
  const byUser = new Map();
  let header = true;
  let last = null;
  const ratingBytes = await lines(`${BASE}/benchmark/5core/rating_only/${cat.name}.csv`, cat.ratingBytes, (line) => {
    if (header) return (header = false), true;
    const [user, item, stars, ts] = line.split(",");
    if (!user || !item || !ts) return true;
    if (!byUser.has(user)) byUser.set(user, []);
    byUser.get(user).push({ item, stars: Number(stars), ts: Number(ts) });
    last = user;
    return true;
  });
  // A partial read can cut the last user short: drop them.
  if (cat.ratingBytes && last) byUser.delete(last);
  const users = [...byUser.entries()].filter(([, rs]) => rs.length >= 6).slice(0, USERS_PER_CAT);
  const need = new Set(users.flatMap(([, rs]) => rs.map((r) => r.item)));
  // Item text from the metadata stream.
  const found = new Map();
  const metaBytes = await lines(`${BASE}/raw/meta_categories/meta_${cat.name}.jsonl`, null, (line) => {
    const asin = line.match(/"parent_asin": ?"([^"]+)"/)?.[1];
    if (!asin || !need.has(asin) || found.has(asin)) return true;
    try {
      const m = JSON.parse(line);
      const text = [m.title, m.store ? `by ${m.store}` : "", ...(m.features ?? []).slice(0, 2)].filter(Boolean).join(". ").replace(/\s+/g, " ").slice(0, 400);
      if (m.title) found.set(asin, { id: asin, cat: cat.name, title: String(m.title).slice(0, 200), text, price: typeof m.price === "number" ? m.price : null, main: m.main_category ?? null });
    } catch {
      /* a broken line is skipped */
    }
    return found.size < need.size;
  });
  for (const it of found.values()) itemsOut.write(JSON.stringify(it) + "\n");
  let kept = 0;
  for (const [user, rs] of users) {
    const known = rs.filter((r) => found.has(r.item)).sort((a, b) => a.ts - b.ts);
    if (known.length < 6) continue;
    ratingsOut.write(JSON.stringify({ user, cat: cat.name, ratings: known }) + "\n");
    kept++;
  }
  log.categories[cat.name] = { rating_bytes: ratingBytes, meta_bytes: metaBytes, users_read: byUser.size, users_kept: kept, items_needed: need.size, items_found: found.size, seconds: Math.round((Date.now() - t0) / 1000) };
  console.log(cat.name, log.categories[cat.name]);
}
ratingsOut.end();
itemsOut.end();
log.total_bytes = Object.values(log.categories).reduce((s, c) => s + c.rating_bytes + c.meta_bytes, 0);
log.finished = new Date().toISOString();
writeFileSync("data/fetch-log.json", JSON.stringify(log, null, 2));
console.log("downloaded", (log.total_bytes / 1e9).toFixed(2), "GB");
