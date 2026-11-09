# Everyday — product brief

Labels: **[F]** sourced fact (link given) · **[E]** estimate · **[A]** assumption we have not tested with customers. No customer quotes below are real interviews; the "in their words" lines are our paraphrase of the job, marked [A].

## The problem

People find things to buy inside short videos, and the buying is the easy part. The hard parts come before and after: *will this actually work with what I already have, can I get it by Friday inside what I meant to spend*, and later *it arrived late, scuffed, or cheaper a week later, and the return window closed while I was busy.*

- In their words [A]: "I saved it from a Reel, I just need to know it fits my desk and my laptop, and I don't want to chase a refund later."
- Who [A]: a busy parent or young professional in the US, buying a few hundred dollars of home and work-from-home things a year from small online shops; usually on a phone, in the gap between jobs, school runs and meetings. In the demo: Maya, buying a study setup by Friday for $350.
- The moment it hurts [A]: twice. At the decision ("I'll check the ports tonight", then never buys, or buys the wrong dock) and after delivery (a delay before a deadline, damage, a price drop, a recall), when the facts are scattered across emails, PayPal and the shop's site.

### Evidence the "after" part is real

- Over one-third (36%) of shoppers in Blue Yonder's 2025 survey had a return rejected in the past year; the top reason was the request falling **outside the return window (31%)** [F] ([Business Wire, Sep 2025](https://www.businesswire.com/news/home/20250910157564/en/Blue-Yonder-Survey-Stricter-Returns-Policies-Deter-GlobalConsumer-Spending)). Industry-run survey, July 2025 fieldwork.
- 47% of consumers have stopped shopping with a retailer over a returns policy (Rithum, 6,000+ consumers, five countries) [F] ([Rithum](https://www.rithum.com/blog/introducing-the-2025-global-returns-profit-impact-report/)). Vendor report.
- Social video is a real discovery channel: 55% of respondents in a 2024 MGH survey found gift ideas while scrolling TikTok [F] ([MGH](https://www.mghus.com/blog/survey-tiktoks-major-influence-on-holiday-gifting-in-2024)). We found **no** sourced number for how often saved clips turn into purchases; that stays unknown.
- Price-drop refunds used to be a product of their own (Paribus, acquired by Capital One in 2016) [F] ([Wikipedia](https://en.wikipedia.org/wiki/Paribus)); a 2026 competitor blog says the automatic-refund version is gone [F, single competitor source].

### How people cope today [A unless linked]

Screenshots and saved Reels; a notes app or a WhatsApp chat with themselves; searching the shop by guesswork; checking ports and sizes by hand; order emails and the PayPal activity page as the "record"; calendar reminders for return windows if they remember. Cost: time at the decision, and money lost to missed windows and unclaimed price drops. We have no sourced dollar figure for that loss and do not invent one.

## Competitors and substitutes

| Product | Positioning | Price | Visual style | Where Everyday differs |
|---|---|---|---|---|
| ChatGPT Instant Checkout (with PayPal) [F] ([PayPal newsroom](https://newsroom.paypal-corp.com/2025-10-28-OpenAI-and-PayPal-Team-Up-to-Power-Instant-Checkout-and-Agentic-Commerce-in-ChatGPT)) | Buy inside a chat; PayPal wallet in ChatGPT from 2026 | Free to shoppers | Chat bubbles, monochrome | Chat ends at checkout. Everyday keeps the record after it: delays, cases, price protection, possessions. Compatibility is code, not chat. |
| Google AI Mode shopping [F] ([TechCrunch](https://techcrunch.com/2025/05/20/google-adds-ai-powered-shopping-features-for-discovery-and-easy-check-out)) | Search, price tracking, agentic checkout with Google Pay on a price drop | Free | Google Material, product grids | Built for the open catalog; doesn't know what you own or what your laptop has. |
| Phia [F] ([App Store](https://apps.apple.com/us/app/phia-shop-smarter-save-money/id6739351340)) | "Should I buy this?" price comparison, new and secondhand fashion | Free | Pastel, editorial fashion | Price-only; no plan, no after-sale. |
| Shop app (Shopify) [F] ([Shopify help](https://help.shopify.com/online-sales-channels/shop/delivery-tracking)) | Track orders from Shopify stores; price-drop and restock alerts | Free | Purple, card feed | Tracking without remedies; Shopify stores only. |
| Capital One Shopping (ex-Paribus) [F] ([TechCrunch](https://techcrunch.com/?p=1398094)) | Coupons and price comparison | Free (affiliate) | Browser extension | No compatibility, no merchant-side case flow. |
| Notes, screenshots, calendar reminders [A] | Do it yourself | Free | — | The thing Everyday replaces for the busy buyer. |

Visually every one of these is either a chat window or a product grid. Everyday's screens are about **an item's life over time**, so the design is built on time, not on a grid (see DESIGN_BRIEF.md).

## The promise

**Show Everyday something you liked; it works out what fits your life, buys it only with your approval on PayPal, and keeps looking after it until the return window, the price promise and the warranty run out.**

Three jobs that must be effortless:
1. **Clip → a plan that fits.** One share, one question at most, a total that includes shipping and arrives by the date.
2. **Approve exactly what moves.** An exact, expiring quote; PayPal's own approval page; nothing charged until PayPal confirms.
3. **After the sale, without chasing.** Delay → swap with the difference back; damage → a case with options; a lower price → the drop back; every date in one place.

Proof points a sceptical owner of the money needs [A]: a total with shipping before any approval; the merchant and payee named; "nothing charged" until PayPal says COMPLETED, with the PayPal ids shown; every refund verified with PayPal before it counts; a visible limit and an off switch; a plain record of what the AI read and what it didn't.

## Who decides what (the trust pattern the UI shows on every money screen)

| Layer | Does | Never does |
|---|---|---|
| **AI reads** | Names products in a screenshot or video cover; reads the words of a request (what, for whom, by when, which qualities); drafts a mandate from plain words | Read or set a price, a budget, a refund, a payee or a PayPal id; approve anything |
| **Code decides** | Parses every number; checks compatibility (ports, VESA, lumbar, owned items); searches every bundle under budget and deadline; hashes the quote; runs the gate (mandate, limit, scam rules, kill switch); computes remedies from the policy version you bought under | Guess when something is unknown (unknown stays unknown) |
| **PayPal moves money** | Shows you the exact amount to approve; captures; refunds; holds the saved-PayPal token; tracking and disputes | Move anything Everyday's gate refused |

What is not real yet [F, from the code]: Northlight Supply is a sandbox test merchant with an authored catalog; the demo clips' objects are authored; the purchase "year" on the passport is seeded and labelled; the preference model's evaluation is on synthetic shoppers.
