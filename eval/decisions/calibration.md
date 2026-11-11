# Decisions thresholds (Everyday, 2026-11-11)

Model `gpt-6-luna`, 48 hand-labelled messages a shopper might get (`eval/decisions/scam-set.json`). For each question the yes cases and the no cases are each split in alternate halves; thresholds are picked on one half and reported on the other, which they never saw. A miss costs more than a false hold, so "yes from" is the best recall at 90% precision or better on the tuning half (the middle of the range of thresholds that reach it), and "no below" is half the lowest tuning-half yes (at most 0.3). A probability between the two is "unsure": amber, never green.

| Question | No below | Yes from | Tuning precision / recall | Held-out precision / recall | Held-out yes answered "no" |
|---|---|---|---|---|---|
| names_a_payment_destination | 0.3 | 0.5 | 100% / 100% (n=24) | 100% / 100% (n=24) | 0 |
| asks_for_payment | 0.28 | 0.32 | 100% / 100% (n=24) | 100% / 83% (n=24) | 2 |
| changed_payment_details | 0.3 | 0.5 | 100% / 100% (n=24) | 100% / 100% (n=24) | 0 |
| pay_outside_paypal | 0.02 | 0.15 | 100% / 82% (n=25) | 100% / 70% (n=23) | 2 |
| impersonation | 0.3 | 0.95 | 100% / 67% (n=25) | 100% / 100% (n=23) | 0 |
| urgency_or_secrecy | 0.3 | 0.93 | 100% / 100% (n=24) | 75% / 100% (n=24) | 0 |

Not calibrated (they use 0.3 / 0.6, shown as "not calibrated" on screen):

- gift_cards_or_crypto: too few labelled yes cases to calibrate (needs two in each half); left at 0.3 / 0.6
- fee_to_release: no threshold reached 90% precision on the tuning half; left at 0.3 / 0.6
- code_or_link: no threshold reached 90% precision on the tuning half; left at 0.3 / 0.6
- overpay_and_refund: no threshold reached 90% precision on the tuning half; left at 0.3 / 0.6
- too_good_to_be_true: no threshold reached 90% precision on the tuning half; left at 0.3 / 0.6

Limits: 48 messages written by the person who built the check; it measures what we thought of, not real scams. Labels are one person's.
