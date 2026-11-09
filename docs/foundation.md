# Everyday foundation and widening (roadmap Part B and C.4), November 2026

- **B.1 Model path** `src/ai/provider.ts` (tiers vision/read/classify, strict schemas, replay, `ai_calls`), `src/ai/grounding.ts` (on-image instructions quarantined).
- **B.2 Traces** `src/trace.ts`; `/traces`, `/trace/:id`, `/api/v1/runs`.
- **B.3 Agents** `src/mcp/tools.ts` shopper server at `/mcp` (Bearer shopper key) and read-only merchant server at `/merchant/mcp` (Bearer merchant key); skill `skill/SKILL.md` at `/skill.md`; `/llms.txt`.
- **B.4 Evals** `src/eval/store.ts` (`eval_runs`), `src/eval/capture.ts` (rules/model), `src/eval/adversarial.ts`, `src/core/techjam.ts`; `POST /console/eval` runs them; explorer `GET /console/eval` with slices and `/console/eval.csv`; reports `/console/{capture,adversarial,techjam}.md`.
- **B.5 Owner trust** `src/guard/` (plain-words mandate → rules, backtest, dry run, approvals by click or passkey, kill scopes, hash-chained audit); `/guard` (shopper), `/merchant/approvals` (merchant).
- **B.6 PayPal depth** orders and captures with request ids, refunds, saved PayPal (vault) and repeat buys, tracking numbers, disputes with evidence packs, transactions, negative test, webhook verify and dedupe.
- **B.7 Channels** `src/channels/` (Telegram, WhatsApp, simulator `/channels`, web push), PWA.
- **B.8 Purchase passport** `/passport`, Channel3 product search with catalog fallback (`src/services/channel3.ts`).
- **B.9 Structural tests** `test/structural.test.ts`, route list in `test/foundation-routes.ts`.
- **B.10 Evidence and judge mode** `/console/evidence`, `/judge`.
- **C.4 Everyday** TechJam-style protocol eval reimplemented (no TechJam material copied), screenshot reading, merchant money desk.

Simulated or not built: chat delivery without tokens; push without VAPID keys; Channel3 without a key; per-judge isolation; WebAuthn attestation. Eval numbers are regression suites on synthetic cases.
