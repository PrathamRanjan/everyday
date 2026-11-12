# How Everyday's guided demo works (and how to port it)

The guided demo never shows a Next button for a step where the judge has to *do* something. The bubble points at the
real button, and the step moves on only once that action really happened. Then a colour wipe switches the judge
between the shopper and the shop. Below are the four parts, so they can be copied into another app.

Files: `web/src/journey/steps.ts` (the script), `web/src/journey/Journey.tsx` (the engine), `web/src/lib/api.ts`
(the signal), `web/src/index.css` (`.ev-wipe`, `.ev-journey`, `--role`), `GET /api/ui/journey` in `src/web/judge.ts`.

## 1. Steps are data

Each step is a plain object:

```ts
{ role: "shop", route: "/merchant", el: ["[data-tour=ship]"],
  title: "Now you're the shop", body: "… Press Ship.",
  wait: { label: "Press Ship", action: /\/merchant\/lines\/[^/]+\/ship$/ },
  after: "Shipped. The tracking goes to PayPal…" }
```

- `role`: which side the judge must be on for this step.
- `route`: the page for the step. It can be a function of what the judge made earlier, e.g. `(c) => c.order`.
- `el`: what to highlight. These are `data-tour` attributes on the real buttons, so the bubble sits beside the button
  the judge presses.
- `wait`: what counts as done. Without it, the step gets a Next button.
- `after`: optional. Once done, the step stays on screen with this text and a Next button, so the result can be read
  (the scam verdict, for example).

## 2. "Done" means the server said yes, not a click

A click proves nothing: the request can fail, be refused by a limit, or hit PayPal and bounce. So the engine listens
for the outcome, in one of three ways:

| Wait type | How it's detected | Used for |
|---|---|---|
| `action: RegExp` | Every successful form action goes through `postAction()` in `lib/api.ts`. After the server answers OK, it fires `window.dispatchEvent(new CustomEvent("ev:action", { detail: { path, to } }))`. The engine matches `path` against the regex. A refused or failed request never fires it. | Get quote, Ship, Claim, Approve, the scam check |
| `route: RegExp` | The app navigated to a page matching the regex, e.g. `/orders/:id` only exists once PayPal captured the money. The id is saved for later steps. | Plan it → plan page, Pay → order page (works after a trip to PayPal's own page and back, because the state lives in `localStorage`) |
| `done: "refund_confirmed"` | Polls `GET /api/ui/journey` every 2.5 s. The server ticks a checklist item only when PayPal reports the refund COMPLETED. | The refund, which settles asynchronously at PayPal |

Porting: add the `CustomEvent` line to your app's one fetch helper for mutations (only on success), and put
`data-tour` attributes on the real buttons. That is the whole integration on the page side.

## 3. The engine (`JourneyHost`, about 300 lines)

- **State** `{ id, i, ctx, shown }` lives in `localStorage`, so a reload or a round trip to PayPal keeps the place.
- **On entering a step:** if the judge is the wrong side, it switches (part 4); otherwise it navigates to the step's
  page. It does this once per step, so the judge can wander off and press "Take me there" to come back.
- **Highlight:** it waits up to about 7 s for the element to exist and be visible, then uses
  [driver.js](https://driverjs.com) (MIT) to dim the page and draw the bubble. While waiting, the bubble has no Next
  button, only a pulsing "Press Ship" line. A `ResizeObserver` on the element calls `driver.refresh()` so the bubble
  moves when the element grows (a pasted message, a result appearing).
- **Completion:** it shows a "Done" flash for 1.1 s, then advances. If the step has `after`, it stays with a Next
  button instead.
- **Dock:** a small card at the bottom left with the step, "Take me there / Show me", and "Skip this step". It shrinks
  to a pill while a bubble shows, so the two never overlap.

## 4. The colour wipe (the side switch)

What you see:

1. A full-screen colour floods out from the centre of the screen as a growing circle: deep moss green
   (`#2c6a4d`) when you become the shop, burnt orange (`#b13a0d`) when you become Maya again.
2. A white icon (a shop or a person) and "You're now Northlight Supply" / "You're Maya again" rise 16 px into place.
3. The colour holds while, underneath, the app signs you in as the other person and opens their page.
4. The colour fades away to reveal the new side. The highlight ring, chips and header accent are now in that side's
   colour, through the `--role` CSS variable set on `<html data-role="shop|shopper">`.

How it's built:

- CSS only: `clip-path: circle(0% → 150% at 50% 50%)` over 35% of a 1.55 s animation with
  `cubic-bezier(0.7, 0, 0.3, 1)` (slow start, fast middle, soft landing). It holds to 75%, then fades its opacity to
  0. The text has its own keyframes (fade and rise in at 20–40%, out at the end).
- **Reduced motion:** with `prefers-reduced-motion`, the circle is replaced by a plain 1.2 s fade.
- **Timing trick:** the sign-in request (`POST /login as=mer:<id>`) runs in parallel with a 900 ms minimum, so the
  swap always happens behind a fully covered screen. The wipe clears 650 ms after the new page is ready. A global
  `__evSwitching` flag stops the half-switched page from bouncing to the sign-in screen on a stray 401.
- **Screen readers:** the overlay is `role="status" aria-live="assertive"`, so "You're now Northlight Supply" is
  announced.

## Porting checklist

1. Copy `Journey.tsx`, `steps.ts`, `RoleSwitch.tsx` and the `.ev-*` CSS block, plus `driver.js`.
2. Fire `ev:action` from your mutation helper on success only.
3. Add `data-tour` to the buttons a judge presses.
4. Give the server a cheap read-only endpoint that says which personas exist in the visitor's demo and which slow,
   external things have completed (`done` ticks).
5. Write the steps.
