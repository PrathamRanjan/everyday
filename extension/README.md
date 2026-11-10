# Everyday for Chrome

A small Chrome extension (Manifest V3, no build step) that brings Everyday to the page you're shopping on.

| On a… | It shows | It does |
|---|---|---|
| Product page | The product the page describes (schema.org or Open Graph data), and an editable sentence such as "Something like the Halden Oak Desk Lamp (desk lamps), under $49" | **Plan it with Everyday**: the same planner as the website (the model reads the words with quotes; code applies budget, dates, what you own and your rules). **Save to Find**: saves the link and a screenshot of the visible page, which the vision model reads into objects |
| Cart or checkout page | The total the page shows | **Checkout check**: code compares that total with your monthly limit, your largest-single-purchase rule and your kill switch. A check, not a block: Everyday doesn't pay on other shops |
| Any page | Your month: left of your limit, the next return window to close | The toolbar badge counts approvals waiting for you |

Nothing is bought from the extension. A plan becomes a purchase only through Everyday's quote and your approval on PayPal.

## Install (unpacked)

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → choose this `extension/` folder.
3. Pin Everyday to the toolbar.

## Connect

- **Signed in to Everyday in this browser?** Nothing to set up: the extension uses that sign-in.
- **Otherwise:** on Everyday open **Messages → Phone app and browser extension → Connect the extension**, copy the key (shown once), and paste it in the extension's **Settings**. Disconnect it there any time; the key stops working at once.

Settings also switch between the live demo (`pph-everyday.onrender.com`) and a local server (`localhost:4111`).

## What it reads, and what it never does

- It reads a shop page only when you open the popup there (`activeTab`). From the page it takes the product's name, brand, category, image, price and currency, or the basket total. It shows these as text, never as page HTML. It sends only those fields, never the rest of the page's words. Everyday screens them for instructions like any request, so a product name can't steer the planner.
- **Save to Find** sends the link and one screenshot of the visible tab, because you pressed it.
- The device key stays in this browser's local extension storage (not synced). The server keeps only its hash.
- It has host access only to the Everyday server. It never sees your PayPal sign-in.

## Files

| File | Role |
|---|---|
| `manifest.json` | Permissions: `activeTab`, `scripting`, `storage`, `alarms`; host access to the Everyday server only |
| `popup.html`, `popup.js`, `styles.css` | The popup (Lifeline colours, light and dark) |
| `lib/page.js` | The read-only page reader injected on demand |
| `lib/api.js` | Calls the Everyday server: site sign-in or device key, and the same routes the website uses |
| `background.js` | Approval badge, refreshed every 5 minutes |
| `options.html`, `options.js` | Server and device key |

## Tests

`e2e/tests/extension.spec.ts` loads this folder into Chromium and checks:
- planning a product from a fixture shop page, tagged as the extension;
- the cart check;
- a device key working, then refused after it is disconnected;
- an axe accessibility scan of the popup.

Screenshots: `docs/screenshots/extension-*`.
