---
name: everyday
description: Shop for a person through Everyday over MCP inside the mandate they set, or read a merchant's orders, cases, approvals and disputes as the merchant's agent. The shopper approves every purchase on PayPal; repeat buys run only inside the mandate.
---

# Everyday skill

Stateless Streamable HTTP (POST) at `{APP_URL}`. Send `X-Agent-Id` so the person can see which agent acted. Keys are shown on `/demo` in demo mode.

## Shopper's agent: `{APP_URL}/mcp`, `Authorization: Bearer <evk_ shopper key>`
1. `my_constraints`: the mandate (limits the shopper set), what they already own, this month's spending.
2. `plan_for` with a need in plain words; it may return questions. Answer by calling `plan_for` again with the answer and the `intent_id`.
3. `quote` freezes prices for 15 minutes and returns a hash.
4. `approve_purchase` with the quote and hash returns a PayPal approval link. The shopper approves on PayPal; this tool never charges.
5. `repeat_buy` charges the saved PayPal only inside the mandate; above the threshold it waits for the shopper, and a blocked category is denied before PayPal.
6. `passport` (labelled purchase history and live orders), `get_trace` (runs on an intent, order or repeat buy).

## Merchant's agent (read-only): `{APP_URL}/merchant/mcp`, `Authorization: Bearer <nlk_ merchant key>`
`list_orders`, `get_order`, `list_cases`, `list_approvals`, `list_disputes`, `get_performance`, `get_trace`. Nothing on this endpoint ships, refunds or decides a case; those stay with the merchant's own screens and the gate.

## Rules the server enforces
- Amounts come from the catalog and quotes, never from text; a quote hash must match before approval.
- Every money move is dry-run against kill switches, the mandate, the monthly limit, the merchant's refund ceiling and live PayPal state.
- Held moves wait for a click or passkey on a linked channel; a kill switch stops every agent; the audit log is a hash chain.

Runs API: `{APP_URL}/api/v1/runs` (Bearer key). Evidence: `{APP_URL}/console/evidence`, `{APP_URL}/judge`.
