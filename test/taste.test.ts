import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dot, itemVec, tasteCard, tasteModel, tasteVec } from "../src/taste/taste.js";

// The server's scoring maths must give the numbers the lab gave (taste-lab/scripts/5-export.mjs wrote them).
describe("taste model: exported, and the server's maths matches the lab", () => {
  it("loads and reproduces the lab's scores from the same raw embeddings", () => {
    const m = tasteModel();
    expect(m).not.toBeNull();
    const p = JSON.parse(readFileSync("src/taste/parity.json", "utf8"));
    const t = tasteVec(m!, p.history.map((h: any) => ({ v: p.raw[h.text], stars: h.stars })));
    p.raw.forEach((v: number[], i: number) => expect(Math.abs(dot(t, itemVec(m!, v)) - p.scores[i])).toBeLessThan(1e-4));
    // The liked English mouse should score above the disliked pressure cooker, in every language it was written in.
    expect(p.scores[0]).toBeGreaterThan(p.scores[3]);
    expect(p.scores[1]).toBeGreaterThan(p.scores[3]);
    expect(p.scores[2]).toBeGreaterThan(p.scores[3]);
  });
  it("publishes a card with test results and baselines, and no weights", () => {
    const c: any = tasteCard();
    expect(c.available).toBe(true);
    expect(c.W).toBeUndefined();
    expect(c.test.random.all.hr_at_10).toBeGreaterThan(0);
    expect(c.language.langs.hi).toBeTruthy();
  });
});
