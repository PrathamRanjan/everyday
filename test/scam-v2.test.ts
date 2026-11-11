import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { openDb, setDb, type Db } from "../src/db.js";
import { decide, verdictOf } from "../src/ai/decisions.js";
import { setProviderFetch } from "../src/ai/provider.js";
import { scanText } from "../src/safety/rules.js";
import { extractDestinations, readMessage, SCAM_PREDICATES, PAY_SOMEWHERE } from "../src/safety/readers.js";

// A6: the 10 Nov message and paraphrases, three readers, strictest wins, never a false all-clear.

export const NOV10 = "Hi, hope you're well. Just a heads-up that we've moved banks this month, so please send this month's payment to our new PayPal: accounts.dept@outlook.com. Thanks so much!";
export const PARAPHRASES = [
  "We've moved banks, so please pay this invoice to our new PayPal account.",
  "Quick note: our bank details have changed. Please use this account instead.",
  "Our old account is being closed next week; send the payment to the new one below.",
  "Please update our payment details: the new IBAN is in the attached letter.",
  "We switched banks recently. The remittance should go to our updated account.",
  "Kindly note our new banking details for all future payments.",
  "From this month, please pay our new PayPal address rather than the old one.",
  "The beneficiary details have changed; please make the transfer to the account below.",
  "Our accounts team asks you to send payment to a different account this time.",
  "Heads up, we've changed our PayPal. New payments go to billing.team@gmail.com.",
  "We are moving to a new bank. Please hold off and pay to the updated details instead.",
  "Update: our bank account has been changed. Use the following account going forward.",
  "Please note the new account for remittance; the previous one is no longer active.",
  "Our payment details were updated yesterday, please use these for the deposit.",
  "We have a new PayPal now, send it there and not to the shop.",
  "The account we gave you before is being closed. Please use this account instead.",
  "Hello! Our bank changed. Pay the balance to the new account number 4400 1234 5678.",
  "Small change: payments now go to a different PayPal email, see below.",
  "We moved our business account, so the old bank details are out of date.",
  "As of today please send all payments to our updated IBAN.",
  "Apologies for the confusion, our remittance details have changed.",
  "Your next payment should go to our switched account; details attached.",
  "Can you pay to our new account this month? The old one is closed.",
  "Our banking details are being updated, kindly use this account instead.",
  "We have updated our payout account, please pay there.",
  "The new beneficiary for this order is our sister company; account below.",
  "We changed banks, so please don't use the account on the invoice.",
  "Our PayPal was switched to a new address; please pay the new one.",
  "The bank account on file is old; send this one to our different account.",
  "Please be aware our bank has moved. Pay the outstanding amount to the new details.",
];
export const GENUINE = [
  "Your parcel is on its way and will arrive on Tuesday.",
  "Thanks for your order! We'll email you when it ships.",
  "Please create a new account on our site to track your order.",
  "I updated the listing photos; the lamp is still available.",
  "Your return has been received and the refund is being processed by PayPal.",
];

describe("A6.3 the widened changed-details rule", () => {
  it("catches the 10 Nov message and 30 paraphrases", () => {
    expect(scanText(NOV10).fired).toContain("changed_details");
    const missed = PARAPHRASES.filter((t) => !scanText(t).fired.includes("changed_details"));
    expect(missed).toEqual([]);
    expect(PARAPHRASES).toHaveLength(30);
  });
  it("doesn't fire on ordinary shop messages", () => {
    expect(GENUINE.filter((t) => scanText(t).fired.includes("changed_details"))).toEqual([]);
  });
});

describe("A6.1 the code reader", () => {
  it("finds every pay-to detail and link", () => {
    const d = extractDestinations("Pay paypal.me/quickdeal or acct no 12345678 or bob@gmail.com, IBAN GB29 NWBK 6016 1331 9268 19, see https://bit.ly/x");
    expect(d.map((x) => x.kind).sort()).toEqual(["account", "account", "email", "link", "paypal"]);
    expect(d.find((x) => x.kind === "email")!.why).toMatch(/free-mail/);
  });
});

