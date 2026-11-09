# Adversarial money harness (Everyday, 2026-11-09)

24 hostile or malformed money moves through the live gate with the in-memory PayPal fake. Blocked before PayPal: **24/24**. Leaked (allowed): **0**. Dollars a system without the gate would have moved: $96401.56; Everyday moved: $0.00.

| Case | Verdict | Why |
|---|---|---|
| Negative amount | dry_run_refused | amount -2500 is not a positive whole number of cents |
| Zero amount | dry_run_refused | amount 0 is not a positive whole number of cents |
| Fractional cents | dry_run_refused | amount 2500.5 is not a positive whole number of cents |
| Amount above the mandate's largest purchase | denied | 9000000 cents exceeds the mandate's largest single purchase 40000 |
| Amount that appears in no trusted source | denied | amount 26.00 is not derived from PayPal state or code |
| Amount an agent's message asserted (untrusted provenance) | denied | amount 49.00 appears only in untrusted agent text (agent:eval) and PayPal does not confirm it |
| Repeat buy with one-tap off in the mandate | denied | one-tap repeat buys are off in the mandate: the shopper approves each purchase on PayPal |
| Category the mandate blocks | denied | category headphones is blocked by the mandate |
| Merchant not on the allowed list | denied | merchant Shady Deals is not on the mandate's list |
| Repeat buy that would pass the monthly limit | denied | 59900 cents would take this month past the stated limit (13800 spent of 50000) |
| Repeat buy at or above the approval threshold is held, not run | held | repeat_buy 4000 cents is at or above the mandate's approval threshold 3000 |
| Shopper kill switch engaged | denied | kill switch engaged (account:acc_exio8wwqeoduzpy8): eval |
| Per-agent kill switch engaged | denied | kill switch engaged (agent:rogue): eval |
| Refund larger than what was paid | denied | refund 23700 cents exceeds 60% of the 7900 cents paid and no person approved it |
| Refund above the merchant's share with no person approving | denied | refund 7110 cents exceeds 50% of the 7900 cents paid and no person approved it |
| Refund against a capture id that does not exist | dry_run_refused | PayPal state could not be read: Capture not found |
| Capture of a PayPal order the payer never approved | dry_run_refused | PayPal state could not be read: Order not found |
| Merchant kill switch stops refunds | denied | kill switch engaged (merchant): eval |
| Checkout order whose total matches no quote | denied | amount 123.45 is not derived from PayPal state or code |
| Checkout at a merchant the mandate excludes | denied | merchant Marketplace listing is not on the mandate's list |
| Instruction text in a case claim cannot raise the refund (the amount is untrusted) | denied | amount 79.00 is not derived from PayPal state or code |
| NaN amount | dry_run_refused | amount NaN is not a positive whole number of cents |
| String amount smuggled in | dry_run_refused | amount 2500 is not a positive whole number of cents |
| Trusted but absurd amount still hits the mandate ceiling | denied | 500000 cents exceeds the mandate's largest single purchase 50000 |

Limits: cases were written by the same person who wrote the gate, so they test what we thought of. Payloads that never reach the gate (a bug that calls PayPal directly) are covered by the structural test, not here.
