import { describe, expect, it } from "vitest";
import { display, displayDeep } from "../src/i18n/display.js";
import { langOfRequest, money, moneyIn, tr, withLang } from "../src/i18n/index.js";
import { budgetCentsAnyLang, dateFromDay, dayAnyLang, numberOf } from "../src/i18n/parse.js";
import { parseGoal } from "../src/services/plans.js";
// @ts-expect-error plain JS helper shared with the CI script
import { check } from "../scripts/i18n/lib.mjs";

// B: four languages. The check below is the CI gate: it fails when any sentence shown has no translation.
describe("languages", () => {
  it("has a translation for every sentence, with the same blanks (web and server)", () => {
    for (const target of ["web", "server"]) {
      const r = check(target);
      expect(r.keys, target).toBeGreaterThan(target === "web" ? 1000 : 400);
      expect(r.problems.map((p: any) => `${p.lang} ${p.problem}: ${p.key.slice(0, 60)}`), target).toEqual([]);
    }
  });

  it("picks the language from the header, then ?lang=, then the cookie, then the browser", () => {
    const req = (h: Record<string, string>, query: any = {}, cookies: any = {}) => ({ get: (k: string) => h[k.toLowerCase()], query, cookies });
    expect(langOfRequest(req({ "x-everyday-lang": "hi" }))).toBe("hi");
    expect(langOfRequest(req({}, { lang: "pt-BR" }))).toBe("pt");
    expect(langOfRequest(req({}, {}, { ev_lang: "id" }))).toBe("id");
    expect(langOfRequest(req({ "accept-language": "fr-FR,pt;q=0.8" }))).toBe("pt");
    expect(langOfRequest(req({ "accept-language": "in-ID" }))).toBe("id");
    expect(langOfRequest(req({}))).toBe("en");
  });

  it("words sentences and money for the language, never changing the amount", () => {
    expect(withLang("hi", () => tr("Sign in first."))).toBe("पहले साइन इन करें।");
    expect(moneyIn("pt", 123456)).toMatch(/US\$\s?1\.234,56/);
    expect(moneyIn("id", 8995)).toMatch(/US\$\s?89,95/);
    expect(withLang("en", () => money(8995))).toBe("$89.95");
  });

  it("re-words stored English sentences by template, and leaves names and codes alone", () => {
    const hi = display("$89.95 is over your $80.00 budget by $9.95", "hi");
    expect(hi).toContain("$89.95");
    expect(hi).toContain("$9.95");
    expect(hi).not.toContain("is over your");
    expect(display("Northlight Desk Lamp", "hi")).toBe("Northlight Desk Lamp");
    const out = displayDeep({ status: "planning", note: "Sign in first.", title: "Northlight Desk Lamp", reasons: ["Sign in first."] }, "pt");
    expect(out.status).toBe("planning");
    expect(out.title).toBe("Northlight Desk Lamp");
    expect(out.note).not.toBe("Sign in first.");
    expect(out.reasons[0]).toBe(out.note);
    // The pseudo-language marks every sentence the server knows.
    expect(display("Sign in first.", "xx")).toBe("⟦Sign in first.⟧");
  });

  it("reads a budget and a day in code, in every language", () => {
    expect(numberOf("1.234,56")).toBe(1234.56);
    expect(numberOf("1,234.56")).toBe(1234.56);
    expect(numberOf("80")).toBe(80);
    expect(budgetCentsAnyLang("वायरलेस कीबोर्ड 80 डॉलर से कम में")).toEqual({ cents: 8000, foreign: null });
    expect(budgetCentsAnyLang("keyboard nirkabel di bawah $80")).toEqual({ cents: 8000, foreign: null });
    expect(budgetCentsAnyLang("teclado sem fio até US$ 79,90")).toEqual({ cents: 7990, foreign: null });
    expect(budgetCentsAnyLang("कीबोर्ड ₹5000 तक")).toEqual({ cents: null, foreign: "INR" });
    expect(budgetCentsAnyLang("teclado até R$ 300")).toEqual({ cents: null, foreign: "BRL" });
    const wed = new Date("2026-11-11T10:00:00Z"); // a Wednesday
    expect(dateFromDay(dayAnyLang("शुक्रवार तक चाहिए")!, wed)).toBe("2026-11-13");
    expect(dateFromDay(dayAnyLang("sebelum Jumat")!, wed)).toBe("2026-11-13");
    expect(dateFromDay(dayAnyLang("até sexta-feira")!, wed)).toBe("2026-11-13");
    expect(dateFromDay(dayAnyLang("até a próxima segunda")!, wed)).toBe("2026-11-23");
    expect(dayAnyLang("dalam satu minggu")).toBeNull();
    const g = parseGoal("mujhe ek wireless keyboard chahiye, 80 डॉलर से कम, शुक्रवार तक", wed);
    expect(g.budget_cents).toBe(8000);
    expect(g.deadline).toBe("2026-11-13");
    expect(g.categories).toContain("keyboard");
    expect(parseGoal("teclado sem fio até US$ 79,90", wed).budget_cents).toBe(7990);
    expect(parseGoal("teclado até R$ 300", wed)).toMatchObject({ budget_cents: null, foreign_currency: "BRL" });
    expect(parseGoal("a desk lamp under $1,200", wed).budget_cents).toBe(120000);
    expect(parseGoal("a desk lamp, budget of 60", wed).budget_cents).toBe(6000);
  });
});

describe("local currency estimate (B5)", () => {
  it("uses a current ECB rate, keeps a recent one when the source fails, and shows nothing older or broken", async () => {
    const { fxRates, setFxFetcher } = await import("../src/services/fx.js");
    const now = Date.parse("2026-11-12T10:00:00Z");
    setFxFetcher(async () => ({ date: "2026-11-11", rates: { INR: 93.69, IDR: 18175, BRL: 5.5565 } }));
    expect((await fxRates(now)).fx?.rates.INR).toBe(93.69);
    // Source down: the cached rate (one day old) is still shown with its own date.
    setFxFetcher(async () => Promise.reject(new Error("down")));
    expect((await fxRates(now)).fx).toBeNull(); // setFxFetcher clears the cache: nothing cached, nothing shown
    setFxFetcher(async () => ({ date: "2026-11-01", rates: { INR: 90, IDR: 18000, BRL: 5.5 } }));
    expect((await fxRates(now)).fx).toBeNull(); // eleven days old
    setFxFetcher(async () => ({ date: "2026-11-11", rates: { INR: 93.69 } }));
    expect((await fxRates(now)).why).toMatch(/no estimate/);
  });
});
