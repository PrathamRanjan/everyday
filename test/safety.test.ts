import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, setDb, type Db } from "../src/db.js";
import { FakePayPal } from "../src/paypal/fake.js";
import { setPayPal } from "../src/paypal/index.js";
import { assessMessage, assessPurchase, setProtectedMode } from "../src/safety/index.js";
import { loadRiskModel, riskScore } from "../src/safety/risk.js";
import { payeeRules, scanText } from "../src/safety/rules.js";
import { seedAll, type Seeded } from "../src/services/seed.js";
import { DEMO_SCAM } from "../src/web/safety.js";

// The safety layer for a shopper (SAFETY_ACCESSIBILITY_SPEC §4, §6 Everyday row): a seller message that moves the
// payment off platform is a hold; the first payment to a web-found seller is a caution that protected mode turns
// into a hold; an amount above the shopper's own history is a caution, never a hold, because the shopper approves
// every checkout on PayPal anyway.
describe("messages", () => {
  it("the demo marketplace message fires off-platform, gift card, fee and overpayment tactics and holds", () => {
    const s = scanText(DEMO_SCAM);
    expect(s.fired).toEqual(expect.arrayContaining(["off_platform", "gift_cards_crypto", "overpay_refund"]));
    const m = assessMessage(DEMO_SCAM);
    expect(m.level).toBe("hold");
    expect(m.words.length).toBeGreaterThan(1);
  });
  it("an ordinary seller reply is clear", () => {
    const m = assessMessage("Thanks for your order! The lamp ships Tuesday and you'll get tracking from PayPal. Let me know if you need anything.");
    expect(m.level).toBe("clear");
  });
  it("the risk model is monotone in the scam features", () => {
    expect(loadRiskModel().features).toContain("t_off_platform");
    const clean = payeeRules({ payeeAgeDays: null, detailsChangedDaysAgo: null, detailsChangeSource: null, amountCents: 4500, historyMedianCents: 4000, velocity10m: 0, velocity24hSumRatio: 1, requestChannelUntrusted: false, hourLocal: 12 }).features;
    const p0 = riskScore(clean);
    expect(riskScore({ ...clean, payee_age_days: 0, request_channel_untrusted: 1, t_off_platform: 1, t_urgency_secrecy: 1 })).toBeGreaterThan(p0);
  });
});

describe("purchases", () => {
  let db: Db;
  let s: Seeded;
  beforeEach(async () => {
    db = await openDb({ memory: true });
    setDb(db);
    setPayPal(new FakePayPal());
    s = await seedAll({ anchor: "2026-11-09T09:00" });
  });
  afterEach(async () => {
    setPayPal(null);
    await db.close();
  });
  const discovery = async () => (await db.query<any>("SELECT id, name FROM merchants WHERE kind = 'discovery' ORDER BY name LIMIT 1")).rows[0];

  it("the first small payment to the test merchant is a caution with a plain reason, not a hold", async () => {
    const a = await assessPurchase(s.account, s.merchant, 4500, db);
    expect(a.level).toBe("caution");
    expect(a.reasons[0]).toMatch(/First payment to/);
  });
  it("a first payment of $200 or more to a seller found on the web holds; a small one is a caution", async () => {
    const d = await discovery();
    expect((await assessPurchase(s.account, d.id, 24900, db)).level).toBe("hold");
    const small = await assessPurchase(s.account, d.id, 2900, db);
    expect(small.level).toBe("caution");
    expect(small.reasons[0]).toMatch(/found on the open web/);
  });
  it("protected mode turns the first payment to any new seller into a hold", async () => {
    await setProtectedMode(s.account, true, ["telegram:1"], db);
    const a = await assessPurchase(s.account, s.merchant, 1500, db);
    expect(a.level).toBe("hold");
    expect(a.rule).toBe("protected_first_payment");
    await setProtectedMode(s.account, false, [], db);
    expect((await assessPurchase(s.account, s.merchant, 1500, db)).level).toBe("caution");
  });
});
