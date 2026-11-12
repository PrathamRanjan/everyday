import { paypalBaseUrl } from "../config.js";
import { currentLang, LANGS } from "../i18n/index.js";
// B7: PayPal's own page opens in the shopper's language (BCP 47; Hindi has no PayPal page, so English (India)).
import { OrderInput, PayPalApi, PayPalError, PPCapture, PPDispute, PPOrder, PPRefund, PPSetupToken, PPTransaction, toValue, TrackingInput, UnknownOutcomeError } from "./types.js";

type Json = Record<string, any>;

/** Typed PayPal REST client. Writes carry PayPal-Request-Id so a retry with the same id cannot apply twice. */
export class PayPalClient implements PayPalApi {
  private token: { value: string; expiresAt: number; scopes: string[]; appId?: string } | null = null;
  readonly env: "sandbox" | "live";

  constructor(private readonly creds: { clientId: string; clientSecret: string; env: "sandbox" | "live" }, private readonly fetchImpl: typeof fetch = (i, init) => fetch(i, init)) {
    this.env = creds.env;
  }

  private get base() {
    return paypalBaseUrl(this.env);
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const res = await this.fetchImpl(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) throw new PayPalError(String(data.error_description ?? "PayPal authentication failed"), res.status, String(data.error ?? ""), undefined, data);
    this.token = { value: String(data.access_token), expiresAt: Date.now() + Number(data.expires_in ?? 3000) * 1000, scopes: String(data.scope ?? "").split(" ").filter(Boolean), appId: data.app_id };
    return this.token.value;
  }

  private pendingMock: string | null = null;
  async withMockResponse<T>(mock: { mock_application_codes: string }, fn: () => Promise<T>): Promise<T> {
    this.pendingMock = JSON.stringify(mock);
    try {
      return await fn();
    } finally {
      this.pendingMock = null;
    }
  }

