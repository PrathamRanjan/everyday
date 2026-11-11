# Everyday

**Show Everyday something you like, or say what you need. It helps you decide, buys with your approval, and keeps helping after delivery.**

A personal buying and ownership assistant. A shared Reel/TikTok/Short becomes a compatible, budgeted plan that knows what you already own; the plan is bought through PayPal after you approve an exact quote; delays, damage and returns are handled on the same record; delivered items become possessions that shape future decisions.

Spec: https://claude.ai/artifact/TZVLZwxENw3CTmxr7LMYGN

## Built and tested

- **Capture** (Telegram adapter + app): Instagram/TikTok/YouTube links normalised to one record per item; every capture states its evidence basis (link only, seeded demo clip, screenshot read by a model, or description). Object selection; Telegram account linking with one-time codes and a secret-token webhook.
- **Intent**: budget, deadline, possessions ("I already own a monitor"), recipient, comfort and style words; only questions that change eligibility are asked (the laptop's port).
- **Retrieval**: BM25 + hashed trigram TF-IDF vectors fused by reciprocal rank fusion; exact model numbers rank first.
- **Hard constraints with reasons**: video output, laptop port, monitor inputs, VESA size, lumbar support, already owned; unknown stays unknown.
- **Learning**: pairwise logistic (Bradley-Terry) preference model; global prior trained offline; bounded online updates from explicit this-or-that choices; reasons gate learning ("too expensive" → price only, "already own"/"wrong recipient" → nothing); gift recipients learn separately; discovery-sourced items never train (data-use guard); "why you see this" panel with forget/delete.
- **Planner**: exhaustive best-bundle search under budget, shipping rules (free over $300, express only when needed) and deadline, with a gap report; unasked extras are suggested outside the total.
- **Purchase**: hashed 15-minute quote (re-checks price, stock, plan version, monthly limit), PayPal Orders v2 with an item breakdown, capture read-back with fee, RecoveryOS repair of lost responses, idempotent returns.
- **After**: merchant console (ship, deliver, backorder, price, cases); backorder → deadline risk → in-stock swap with the difference refunded on the original capture; cases with claims vs observations, Rebuy-style return eligibility, partial remedies, merchant approval, PayPal refund verified; owned items with return and warranty dates; recall matching; repair-or-replace; price watches on recorded changes; Today and a commitments calendar.

## Run

```bash
npm install
cp .env.example .env   # PayPal sandbox keys; optional TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET
npm run dev            # http://localhost:3500
```

`/demo` → Reset → sign in as Maya. The Telegram simulator (`/telegram`) posts real Bot API updates to the same webhook a live bot uses. `/console` shows the model evaluation, training manifest, choice log and the failure lab.

```bash
npm test                          # 19 tests: core (links, retrieval eval, model, constraints, planner, returns) + 4 HTTP flows
node --import tsx scripts/experiment.ts   # the preference experiment report
```

## Evidence (labelled honestly)

- Preference model, **synthetic shoppers** (hidden taste weights; real catalog attributes), 140 train / 60 held-out, 5 seeds, NDCG@3 within category: popularity ≈ 0.74, global ≈ 0.75, **personal after 5 choices ≈ 0.85** (gain 0.105, larger than seed spread → promoted). Synthetic data establishes mechanics, not real-world uplift.
- Retrieval, 20 authored judged queries on a 35-product catalog: Recall@5 BM25 0.95, trigram 1.0, fused 1.0 (small, easy catalog; not a benchmark).
- **Live PayPal sandbox run (9 Nov demo clock; checked against the PayPal API):**
  - Telegram simulator → seeded Short → lamp picked → goal "comfortable study setup by Friday for $350, I already own a monitor" → one question (laptop port) → plan $289 (lamp $49, chair $169, dock $59, shipping $12); no monitor suggested.
  - Hashed quote approved; PayPal order 01D1253357982945Y with item breakdown; capture 9P656496MU567232L **$289.00 COMPLETED, fee $10.13, net $278.87** (read back).
  - The first checkout link was abandoned unapproved; the second attempt used a new request id (`order:…:2`) and the old order was never captured.
  - Merchant backordered the chair to 2026-11-17 (after the Friday deadline). Everyday offered **no swap**, correctly: no in-stock ergonomic chair at or below $169 exists in the catalog, so the $20 swap refund shown in the tests did not occur live.
  - Lamp delivered → damaged case → eligibility (window to 2026-12-09, no fee because damaged) → shopper chose "keep it, $15 back" → merchant approved → refund 675385122W840225J **$15.00 COMPLETED**; capture now PARTIALLY_REFUNDED. App shows paid $289, refunded $15, net $274.
- Found live and fixed: confirmation messages after case actions were placed after `#cases` in the redirect and never shown.

## Changes on 8 Nov 2026

From the six-product review and implementation plan (https://claude.ai/artifact/5sDaBKUfMziPvxnTwDfswc). 25 tests pass; each change below has a test on the fake PayPal; price protection and payment finality were re-run live (below).

- Only a COMPLETED capture with the quoted amount marks an order paid and takes stock; PENDING waits for the reconciler; DECLINED lets the shopper pay again.
- A refund whose first PayPal call fails stays recorded and is retried by the worker with the same request id; the case still resolves once PayPal confirms.
- New: every preference update has a receipt on the You page, and Undo rebuilds the model by replaying the remaining choices (undoing the latest restores the exact earlier weights).
- New: the laptop question is tried against the catalog first, asked only if the answer changes what fits, and shows why.
- New: price protection. Each order keeps the merchant policy it was bought under, and Northlight's says 14 days after delivery. When Northlight records a lower price for the same item, in stock, the owner is told and Today shows the claim. The shopper asks; the merchant approves; the refund goes on the original capture through the case flow; the owned item's cost drops once PayPal confirms. A further drop pays only the further difference. Outside the window, out of stock, returned, or a claim already open: refused with the reason. A price protection promise is the merchant's, not PayPal's.
- Found live and fixed: a capture PayPal refused (`INSTRUMENT_DECLINED`, when the sandbox buyer's balance couldn't cover it) was shown as "declined" with no reason, and the reconciler kept retrying it. Now the order records PayPal's reason, says nothing was charged, stops retrying, and the next Pay creates a fresh PayPal order (test added). Also fixed: a Pay pressed while the reconciler was clearing that order showed "still being confirmed".

### Live rerun on the 8 Nov code (checked with `scripts/pp-check.mts`)

- Demo reset; study-setup plan $289 (lamp $49, chair $169, dock $59, shipping $12). First order `16958994BA562841B`: approved, capture refused with `INSTRUMENT_DECLINED` (the buyer's balance had just paid another app's deposit); nothing charged, order cleared with the reason shown.
- Second order `4T459510Y84666018` (attempt 2; balance plus sandbox Visa): capture `4YL25828JE900393G` **$289.00 COMPLETED** (fee $10.13), read back before EV-4001 counted as paid.
- Price protection: lamp delivered; Northlight recorded the Halden Oak lamp at $39; Maya was notified and Today showed "$10.00 back is available"; she claimed it under NL-returns-2026-10 (14 days after delivery); Northlight approved; refund `7YV35564HW882994G` **$10.00 COMPLETED** on the original capture (now PARTIALLY_REFUNDED); her owned lamp now costs $39.

## Review fixes (9 Nov 2026)

From the 8 Nov independent review: each defect its probes reproduced is fixed, and each probe is now a regression test that checks the correct behaviour (test/flows.test.ts). 33 tests pass. These fixes are tested on the fake PayPal; they have not been re-run live on the sandbox yet.

- Refunds count only once PayPal says COMPLETED, through one conditional update, so overlapping checks lower an item's cost once. (A PENDING refund was being counted straight away; fixed.)
- A refund PayPal marks FAILED is not counted; the case goes back to the merchant and a retry uses a new request id.
- A capture for the wrong amount or currency is an exception with no new checkout.
- The order keeps the merchant policy that was in the quote the shopper approved (it is part of the quote's hash).
- An approved replacement creates a real replacement order line; the case closes when it is delivered.
- Undo replays the features each choice was made on, so later catalog edits don't change the restored model.
- Unknown lumbar-support data doesn't satisfy a comfort requirement; an owned item fills its slot instead of blocking the plan.

## Foundation and widening (9 Nov 2026)

Everything below is built and covered by `test/foundation.test.ts` (walks every new route, 59 of them, and fails on any 5xx or unvisited route) plus `test/structural.test.ts` (every PayPal write in `src/services` is preceded by the gate in the same function). Suite: 45/45.

### What is real

- **Plain-words mandates** (`/guard`, `/merchant/approvals`). A shopper or merchant writes rules in a sentence or two; `src/guard/policy.ts` compiles them (model-assisted when `AI_PROVIDER=openai`, regex otherwise), clamps them, and versions them. Backtest against the seeded purchase year shows what would have run, waited or been denied before you activate.
- **Dry-run gate** (`src/guard/dryrun.ts`). Every money move (order, capture, refund, repeat buy, tracking, evidence) is checked for kill switches, integer cents, provenance of the amount, the mandate, the monthly limit, the merchant's refund ceiling and live PayPal state before PayPal is called. Holds create an approval and notify the party on their linked channel.
- **Traces** (`/trace/:id`, `/traces`, `/api/v1/runs`). Each run records gate decisions and PayPal request/debug ids. The MCP `get_trace` tool exposes them to agents on their own entities only.
- **Webhooks**: `/webhooks/paypal` (signature-verified against `PAYPAL_WEBHOOK_ID`, recorded once in `webhook_events`, unverified posts rejected; PayPal read-back remains the source of truth).
- **Channels** (`/channels`, `/webhooks/telegram`, `/webhooks/whatsapp`). Approve and decline buttons, countersign above `EV_COUNTERSIGN_ABOVE_CENTS`, passkey endpoints, hash-chained audit log at `/guard/audit.json`. Without tokens, messages are recorded as simulated and shown on `/channels`.
- **PWA and push** (`/manifest.webmanifest`, `/sw.js`, `/push/*`). Simulated until VAPID keys are set.
- **Purchase passport** (`/passport`). Seeded, labelled purchase year; saved PayPal (vault) setup and revoke; repeat buys that run through the gate and are held or denied by the mandate; Channel3 product search with an honest catalog fallback.
- **Merchant money desk** (`/merchant/money`). Tracking numbers posted to PayPal orders, dispute sync, evidence packs, accept-claim (gated refund), transaction reconciliation and PayPal negative-test codes (also gated).
- **MCP server** (`/mcp`, Bearer shopper key). Tools: my_constraints, plan_for, quote, approve_purchase, repeat_buy, passport, get_trace. Rate limited, idempotent, kill-switch aware.
- **Merchant MCP (read-only)** (`/merchant/mcp`, Bearer merchant key): list_orders, get_order, list_cases, list_approvals, list_disputes, get_performance, get_trace. Nothing on it ships, refunds or decides.
- **Eval explorer, llms.txt, skill.** `GET /console/eval` slices every eval row by arm, outcome and trap with CSV at `/console/eval.csv`; `/llms.txt`; skill file `skill/SKILL.md` at `/skill.md`; file map in `docs/foundation.md`.
- **Screenshot reading** uses the OpenAI vision tier when configured; on-image instructions are quarantined and only flagged, never obeyed.

### Evals (numbers are from the seeded sandbox, limits stated in each file)

- `npm run eval:techjam` → `eval/techjam.md`. 120 held-out scenarios: baseline BM25 vs Everyday's hybrid search with reply tree, reranker and abstain. Everyday wins on hit rate, MRR and conversion but pays 11% false abstains and 2.6 turns. Protocol reimplemented from the public description; no TechJam material included.
- `npm run eval:adversarial` → `eval/adversarial.md`. 24 attacks on the gate (negative, fractional, smuggled, untrusted-provenance and over-limit amounts, excluded merchants, blocked categories). All refused before PayPal.
- `npm run eval:capture` → `eval/capture.md`. 10 drawn frames including 2 instruction traps; model and oracle arms 10/10, rules arm 2/10. Frames are far easier than real screenshots.

If the dev server holds `./data/pglite`, run evals with `PGLITE_PATH=./data/pglite-eval`.

### Waiting on you

Keys for Channel3, Telegram, WhatsApp and VAPID (see `.env.example`). Everything degrades to a labelled simulation without them. Deployment, demo video and LICENSE are still parked.

## Scam and fraud protection (9 Nov 2026)

Three layers, strictest wins, none can approve a payment (`SAFETY_ACCESSIBILITY_SPEC.md` §4, Everyday row of §6):

- **Rules in code** (`src/safety/rules.ts`): the first payment to a seller found on the open web is a caution, or a hold at $200 and above; three new sellers in ten minutes holds; a message that asks for a code, moves payment off PayPal, asks for gift cards or a fee, or claims an overpayment holds. An amount above the shopper's own history is a caution only, because the shopper approves every checkout on PayPal.
- **Scam text model in the browser** (`public/safety/`, 23 MB int8 ONNX, fine-tuned MiniLM): scores a pasted seller or marketplace message on the shopper's device at `/safety`. Advisory; its score never reaches the gate.
- **Payment-risk model** (`public/safety/risk_lgbm.json`): monotone LightGBM walked in TypeScript, **trained on synthetic data**, shown as a ranking signal with the rule reasons.

The gate (`src/guard/dryrun.ts`) runs the check on every order and repeat buy and records a `scam check` line; a hold becomes an approval with `safety_rule` and `safety_reasons` in its payload, listed on `/safety`. Protected mode (`/safety#protected`) turns the first payment to any new seller into a hold and names up to two trusted contacts. Inbound messages on `/safety` carry a red or amber scam banner from the rules. Tests: `test/safety.test.ts`; the model's measured results are on `/safety/model-card`.

## Accessibility (9 Nov 2026)

`public/a11y.js` and `public/a11y.css` on every page: a **Display and help** button with text size, high contrast, Atkinson Hyperlegible, read-aloud, voice input (on-device where the browser supports it), plain words, bigger targets, more time and no motion. A first-visit card offers the same choices. The profile stays in this browser's `localStorage`; typing and buttons always work without it.

## Improvement spec: live acceptance record

| Item | Result on https://pph-everyday.onrender.com | Date |
|---|---|---|
| A2.1 saved demo wallet | **Passed.** With no PayPal login, the demo shopper planned a desk lamp, got the exact quote and pressed **Pay as the demo shopper**. PayPal order `4L752368AR902121V` COMPLETED, capture `9YW71616HF633590Y` COMPLETED, $61.00 USD (fee $2.37), both confirmed with `scripts/pp-check.mts`. The order shows "Paid from the demo's saved sandbox wallet". The wallet-off path (only PayPal's own page offered, no PayPal id made) is covered by unit tests (`test/demowallet.test.ts`); it has not been switched off on live. | 10 Nov 2026 |
| A1 private workspaces | **Passed** at `4103bea`. The operator's global reset ran (`/admin/demo/reset-all`) and rebuilt the showcase. Two separate browser sessions each pressed **Try the live demo**; each got its own workspace with "2 of 2 payments confirmed by PayPal" (real sandbox wallet captures), its own EV-4001/EV-4002, and no order id in common. B asking for A's order (`/api/ui/orders/<A's id>`) got **404**. A's merchant kill switch showed engaged in A and not in B. The signed-out preview read `source: showcase`. The webhook routing (by `custom_id` `ws:record`, falling back to `paypal_refs`), the join link, per-workspace reset, 48-hour expiry and the 5-per-hour start limit are covered by `test/workspaces.test.ts`; a real PayPal webhook to a visitor's workspace was not triggered on live. Browser suites (shopper, merchant, wallet, judge, a11y, extension, phone web build) pass locally against private demos. | 11 Nov 2026 |
| A4 health check, clocks | **Passed in part** at `fb76add`. `/healthz` returns `{ok:true, db:{ok:true, kind:"postgres", ms:2}, commit:"fb76add…"}` in 113 ms; it answers 503 if the database round trip fails. Each demo's clock starts at Monday 09:00 (relative to today; no pinned dates in the seed). Quote expiry runs on that clock: a fresh keyboard quote said "Good until Mon 16 Nov 09:15 on the demo clock" with no real-time countdown; after **+1 day** the plan no longer offered it. Real accounts (no demo clock) keep the 15-minute real-time expiry. **Not done, owner's call:** always-on hosting is a paid Render plan, a purchase only the owner can make. No keep-warm ping was added: on the free plan it would use up the free instance hours all eight apps share. The spec's "open after 12 idle hours, first byte under 2 s, no splash" check was not run and would fail on the free plan's cold start. Telegram robot judge: not built for this app in Wave 1. | 11 Nov 2026 |
| A11, A5.1, A5.4, A5.5 | **Passed in part** at `f9d6f4e`. Live: the service started on Render, so its keys are present. `/healthz` names `f9d6f4e`. The session reports `openai (gpt-6.1-sol, backup gpt-6-sol, small jobs gpt-6-luna)`. A real request ("sweat-proof wireless earbuds for running, under $80, need them by next Friday") was read by **gpt-6.1-sol** in 4.7 s, with grounded must-haves sweat-proof, wireless and running. The seeded mandate is labelled "the demo's starting rules (set by code, not read by a model)". Unit-verified only (`test/ai-honest.test.ts`), because switching the key off on live would break the site: the refusal to start without keys (prints names, never values); ≥4,000 output tokens and low effort; one repair attempt, then the backup model, then stop with no replayed answer; a failed reading shows "I couldn't read that. Try again, or fill it in below." with **Try again** and the manual form (web and phone), and no raw error. Rule readings appear only in tests and the labelled offline evaluation (`EV_RULES_READER=1`). **Not done:** the evaluations were not re-run on the new models, so `/proof` numbers are still from the old models; the Decisions API (A5.2) and agent rail (A5.3) are not in Wave 1 for this app. | 11 Nov 2026 |
| E1 owned item and empty plan | **Passed** at `1e03aba`. Live, the review's sentence "sweat-proof wireless earbuds for running, under $80, need them by next Friday" was read by gpt-6.1-sol (must-haves sweat-proof, wireless). The plan now says: "You own Hush ANC Headphones, but nothing Everyday knows about it shows it is sweat-proof, as you asked, so it doesn't fill this slot. Nothing in the catalog fits; here is why. Hush ANC Headphones ($99.00): you already own Hush ANC Headphones; over your $80.00 budget; not shown to be sweat-proof." Total $0, not feasible, and **Get the exact quote** refused. Before the fix it was $0.00 of items plus $12.00 shipping with a quote button. A plan where the owned item does qualify ("a desk lamp under $80" while owning the Halden lamp) says "There is nothing to buy in this plan…" and can't be quoted. A pick that can't be shown to have a stated quality says "Not confirmed for …" (unit test `test/readers.test.ts`). **Limit:** a must-have counts as met only when the product's own data (finish, material, style, title or description) shows it, so honest "not shown" results are common for qualities the catalog doesn't record. | 11 Nov 2026 |

**Follow-up checks, 11 Nov (later the same day; live at `f7b77c6`)**

| Item | Result | How it was checked |
|---|---|---|
| A2.1 wallet switched off | **Passed.** With the saved wallet switched off, the session said `usable: false, state: off` and **Pay as the demo shopper** was refused: "The demo's saved PayPal wallet isn't available (Switched off by the operator.). Pay on PayPal's own page instead." Switched back on 0.6 s later; PayPal read the wallet back. | Live, inside a fresh private demo. |
| A1 PayPal webhooks into a visitor's demo | **Passed.** In 48 hours, 73 real PayPal webhooks were routed into their own demos; 0 that belong to an existing demo were missed. 60 unmatched ones name demos that aren't here (deleted by the global reset, or another app's look-alike id on the shared sandbox account). The handler now routes by `custom_id` only to a demo that exists here. | Live; counts are on `/admin/demo`. |
| A4/E4 one clock | **Passed.** Plans now show when they were made on the demo clock (as orders already did), not the server's date. | Unit test (`test/demowallet.test.ts`). |
| A5.1 evaluations on the new models | **Done.** Capture reader on `gpt-6.1-sol`: 10/10 correct, 2/2 on-image traps caught, p50 3.3 s (its model arm had never run before). Money harness: 24/24 blocked, $0 moved. TechJam replay uses no model and is unchanged (0.521 vs baseline 0.497). Files in `eval/`, shown on `/proof`. | Scripts `npm run eval:*`, 11 Nov. |
| A5.5 honest failure state in a browser | **Passed** on web and on the phone app's browser build, against a local server with the AI key switched off. Shown: "I couldn't read that. Try again, or fill it in below.", **Try again** and the manual form. The manual plan is labelled "Filled in by you on the form; no model read it" and still applies E1. Fixed along the way: the panel had vanished when the page refetched; the trust strip said "AI reads" on a manual plan. The seed with no model said "0 of 2 payments confirmed by PayPal; 2 did not go through". | In-app browser, local server with `AI_PROVIDER=none`. |
| Phone app on iOS | **Not run.** This Mac has the command-line tools but not full Xcode, which the simulator needs. | Owner: install Xcode, then `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. |

