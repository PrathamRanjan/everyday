# TechJam-style conversational shopping eval (Everyday, 2026-11-11)

Protocol reimplemented in TypeScript from the published description; no TechJam material is included. Scenarios are generated from committed seeds (11, 23, 37; see eval/techjam-heldout.json), 40 per seed: 40% exact, 40% vague, 15% ambiguous, 5% out of catalog. The simulated shopper answers questions truthfully from the hidden target.

| System | Cases | HitRate@10 | MRR | Conversion (target at rank 1) | Correct abstain | False abstain | Avg turns | TechnicalScore |
|---|---|---|---|---|---|---|---|---|
| baseline (BM25, one turn, never asks) | 120 | 68% | 0.55 | 48% | 0% | 0% | 1.00 | 0.497 |
| everyday (hybrid + reply tree + reranker + abstain) | 120 | 82% | 0.68 | 61% | 0% | 11% | 2.64 | 0.521 |

## By scenario kind (Everyday / baseline)

- exact: 48 · hit@10 100% · MRR 0.98 · converted/abstained 96% / 48 · hit@10 100% · MRR 0.99 · converted/abstained 98%
- vague: 48 · hit@10 73% · MRR 0.51 · converted/abstained 40% / 48 · hit@10 46% · MRR 0.25 · converted/abstained 15%
- ambiguous: 18 · hit@10 61% · MRR 0.34 · converted/abstained 22% / 18 · hit@10 39% · MRR 0.16 · converted/abstained 6%
- out of catalog: 6 · hit@10 0% · MRR 0.00 · converted/abstained 0% / 6 · hit@10 0% · MRR 0.00 · converted/abstained 0%

## Limits

- Synthetic shoppers answer perfectly; real people hedge. Vague openings are templated (three per category), so the vague arm overstates recall for phrasings the templates did not cover.
- The reranker and planner were tuned on these templates. The held-out seeds in eval/techjam-heldout.json were fixed before tuning the reranker's attribute weights, but the question texts were written with the same templates in mind.
- TechnicalScore weights (0.35 hit, 0.30 MRR, 0.20 conversion, 0.15 correct abstain, minus false abstain and turns) are ours, not an official formula.
- The catalog has 35 products in 10 categories: HitRate@10 is easy at this size; MRR and conversion are the informative columns.
