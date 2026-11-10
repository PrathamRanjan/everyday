import { randomBytes } from "node:crypto";
import { OrderInput, PayPalApi, PayPalError, PPCapture, PPDispute, PPOrder, PPRefund, PPTransaction, toValue, TrackingInput, UnknownOutcomeError } from "./types.js";

const rid = (p: string) => `${p}${randomBytes(6).toString("hex").toUpperCase()}`;

type FakeOrder = PPOrder & { cents: number; currency: string; customId: string; vault?: string };
type FakeCapture = PPCapture & { refundedCents: number; cents: number };

/** In-memory PayPal: orders (buyer-approved and vaulted), captures, partial refunds. Idempotent on PayPal-Request-Id. */
export class FakePayPal implements PayPalApi {
  readonly env = "sandbox" as const;
  orders = new Map<string, FakeOrder>();
  captures = new Map<string, FakeCapture>();
  /** The next capture comes back with this status (e.g. PENDING); change it later with setCaptureStatus. */
  nextCaptureStatus: string | null = null;
  setCaptureStatus(id: string, status: string) {
    const c = this.captures.get(id);
    if (c) c.status = status as FakeCapture["status"];
  }
  refunds = new Map<string, PPRefund & { captureId: string }>();
  bodies: { method: string; body: unknown }[] = [];
  tokens = new Set<string>();
  setupApproved = new Set<string>();
  calls: string[] = [];
  private idem = new Map<string, unknown>();
  private fail = new Map<string, Error>();
  private lose = new Set<string>();
  /** When set, refunds come back PENDING until settleRefunds(). */
  refundsPending = false;
  disputes = new Map<string, PPDispute & { evidence: unknown[] }>();
  trackers: { orderId: string; input: TrackingInput }[] = [];
  private mock: string | null = null;

  /** Opens a sandbox-style dispute against a capture (tests and the console use this). */
  openDispute(captureId: string, reason = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"): PPDispute {
    const cap = this.captures.get(captureId);
    const d: PPDispute & { evidence: unknown[] } = {
      dispute_id: rid("PP-D-"),
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason,
      dispute_amount: cap?.amount,
      disputed_transactions: [{ seller_transaction_id: captureId }],
      dispute_life_cycle_stage: "INQUIRY",
      seller_response_due_date: new Date(Date.now() + 7 * 86400_000).toISOString(),
      create_time: new Date().toISOString(),
      evidence: [],
    };
    this.disputes.set(d.dispute_id, d);
    return d;
  }

  async withMockResponse<T>(mock: { mock_application_codes: string }, fn: () => Promise<T>): Promise<T> {
    this.mock = mock.mock_application_codes;
    try {
      return await fn();
    } finally {
      this.mock = null;
    }
  }

  /** Simulates the sandbox mock codes used in negative tests, on the next write only. */
  private consumeMock(method: string) {
    const m = this.mock;
    if (!m) return;
    this.mock = null;
    if (["INSTRUMENT_DECLINED", "INSUFFICIENT_FUNDS", "TRANSACTION_REFUSED", "PAYER_CANNOT_PAY", "DUPLICATE_INVOICE_ID"].includes(m)) throw new PayPalError(`Simulated ${m} on ${method}`, 422, m, "fake-mock-" + m.toLowerCase(), [{ issue: m }]);
    if (m === "INTERNAL_SERVER_ERROR") throw new PayPalError("Simulated 500", 500, "INTERNAL_SERVER_ERROR", "fake-mock-500", null);
  }

