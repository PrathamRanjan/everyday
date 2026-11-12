# Devpost submission: Everyday

Copy each block into the matching Devpost field. Lines marked **[YOU]** are yours to answer; I didn't guess them.

---

## General info

**Project name** (60 max)

```
Everyday: AI shopping that keeps working after checkout
```

**Elevator pitch** (200 max)

```
An AI buying assistant on PayPal that finds the right thing, pays with your approval, then claims price drops, tracks returns and stops scams, for the shopper and the shop.
```

---

## Project details

### About the project (Markdown)

```markdown
## Inspiration

Checkout takes a minute. Owning the thing takes years, and that's where people actually lose money. A shop promises to refund the difference if its price drops within 14 days, but nobody notices the drop. A return window closes quietly. A warranty ends in an email nobody can find. And right after you buy, a message arrives: "your parcel is held, pay a small fee here."

Meanwhile AI agents are starting to spend money for people, and the only thing between an agent and your PayPal balance is usually a prompt.

Shopping apps stop at the receipt. We wanted to build for everything after it, for both people in the sale: the shopper, and the small shop that has to deal with every claim.

## What it does

Everyday is one system with two sides that share one set of records.

**Maya, the shopper**
- She asks in a sentence: "a quiet keyboard under $80, I already own a monitor".
- She gets a plan that knows what she owns and explains every pick, including what was ruled out and why.
- She approves an exact quote and pays with PayPal.
- From then on, every item she owns gets a lifeline: return window, price promise, warranty and recalls.
- Today opens with **the money she can still get back**. When a price drops inside the shop's promise, Everyday files the claim with the evidence.

**Northlight Supply, the shop**
- It ships with tracking (posted to PayPal) and writes its refund rules in plain words.
- Claims arrive pre-checked, with the observed price and the policy clause the order was bought under.
- When the shop approves, PayPal refunds on the original capture, and the refund counts only once PayPal confirms it.

**Around both**
- **Scam check:** a model we trained runs in the browser and checks pasted messages on the device. Rules in code hold risky payments.
- **Agents:** an MCP server lets outside AI agents plan, quote and start a PayPal approval inside the shopper's limits. They can't refund or change limits.
- **More ways in:** a Telegram bot, a Chrome extension, a phone app, hands-free control, and four languages.

## How we built it

The core rule is: **the AI proposes, code decides, PayPal moves.**

- **AI reads.** OpenAI's Responses API (`gpt-6.1-sol`, backup `gpt-6-sol`) reads requests, rules, links and receipts into structured fields.
  - Every reading must quote the words it relied on.
  - The Decisions API (`gpt-6-luna`) is a second reader, with thresholds calibrated in code.
  - Vision reads receipts and screenshots. Transcription handles voice.
- **Code decides.**
  - Retrieval is BM25 plus trigram TF-IDF, fused by reciprocal rank fusion.
  - Hard constraints come with reasons, and an exhaustive best-bundle search runs under budget, shipping and deadline.
  - A hashed 15-minute quote is followed by a **dry-run gate** in front of every money move. It checks kill switches, integer cents, where each amount came from, the shopper's limits, the shop's refund ceiling and live PayPal state, all before PayPal is called.
  - A structural test proves every PayPal write passes through that gate.
- **PayPal moves.** Ten PayPal integrations:
  - Orders v2 (create, capture, tracking).
  - Payments v2 (refund a capture, read a refund).
  - Vault v3 (a saved sandbox wallet for one-tap demo payments).
  - Verified webhooks, Disputes v1 and Transaction Search.
  - **PayPal's MCP server**, which our assistant uses to check answers with PayPal itself.

  Nothing counts until PayPal's read-back says COMPLETED. A reconciler repairs lost responses, and every write is idempotent.

**Two models of our own run in the browser:**
- **A scam model:** a fine-tuned MiniLM, quantised to a 23 MB int8 ONNX file and run with onnxruntime-web and a WordPiece tokenizer written in JavaScript.
  - AUC 0.988 on 8,188 real SMS messages.
  - 1.0% false alarms on 600 genuine messages.
  - We publish its weak spot: business-email scams, AUC 0.58.
- **A taste model:** a multilingual MiniLM plus a trained 384→128 projection, trained on 11,999 Amazon shoppers and 139,130 products (19.6 GB of Amazon Reviews 2023).
  - On held-out purchases it puts the real next buy in the top 10 of 100 for 23.2% of people, against 22.7% for popularity and 9.9% for random order.
  - It only reorders listings inside the verdict code gave them.

Your messages never leave your device for the scam check. That is the point: people will only paste real scam messages into something that doesn't upload them.

**The stack:**
- React 19, Vite and Tailwind v4 on the front end; Express and TypeScript on the server.
- Postgres on Render, with a private demo workspace per visitor, deleted after 48 hours.
- Expo / React Native for the phone app, and Manifest V3 for the Chrome extension.
- MediaPipe for on-device hands-free tracking.

**Testing:**
- 135 unit and HTTP tests, and Playwright suites for every journey.
- axe (WCAG 2.2 AA) on every page in light and dark mode, 200% text at 320 px, and a keyboard-only checkout test.
- A 24-attack adversarial harness on the payment gate: 24 refused, $0 moved.

## Challenges we ran into

- **Payment finality.** A capture can come back PENDING, DECLINED (`INSTRUMENT_DECLINED` when the sandbox buyer's balance ran out), or not at all. We made "paid" mean "PayPal read back COMPLETED for the quoted amount". We added a reconciler with stable request ids, so a retry can never charge twice.
- **Webhooks on a shared sandbox account.** Other projects on the same sandbox account sent look-alike `custom_id`s. Events are now routed only to a demo workspace that exists. In one 48-hour window, 73 real webhooks were routed and none was missed.
- **Making AI honest about money.** We had to separate what a model reads from what code decides. When a reading fails, the app says so and offers a form; it never replays an old answer.
- **A guided demo that can't lie.** Our tour moves on only when the server or PayPal confirms the action happened, not when a button is clicked. When a judge restarted it, it got stuck because the demo's one price drop was already used. Each start now gives a fresh copy of the demo.
- **Staying up.** A shared database restart crashed the server, because Express 4 ignores rejected promises in async routes. We now route those errors to a 503 with a retry hint, and the server waits for the database instead of crash-looping.

## Accomplishments that we're proud of

- A complete product for two people, not a proof of concept: a real price drop goes from found, to claimed, to approved by the shop, to refunded by PayPal. Every step can be checked with live sandbox ids.
- Two trained models running in the browser, with model cards that say where they're weak.
- Agentic commerce with a leash: the same limits bind a person, our assistant and any outside agent.
- Accessibility and four languages built in from the start, and tested on every journey.

## What we learned

- **The interesting part of commerce is after the sale.** That's where trust is won or lost, for the shopper and the shop.
- **Agents need limits outside the model.** A prompt is not a spending policy; a gate in code is.
- **On-device AI changes what people are willing to share.**
- **Honest labelling builds trust.** Saying "AI read this, code decided that, PayPal moved this", and listing what we haven't measured, made the product more convincing, not less.

## What's next for Everyday

- Real shops' price feeds and promises beyond the demo shop.
- A native-speaker review of the Hindi, Indonesian and Portuguese translations.
- Testing with real screen-reader users, and the phone app on devices.
- Training the scam model on real business-email scams, its known weak spot.
```

