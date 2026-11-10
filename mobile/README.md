# Everyday for iPhone and Android

A React Native app (Expo SDK 58, Expo Router, TypeScript) for the same Everyday server as the website and the Chrome
extension. It is not in the App Store or Google Play; run it with Expo Go or build it with EAS.

| Tab | What it does |
|---|---|
| **Today** | What needs you, held approvals, the next few weeks drawn as a lifeline, and this month's spending against your limit. Optional reminders on the phone before a return window closes, a warranty ends or a delivery is due |
| **Plans** | Say it in a sentence ("a quiet mouse under $45 by Thursday"). The plan shows what the model read, with your words quoted; what code ruled out; the exact quote; and **Pay with PayPal** |
| **Find** | Save a Reel, TikTok or product link, a screenshot from the camera roll, or a few words. Pick the item, then plan from it |
| **Bought** | Every order. Each line has its lifeline (paid, arrives, return window, price promise) and the PayPal payment record read back from PayPal |
| **Approvals** | Money moves waiting for you, approved with Face ID or your passcode. Your rules, and a kill switch that stops every assistant |

## How it signs in, and why it's safe

- **Demo:** **Continue as Maya** makes a key for this phone, just as the website's demo sign-in does. It works only when the server is in demo mode, and signing in again disconnects the previous demo key.
- **Real account:** on the website open **Messages → Phone app and browser extension → Connect the phone app**, then paste the key. It is shown once.
- **Where the key lives:** in the iOS Keychain or Android Keystore (`expo-secure-store`). The server keeps only its hash. **Settings → Sign out** disconnects it on the server too.
- **What a key can do:** act only as that shopper, never as the merchant. It can't create more keys. Every request goes through the same server routes and rules as the website.

## Paying with PayPal from the phone

1. Pay opens PayPal's sandbox approval page in the system's secure in-app browser (`ASWebAuthenticationSession` on iOS, a Custom Tab on Android). The app never sees the PayPal sign-in.
2. PayPal returns the buyer to Everyday's `/orders/:id/paypal/return-app`. The server checks that the PayPal order ID matches the order, captures the payment, and reads it back from PayPal.
3. The server then redirects to `everyday://orders/<id>?ok=…`, which closes the browser and opens the order in the app.
4. If the browser is closed another way, the order screen reloads: the server already knows whether it was paid.

## Run it

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with Expo Go (iPhone camera or the Expo Go app on Android). On the sign-in screen choose a server:
- **Live demo:** `pph-everyday.onrender.com`, which works from anywhere.
- **This computer:** `localhost:4111`. Use this only in a simulator or the browser build.
- **Other:** your laptop's Wi-Fi address, for example `http://192.168.1.10:4111`, to use a local server from a phone on the same network.

Build an installable app in the cloud (no Xcode needed):

```bash
npx eas-cli@latest build --profile preview --platform android
```

## Checks

| Check | How |
|---|---|
| Types | `npm run typecheck` |
| Expo config and dependency versions | `npx expo-doctor` (20/20) |
| Browser build | `npm run export:web`, then `node scripts/serve-web.mjs` on port 8081 |
| Journeys | `e2e/tests/mobile.spec.ts` (Playwright, 390×844 touch viewport) drives the browser build against the real server. It covers demo sign-in, Today, a plan from the phone with its exact quote, Pay opening PayPal's sandbox, the unpaid order's lifeline and PayPal record, the kill switch, Find and sign-out, with an axe WCAG 2.2 AA scan on four screens |

Screenshots: `docs/screenshots/mobile-*` (light and dark).

## Not verified yet

- **No real phone run yet.** This Mac has no Xcode or Android SDK, so the app has been checked only through its browser build. That build runs the same screens and code with react-native-web.
- **Native-only parts:**
  - Face ID or passcode before approving.
  - Returning from the secure PayPal browser through `everyday://`.
  - Phone reminders.
  - Choosing a screenshot from the photo library.

  Each of these uses an Expo module that ships in Expo Go, but none has been exercised on a device. In Expo Go the `everyday://` return should work on iOS, where the secure browser catches the scheme itself, but that is untested; on Android it needs an EAS build. Either way the server has already captured the payment, and the order screen reloads.
- **Approvals over the countersign limit** need the passkey registered on the website. The app links there instead of approving.
- **Reminders use the server's dates.** In demo mode those follow the demo clock, so after **+1 week** they no longer match the real calendar.
- **No share-sheet extension yet.** "Share to Everyday" from Instagram or TikTok needs a native extension and an EAS build. For now, paste the link in Find.