  private async call<T = Json>(method: string, path: string, body?: unknown, opts: { requestId?: string; prefer?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json", Accept: "application/json" };
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (this.pendingMock && method !== "GET") {
      headers["PayPal-Mock-Response"] = this.pendingMock;
      this.pendingMock = null;
    }
    if (opts.prefer) headers["Prefer"] = opts.prefer;
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        last = new UnknownOutcomeError(`Network error calling PayPal ${method} ${path}: ${(e as Error).message}`);
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue; // same PayPal-Request-Id: safe
        }
        throw last;
      }
      const text = await res.text();
      const data = (text ? JSON.parse(text) : {}) as any;
      if (res.status >= 500 && attempt < 2) {
        last = new PayPalError(data.message ?? `PayPal ${res.status}`, res.status, data.name, data.debug_id, data.details);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      // PayPal still working on this request id ("request in progress") or rate limiting: the outcome is
      // unknown, never a refusal. Wait and resend the same request id; if it persists, report it as unknown.
      if (res.status === 429 || /PREVIOUS_REQUEST_IN_PROGRESS/.test(`${data.name ?? ""} ${JSON.stringify(data.details ?? "")}`)) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          continue;
        }
        throw new UnknownOutcomeError(`PayPal is still processing ${method} ${path} (outcome unknown; retry with the same request id)`);
      }
      if (!res.ok) {
        const d = Array.isArray(data.details) && data.details[0] ? `: ${data.details[0].issue ?? ""} ${data.details[0].description ?? ""}`.trim() : "";
        throw new PayPalError(`${data.message ?? data.name ?? `PayPal ${res.status}`}${d}`, res.status, data.name ?? data.details?.[0]?.issue, data.debug_id, data.details);
      }
      return data as T;
    }
    throw last;
  }

  async verifyCredentials() {
    await this.accessToken();
    return { appId: this.token?.appId, scopes: this.token?.scopes ?? [] };
  }

  async createSetupToken(input: { returnUrl: string; cancelUrl: string; description: string }, requestId: string): Promise<PPSetupToken> {
    const d = await this.call<Json>(
      "POST",
      "/v3/vault/setup-tokens",
      {
        payment_source: {
          paypal: {
            description: input.description.slice(0, 127),
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
            permit_multiple_payment_tokens: true,
            experience_context: { brand_name: "Everyday", return_url: input.returnUrl, cancel_url: input.cancelUrl, shipping_preference: "NO_SHIPPING", vault_instruction: "ON_PAYER_APPROVAL" },
          },
        },
      },
      { requestId },
    );
    return { id: d.id, status: d.status, approveUrl: d.links?.find((l: Json) => l.rel === "approve")?.href ?? null };
  }

  async createPaymentToken(setupTokenId: string, requestId: string) {
    const d = await this.call<Json>("POST", "/v3/vault/payment-tokens", { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } }, { requestId });
    return { id: String(d.id), customerId: d.customer?.id };
  }

  async createOrder(input: OrderInput & { returnUrl: string; cancelUrl: string }, requestId: string) {
    const d = await this.call<PPOrder>(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.customId,
            custom_id: input.customId,
            invoice_id: input.invoiceId,
            description: input.description.slice(0, 127),
            amount: input.items?.length
              ? { currency_code: input.currency, value: toValue(input.amountCents), breakdown: { item_total: { currency_code: input.currency, value: toValue(input.items.reduce((a, i) => a + i.unitCents * i.quantity, 0)) }, shipping: { currency_code: input.currency, value: toValue(input.shippingCents ?? 0) } } }
              : { currency_code: input.currency, value: toValue(input.amountCents) },
            items: input.items?.map((i) => ({ name: i.name.slice(0, 127), sku: i.sku.slice(0, 127), quantity: String(i.quantity), unit_amount: { currency_code: input.currency, value: toValue(i.unitCents) }, category: "PHYSICAL_GOODS" })),
          },
        ],
        payment_source: { paypal: { experience_context: { brand_name: (input.brand ?? "Everyday").slice(0, 127), locale: LANGS[currentLang()].paypal, user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: input.returnUrl, cancel_url: input.cancelUrl } } },
      },
      { requestId, prefer: "return=representation" },
    );
    const approve = d.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
    return { id: d.id, status: d.status, approveUrl: approve };
  }

  async createVaultedCaptureOrder(input: OrderInput & { vaultId: string }, requestId: string) {
    return this.call<PPOrder>(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.customId.slice(0, 256),
            custom_id: input.customId.slice(0, 127),
            invoice_id: input.invoiceId,
            description: input.description.slice(0, 127),
            amount: input.items?.length
              ? { currency_code: input.currency, value: toValue(input.amountCents), breakdown: { item_total: { currency_code: input.currency, value: toValue(input.items.reduce((a, i) => a + i.unitCents * i.quantity, 0)) }, shipping: { currency_code: input.currency, value: toValue(input.shippingCents ?? 0) } } }
              : { currency_code: input.currency, value: toValue(input.amountCents) },
            items: input.items?.map((i) => ({ name: i.name.slice(0, 127), sku: i.sku.slice(0, 127), quantity: String(i.quantity), unit_amount: { currency_code: input.currency, value: toValue(i.unitCents) }, category: "PHYSICAL_GOODS" })),
          },
        ],
        payment_source: { paypal: { vault_id: input.vaultId } },
      },
      { requestId, prefer: "return=representation" },
    );
  }

  async getPaymentToken(id: string) {
    const d = await this.call<Json>("GET", `/v3/vault/payment-tokens/${encodeURIComponent(id)}`);
    return { id: String(d.id), customerId: d.customer?.id, email: d.payment_source?.paypal?.email_address };
  }

  async getOrder(id: string) {
    return this.call<PPOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`);
  }

  async captureOrder(id: string, requestId: string) {
    return this.call<PPOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { requestId, prefer: "return=representation" });
  }

  async getCapture(id: string) {
    return this.call<PPCapture>("GET", `/v2/payments/captures/${encodeURIComponent(id)}`);
  }

  async refundCapture(captureId: string, amountCents: number | null, currency: string, note: string, requestId: string) {
    const body: Json = { note_to_payer: note.slice(0, 255) };
    if (amountCents !== null) body.amount = { value: toValue(amountCents), currency_code: currency };
    return this.call<PPRefund>("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, body, { requestId, prefer: "return=representation" });
  }

  async getRefund(id: string) {
    return this.call<PPRefund>("GET", `/v2/payments/refunds/${encodeURIComponent(id)}`);
  }

  async createWebhook(url: string, eventTypes: string[]) {
    const d = await this.call<{ id: string }>("POST", "/v1/notifications/webhooks", { url, event_types: eventTypes.map((name) => ({ name })) });
    return { id: d.id };
  }

  async listWebhooks() {
    const d = await this.call<{ webhooks: { id: string; url: string }[] }>("GET", "/v1/notifications/webhooks");
    return d.webhooks ?? [];
  }

  async verifyWebhookSignature(headers: Record<string, string | undefined>, body: unknown, webhookId: string) {
    const d = await this.call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: body,
    });
    return d.verification_status === "SUCCESS";
  }

  async listDisputes(opts: { status?: string; transactionId?: string } = {}): Promise<PPDispute[]> {
    const qs = new URLSearchParams();
    if (opts.status) qs.set("dispute_state", opts.status);
    if (opts.transactionId) qs.set("disputed_transaction_id", opts.transactionId);
    qs.set("page_size", "50");
    const d = await this.call<Json>("GET", `/v1/customer/disputes?${qs}`);
    return (d.items ?? []) as PPDispute[];
  }

  async getDispute(id: string): Promise<PPDispute> {
    return this.call<PPDispute>("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`);
  }

  async provideDisputeEvidence(id: string, evidence: { notes: string; evidenceType?: string }, requestId: string) {
    await this.call<Json>("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/provide-evidence`, { evidences: [{ evidence_type: evidence.evidenceType ?? "OTHER", notes: evidence.notes.slice(0, 2000) }] }, { requestId });
    return { accepted: true };
  }

  async acceptDisputeClaim(id: string, note: string, requestId: string) {
    await this.call<Json>("POST", `/v1/customer/disputes/${encodeURIComponent(id)}/accept-claim`, { note: note.slice(0, 2000), accept_claim_type: "REFUND" }, { requestId });
    return { accepted: true };
  }

  async searchTransactions(opts: { startDate: Date; endDate: Date; transactionId?: string }): Promise<PPTransaction[]> {
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
    const qs = new URLSearchParams({ start_date: iso(opts.startDate), end_date: iso(opts.endDate), fields: "transaction_info,payer_info", page_size: "100" });
    if (opts.transactionId) qs.set("transaction_id", opts.transactionId);
    const d = await this.call<Json>("GET", `/v1/reporting/transactions?${qs}`);
    return (d.transaction_details ?? []) as PPTransaction[];
  }

  async addTracking(orderId: string, input: TrackingInput, requestId: string) {
    await this.call<Json>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/track`, { capture_id: input.captureId, carrier: input.carrier, tracking_number: input.trackingNumber, status: input.status ?? "SHIPPED", notify_payer: true, items: input.items }, { requestId });
    return { status: input.status ?? "SHIPPED" };
  }
}

export const WEBHOOK_EVENTS = ["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED", "PAYMENT.REFUND.PENDING", "PAYMENT.REFUND.FAILED"];