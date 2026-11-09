import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { setProviderFetch } from "../src/ai/provider.js";
import { dateForDay, readRequest } from "../src/ai/request.js";
import { setOembedFetch } from "../src/services/oembed.js";
import { seed, type Seeded } from "../src/services/seed.js";
import { createIntent, currentPlan } from "../src/services/plans.js";
import { capture } from "../src/services/captures.js";
import { accountById } from "../src/store.js";
import { normalizeLink } from "../src/core/url.js";
import { coverOf } from "../src/services/oembed.js";

// The two model readers added on 10 Nov: the request reader (words -> grounded fields; numbers stay with code) and the
// public-cover reader for real YouTube/TikTok links. The network is replaced; the code paths are the production ones.

let db: Db;
let s: Seeded;
const saved = { provider: config.ai.provider, key: config.ai.openaiKey };

/** A fake OpenAI Responses endpoint that answers with `out` for every call and records the requests. */
function fakeModel(out: (body: any) => unknown) {
  const calls: any[] = [];
  setProviderFetch((async (_url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    return new Response(JSON.stringify({ model: body.model, usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(out(body)) }] }] }), { status: 200 });
  }) as typeof fetch);
  return calls;
}

beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  s = await db.tx((q) => seed(q, { anchor: "2026-11-09T09:00" }));
  config.ai.provider = "openai";
  config.ai.openaiKey = "test-key";
});
afterEach(async () => {
  setProviderFetch(null);
  setOembedFetch(null);
  config.ai.provider = saved.provider;
  config.ai.openaiKey = saved.key;
  await db.close();
});

const empty = { wants: [], owns: [], replace: [], whole_setup: { value: false, quote: "" }, recipient: { relation: null, quote: "" }, deadline: { day: null, quote: "" }, comfort: { value: false, quote: "" }, must_have: [] };

describe("request reader", () => {
  it("keeps only fields whose quote is in the shopper's words, and never reads money", async () => {
    const calls = fakeModel(() => ({
      ...empty,
      wants: [{ category: "mouse", quote: "quiet mouse" }, { category: "webcam", quote: "a webcam please" }],
      owns: [{ category: "keyboard", quote: "already has a keyboard" }],
      recipient: { relation: "brother", quote: "for my brother" },
      deadline: { day: "wednesday", quote: "by Wednesday" },
      must_have: [{ word: "quiet", quote: "really quiet" }, { word: "pink", quote: "in pink" }],
    }));
    const r = await readRequest("Need a really quiet mouse for my brother by Wednesday, under $45. He already has a keyboard.");
    expect(r.reader).toBe("model");
    expect(r.wants).toEqual(["mouse"]); // the webcam quote is not in the text
    expect(r.owns).toEqual(["keyboard"]);
    expect(r.recipient).toBe("brother");
    expect(r.deadline_day).toBe("wednesday");
    expect(r.must_have).toEqual(["quiet"]);
    expect(r.dropped).toBe(2);
    // The schema the model fills has no money field at all.
    expect(JSON.stringify(calls[0].text.format.schema)).not.toMatch(/budget|cents|amount|price/i);
  });

  it("drives the plan: model-read words plus the code-read budget, and a stated quality outranks learned taste", async () => {
    fakeModel(() => ({ ...empty, wants: [{ category: "mouse", quote: "quiet mouse" }], must_have: [{ word: "quiet", quote: "quiet mouse" }] }));
    const a = await accountById(db, s.account);
    const id = await createIntent(a, { text: "a quiet mouse under $60", channel: "app" });
    const i = (await db.query<any>("SELECT * FROM intents WHERE id = $1", [id])).rows[0];
    expect(i.budget_cents).toBe(6000);
    const reqs = typeof i.reqs === "string" ? JSON.parse(i.reqs) : i.reqs;
    expect(reqs.read.reader).toBe("model");
    expect(reqs.read.readings.map((x: any) => x.quote)).toContain("quiet mouse");
    const p = await currentPlan(db, id);
    const mouse = p.body.slots.find((x: any) => x.key === "mouse");
    expect(mouse.pick.reasons[0]).toMatch(/quiet, as you asked/);
  });

  it("falls back to the rules reader when the model fails, and says so", async () => {
    setProviderFetch((async () => new Response("boom", { status: 400 })) as typeof fetch);
    const r = await readRequest("a desk lamp by Friday");
    expect(r.reader).toBe("rules");
    const a = await accountById(db, s.account);
    const id = await createIntent(a, { text: "a desk lamp by Friday under $80", channel: "app" });
    const reqs = (await db.query<any>("SELECT reqs FROM intents WHERE id = $1", [id])).rows[0].reqs;
    expect((typeof reqs === "string" ? JSON.parse(reqs) : reqs).read.reader).toBe("rules");
  });

  it("computes the deadline date in code from the quoted weekday", () => {
    const mon = new Date("2026-11-09T09:00:00Z"); // a Monday
    expect(dateForDay("wednesday", mon)).toBe("2026-11-11");
    expect(dateForDay("monday", mon)).toBe("2026-11-16");
    expect(dateForDay("tomorrow", mon)).toBe("2026-11-10");
  });
});

describe("public cover reader", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

  it("reads a real YouTube link's oEmbed cover with the vision model and labels the basis", async () => {
    setOembedFetch((async (url: any) => {
      const u = String(url);
      if (u.startsWith("https://www.youtube.com/oembed")) return new Response(JSON.stringify({ title: "Cosy oak desk tour", author_name: "deskdays", thumbnail_url: "https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg" }), { status: 200 });
      if (u.startsWith("https://i.ytimg.com/")) return new Response(png, { status: 200, headers: { "content-type": "image/png", "content-length": String(png.length) } });
      return new Response("no", { status: 404 });
    }) as typeof fetch);
    fakeModel(() => ({ transcript: "", objects: [{ label: "oak desk lamp", category: "lamp", query: "oak desk lamp", price_seen: null, price_quote: null }] }));
    const a = await accountById(db, s.account);
    const c = await capture(a, { url: "https://youtube.com/shorts/abc123XYZ", channel: "app" });
    const row = (await db.query<any>("SELECT * FROM captures WHERE id = $1", [c.id])).rows[0];
    expect(row.status).toBe("analysed_cover");
    expect(row.title).toMatch(/Cosy oak desk tour/);
    expect(row.basis).toMatch(/cover image/);
    expect((typeof row.objects === "string" ? JSON.parse(row.objects) : row.objects)[0].category).toBe("lamp");
  });

  it("never fetches a cover from a host that isn't the platform's image host", async () => {
    const seen: string[] = [];
    setOembedFetch((async (url: any) => {
      seen.push(String(url));
      if (String(url).includes("/oembed")) return new Response(JSON.stringify({ title: "x", thumbnail_url: "https://169.254.169.254/latest/meta-data" }), { status: 200 });
      return new Response("secret", { status: 200, headers: { "content-type": "image/png" } });
    }) as typeof fetch);
    const cover = await coverOf(normalizeLink("https://youtu.be/abcdefg")!);
    expect(cover?.image).toBeNull();
    expect(seen.some((u) => u.includes("169.254"))).toBe(false);
  });
});
