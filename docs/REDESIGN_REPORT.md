# Everyday — redesign report

10 Nov 2026. Live: https://pph-everyday.onrender.com (Render, deploy of `main` a763328). Repo: `PrathamRanjan/everyday`, branch `redesign` fast-forwarded into `main`.
Detail behind every claim here: [AUDIT.md](AUDIT.md), [FLOW_MAP.md](FLOW_MAP.md), [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md), [DESIGN_BRIEF.md](DESIGN_BRIEF.md).

## What it is

Everyday turns "I need a quiet mouse by Thursday, under $45" (typed, or a clip shared from Telegram) into a checked plan: AI reads the words, code enforces budget, dates and what you own, and PayPal moves the money only after you approve an exact, hashed quote.
It is for busy online buyers who lose track of what happens after the sale. Every item gets a lifeline: delivery, return window, price promise and warranty, with refunds run under the merchant's written mandate and verified with PayPal.

## Integration matrix (short form; full table in AUDIT §1)

| Status | Integrations |
|---|---|
| **Live-verified** | PayPal Orders v2: create, buyer approval, capture, read-back. Fresh run on the new UI: EV-4001, $24.00, capture `3DT00799U0260651V`. OpenAI request reader: 1 live `read_request` call, ok, $0.002, 1.1 s, with quotes on the plan. Channel3 search. Render web service + Postgres. |
| **Code + tests, not shown live this pass** | PayPal Refunds (with request-id idempotency), Vault v3 repeat buys, order tracking, Disputes, Transaction Search, webhooks (signature verified, recorded once). Telegram bot (same webhook code as the in-app simulator), Web Push, passkey countersign, MCP shopper/merchant agents, in-browser scam model. |
| **Simulated, labelled in the product** | Demo clips with authored objects ("demo clip"). Seeded purchase history on Passport. The demo clock (ribbon says so; PayPal call times are labelled as real time). |
| **Not wired** | WhatsApp. AG Grid, APIMatic, Bryntum. |

## Hard-coding findings (AUDIT §2)

- **One built-in merchant** (Northlight Supply). Scope, not a bug: the sandbox has one test merchant and the product says so. Open.
- **Demo clock reads the first account.** Wrong only with more than one shopper. Open, P2.
- **Authored demo clips.** Labelled "demo clip"; real YouTube/TikTok links are read for real. Fresh-data test: a real link returned its real title.
- **Model card cited notebooks not in the repo.** Fixed: it now says where they live.
- **Fake PayPal client.** Reachable only from tests.

## Design direction

**Lifeline.** Warm paper, near-black ink, and three status colours:
- vermilion for "needs you"
- moss for "settled"
- ochre for "waiting on PayPal"

Type is Newsreader and Public Sans with tabular figures. The signature element is an SVG timeline per item, drawn from real dates, with return and price-promise bands and a "today" tick.

**Why it fits.** The product's value is dates people forget, so every screen puts time first. It reads in daylight on a phone and separates "AI reads / code decides / PayPal moves money" visually.

**Build.** React + TypeScript + Vite + Tailwind v4 + shadcn, served by the existing Express app. All POST routes, rules and tests are unchanged; the old server-rendered pages are deleted. Magic UI-style motion is used on the landing page only, and is off with reduced motion.

**Screenshots** (`docs/screenshots/`, 375 / 768 / 1440, light and dark):
- [landing-375-light](screenshots/landing-375-light.jpg), [landing-1440-dark](screenshots/landing-1440-dark.jpg)
- [today-1440-light](screenshots/today-1440-light.jpg)
- [plan-375-light](screenshots/plan-375-light.jpg), [plan-1440-dark](screenshots/plan-1440-dark.jpg)
- [guard-375-light](screenshots/guard-375-light.jpg)
- [judge-375-dark](screenshots/judge-375-dark.jpg)
- [merchant-approvals-1440-light](screenshots/merchant-approvals-1440-light.jpg)
- the live sandbox order: [sandbox-order-375-light](screenshots/sandbox-order-375-light.jpg), [sandbox-order-1440-light](screenshots/sandbox-order-1440-light.jpg)

**Tours.** Driver.js tours exist for the shopper, the merchant and the judge. The judge tour (`/?tour=judge`, about 3 minutes) signs in as Maya and waits for a real plan. It stops at the live PayPal step and resumes on the order after PayPal returns. Progress survives navigation and reloads. A demo ribbon states sandbox, test money and the demo clock, with +1 day, +1 week and Reset.

## Test, build, Lighthouse and live QC

| Check | Result |
|---|---|
| `npm run typecheck` (server + web) | Pass |
| `npm test` | 65/65 pass |
| `npm run build` (clean web install, as Render runs it) | Pass. Main bundle 332 KB (103 KB gzip); pages are split per route and preloaded per URL |
| Playwright journeys | 7/7 pass, locally and against live: shopper, display settings, merchant, judge tour, take the tour. Screenshot run: pass |
| axe, WCAG 2.2 A/AA (serious and critical) | 0 issues on 17 screens, light and dark, local and live |
| Lighthouse mobile, live | Performance: / 99, /login 99, /judge 96, /today 96. Accessibility, best practices and SEO 100 on all four. CLS ≤ 0.002 |
| Lighthouse mobile, local (no CDN) | 90–93 |
| 360 px, live | 15 screens, no horizontal scroll |
| Live QC | Every route answers (404 page for unknown paths). The kill switch was released by a demo reset. The demo was reset after testing, so judges start clean |