### Built with (up to 25 tags)

```
paypal-orders-v2, paypal-payments-v2, paypal-vault-v3, paypal-webhooks, paypal-disputes, paypal-mcp, openai, typescript, react, vite, tailwindcss, express, node.js, postgresql, render, channel3, onnx, onnxruntime-web, minilm, mediapipe, mcp, telegram-bot-api, expo, react-native, chrome-extension
```

### "Try it out" links

```
https://pph-everyday.onrender.com
https://github.com/PrathamRanjan/everyday
https://t.me/everyday_paypal_demo_bot
```

The GitHub repository is **private** right now. Devpost requires it to be public before you submit.

### Image gallery (3:2, up to 15)

Use the new 1500×1000 screenshots in `docs/devpost/` (see the list at the end of this file).

### Video

[YOU] Upload the demo video to YouTube (public or unlisted), under 3 minutes, and paste the link here.

---

## Additional info

**Upload a file:** optional. `everyday-extension.zip` from https://pph-everyday.onrender.com/downloads/everyday-extension.zip is a good one.

**Submitter type:** [YOU] Individual / Team / Organization

**Country of residence:** [YOU]

**Canada province:** `N/A` unless you live in Canada [YOU]

**Organization name:** `N/A` unless you are submitting for an organization [YOU]

**New or existing:** `New`. The first commit is 9 Nov 2026, after 1 Oct 2026.

**If it existed before:** `N/A`

**How the project meets the main technology requirement:**