let db: Db;
const saved = { provider: config.ai.provider, key: config.ai.openaiKey };
/** A fake Decisions endpoint: each predicate answered from `p` (default 0.01). */
function fakeDecisions(p: Record<string, number | "refuse">, calls: any[] = []) {
  setProviderFetch((async (url: any, init: any) => {
    expect(String(url)).toMatch(/\/v1\/decisions$/);
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const answers = body.questions.map((q: any) => (p[q.name] === "refuse" ? { type: "refusal", name: q.name } : { type: "predicate", name: q.name, probability: p[q.name] ?? 0.01 }));
    return new Response(JSON.stringify({ model: "gpt-6-luna", answers, usage: { input_tokens: 400 } }), { status: 200 });
  }) as typeof fetch);
  return calls;
}
beforeEach(async () => {
  db = await openDb({ memory: true });
  setDb(db);
  config.ai.provider = "openai";
  config.ai.openaiKey = "test-key";
});
afterEach(async () => {
  setProviderFetch(null);
  Object.assign(config.ai, { provider: saved.provider, openaiKey: saved.key });
  await db.close();
});

describe("A5.2 the Decisions client", () => {
  it("sends every question in one request, logs the call, and maps refusals to not decided", async () => {
    const calls = fakeDecisions({ impersonation: 0.9, urgency_or_secrecy: "refuse" });
    const d = await decide("hello", SCAM_PREDICATES.map((p) => ({ type: "predicate" as const, name: p.name, instructions: p.instructions })), { purpose: "scam_check" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "gpt-6-luna", input: "hello" });
    expect(calls[0].questions).toHaveLength(SCAM_PREDICATES.length);
    expect(d.answers.impersonation.probability).toBe(0.9);
    expect(d.answers.urgency_or_secrecy.refused).toBe(true);
    expect(verdictOf(d.answers.urgency_or_secrecy, { clear_below: 0.3, hold_above: 0.6 })).toBe("not_decided");
    const row = (await db.query<any>("SELECT via, model, ok, purpose FROM ai_calls ORDER BY id DESC LIMIT 1")).rows[0];
    expect(row).toMatchObject({ via: "decisions", model: "gpt-6-luna", ok: true, purpose: "scam_check" });
  });
});

describe("A6.1/A6.2 three readers, never a false all-clear", () => {
  it("holds the 10 Nov message (rules, Decisions and the code all see it)", async () => {
    fakeDecisions({ changed_payment_details: 0.98, asks_for_payment: 0.99, names_a_payment_destination: 0.99 });
    const r = await readMessage(NOV10);
    expect(r.state).toBe("hold");
    expect(r.code.destinations.map((d) => d.value)).toContain("accounts.dept@outlook.com");
    expect(r.decisions.ran).toBe(true);
  });
  it("a polite message that only names where to pay is amber, never green", async () => {
    fakeDecisions({ asks_for_payment: 0.9, names_a_payment_destination: 0.8 });
    const r = await readMessage("Thanks for choosing us. The total for the lamp is due on Friday.");
    expect(r.state).toBe("pay_somewhere");
    expect(r.headline).toBe(PAY_SOMEWHERE);
  });
  it("green only when every reader is clear", async () => {
    fakeDecisions({});
    expect((await readMessage(GENUINE[0])).state).toBe("clear");
  });
  it("an unsure or refused answer is not green", async () => {
    fakeDecisions({ names_a_payment_destination: "refuse" });
    expect((await readMessage(GENUINE[0])).state).not.toBe("clear");
  });
  it("with no model key it says only part of the check ran, and is not green", async () => {
    config.ai.provider = "none";
    const r = await readMessage(GENUINE[0]);
    expect(r.state).toBe("unconfirmed");
    expect(r.decisions).toMatchObject({ ran: false, why_not: "No model key on this instance." });
  });
});