  async listDisputes(opts: { status?: string; transactionId?: string } = {}): Promise<PPDispute[]> {
    return this.run("listDisputes", null, () => [...this.disputes.values()].filter((d) => (!opts.status || d.status === opts.status) && (!opts.transactionId || d.disputed_transactions?.some((t) => t.seller_transaction_id === opts.transactionId))));
  }
  async getDispute(id: string): Promise<PPDispute> {
    return this.run("getDispute", null, () => this.disputes.get(id) ?? this.notFound("Dispute"));
  }
  async provideDisputeEvidence(id: string, evidence: { notes: string; evidenceType?: string }, requestId: string) {
    return this.run("provideDisputeEvidence", requestId, () => {
      const d = this.disputes.get(id) ?? this.notFound("Dispute");
      if (d.status !== "WAITING_FOR_SELLER_RESPONSE") throw new PayPalError("Evidence only accepted while WAITING_FOR_SELLER_RESPONSE", 422, "UNPROCESSABLE_ENTITY", "fake", null);
      d.evidence.push(evidence);
      d.status = "UNDER_REVIEW";
      d.update_time = new Date().toISOString();
      return { accepted: true };
    });
  }
  async acceptDisputeClaim(id: string, _note: string, requestId: string) {
    return this.run("acceptDisputeClaim", requestId, () => {
      const d = this.disputes.get(id) ?? this.notFound("Dispute");
      d.status = "RESOLVED";
      return { accepted: true };
    });
  }
  async searchTransactions(opts: { startDate: Date; endDate: Date; transactionId?: string }): Promise<PPTransaction[]> {
    return this.run("searchTransactions", null, () => {
      const out: PPTransaction[] = [];
      for (const c of this.captures.values()) {
        if (opts.transactionId && c.id !== opts.transactionId) continue;
        out.push({ transaction_info: { transaction_id: c.id, transaction_status: c.status === "COMPLETED" ? "S" : "P", transaction_amount: c.amount, transaction_initiation_date: new Date().toISOString(), transaction_event_code: "T0006", invoice_id: c.invoice_id, custom_field: c.custom_id } });
      }
      for (const r of this.refunds.values()) out.push({ transaction_info: { transaction_id: r.id, transaction_status: "S", transaction_amount: { currency_code: r.amount?.currency_code ?? "USD", value: "-" + (r.amount?.value ?? "0") }, transaction_event_code: "T1107" } });
      return out;
    });
  }
  async addTracking(orderId: string, input: TrackingInput, requestId: string) {
    this.consumeMock("addTracking");
    return this.run("addTracking", requestId, () => {
      if (!this.orders.has(orderId)) this.notFound("Order");
      if (!this.captures.has(input.captureId)) this.notFound("Capture");
      this.trackers.push({ orderId, input });
      return { status: input.status ?? "SHIPPED" };
    });
  }

  constructor(private readonly approveBase = "http://fake.paypal.local") {}

  /** The next call to `method` fails without doing anything. */
  failNext(method: string, err: Error = new PayPalError("Service unavailable", 503, "SERVICE_UNAVAILABLE", "fake", null)) {
    this.fail.set(method, err);
  }
  /** The next call to `method` succeeds at "PayPal" but the response is lost. */
  loseResponseNext(method: string) {
    this.lose.add(method);
  }
  approveOrder(id: string) {
    const o = this.orders.get(id);
    if (!o) throw new Error("no order");
    o.status = "APPROVED";
  }
  approveSetup(id: string) {
    this.setupApproved.add(id);
  }
  settleRefunds() {
    for (const r of this.refunds.values()) if (r.status === "PENDING") r.status = "COMPLETED";
  }
  refundsFor(captureId: string) {
    return [...this.refunds.values()].filter((r) => r.captureId === captureId);
  }

  private async run<T>(method: string, requestId: string | null, fn: () => T): Promise<T> {
    this.calls.push(method);
    const f = this.fail.get(method);
    if (f) {
      this.fail.delete(method);
      throw f;
    }
    let out: T;
    if (requestId && this.idem.has(requestId)) out = this.idem.get(requestId) as T;
    else {
      out = fn();
      if (requestId) this.idem.set(requestId, out);
    }
    if (this.lose.has(method)) {
      this.lose.delete(method);
      throw new UnknownOutcomeError(`Simulated lost response for ${method}`);
    }
    return JSON.parse(JSON.stringify(out));
  }

  private notFound(what: string): never {
    throw new PayPalError(`${what} not found`, 404, "RESOURCE_NOT_FOUND", "fake", null);
  }

  private newCapture(o: FakeOrder): FakeCapture {
    const fee = Math.round(o.cents * 0.039) + 30;
    const c: FakeCapture = { id: rid("CA"), status: (this.nextCaptureStatus ?? "COMPLETED") as FakeCapture["status"], amount: { value: toValue(o.cents), currency_code: o.currency }, custom_id: o.customId, refundedCents: 0, cents: o.cents, seller_receivable_breakdown: { gross_amount: { value: toValue(o.cents), currency_code: o.currency }, paypal_fee: { value: toValue(fee), currency_code: o.currency }, net_amount: { value: toValue(o.cents - fee), currency_code: o.currency } } };
    this.captures.set(c.id, c);
    o.status = "COMPLETED";
    o.purchase_units = [{ reference_id: o.customId, custom_id: o.customId, amount: c.amount, payments: { captures: [{ id: c.id, status: c.status, amount: c.amount, custom_id: c.custom_id }] } }];
    return c;
  }

  async verifyCredentials() {
    return this.run("verifyCredentials", null, () => ({ appId: "FAKE", scopes: ["vault", "payments"] }));
  }

  async createSetupToken(input: { returnUrl: string }, requestId: string) {
    return this.run("createSetupToken", requestId, () => {
      const id = rid("ST");
      return { id, status: "PAYER_ACTION_REQUIRED", approveUrl: `${this.approveBase}/vault?token=${id}&return=${encodeURIComponent(input.returnUrl)}` };
    });
  }