### Failures found along the way, all fixed

- **Every order screen returned 500.** It queried a missing column; the new journey test caught it.
- **Over-budget options were listed under "Also fits".**
- **The model read "study desk" as a desk mat.**
- **The judge tour stalled after a reset** on three stops that needed a plan that didn't exist yet.
- **Order dates mixed real time and demo time.**
- **Timeline labels overlapped** when two dates were close.
- **axe found seven issues:** ticker label, scroll focus, three contrast spots, an unnamed file input and unnamed slider thumbs.
- **Mobile performance started at 65.**

The P0 from the audit, the channel simulator exposing other parties' conversations, is fixed and tested.

## Scores, before (live `main` 6031071) and after (a763328)

Strict, out of 10. "Before" is the server-rendered UI with the P0 open, no live model calls and the merchant kill switch engaged.

| Criterion | Before | After | Evidence a judge can see | Gap that still costs points |
|---|---|---|---|---|
| Technological implementation | 7 | 8 | Real sandbox capture read back before "paid"; quote hash; mandate gate before PayPal; model readings carry quotes, and ungrounded ones are dropped; evidence console with real counts | Refunds, Vault repeat buys and disputes are proven in tests, not with live sandbox ids on the evidence page |
| Design | 5 | 8 | One coherent product with designed empty, loading, error and offline states; mobile-first; 44 px targets; axe-clean in both themes; Lighthouse 96–99 | Desktop leaves white space on long pages; the timeline is small inside cards at 1440 |
| Potential impact | 6 | 6 | Clear audience and pain (missed return windows and price drops) and an honest planner | No user evidence, one test merchant, and money recovered is shown on seeded data only |
| Innovation / idea | 6 | 6 | Item "lifeline" plus the written-mandate gate for both shopper and merchant is uncommon | Agentic shopping and price-protection claims are active categories (for example, a Gmail-based price-protection claimer launched in 2026) |
| Presentation | 3 | 5 | A 3-minute judge tour that reaches a live PayPal step; an honest demo ribbon | **No video yet.** This criterion is judged on the video |

## Track-by-track odds

| Track | Odds | Why | Single change that most improves the odds |
|---|---|---|---|
| 1st / 2nd / 3rd | Long shot | Strong build, but presentation (no video) and unproven impact cap the total | A tight 3-minute video that follows the judge tour |
| Most Creative | Long shot | The lifeline is distinctive, but the concept sits in a busy agentic-shopping space | Open the video on the lifeline moving with the demo clock |
| Most Impactful | Long shot | The problem is credible; there is no evidence of users or money saved | Show one real price-drop refund in the sandbox, end to end, and quantify the problem with a cited figure |
| Best Demo Delivery | Long shot | The judge tour helps, but this track is about the video | Record the video |
| Best Use of PayPal + AI | **Realistic contender** | Many PayPal APIs in one product, plus AI that is fenced off from money (quotes as evidence, code decides amounts) | Put live refund and Vault ids next to the capture on the evidence page |
| Best Use of Agentic Commerce | **Realistic contender** | MCP agents plan and quote under a written mandate. Vaulted repeat buys run under a threshold; above it they wait for a tap or a passkey | Demo an outside agent hitting the mandate limit live, then a repeat buy under it |
| AG Grid (1st/2nd/3rd) | Not eligible | Not used | Not worth adding this late |
| APIMatic | Not eligible | Not used | — |
| Bryntum | Not eligible | Not used | — |
| Best Use of Channel3 | Long shot | Live, but it is a secondary search beyond the seeded catalog | Make Channel3 the source of the plan's candidates in the demo path, with its offer ids visible |
| Best Use of Render (1st/2nd/3rd) | Long shot | One web service plus Postgres on the free plan; auto-deploy from `main` | Move the clock jobs (price-drop sweep, return-window alerts) to a Render Cron Job and show it in the write-up |

**Comparison.** I could not see the hackathon field: the Devpost gallery isn't public before the deadline. The comparison above is against public products and categories only.

## Top three changes left before submission

1. **Record the 3-minute video** along the judge tour: request → readings with quotes → code's pick → exact quote → PayPal sandbox → order lifeline → +1 week → a refund.
2. **Prove refunds and a Vault repeat buy live** with sandbox ids, and show them on the evidence console next to the capture.
3. **Write the Devpost entry** around the problem and audience: missed return windows and price drops. State plainly what is simulated.

## What I could not do, and why

- **No video.** It is outside what I can produce here.
- **Live refunds, Vault, disputes and transaction search** were not exercised on the live service in this pass. They pass against the fake client in tests. This is the biggest remaining evidence gap.
- **Passkey countersign** needs a real device.
- **The hackathon field** isn't visible before the deadline.
- **The local `main` worktree** was not updated (it is checked out elsewhere). `origin/main` is the deployed source of truth.
