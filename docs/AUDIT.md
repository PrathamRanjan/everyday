# Everyday — audit

Date: 10 Nov 2026. Branch `redesign`, fast-forwarded into `main` at a763328 and deployed (Render deploy live 02:06 UTC).
Scope: Everyday only. Live service `pph-everyday` on Render (free plan, Singapore), auto-deploys from `main`.

Legend: **Live** = configured on the Render service and seen working there. **Code + tests** = implemented and exercised by the test suite against the in-repo fake PayPal or fixtures. **Simulated** = a stand-in that is labelled as such in the product.

## 1. Integration matrix

| Integration | What Everyday uses it for | Code | Live config | Evidence | Status |
|---|---|---|---|---|---|
| PayPal Orders v2: create, approve, capture, read-back | Buying a quoted plan; the capture is read back from PayPal before the order shows as paid | `src/paypal/client.ts`, `services/orders.ts` | Client id/secret set, sandbox | Live order EV-4001, $41, capture `2H948761WE562284C` (10 Nov). Fresh run on the new UI (judge tour → plan → quote → PayPal sandbox buyer → back to the order, tour resumed): EV-4001, $24.00, capture `3DT00799U0260651V`; screenshots `docs/screenshots/sandbox-order-*` Tests: lost capture response is repaired once; declined instrument leaves nothing charged | **Live** |
| PayPal Refunds (`/v2/payments/captures/:id/refund`, refund read-back) | Swap differences, partial refunds, price protection; one request id per case so a retry cannot pay twice | `services/orders.ts`, `services/protect.ts` | same | Tests: $20 + $15 + $10 refunds on one capture, `payment_ops.request_id = case:<id>`, double-claim refused | Code + tests; not yet shown live |
| PayPal Vault v3 (setup token → payment token) and vaulted capture | One-tap repeat buys under the shopper's mandate | `services/passport.ts` | same | Tests: save, revoke, repeat buy under threshold runs, above it waits for approval | Code + tests; not yet shown live |
| PayPal order tracking (`/orders/:id/track`) | Merchant attaches carrier and number | `services/passport.ts` | same | Tests | Code + tests |
| PayPal Disputes (list, get, evidence, accept claim) | Merchant money screen; acceptance goes through the merchant's refund mandate and kill switch | `services/passport.ts` | same | Tests; kill switch refuses before PayPal is called | Code + tests |
| PayPal Transaction Search (`/v1/reporting/transactions`) | Reconcile Everyday's ledger against PayPal | `services/passport.ts` | same | Tests; needs the Transaction Search scope on the app | Code + tests |
| PayPal webhooks (signature verification) | Capture/refund events, recorded once | `web/trace.ts` | `PAYPAL_WEBHOOK_ID` set | Tests: unsigned rejected, verified accepted once | Code + tests |
| OpenAI (reader models) | Reads screenshots, shared links and free-text requests into objects and needs, each with a quote; compiles plain-English mandates into rules. Never sets a price, a refund or a payee | `ai/*`, `guard/policy.ts` | `OPENAI_API_KEY`, `AI_PROVIDER` set | After deploy, one live plan made 1 `read_request` call (ok, $0.002, 1.1 s); the plan shows each reading with its quote. Readings whose quote is not in the text, or doesn't name the category, are dropped | **Live** |
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
- The plan now says so plainly: "Nothing quiet fits the budget: Silent Mouse comes to $47.00 with shipping, $2.00 over." Other options over budget carry their total and the overage instead of sitting under "Also fits".
- "Help me set up a comfortable study desk": the model once read "desk" as a desk mat. A category is now kept only when its quote names it; covered by a test.
- "a quiet mouse under $60": plans normally, with the code's pick and alternatives.
- A real YouTube link (not a demo clip) is read from its public cover; the title is the real one.

## 4. Checks

| Check | Result |
|---|---|
| `npm run typecheck` (server and web) | Pass |
| `npm test` | 65 tests in 10 files, all pass (adds the over-budget planner test and the category-grounding test) |
| Playwright (`e2e/`) | 7 journeys pass locally and against the live URL: shopper plan → exact quote → PayPal button; display settings persist; merchant orders, money, refund mandate; judge tour survives navigation and reload and stops at the PayPal step; take-the-tour |
| axe (WCAG 2.0/2.1/2.2 A and AA) | 0 serious or critical issues on 17 screens, light and dark, local and live |
| Lighthouse mobile, live | Performance / 99, /login 99, /judge 96, /today 96; accessibility, best practices, SEO 100 on all four; CLS ≤ 0.002 (`docs/lighthouse/live.json`). Local (no CDN): 90–93 |
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
| 5 | P1 | Live merchant kill switch is engaged (left from a drill), so merchant refunds are refused on the live demo | Released by a demo reset on this service; verified `kill.engaged = false` live |
| 6 | P2 | Old server-rendered pages still reachable alongside the new app | Removed: 26 page handlers, the HTML layout/shell/icons, old browser scripts and stylesheets. All POST routes kept |
| 7 | P2 | Console model table scrolled sideways at 360 px; some standalone links were 20 px tall | Fixed |
| 8 | P1 | Planner listed over-budget options under "Also fits" when the stated quality only existed over budget | Options carry `total_if_chosen_cents` and `over_budget_cents`; the plan says what is over and by how much |
| 9 | P1 | Request reader accepted a category its quote didn't name ("study desk" → desk mat) | Category kept only when the quote names it; dropped readings counted |
| 10 | P1 | After a demo reset the judge tour pointed at a plan that didn't exist: three empty stops with 5 s waits | Stop 2 hands over the New plan form and resumes on the new plan |
| 11 | P2 | Order showed "Paid Nov 10" (server time) while the demo clock and events said Nov 16 | Orders show when they were placed on the shopper's clock; PayPal call times are labelled as real time |
| 12 | P2 | Timeline labels overlapped when two dates were close (paid and arrives) | Labels are laid out left to right and nudged apart |
| 13 | P2 | axe: ticker aria-label on a div, unfocusable scroll regions, tab/id/destructive contrast, unnamed file input and slider thumbs | Fixed; axe suite added |
| 14 | P2 | Mobile performance 65 (uncompressed assets, page chunks fetched late) | Brotli/gzip, boot skeleton, lazy tour library and sheets, per-page modulepreload and data preload |

## 6. Still simulated or unproven

- Refunds, Vault repeat buys, tracking, disputes and transaction search are proven against the fake in tests but not yet with sandbox ids on the live service.
- OpenAI vision reads of screenshots are proven in tests and locally; the live proof above is the text reader.
- Passkey countersign needs a real device to demonstrate.
- WhatsApp is not used.
