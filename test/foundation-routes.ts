/** Routes the foundation test walks. The acceptance journey skips exactly these and nothing else. */
export const FOUNDATION_ROUTES: Record<string, string> = Object.fromEntries(
  [
    "ALL /mcp", "ALL /merchant/mcp", "GET /api/v1/runs", "GET /api/v1/runs/:id", "GET /console/adversarial.md", "GET /console/capture.md", "GET /console/eval.csv", "GET /llms.txt", "GET /skill.md", "GET /console/techjam.md", "GET /guard/audit.json", "GET /guard/runs.json", "GET /manifest.webmanifest", "GET /merchant/approvals/audit.json", "GET /merchant/money/disputes/:id/evidence.json", "GET /merchant/money/transactions.json", "GET /passport.json", "GET /passport/vault/return", "GET /push/public-key", "GET /sw.js", "GET /webhooks/whatsapp",
    "POST /channels/link", "POST /connect/telegram", "POST /guard/approvals/:id/:choice(approve|decline)", "POST /merchant/approvals/:id/:choice(approve|decline)", "POST /channels/reply", "POST /console/eval", "POST /guard/adopt-rules", "POST /guard/approvals/:id/click", "POST /guard/backtest", "POST /guard/kill", "POST /guard/passkey/register/finish", "POST /guard/passkey/register/start", "POST /guard/passkey/sign/finish", "POST /guard/passkey/sign/start", "POST /guard/policy", "POST /guard/policy/:id/activate", "POST /guard/suggestions", "POST /merchant/approvals/:id/click", "POST /merchant/approvals/kill", "POST /merchant/approvals/passkey/register/finish", "POST /merchant/approvals/passkey/register/start", "POST /merchant/approvals/passkey/sign/finish", "POST /merchant/approvals/passkey/sign/start", "POST /merchant/approvals/policy", "POST /merchant/lines/:id/tracking", "POST /merchant/money/disputes/:id/accept", "POST /merchant/money/disputes/:id/evidence", "POST /merchant/money/disputes/sync", "POST /merchant/money/negative-test", "POST /passport/repeat", "POST /passport/vault", "POST /passport/vault/revoke", "POST /push/subscribe", "POST /webhooks/paypal", "POST /webhooks/telegram", "POST /webhooks/whatsapp",
  ].map((r) => [r, "walked in test/foundation.test.ts"]),
);
/** Routes another test file walks; the acceptance journey skips these too. */
export const ELSEWHERE: Record<string, string> = {};
/** A2.1: the demo's saved wallet and its operator page. */
Object.assign(
  ELSEWHERE,
  Object.fromEntries(
    ["GET /admin", "GET /admin/paypal/wallet", "GET /admin/paypal/wallet/return", "POST /admin/login", "POST /admin/logout", "POST /admin/paypal/wallet/:onoff(on|off)", "POST /admin/paypal/wallet/check", "POST /admin/paypal/wallet/setup", "POST /orders/:id/pay-demo", "POST /quotes/:id/approve-demo"].map((r) => [r, "walked in test/demowallet.test.ts (setup/return need PayPal's approval page)"]),
  ),
);
/** A1: the visitor's own demo workspace, its second-device link, and the operator's workspace page. */
Object.assign(
  ELSEWHERE,
  Object.fromEntries(
    ["POST /demo/start", "GET /demo/join/:token", "GET /api/ui/workspace", "GET /admin/demo", "POST /admin/demo/showcase", "POST /admin/demo/reset-all", "POST /admin/robot-judge"].map((r) => [r, "walked in test/workspaces.test.ts"]),
  ),
);
