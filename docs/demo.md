# 10-minute demonstration and 30-minute live extension

## Before meeting

Open https://tim8es.github.io/supply-contract-checker/?demo=1 and set the check date to 10 March 2026.
A local fallback is available using Python's built-in HTTP server on port 8080.
Run the commands: npm test, npm run benchmark, and node scripts/analyze.mjs --input documents --date 2026-03-10 --with-penalty.

## Walkthrough

| Minute | Demonstration | Key message |
|---|---|---|
| 0–1 | Start with the procurement user's task. | The user wants current price and deadline with a direct source, not chat. |
| 1–3 | STN-101 amount 1,380,000 RUB and delivery 30.04.2026. Inspect citations and history. | Only the signed effective amendment supersedes original terms. |
| 3–4 | STN-102 amount 840,000 RUB, delivery 20.03.2026, open supplier letter. | 27.03.2026 is only an unapproved proposal. |
| 4–5 | STN-103 amount missing and deadline 30.04.2026. | Internal budget 600,000 RUB is not contract amount. |
| 5–6 | Filter for deliveries before 01.04.2026. | Only STN-102 qualifies, with a pending date proposal. |
| 6–7 | Open optional penalty rate for STN-101 and original clause. | Rate is 0.1% per day, not the 10% maximum cap. |
| 7–8 | Upload previously unseen TXT with a new number, amount and deadline. | No hardcoded contract identifiers or values. |
| 8–9 | Run npm run benchmark, inspect all misses. | 100% precision / 84.21% recall on synthetic holdout, nine misses; not production accuracy. |
| 9–10 | Explain architecture and limits. | Separate candidate extraction, source verification and temporal policy. |

## Live extension challenge (next 30 minutes)

Penalty-rate is already implemented as a plugin. For a genuine live change, choose a DIFFERENT field, such as warranty period, and:

1. Add a field extractor in src/extractors/ with key, label, parseToken, extract and changedIntent.
2. Return value and evidence with file, line, endLine, quote and valueText, or return null.
3. Register the descriptor through the optional extractors array in analyze().
4. Add tests for base value, effective signed amendment and unsigned proposal.
5. Run npm test, show the exact original clause and describe known limitations.

Do not invent a missing field. Preserve existing price/delivery behavior.

## Interview discussion

**Why no model in the hot path?** The task is small Russian TXT; determinism, explainability and offline operation dominate. The measured recall deficit is evidence of a future optional model opportunity, not an excuse for unmeasured model integration.

**Does benchmark precision equal real-world accuracy?** No. The corpus contains 36 manually authored synthetic cases, not real customer agreements. All nine omissions remain visible in a report.

**Does a verified quote prove the agreement is legally effective?** No. The verifier proves exact original bytes and reconstructable value token. Applicability uses separate rules for signed parties, signing date, effectiveness, amendments and conflicting documents. Digital signatures are not authenticated.

**Why not GitHub Actions as an online API?** Actions queues ephemeral jobs and is not a synchronous, secret-bearing public server.

**What changes at 100,000 documents?** Authorized ingestion API, queues, encrypted object storage, search indexes, idempotency, audit logs and document-level ACL.

## Exit checklist

All four required procurement questions answerable from citations; new TXT upload; missing amount remains missing; draft and letter not effective; extension proven; Node tests, interactive Chrome scenario and publication pass; quality benchmark discloses failure cases.
