# Everyday

**Buy the right thing once. Then stop worrying about it.**

An AI buying and ownership assistant on PayPal that keeps working after checkout: it finds the right thing, buys it
with your approval, then watches every return window, price promise, warranty and scam message until the money is
safe. It works for both sides of the sale: the shopper, and the small shop that sold to them.

- **Live app:** https://pph-everyday.onrender.com (PayPal sandbox; no real money)
- **Guided demo:** https://pph-everyday.onrender.com/#demo (16 steps, about 6 minutes, no sign-up)
- **Telegram bot:** [@everyday_paypal_demo_bot](https://t.me/everyday_paypal_demo_bot)
- **Proof pages:** [/paypal](https://pph-everyday.onrender.com/paypal) (every PayPal API with live sandbox ids),
  [/ai](https://pph-everyday.onrender.com/ai) (every model call), [/proof](https://pph-everyday.onrender.com/proof)
  (evaluations), [/accessibility](https://pph-everyday.onrender.com/accessibility)
- **License:** MIT ([LICENSE](LICENSE))

---

## Overview

### The problem

Checkout takes a minute. Owning the thing takes years, and that is where people actually lose money:

- **Return windows close quietly.** Nobody tracks 14-, 30- and 90-day windows across a dozen shops.
- **Price promises go unclaimed.** A shop promises to refund the difference if its price drops within 14 days. That
  only pays out if someone notices the drop and files a claim with evidence. Almost nobody does.
- **Warranties and recalls are forgotten.** The end date sits in an email nobody can find.
- **Scams arrive right after you buy.** "Your parcel is held, pay a fee here" works because you really did just buy
  something.
- **AI agents can now spend money.** Without hard limits outside the model, an agent can be talked into paying.
- **Small shops drown in claims.** Each one arrives as an angry email with no order, no evidence and no policy
  attached.

Shopping apps stop at the receipt. Everyday is built for everything after it, for both people at once.

### What we built

One system for two people that share one set of records:

- **Maya, the shopper.** She asks in a sentence ("a quiet keyboard under $80, I already own a monitor") and gets a
  plan that knows what she owns. She sees an exact quote, pays with PayPal, and then gets a line through time for
  everything she bought. That line covers returns, price promises, warranty and recalls, with the money she can
  still get back shown first.
- **Northlight Supply, the shop.** It ships orders (tracking goes to PayPal), sets its own refund rules in plain
  words, and gets claims that arrive pre-checked, with the observed price and its own policy clause. It approves,
  and PayPal refunds on the original capture.

### Technical depth, in one paragraph

The core design is one sentence: **the AI proposes, code decides, PayPal moves.** Models read requests, receipts and
screenshots, and every reading must quote the words it relied on. Code then makes every decision. It runs
hard-constraint checks with reasons, an exhaustive best-bundle search under budget and deadline, a hashed 15-minute
quote, and a dry-run gate in front of every money move. That gate checks kill switches, integer cents, where each
amount came from, the shopper's limits, the shop's refund ceiling and live PayPal state, all before PayPal is
called. PayPal then moves the money through **10 PayPal integrations**. A payment or refund counts only after
PayPal's read-back says COMPLETED. Lost responses are repaired by a reconciler, and every write is idempotent. Two
models we trained run **in the shopper's browser**: a 23 MB scam detector and a taste model. The same limits bind a
person, our own assistant, and any outside AI agent that connects over our MCP server.

### Impact

- **For shoppers:** money that is already theirs but usually lost (unclaimed price drops, missed returns, scams
  paid) gets found, claimed and refunded. The guided demo shows a real one end to end: a price drop is found,
  claimed by the shopper, approved by the shop, and refunded by PayPal.
- **For small shops:** claims arrive checked, with evidence, under refund rules the shop wrote itself, instead of
  as support emails. A clean, fast refund keeps a customer instead of starting a dispute.
- **For agentic commerce:** a working answer to "how do you let an AI agent spend money safely". Limits, approvals
  and a kill switch live in code, outside the model, and apply to every agent the same way.
- **For people usually left out:** four languages, hands-free control, and accessibility tested on every journey.

### Innovation

- **Commerce that keeps working after the sale.** The unit of the product is the thing you own, not the order.
- **A leash for agents.** Agents can plan, quote and start a PayPal approval over MCP, inside the shopper's rules.
  They cannot refund, change limits or approve their own purchase.
- **Explainable picks.** Every pick says why, including what was ruled out and why, and whether a preference came
  from the population or from you.
- **Private by construction.** The scam check reads your messages on your device. They are never sent to us.
- **A press-to-advance guided demo.** A waiting step has no Next button. It moves on only when the server, or
  PayPal, says the action really happened. See [docs/GUIDED_TOUR.md](docs/GUIDED_TOUR.md).

---

## Why Everyday deserves to win

Each claim below can be checked on the live site.

### Technological implementation

- **10 PayPal integrations, all live in the sandbox:**
  - Orders v2: create, capture, and add tracking.
  - Payments v2: refund a capture, and read a refund back.
  - Vault v3: a saved wallet, for one-tap demo payments.
  - Disputes v1.
  - Transaction Search v1.
  - Verified webhooks.
  - PayPal's hosted MCP server: `get_order`, `get_refund`, `get_dispute` and `get_shipment_tracking`.

  [/paypal](https://pph-everyday.onrender.com/paypal) lists each one with a live sandbox id.
- **OpenAI, used with care:**
  - The Responses API (`gpt-6.1-sol`) with one repair attempt, then a backup model (`gpt-6-sol`), then an honest
    failure screen. There is no silent fallback.
  - The Decisions API (`gpt-6-luna`) as a second reader, with thresholds calibrated in code.
  - Vision for receipts and screenshots.
  - Transcription for voice.
  - An assistant ("Ask") that checks its answers against PayPal through PayPal's MCP server.

  Every call is logged at [/ai](https://pph-everyday.onrender.com/ai).
- **Two models of our own in the browser:** a scam model (fine-tuned MiniLM, 23 MB int8 ONNX) and a taste model
  (multilingual MiniLM plus a trained projection). Details are [below](#models-that-run-in-your-browser).
- **Money engineering:**
  - Idempotent PayPal requests, and read-back before any state changes.
  - A reconciler for lost responses, and refunds that count only once COMPLETED.
  - A hash-chained audit log.
  - A dry-run gate checked by a structural test that every PayPal write passes through it.
- **Engineering quality:**
  - 135 unit and HTTP tests, including an acceptance journey that fails if any route goes unused or returns a 5xx.
  - Playwright suites for the guided demo, shopper, shop, wallet, accessibility, languages, phone and a robot
    judge.
  - A 24-attack adversarial harness on the payment gate: 24 refused, $0 moved.
  - Private demo workspaces per visitor, deleted after 48 hours.

### Design

- **A complete product for two people, not a proof of concept.** The shopper's app and the shop's console share one
  set of records, and a colour wipe switches between them.
- **Every money screen shows** one exact total, who decides what (AI, code or PayPal, labelled), and what happens
  next.
- **Every channel uses the same rules:** web, phone app, Chrome extension, Telegram, hands-free and four languages.
- **A guided demo you drive yourself:** 16 steps, every button pressed by you, and each bubble tagged with the
  technology behind it.

### Potential impact

- **Online shoppers who lose money after checkout:** missed returns, unclaimed price promises, forgotten warranties
  and scams.
- **Small shops:** claims arrive checked, with evidence, under their own rules, instead of as complaints.
- **Agentic commerce:** the same limits bind a person, our assistant and any outside agent, so letting an AI shop
  for you stops being a leap of faith.
- **Access:** four languages, hands-free control and WCAG 2.2 AA testing widen who can use it.

### Innovation

- **Commerce that keeps working after the sale,** on both sides of it.
- **Agentic commerce with a leash,** enforced in code rather than in a prompt.
- **On-device AI for safety:** your messages are checked where they are, not uploaded.
- **Honest AI:** every reading quotes its source words, every pick explains itself, and what has not been measured
  is listed on [/proof](https://pph-everyday.onrender.com/proof).

---

## Try it (for judges)

1. Open https://pph-everyday.onrender.com. No account, password or key is needed.
2. In **The guided demo** section, press **Start the guided demo**. You get your own private demo; each start gives
   you a fresh copy. You press every button yourself:
   - set Maya's own limits
   - ask for a keyboard in a sentence
   - see why code picked it
   - get the exact quote
   - pay with PayPal
   - switch to the shop and ship it
   - claim a price drop as Maya
   - approve the refund as the shop
   - watch PayPal confirm it
   - test a scam message against the on-device model
   - see the agents page
3. **Paying:** every payment and refund is a real PayPal sandbox call with test money.
   - The yellow button pays at once from a sandbox wallet saved for the demo (Vault v3), with no login.
   - **Pay on PayPal's own page** opens PayPal's sandbox checkout, which accepts only sandbox test buyer accounts.
4. **Telegram:** in the app, go to **Messages → Connect Telegram** for a one-time link to
   [@everyday_paypal_demo_bot](https://t.me/everyday_paypal_demo_bot).
   - Send it a shop link and get a plan back.
   - Approve payments with buttons.
   - Use `/pending`, `/orders`, `/watch`, or `/stop`, which freezes every payment.
5. **Proof:** [/paypal](https://pph-everyday.onrender.com/paypal), [/ai](https://pph-everyday.onrender.com/ai),
   [/proof](https://pph-everyday.onrender.com/proof), and
   [/accessibility](https://pph-everyday.onrender.com/accessibility).

The site is on Render's free plan. After a quiet spell the first load can take up to a minute while it wakes.

---

## Features

### For the shopper

- **Ask in a sentence.** The request is read into a budget, a deadline, must-haves and what you already own. You
  are asked a question only when the answer changes what fits.
- **Plans that know what you own.** An owned item fills its slot instead of being bought twice.
  - Hard constraints come with reasons (ports, video output, VESA size, lumbar support). Unknown stays unknown.
  - An exhaustive best-bundle search runs under budget, shipping rules and deadline.
- **Where products come from.** The demo shop's catalogue (Northlight Supply, seeded sample data), plus **Channel3**
  web results. Web results are checked in code against the same must-haves and budget, and labelled "Found on the
  web; not purchasable in this demo".
- **Why this pick.** Every pick explains itself.
  - Until you make a choice, the taste line says what most shoppers like. After that, it uses your own this-or-that
    choices.
  - Every learned preference can be seen, undone and forgotten.
- **Exact quote, then PayPal.** A hashed quote re-checks price, stock, plan version and your monthly limit, then
  opens a PayPal Orders v2 checkout with an item breakdown.
- **A lifeline for everything you own.** Bought, return window, price promise, warranty end, and what Everyday does
  at each point.
- **Money back first.** Today opens with the money you can still get back.
  - "Claim price drops for me" files claims automatically. The shop still approves, and a refund counts only once
    PayPal confirms it.
- **Cases:** damage, late, wrong item, partial refunds, replacements and backorder swaps, all on the same order
  record.
- **Receipts from any shop.** Photograph a receipt; a vision model reads it, and code checks the dates.
- **Your own spending rules, in plain words.** Write them in a sentence. They are compiled, clamped and versioned,
  and backtested against your purchase year before you switch them on. There is a kill switch.
- **Scam check.** Paste a message and the on-device model scores it. Rules on the server hold risky payments, such
  as a first payment to an unknown seller, gift cards, or a request to move off PayPal.

### For the shop

- **Orders:** ship with tracking (posted to PayPal), deliver, backorder, and change prices.
- **Claims arrive pre-checked:** the observed price, the policy clause the order was bought under, and the shopper's
  evidence.
- **Refund rules in plain words,** plus a refund ceiling enforced by the gate.
- **Money desk:** disputes sync, evidence packs, transaction reconciliation, and a read-only merchant MCP server.

### Everywhere

- **MCP server for AI agents** (`/mcp`):
  - Tools to plan, quote, approve a purchase (starting a PayPal approval the shopper finishes), repeat a buy, and
    read traces.
  - Agents cannot refund or change limits.
  - Rate limited, idempotent and kill-switch aware.
  - The [/agents](https://pph-everyday.onrender.com/agents) page shows every agent call.
- **Telegram bot:** plans from a shared link, approvals with buttons, and the kill switch by message.
- **Chrome extension** (Manifest V3, [download](https://pph-everyday.onrender.com/downloads/everyday-extension.zip)):
  plan or save a product from any shop page, and check a cart against your rules.
- **Phone app** (Expo / React Native, in `mobile/`): Today, plans, approvals and the kill switch, with a PayPal
  approval that returns to the app.
- **Hands-free ("Look and Say"):** point with your head or hand and speak.
  - Tracking runs on the device (MediaPipe).
  - A money move needs "confirm" said back within 60 seconds.
  - Deleting and cancelling are refused by voice.

### Accessibility

Accessibility is tested on every journey, not added at the end:

- **axe (WCAG 2.2 AA)** on every page of every journey, in light and dark mode. The suite fails on any serious or
  critical issue.
- **Reflow:** no sideways scrolling at 320 px wide or at 200% text.
- **Keyboard only:** a test goes from a typed request to a paid PayPal order using only Tab and Enter, with each
  step announced in a live region.
- **Reduced motion:** nothing keeps moving. The side-switch wipe becomes a plain fade.
- **Display and help panel:**
  - text size, high contrast and the Atkinson Hyperlegible font
  - read-aloud, voice input and dictation
  - plain words, bigger targets, more time, and no motion
- **Hands-free control** for people who can't use a mouse or touch screen comfortably.
- Results are on [/accessibility](https://pph-everyday.onrender.com/accessibility) and in `eval/accessibility.json`.
- **Not tested yet:** a person using VoiceOver or NVDA, forced colours, and the phone app on a real device.

### Four languages, and why these four

Everyday speaks **English, Hindi, Bahasa Indonesia and Brazilian Portuguese**. That covers every screen: 1,687 web
sentences and 915 server sentences, with a check that fails on any missing one. It also covers what the AI writes
back, the dictation language, Telegram and push messages, and the language of the PayPal checkout page.

Why these: Hindi, Bahasa Indonesia and Portuguese are the languages of India, Indonesia and Brazil. Those are three
very large, mobile-first online shopping markets, where many people shop in a language other than English.

- These are the shoppers who most need help after checkout: the return rules, the warranty, and the "your parcel is
  held" scam all arrive in fine print or in their own language.
- The taste model is multilingual and was tested in all four languages.
- Prices show a local-currency estimate (INR, IDR, BRL, from ECB reference rates) while you still pay in US dollars.
- The translations were made by machine and are labelled as such. A native-speaker review is still to do.

### Models that run in your browser

Two models we trained run **on the shopper's device**. The data they read never leaves it.

- **The scam model.** A fine-tuned MiniLM text encoder with small classification heads (genuine / marketing /
  scam).
  - It is quantised to int8 and shipped as a **23 MB ONNX file** (`public/safety/model/`).
  - It runs with onnxruntime-web and a WordPiece tokenizer written in JavaScript.
  - **Results** (from the training runs; the training notebooks are not in this repo):
    - AUC **0.988** on 8,188 real Singapore SMS (ScamShield test set).
    - AUC 0.979 on 1,574 ScamShield evaluation messages.
    - **1.0% false alarms** on 600 genuine everyday messages.
    - **Weak spot:** business-email scams (AUC 0.58). We show this on
      [/proof](https://pph-everyday.onrender.com/proof) rather than hide it.
  - Its score is advice only and can never approve a payment. Rules in code decide holds.
- **The taste model** (`taste-lab/`). A multilingual MiniLM (q8) plus a trained 384→128 projection on centred
  embeddings.
  - Trained on 11,999 Amazon shoppers and 139,130 products (19.61 GB of Amazon Reviews 2023: Office, Electronics,
    Home and Kitchen).
  - On held-out purchases, the real next buy lands in the top 10 of 100 for **23.2%** of people. That compares with
    21.8% for the plain embedding, 22.7% for popularity and 9.9% for random order. On products never bought in
    training it scores 21.2%, where popularity scores 0%.
  - In the browser it only reorders web listings inside the verdict code gave them. It never changes a verdict.
  - The browser's embeddings match the lab's at cosine 0.995–0.997.
- **Payment-risk model.** A monotone LightGBM walked in TypeScript (`public/safety/risk_lgbm.json`). It is trained on
  **synthetic** data and used only as a ranking signal next to the rule reasons.

Why on-device: a scam check is only useful if people paste their real messages into it. Doing it locally means
there's nothing to leak and nothing to consent to, and it works the moment the page loads.

---

## How PayPal is used

| PayPal tool | What it does in Everyday |
|---|---|
| Orders v2: create, capture | Checkout from an exact quote, with an item breakdown and the shopper's locale; capture is read back before the order counts as paid |
| Orders v2: add tracking | The shop's Ship button posts the tracking number to the PayPal order |
| Payments v2: refund a capture, read a refund | Price-drop claims, damage, partial refunds and backorder swaps refund on the original capture; a refund counts only once read back as COMPLETED |
| Vault v3: setup and payment tokens | A sandbox wallet saved for the demo, so judges can pay in one tap without a PayPal login |
| Webhooks (verify signature) | Capture and refund events, signature-verified, routed into each visitor's private demo |
| Disputes v1 | The shop's money desk syncs disputes and builds evidence packs |
| Transaction Search v1 | Reconciliation on the shop's money desk |
| PayPal MCP server (read tools) | The Ask assistant checks orders, refunds, disputes and tracking with PayPal itself before answering |

Every one is listed with a live sandbox id at [/paypal](https://pph-everyday.onrender.com/paypal).

## How AI is used

| AI tool | What it does | What it can't do |
|---|---|---|
| OpenAI Responses API, `gpt-6.1-sol` (backup `gpt-6-sol`) | Reads requests, plain-words rules, and Telegram links into structured fields that quote their source words | Decide anything about money |
| OpenAI Decisions API, `gpt-6-luna` | Second reader for yes/no judgements, with thresholds calibrated in code | Hold or release a payment on its own |
| OpenAI vision | Reads receipts and screenshots; values it can't point to are dropped | Save anything until you press Save |
| OpenAI transcription | Voice notes and hands-free commands | Confirm a money move without "confirm" said back |
| Ask assistant (tools + PayPal MCP) | Answers questions about your orders, citing the tool calls it used | Refund, pay or change limits |
| Our scam model (browser) | Scores pasted messages on the device | Approve a payment |
| Our taste model (browser) | Orders web listings by your taste | Change what code ruled in or out |

With no AI key the app says so on screen and offers the manual form. It never invents an answer.

## Sponsor tools

- **Channel3:** web product search. On a plan, "Also found on the web" lists real products, each checked in code
  against the same must-haves and budget, and labelled as not purchasable in the demo.
- **Render:** the web service and Postgres. It includes a `render.yaml` blueprint, a `/healthz` check that names the
  running commit, and a private workspace per visitor, deleted after 48 hours.

Not used: AG Grid, APIMatic, Astropods, Bryntum, Elastic, KERNEL, Postman, Zapier.

---

## Architecture

```
web/        React 19 + Vite + Tailwind v4 app (shopper, shop, landing, guided demo)
src/        Express + TypeScript server
  core/       retrieval (BM25 + trigram TF-IDF, reciprocal rank fusion), constraints, planner, preference model
  guard/      plain-words rules, the dry-run gate, audit chain
  paypal/     PayPal client (real and an in-memory fake for tests), MCP client
  services/   plans, quotes, orders, cases, price protection, money back, receipts, workspaces
  ai/         OpenAI provider, Decisions client
  channels/   Telegram, WhatsApp, push
  web/        routes: API, MCP servers, webhooks, demo, proof pages
public/safety/  the on-device scam model and payment-risk model
taste-lab/  training and evaluation of the taste model
extension/  Chrome extension (Manifest V3)
mobile/     Expo / React Native phone app
e2e/        Playwright suites
test/       Vitest unit and HTTP tests
eval/       evaluation results shown on /proof
```

Storage is Postgres on Render, or PGlite locally (no install). A worker handles reconciliation, refund checks, price
watches, auto-claims and webhook processing.

## Run it locally

Requires Node 20.11 or later.

```bash
npm install
cp .env.example .env     # add PayPal sandbox keys; everything else is optional
npm run dev              # http://localhost:3500
```

- **PayPal:** `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a sandbox app; `PAYPAL_WEBHOOK_ID` for verified
  webhooks.
- **AI:** `AI_PROVIDER=openai` and `OPENAI_API_KEY`. Without them, readings show the manual form.
- **Optional:** `CHANNEL3_API_KEY`, `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET`, VAPID keys for push. Each
  feature without its key is a labelled simulation.
- The web app is built with `npm run build` (server and `web/`). `npm run dev` serves the last build of `web/`; use
  `npm --prefix web run dev` for live reload.
- Phone app: see `mobile/README.md`. Chrome extension: load `extension/` unpacked.

### Tests

```bash
npm test                                   # 135 unit and HTTP tests (in-memory PayPal fake)
npm run typecheck
cd e2e && E2E_URL=http://localhost:3500 npx playwright test   # browser suites
npm run eval:adversarial                   # 24 attacks on the payment gate
npm run eval:capture                       # screenshot reading, with on-image instruction traps
```

## What has not been measured

These are listed on [/proof](https://pph-everyday.onrender.com/proof) too:

- No stranger has been timed using the app yet.
- The scam model has not been tested on real business messages; that is its weak spot.
- The payment-risk model has not been tested on real fraud.
- The taste model has not been tested on Everyday's own shoppers.
- Hands-free control has not been tested on real eyes or real speech.
- The phone app has not run on a real device.
- No native speaker has reviewed the translations.

The dated build and verification record, with live sandbox ids for each check, is in
[docs/VERIFICATION_LOG.md](docs/VERIFICATION_LOG.md).

## License

MIT. See [LICENSE](LICENSE).
