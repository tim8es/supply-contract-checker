# Context-localized extraction audit

This report compares the initial synthetic benchmark against the engine
after targeted safety corrections. The 36 documents and 72 labels are unchanged.

## What triggered the changes

The review uncovered a **false authoritative delivery date** not represented
in the original holdout: a payment date preceding a delivery date within the
same paragraph could be mistaken for the deadline. Independent adversarial
tests were added *before* fixing the implementation.

Another gap: legitimate contract price could be dropped entirely if a
separate advance or penalty statement shared its paragraph.

The implementation now evaluates dates and monetary anchors within local,
clearly separated clauses while keeping the complete original evidence block.
Multiple conflicting delivery dates without an explicit old-to-new transition
remain ambiguous and require review.

## Measured change (synthetic corpus only)

| Metric | Baseline | After context audit |
|---|---:|---:|
| Correct-value precision | 100% | **100%** |
| Correct-value recall | 84.21% | **85.96%** |
| Correctly grounded quotes on correct values | 100% | **100%** |
| Incorrect authoritative values | 0 | **0** |
| Missed values | 9 | **8** |
| True negatives | 15 | **15** |
| Cases / fields | 36 / 72 | 36 / 72 |

The original missing price in scenario 322 (price plus advance) is now
recognized. All other eight synthetic misses remain visible:

| Scenario | Field |
|---|---|
| 302 | amount |
| 303 | amount |
| 303 | deadline |
| 304 | deadline |
| 306 | deadline |
| 307 | amount |
| 308 | deadline |
| 309 | deadline |

## Methodological warning

The initial baseline was recorded before this adjustment. The current result
was *measured again on a known corpus*, so 85.96% must **not** be presented
as blind generalization or production accuracy. It shows a regression-safe
improvement on a disclosed synthetic set. No real-world labels were used.

## Reproduce

Run `npm test` for deterministic regression tests, then
`npm run benchmark` for exact percentages and the full miss table.
GitHub Actions archives both JSON and Markdown benchmark outputs.
The browser E2E also checks the original six contracts, citation navigation,
filtering and an unseen TXT upload.

**Next evidence needed:** a separately sourced, never-used-for-tuning corpus
of anonymized real agreements, labelled independently by procurement/legal
specialists, with per-field precision, recall and abstention rates.
