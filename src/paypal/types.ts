export interface PPMoney {
  value: string;
  currency_code: string;
}

export interface PPCapture {
  id: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  amount: PPMoney;
  custom_id?: string;
  invoice_id?: string;
  seller_receivable_breakdown?: { gross_amount?: PPMoney; paypal_fee?: PPMoney; net_amount?: PPMoney };
}

export interface PPRefund {
  id: string;
  status: "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";
  amount?: PPMoney;
}

export interface PPOrder {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  purchase_units?: { reference_id?: string; custom_id?: string; invoice_id?: string; amount?: PPMoney; payee?: { email_address?: string; merchant_id?: string }; payments?: { captures?: PPCapture[]; refunds?: PPRefund[] } }[];
  links?: { href: string; rel: string; method?: string }[];
}

export interface PPSetupToken {
  id: string;
  status: string;
  approveUrl: string | null;
}

export interface PPDispute {
  dispute_id: string;
  status: string;
  reason?: string;
  dispute_amount?: PPMoney;
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string }[];
  dispute_life_cycle_stage?: string;
  seller_response_due_date?: string;
  create_time?: string;
  update_time?: string;
}
export interface PPTransaction {
  transaction_info: { transaction_id: string; transaction_status?: string; transaction_amount?: PPMoney; transaction_initiation_date?: string; transaction_event_code?: string; custom_field?: string; invoice_id?: string };
  payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string } };
}
export interface TrackingInput {
  captureId: string;
  carrier: string;
  trackingNumber: string;
  status?: "SHIPPED" | "ON_HOLD" | "DELIVERED" | "CANCELLED";
  items?: { name: string; sku: string; quantity: number }[];
}

export interface OrderInput {
  amountCents: number;
  currency: string;
  customId: string;
  description: string;
  invoiceId?: string;
  brand?: string;
  items?: { name: string; sku: string; quantity: number; unitCents: number }[];
  shippingCents?: number;
}

export interface PayPalApi {
  readonly env: "sandbox" | "live";
  verifyCredentials(): Promise<{ appId?: string; scopes: string[] }>;
  createSetupToken(input: { returnUrl: string; cancelUrl: string; description: string }, requestId: string): Promise<PPSetupToken>;
  createPaymentToken(setupTokenId: string, requestId: string): Promise<{ id: string; customerId?: string }>;
  /** Buyer-approved order (intent CAPTURE): returns the approval link. */
  createOrder(input: OrderInput & { returnUrl: string; cancelUrl: string }, requestId: string): Promise<{ id: string; status: string; approveUrl: string | null }>;
  /** Merchant-initiated charge on a vaulted PayPal token (intent CAPTURE). */
  createVaultedCaptureOrder(input: OrderInput & { vaultId: string }, requestId: string): Promise<PPOrder>;
  /** Reads a saved payment token back (Vault v3); throws a 404 PayPalError when it no longer exists. */
  getPaymentToken(id: string): Promise<{ id: string; customerId?: string; email?: string }>;
  getOrder(id: string): Promise<PPOrder>;
  captureOrder(id: string, requestId: string): Promise<PPOrder>;
  getCapture(id: string): Promise<PPCapture>;
  refundCapture(captureId: string, amountCents: number | null, currency: string, note: string, requestId: string): Promise<PPRefund>;
  getRefund(id: string): Promise<PPRefund>;
  createWebhook(url: string, eventTypes: string[]): Promise<{ id: string }>;
  listWebhooks(): Promise<{ id: string; url: string }[]>;
  verifyWebhookSignature(headers: Record<string, string | undefined>, body: unknown, webhookId: string): Promise<boolean>;
  /** Disputes API (E3): list, read, respond with evidence, or accept the claim. */
  listDisputes(opts?: { status?: string; transactionId?: string }): Promise<PPDispute[]>;
  getDispute(id: string): Promise<PPDispute>;
  provideDisputeEvidence(id: string, evidence: { notes: string; evidenceType?: string }, requestId: string): Promise<{ accepted: boolean }>;
  acceptDisputeClaim(id: string, note: string, requestId: string): Promise<{ accepted: boolean }>;
  /** Transaction Search (E5): what PayPal says moved, to reconcile against our ledger. */
  searchTransactions(opts: { startDate: Date; endDate: Date; transactionId?: string }): Promise<PPTransaction[]>;
  /** Order tracking (E3): shipment tracking attached to the PayPal order so the shopper sees it in PayPal too. */
  addTracking(orderId: string, input: TrackingInput, requestId: string): Promise<{ status: string }>;
  /** Sandbox negative testing: PayPal-Mock-Response on the next write only. */
  withMockResponse<T>(mock: { mock_application_codes: string }, fn: () => Promise<T>): Promise<T>;
}

export class PayPalError extends Error {
  constructor(message: string, readonly status: number, readonly name_: string | undefined, readonly debugId: string | undefined, readonly details: unknown) {
    super(message);
  }
  get isClientError() {
    return this.status >= 400 && this.status < 500;
  }
}

/** Network-level failure where the request may or may not have reached PayPal. */
export class UnknownOutcomeError extends Error {}

export const toValue = (cents: number) => (cents / 100).toFixed(2);
export const toCents = (m: PPMoney | undefined) => (m ? Math.round(Number(m.value) * 100) : 0);
export const firstCapture = (o: PPOrder) => o.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
