# Everyday — audit

Date: 10 Nov 2026. Branch `redesign` (three commits on top of live `main` 6031071).
Scope: Everyday only. Live service `pph-everyday` on Render (free plan, Singapore), auto-deploys from `main`.

Legend: **Live** = configured on the Render service and seen working there. **Code + tests** = implemented and exercised by the test suite against the in-repo fake PayPal or fixtures. **Simulated** = a stand-in that is labelled as such in the product.

## 1. Integration matrix

| Integration | What Everyday uses it for | Code | Live config | Evidence | Status |
|---|---|---|---|---|---|
| PayPal Orders v2: create, approve, capture, read-back | Buying a quoted plan; the capture is read back from PayPal before the order shows as paid | `src/paypal/client.ts`, `services/orders.ts` | Client id/secret set, sandbox | Live order EV-4001, $41, capture `2H948761WE562284C` (10 Nov). Tests: lost capture response is repaired once; declined instrument leaves nothing charged | **Live** |
| PayPal Refunds (`/v2/payments/captures/:id/refund`, refund read-back) | Swap differences, partial refunds, price protection; one request id per case so a retry cannot pay twice | `services/orders.ts`, `services/protect.ts` | same | Tests: $20 + $15 + $10 refunds on one capture, `payment_ops.request_id = case:<id>`, double-claim refused | Code + tests; not yet shown live |
| PayPal Vault v3 (setup token → payment token) and vaulted capture | One-tap repeat buys under the shopper's mandate | `services/passport.ts` | same | Tests: save, revoke, repeat buy under threshold runs, above it waits for approval | Code + tests; not yet shown live |
| PayPal order tracking (`/orders/:id/track`) | Merchant attaches carrier and number | `services/passport.ts` | same | Tests | Code + tests |
| PayPal Disputes (list, get, evidence, accept claim) | Merchant money screen; acceptance goes through the merchant's refund mandate and kill switch | `services/passport.ts` | same | Tests; kill switch refuses before PayPal is called | Code + tests |
| PayPal Transaction Search (`/v1/reporting/transactions`) | Reconcile Everyday's ledger against PayPal | `services/passport.ts` | same | Tests; needs the Transaction Search scope on the app | Code + tests |
| PayPal webhooks (signature verification) | Capture/refund events, recorded once | `web/trace.ts` | `PAYPAL_WEBHOOK_ID` set | Tests: unsigned rejected, verified accepted once | Code + tests |
| OpenAI (reader models) | Reads screenshots, shared links and free-text requests into objects and needs, each with a quote; compiles plain-English mandates into rules. Never sets a price, a refund or a payee | `ai/*`, `guard/policy.ts` | `OPENAI_API_KEY`, `AI_PROVIDER` set | Live evidence page shows **0 model calls**: the model reader for free-text requests (204f38e) is on this branch, not yet on `main`. Locally there is no key, so readers fall back to rules | Code + tests; live use to be proven after deploy |
| YouTube / TikTok public cover (oEmbed) | A real shared link gets its real title and cover read | `services/captures.ts` | none needed | Fresh-data test: a real YouTube link came back as "Me at the zoo · jawed", not a fixture | **Live-capable**, verified locally |
| Channel3 product search | Search beyond the seeded catalog | `services/catalog.ts` | `CHANNEL3_API_KEY` set | Live evidence page says "Channel3 live" | **Live** |
| Telegram bot | Share a clip, answer the one question, approve with buttons | `channels/*`, `/c/telegram/webhook` | Bot token and webhook secret set; bot username falls back to a default | Tests drive the same webhook with Bot API JSON. The in-app simulator runs the same code | Code + tests; live chat not re-verified today |
| Web Push (VAPID) | Delivery, delay and refund alerts | `channels/push.ts`, `public/sw.js` | VAPID keys set | Tests: subscribe accepted | Code + tests |
| Passkeys (WebAuthn) | Countersign approvals above $200 | `guard/passkey.ts`, `web/src/lib/passkey.ts` | none needed | Tests: bad finishes refused | Code + tests; needs a real device to show |
| MCP (shopper and merchant agents) | Agents plan, quote and read traces; the shopper still approves on PayPal | `web/mcp.ts` | keys printed by seed | Tests: wrong key refused; merchant key lists orders | Code + tests |
| In-browser scam model (ONNX) and payment-risk model (LightGBM) | Second pair of eyes before money moves | `public/safety/*`, `safety/*` | none needed | Tests: demo scam held. Training notebooks (`guard-lab`) are not in this repo; the model card says so | Code + tests; provenance partly external |
| WhatsApp | — | webhook only | not set | Deferred; not shown in the product | Not used |