```
PayPal (sandbox), 10 integrations, each with a live sandbox id on https://pph-everyday.onrender.com/paypal:
- Orders v2, create and capture: checkout from an exact quote, with an item breakdown and the shopper's locale. The capture is read back before an order counts as paid.
- Orders v2, add tracking: the shop's Ship button posts the tracking number to the PayPal order.
- Payments v2, refund a capture and read a refund: price-drop claims, damage, partial refunds and backorder swaps refund on the original capture. A refund counts only once read back as COMPLETED.
- Vault v3, setup and payment tokens: a sandbox wallet saved for the demo, so judges can pay in one tap without a PayPal login.
- Webhooks, verify signature: capture and refund events, signature-verified, routed into each visitor's private demo.
- Disputes v1: the shop's money desk syncs disputes and builds evidence packs.
- Transaction Search v1: reconciliation on the shop's money desk.
- PayPal's MCP server (get_order, get_refund, get_dispute, get_shipment_tracking): our "Ask" assistant checks orders, refunds, disputes and tracking with PayPal before answering.

AI:
- OpenAI Responses API, gpt-6.1-sol (backup gpt-6-sol): reads shopping requests, plain-words spending rules and shared links into structured fields that quote their source words. It never decides money; code does.
- OpenAI Decisions API, gpt-6-luna: a second reader for yes/no judgements, with thresholds calibrated in code.
- OpenAI vision: reads receipts and screenshots. Values it can't point to are dropped.
- OpenAI transcription: voice notes and hands-free commands.
- Our own scam model: a fine-tuned MiniLM, 23 MB int8 ONNX, running in the browser with onnxruntime-web, so messages are checked on the device.
- Our own taste model: a multilingual MiniLM plus a trained projection, trained on 11,999 Amazon shoppers. It runs in the browser and orders web listings by taste inside the verdicts code gave.
- An MCP server for outside AI agents: they can plan, quote and start a PayPal approval inside the shopper's limits, but can't refund or change limits.
```

**Additional sponsor tools:** tick **Channel3** and **Render**.

- **Channel3:** web product search. Results are checked in code against the plan's must-haves and budget.
- **Render:** web service and Postgres, a `render.yaml` blueprint, and a health check.

Not used: AG Grid, APIMatic, Astropods, Bryntum, Elastic, KERNEL, Postman, Zapier.

**Public code repository URL:**

```
https://github.com/PrathamRanjan/everyday
```

The repository is private at the moment; make it public before submitting [YOU]. It already has the MIT license, setup instructions in the README, and how PayPal, AI and the sponsor tools are used.

**Working demo URL:**

```
https://pph-everyday.onrender.com
```

**Testing instructions for judges:**

```
No account, password or key is needed.

1. Open https://pph-everyday.onrender.com and press "Start the guided demo" (16 steps, about 6 minutes). You get your own private demo, and every start gives you a fresh copy. You press every button yourself. The tour moves on only when the server or PayPal confirms the action really happened.
2. Paying: every payment and refund is a real PayPal sandbox call. The yellow "Pay as the demo shopper" button pays at once from a sandbox wallet saved for the demo (Vault v3), with no login. "Pay on PayPal's own page" needs a sandbox test buyer account.
3. The header switch moves between Maya (the shopper) and Northlight Supply (the shop) at any time.
4. Telegram: in the app, go to Messages, then Connect Telegram, then talk to @everyday_paypal_demo_bot.
5. Proof: /paypal (every PayPal API with live sandbox ids), /ai (every model call), /proof (evaluations), /accessibility.

The app is on Render's free plan, so the first load after a quiet spell can take up to a minute.
```

**PayPal integration rating (1–10):** [YOU] Your call. A draft for the feedback box, based on what we actually hit:

```
Orders v2 and Payments v2 were clear and dependable, and reading a capture or refund back made it easy to only count money PayPal had confirmed. PayPal's MCP server was a quick win: our assistant can check an order or refund with PayPal itself before answering. Vault v3 let us offer judges a one-tap sandbox payment with no login.

What cost us time:
- A sandbox capture refused with INSTRUMENT_DECLINED when the shared sandbox buyer's balance ran low.
- Webhooks from other apps on the same sandbox account arrived with look-alike custom_ids, so we had to route events carefully.
- Judges can't complete PayPal's own hosted checkout without a sandbox buyer login, which is why we built the vaulted one-tap path.

A way to hand out per-judge sandbox buyers, or a hosted-checkout test mode with no login, would help hackathon projects a lot.
```

**Open to PayPal contacting you:** [YOU] Yes / No

**APIMatic Context Plugin experience:** leave blank (not used).

**AG Grid experience:** leave blank (not used).

**Age, eligible jurisdiction, not an employee of the Promotion Entities:** [YOU] Confirm each yourself.

**Which AI tools did you use while working on the project:** [YOU] Add any others you used.

```
Claude Code (Claude Opus 5.5) for building, testing and deploying. OpenAI models (gpt-6.1-sol, gpt-6-sol, gpt-6-luna, vision, transcription) inside the product.
```

**Level of learning:** [YOU] `Significant` is the natural answer.

**AI value for your career:** [YOU] Yes / No

---

## Gallery images

New 3:2 screenshots, 1500×1000, are in `docs/devpost/`:

1. `01-landing.png`: the landing page hero
2. `02-guided-demo.png`: a guided-demo step with tech tags and the Impact line
3. `03-plan.png`: a plan that explains its picks
4. `04-money-back.png`: Today, with the money you can still get back
5. `05-shop-claims.png`: the shop's console with a pre-checked claim
6. `06-scam-check.png`: the on-device scam check
7. `07-features.png`: the features section
