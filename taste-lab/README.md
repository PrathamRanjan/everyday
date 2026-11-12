# Taste lab

Trains and checks the taste model behind **Sort by my taste** on a plan's web listings. It only reorders listings
inside the verdict code already gave them, it never makes anything "fit", and it never touches money. It runs in the
shopper's browser, and only when they switch it on.

Everything here can be re-run from scratch:

```bash
cd taste-lab && npm install
npm run fetch      # 1: sample Amazon Reviews 2023 (reports every byte read)
npm run embed      # 2: multilingual MiniLM embeddings of every item
CENTER=1 K=128 node scripts/3-train.mjs        # 3: projection + held-out evaluation vs baselines
node scripts/3b-nothing-fits.mjs k128-centred  # 3b: the "nothing fits" line, chosen on validation
npm run language   # 4: pick what ships (validation only), language test (needs OPENAI_API_KEY in ../.env)
npm run export     # 5: write src/taste/model.json, web/public/taste/model.json, src/taste/parity.json
```

`data/` (19.6 GB of downloads, embeddings, run logs) is not committed. `results/` holds every run's numbers, the language test, the fetch log and what was chosen to ship.

## Data

[Amazon Reviews 2023](https://amazon-reviews-2023.github.io/) (McAuley Lab), three categories. The raw files are
large (reviews 5.78 / 22.6 / 31.4 GB; metadata 2.15 / 5.25 / 11.79 GB; 5-core ratings 104 MB / 897 MB / 1.64 GB for
Office Products / Electronics / Home and Kitchen), so the fetch reads only what it needs:

| Category | Ratings read | Metadata streamed | People kept (6+ ratings) | Items |
| --- | --- | --- | --- | --- |
| Office Products | 104 MB (all of the 5-core file) | 2.15 GB (whole file) | 3,999 | 27,962 |
| Electronics | first 160 MB of 897 MB | 5.25 GB (whole file) | 4,000 | 43,483 |
| Home and Kitchen | first 160 MB of 1.64 GB | 11.79 GB (whole file) | 4,000 | 67,685 |

19.61 GB downloaded in all; 11,999 people, 139,130 items. Only the 5-core rating files are used, not the review text.
**Bias to keep in mind:** a partial read of a user-sorted file keeps whichever users come first in it, not a random
sample.

## Model

- Text: the listing's title, then ". by <brand>" (what a web listing always has).
- Embedding: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, 8-bit (q8) ONNX, mean pooling, unit length, 384 numbers.
  The same model in Node (lab) and in the browser (transformers.js 3.8.1, pinned).
- Centring: the mean item is subtracted and each vector re-normalised. Without it, every cosine sat near 0.88.
- Taste: weighted mean of the person's history (liked ≥4★ counts 1, 3★ 0.3, ≤2★ −0.5); in the app, a thing you
  kept counts as liked and one you returned as disliked.
- Projection: W (384 → 128), started from PCA-128, trained with BPR (the next buy against 4 random items from the
  same category, cosine at temperature 0.05, Adam), early stopping on validation NDCG@10.

## How it was checked

Leave-last-out: each person's last purchase is the test item, the one before it validation, and the rest history.
The true item is ranked among 99 negatives from the same category that the person never bought; every method sees the
same negatives. "New products" are test items that appear in no one's training history (6,088 of 11,999), which is the
situation for web listings. The configuration that ships was chosen on validation only.

Test results (11,999 people):

| Method | Top 10 of 100 | NDCG@10 | AUC | Top 10, new products |
| --- | --- | --- | --- | --- |
| random order | 9.9% | 0.045 | 0.494 | 10.0% |
| popularity (training counts) | 22.7% | **0.147** | 0.393 | 0.0% |
| raw cosine (centred embedding) | 21.8% | 0.121 | 0.597 | 20.6% |
| PCA-128 start | 21.5% | 0.118 | 0.596 | 20.2% |
| **trained projection (ships)** | **23.2%** | 0.130 | **0.611** | **21.2%** |

Configurations compared on validation NDCG@10: K=128 centred trained **0.140** (ships); K=32 centred, where training
didn't beat raw cosine, 0.126; K=128 uncentred 0.117; and the first run, K=32 uncentred, 0.109. That first run's
projection was *worse* than raw cosine on test (19.0% vs 19.8%, and 13.8% vs 19.1% on new products).

### What this does and doesn't show

- The model beats random order clearly and the plain embedding by a little (23.2% vs 21.8%). It is not a strong
  recommender: three times out of four, the real next buy is not in its top 10 of 100.
- Popularity is better on NDCG for items it has seen, but has nothing to say about new products, which is what
  Channel3 returns. The app doesn't use popularity.
- Training gives a small gain over the untrained embedding (+1.4 points overall, +0.6 points on new products).

## "Nothing fits"

Checked at the level the app uses: a whole list of listings is "nothing fits" when its best score is under τ. τ was
chosen on validation for the best balanced accuracy between (a) a list holding the person's real next buy plus 9
others and (b) a list of 10 items from another category.

τ = 0.2. On test: a list from another category is flagged 76.3% of the time; a list holding the real next buy is
wrongly flagged 21.7% of the time; a list of 10 random same-category items is flagged 26.0% of the time (no right
answer). A per-item line set at "90% of real next buys pass" was also tried; it almost never fired (0.04% of
other-category lists), so it was dropped. Because of the 21.7%, the app words it as a guess, not a rule.

## Languages

150 held-out people (seeded), each with their real next buy among 19 others from the same category. Their history
stays in English; the 20 listings were machine-translated (the app's OpenAI model, with brand and model names kept)
and embedded in that language. Chance is 25%.

| Listings in | Real next buy in the top 5 of 20 | Mean rank of 20 | Translated title vs English (cosine; title only) |
| --- | --- | --- | --- |
| English | 33.3% | 9.17 | — |
| Hindi | 34.0% | 9.32 | 0.83 (0.81) |
| Bahasa Indonesia | 32.0% | 9.25 | 0.79 (0.79) |
| Brazilian Portuguese | 28.7% | 9.71 | 0.73 (0.73) |

With 150 people each number is ±~4 points, so Hindi and Indonesian are indistinguishable from English, and Portuguese
is weaker (closer to chance). Even in English, top 5 of 20 is only 8 points above chance: the multilingual model
carries the taste signal across languages about as well as it carries it at all, which is modestly.

## Parity

`npm run export` embeds four listings (English, Hindi, Indonesian, Portuguese) and writes their raw embeddings and the
final scores into `src/taste/parity.json`. The weights are rounded to 6 decimals on export; the script refuses to
export if that changes any score by more than 1e-4. `test/taste.test.ts` checks the server's maths against those
scores. `e2e/tests/taste-parity.spec.ts` (`TASTE_PARITY=1`) checks the browser against the lab.

**Browser parity is close, not exact.** Measured on 12 Nov in Chromium: the browser's raw embeddings agree with the lab's
at cosine 0.997 / 0.997 / 0.995 / 0.997 (English, Hindi, Indonesian, Portuguese). Final scores are 0.875 / 0.674 /
0.744 / −0.528 in the browser against 0.876 / 0.662 / 0.729 / −0.514 in the lab, so the largest gap is 0.016. The order
is the same. The cause is the 8-bit model running on onnxruntime-web in the browser and onnxruntime-node in the lab,
whose int8 kernels differ. The test allows cosine ≥ 0.99, scores within 0.03 and the same order. A list whose best
score sits within ~0.02 of τ can get a different "nothing fits" answer in the browser than in the lab.

## Not measured

- Anyone using Everyday: the people here are Amazon shoppers; a demo shopper owns only a handful of things.
- Real non-English listings: the language test uses machine-translated titles.
- Whether sorting by taste changes what people buy, or whether they like it.