  async createPaymentToken(setupTokenId: string, requestId: string) {
    return this.run("createPaymentToken", requestId, () => {
      if (!this.setupApproved.has(setupTokenId)) throw new PayPalError("Setup token not approved", 422, "UNPROCESSABLE_ENTITY", "fake", null);
      const id = rid("PT");
      this.tokens.add(id);
      return { id, customerId: rid("CUS") };
    });
  }

  async createOrder(input: OrderInput & { returnUrl: string }, requestId: string) {
    this.consumeMock("createOrder");
    this.bodies.push({ method: "createOrder", body: input });
    return this.run("createOrder", requestId, () => {
      const id = rid("OR");
      this.orders.set(id, { id, status: "PAYER_ACTION_REQUIRED", cents: input.amountCents, currency: input.currency, customId: input.customId, purchase_units: [{ custom_id: input.customId, amount: { value: toValue(input.amountCents), currency_code: input.currency } }] });
      return { id, status: "PAYER_ACTION_REQUIRED", approveUrl: `${this.approveBase}/checkout?token=${id}&return=${encodeURIComponent(input.returnUrl)}` };
    });
  }

  async createVaultedCaptureOrder(input: OrderInput & { vaultId: string }, requestId: string) {
    this.consumeMock("createVaultedCaptureOrder");
    return this.run("createVaultedCaptureOrder", requestId, () => {
      if (!this.tokens.has(input.vaultId)) throw new PayPalError("Payment token not found", 422, "UNPROCESSABLE_ENTITY", "fake", null);
      const id = rid("OR");
      const o: FakeOrder = { id, status: "CREATED", cents: input.amountCents, currency: input.currency, customId: input.customId, vault: input.vaultId };
      this.orders.set(id, o);
      this.newCapture(o);
      return { id: o.id, status: o.status, purchase_units: o.purchase_units } as PPOrder;
    });
  }

  async getPaymentToken(id: string) {
    return this.run("getPaymentToken", null, () => {
      if (!this.tokens.has(id)) throw new PayPalError("The specified resource does not exist.", 404, "RESOURCE_NOT_FOUND", "fake", null);
      return { id, customerId: "fake-customer", email: "buyer@example.test" };
    });
  }

  async getOrder(id: string) {
    return this.run("getOrder", null, () => {
      const o = this.orders.get(id) ?? this.notFound("Order");
      return { id: o.id, status: o.status, purchase_units: o.purchase_units } as PPOrder;
    });
  }

  async captureOrder(id: string, requestId: string) {
    this.consumeMock("captureOrder");
    return this.run("captureOrder", requestId, () => {
      const o = this.orders.get(id) ?? this.notFound("Order");
      if (o.status === "COMPLETED") throw new PayPalError("Order already captured", 422, "ORDER_ALREADY_CAPTURED", "fake", null);
      if (o.status !== "APPROVED") throw new PayPalError("Payer has not approved the order", 422, "ORDER_NOT_APPROVED", "fake", null);
      this.newCapture(o);
      return { id: o.id, status: o.status, purchase_units: o.purchase_units } as PPOrder;
    });
  }

  async getCapture(id: string) {
    return this.run("getCapture", null, () => {
      const c = this.captures.get(id) ?? this.notFound("Capture");
      return { id: c.id, status: c.status, amount: c.amount, custom_id: c.custom_id, seller_receivable_breakdown: c.seller_receivable_breakdown };
    });
  }

  async refundCapture(captureId: string, amountCents: number | null, currency: string, _note: string, requestId: string) {
    this.consumeMock("refundCapture");
    this.bodies.push({ method: "refundCapture", body: { captureId, amountCents } });
    return this.run("refundCapture", requestId, () => {
      const c = this.captures.get(captureId) ?? this.notFound("Capture");
      const left = c.cents - c.refundedCents;
      const amt = amountCents ?? left;
      if (amt <= 0 || amt > left) throw new PayPalError("Refund amount exceeds the remaining capture", 422, "REFUND_AMOUNT_EXCEEDED", "fake", null);
      c.refundedCents += amt;
      c.status = c.refundedCents >= c.cents ? "REFUNDED" : "PARTIALLY_REFUNDED";
      const r = { id: rid("RF"), status: (this.refundsPending ? "PENDING" : "COMPLETED") as PPRefund["status"], amount: { value: toValue(amt), currency_code: currency }, captureId };
      this.refunds.set(r.id, r);
      return { id: r.id, status: r.status, amount: r.amount };
    });
  }

  async getRefund(id: string) {
    return this.run("getRefund", null, () => {
      const r = this.refunds.get(id) ?? this.notFound("Refund");
      return { id: r.id, status: r.status, amount: r.amount };
    });
  }

  async createWebhook(url: string) {
    return { id: `WH-FAKE-${url.length}` };
  }
  async listWebhooks() {
    return [];
  }
  async verifyWebhookSignature(headers: Record<string, string | undefined>) {
    return headers["paypal-transmission-sig"] === "valid-fake-signature";
  }
}