## 2. Hard-coding hunt

| Finding | Where | Severity | Status |
|---|---|---|---|
| One merchant is built in: `MERCHANT` constant, "Northlight" in event and flash text | `services/orders.ts`, `web/shopper.ts`, `services/life.ts` | P2 (scope, not a bug: the sandbox has one test merchant, labelled as such) | Open, documented |
| Demo clock and merchant price route read `SELECT * FROM accounts LIMIT 1` | `web/ops.ts`, `api.ts /api/ui/demo` | P2: with more than one shopper the clock shown is the first one's | Open |
| Demo clips have authored objects (`analysed_fixture`) | `services/captures.ts` | P3: labelled "demo clip"; real links are read for real | Open, labelled |
| Seeded purchase history on Passport | `services/passport.ts` | P3: labelled "seeded history" in the new UI, kept apart from live numbers | Labelled |
| Model card cited `guard-lab`, which is not in the repo | Safety model card | P2 honesty | Fixed: the card now says the notebooks live outside this repo |
| Fake PayPal client | `src/paypal/fake.ts` | — | Only reachable from tests; production always builds the real client |

## 3. Fresh-data test (not seed data)

- "A quiet mouse under $45 by Thursday": the $35 Silent Mouse is correctly ruled out because it comes to $47 with shipping. The reason is shown ("Ruled out by code").
- "a quiet mouse under $60": plans normally, with the code's pick and alternatives.
- A real YouTube link (not a demo clip) is read from its public cover; the title is the real one.

## 4. Checks

| Check | Result |
|---|---|
| `npm run typecheck` (server and web) | Pass |
| `npm test` | 63 tests in 10 files, all pass (59 existing, converted where they asserted old HTML, plus 4 new token-contrast tests) |
| `npm run build` (server, clean `web` install, Vite) | Pass; main bundle 329 KB (102 KB gzip), pages split per route |
| Route coverage | The acceptance journey reaches every route, including every new screen and `/api/ui/*` endpoint, with no 5xx |
| 360 px | No horizontal scroll on any screen (landing, login, 19 shopper/console screens, 5 merchant screens). Wide tables and the timeline scroll inside their own card |
| Target size | Standalone links and controls ≥ 44 px; inline links inside sentences use the WCAG inline exception |
| Colour contrast | `test/tokens.test.ts`: text ≥ 4.5:1 on every surface and every money state on its tint, light and dark |

## 5. Findings and fixes

P0 = wrong money, data exposure or a broken core screen. All P0s are fixed on this branch.

| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | P0 | Any signed-in party could read and reply to any conversation through the channel simulator, outside demo mode too | Simulator access only in demo mode (or the operator); otherwise a party sees and replies only as itself. `/channels/reply` returns 403 for another address |
| 2 | P0 | Order screen data endpoint asked for a column `events` doesn't have: every order screen failed (found by the new journey) | Read `type` as the event kind |
| 3 | P1 | Landing preview and order timeline read `order_lines.created_at`, which doesn't exist | Use the order's creation time |
| 4 | P1 | With no front-end build, the server silently served nothing useful | Page URLs answer 503 with the fix (`npm run build`) |
| 5 | P1 | Live merchant kill switch is engaged (left from a drill), so merchant refunds are refused on the live demo | Release after deploy (this app's service and schema only) |
| 6 | P2 | Old server-rendered pages still reachable alongside the new app | Removed: 26 page handlers, the HTML layout/shell/icons, old browser scripts and stylesheets. All POST routes kept |
| 7 | P2 | Console model table scrolled sideways at 360 px; some standalone links were 20 px tall | Fixed |

## 6. Still simulated or unproven

- Refunds, Vault repeat buys, tracking, disputes and transaction search are proven against the fake in tests but not yet with sandbox ids on the live service.
- OpenAI reads: configured live, zero recorded calls so far.
- Passkey countersign needs a real device to demonstrate.
- WhatsApp is not used.
