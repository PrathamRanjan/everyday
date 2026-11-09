# Everyday — design brief

The old look came from a shared kit used by other projects. It is gone. Everything below comes from what Everyday is about: **one item's life over time**, from a clip you liked, through an approved payment, to the day its warranty runs out. The customer is a busy buyer on a phone (PRODUCT_BRIEF.md).

## Three directions

| | A. Lifeline | B. Label maker | C. Instrument panel |
|---|---|---|---|
| Mood | Calm household ledger that knows dates. Paper, ink, one warm alarm colour. | Kraft card and embossed tape labels; homely, crafty. | Dark device UI with gauges and LEDs; precise, technical. |
| Palette | Warm paper, near-black ink, vermilion for "needs you", moss for "settled", ochre for "waiting on PayPal" | Kraft brown, black tape, white embossing, red tape for warnings | Graphite, phosphor green, amber, red |
| Type | Newsreader (display, optical sizes) + Public Sans (text, tabular figures) | Space Mono everywhere | Mono display + condensed grotesk |
| Signature | **The lifeline**: each item as a line through time with its windows as bands and a "today" tick | Status as label-maker tape | Spending as analogue gauges |
| References outside fintech | Train timetables, museum object labels, Muji receipts, a paper wall planner | Dymo labels, pantry jars | Teenage Engineering, synth front panels |
| Fit for a busy buyer on a phone (1–5) | 5: reads in sunlight, dates are the product | 3: charming, but tape chips are low-contrast and small text in mono tires fast | 2: dark-first hurts outdoor reading; gauges intimidate around money |
| Fit for "AI proposes, code decides, PayPal moves money" | 5: each layer gets a mark on the line | 3 | 4 |
| Distinct from the field (chat windows and product grids) | 5 | 4 | 3 (dark dashboards are common) |
| Accessibility risk | Low | Medium (mono, tape contrast) | Medium (glow, dark only) |
| **Total** | **20** | 13 | 12 |

**Chosen: A, Lifeline.** Everyday's whole value sits in dates that people lose track of (deadline, return window, price promise, warranty). A design built on a time axis makes that value visible on every screen, works in plain light on a phone, and looks like nothing else in the hackathon field, where entries are chat windows and dashboards.

## Signature element: the lifeline

A horizontal rail per item (or order) drawn in SVG from real dates:

- **Marks** on the rail: saved, planned, paid, shipped, delivered, each a dot with its date; money marks carry their PayPal status.
- **Bands** under the rail: *return window* (until the merchant's date), *price promise* (14 days after delivery under the policy version you bought under), *warranty* (compressed so years fit).
- A **today tick** in ink. A band that closes within 7 days turns vermilion and says "closes in N days".
- On phones the rail stays horizontal and scrolls inside its own card; it never makes the page scroll sideways.

Where it appears: the order page (one per line), Things you own (one per item), Today ("closing soon" uses the same bands), and the landing page hero (the story of one lamp, from a Short to "covered until 2029").

Money states have one consistent visual language, used in the lifeline, timelines, tables and badges:

| State | Mark | Colour token |
|---|---|---|
| Waiting on you | filled vermilion dot | `--now` |
| Waiting on PayPal (pending, created, held for capture) | ochre ring | `--wait` |
| Settled (captured COMPLETED, refund COMPLETED) | filled moss dot | `--done` |
| Money back | moss ring with an arrow | `--done` |
| Refused or failed (nothing charged) | carmine cross | `--stop` |

PayPal actions keep PayPal's own button colours (gold/blue). Nothing else in the app uses them, so "PayPal colours" always means "PayPal moves money here".

## Typography

- **Display: Newsreader** (Production Type, SIL OFL, Fontsource). Optical sizes; used at 20 px and above for page titles, item names in heroes and section heads. Weight 500–600.
- **Text: Public Sans** (USWDS, SIL OFL, Fontsource). Open apertures, legible at 13–16 px, with tabular figures (`font-variant-numeric: tabular-nums`) used for every amount, date, time and status count. Weights 400, 500, 600.
- PayPal ids, hashes and request ids: Public Sans with tabular figures and `letter-spacing: .02em`, not a third face.
- Scale (rem, 16 px base, 1.2 minor third): 0.75 · 0.8125 · 0.875 · 1 · 1.125 · 1.35 · 1.62 · 1.94 · 2.33 · 2.8. Body 1rem / 1.55. Line length 60–72ch for prose, cards up to 40rem.
- The accessibility font option (Atkinson Hyperlegible) still replaces both faces when chosen in Display and help.

## Tokens

Colour (checked with the WCAG 2.2 contrast formula against their own background; ratios are for normal text, AA needs 4.5:1):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | #F7F4EE | #14120F | page background |
| `--card` | #FFFDF9 | #1D1A16 | cards, sheets |
| `--ink` | #1C1A17 (15.8:1 on paper) | #F1EBE0 (15.8:1) | text |
| `--ink-2` | #5A554C (6.7:1) | #B5AC9C (8.3:1) | secondary text |
| `--rule` | #E3DDD1 | #36312A | borders, the rail |
| `--now` | #B13A0D (5.5:1) | #F48A57 (7.7:1) | needs you, closing soon |
| `--done` | #2C6A4D (5.8:1) | #79C79D (9.3:1) | settled money, money back |
| `--wait` | #7D5800 (5.9:1) | #E4B850 (10.0:1) | waiting on PayPal |
| `--stop` | #A11D2B (7.0:1) | #F28B8B (7.9:1) | refused, held by a scam rule |
| `--focus` | #1C1A17 ring + #F7F4EE gap | #F1EBE0 ring | visible focus (2 px + 2 px offset) |

Each status colour has a tinted background (`--now-bg` etc.) at ≤12% strength; status text sits on the tint at ≥4.5:1 (checked in `web/src/tokens.test.ts`).

Radius: 4 (inputs, chips' inner), 8 (buttons), 12 (cards), 20 (sheets), full (chips, dots). Spacing: 4 px base (4, 8, 12, 16, 24, 32, 48, 64). Elevation: borders first; one soft shadow for floating layers (`0 8px 30px -12px rgb(28 26 23 / .25)`). Motion: 120 ms (press), 200 ms (state), 320 ms (sheets, lifeline draw), `cubic-bezier(.2,.7,.2,1)`; with `prefers-reduced-motion: reduce` or the Display and help "no motion" switch, every transition and the lifeline draw-in are off.

## Rules we hold ourselves to

No purple-to-blue gradients, no glass, no bento grid, no emoji as icons (Lucide line icons only), no lorem ipsum, no fake stats or "trusted by" logos, no testimonial cards. Illustrative pricing on the landing page is labelled illustrative. Every number on a screen comes from the database.

## Copy

Plain words, short sentences, written for a phone between jobs. Every screen answers three things at the top: **what happened**, **what needs you**, **what happens next**. Money copy always names the amount, who it goes to, why, and how to undo it ("Decline and nothing moves." / "Refunds go back to the PayPal you paid with.").

## Components and libraries

- shadcn/ui (MIT) for the app: buttons, cards, dialogs, sheets, tabs, badges, tables, forms, toasts (sonner, MIT), command palette (cmdk, MIT), skeletons, tooltips. Restyled to the tokens above; nothing ships with the default zinc look.
- Magic UI (MIT): two pieces on the public landing page only (an animated number ticker for the quote total and a border beam on the live preview). Never on approval screens.
- Aceternity UI: considered for the landing hero; not used, because its free components are offered under its own licence terms rather than a standard open-source licence, and the effects (spotlights, glowing beams) fight the paper look. The lifeline hero is our own SVG.
- Icons: lucide-react (ISC). Tour: Driver.js (MIT). Fonts: Fontsource packages of Newsreader and Public Sans (OFL).
