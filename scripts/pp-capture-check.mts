import { PayPalClient } from "../src/paypal/client.ts";
import { config } from "../src/config.ts";
const pp = new PayPalClient({ clientId: config.paypal.clientId, clientSecret: config.paypal.clientSecret, env: config.paypal.env });
const [orderId] = process.argv.slice(2);
try {
  const r: any = await pp.captureOrder(orderId, `capture:${orderId}`);
  console.log("captured", r.status, r.purchase_units?.[0]?.payments?.captures?.[0]?.id);
} catch (e: any) {
  console.log("error", e.status, e.name_, e.message, JSON.stringify(e.details ?? e.body ?? "").slice(0, 600));
}
