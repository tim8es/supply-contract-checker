# Baseline · Synthetic holdout v1

**Frozen inputs:** [36 scenarios, 72 fields](./holdout.mjs). The corpus and
gold labels were added before the verifier and extractor-registry changes.
It is **not** a blinded external dataset and is **not** real-world accuracy.

**Baseline CI run:** [42123442884](https://github.com/tim8es/supply-contract-checker/actions/runs/42123442884).
Run `npm run benchmark` to reproduce the detailed table; CI also uploads
`benchmark.json` and `benchmark.md` as artifacts.

| Quality signal | Baseline |
|---|---:|
| Correct-value precision | **100%** |
| Correct-value recall | **84.21%** |
| Exact source quotation + claimed value present (conditional on TP) | **100%** |
| False authoritative results | **0** |
| Missed values (false negatives) | **9** |
| Correctly absent / abstained values (true negatives) | **15** |
| Cases | 36 |
| Field labels | 72 |

> **Precision caveat:** on a tiny, synthetically generated dataset, 100%
> precision does not establish production-level reliability. The evidence
> check verifies byte-for-byte quotation and occurrence of the claimed
> number/date, **not its legal interpretation**.

## All baseline misses (kept visible)

| ID | Field | Pattern currently missed |
|---|---|---|
| 302 | Amount | `Стоимость продукции ... равна` |
| 303 | Amount | `Совокупная цена партии ... составит` |
| 303 | Deadline | `оборудование передается покупателю до` |
| 304 | Deadline | `передача всей партии осуществляется` |
| 306 | Deadline | `поставка планируется` |
| 307 | Amount | `сумма договора составит` |
| 308 | Deadline | `весь товар должен быть поставлен до` |
| 309 | Deadline | `срок передачи продукции` |
| 322 | Amount | price and advance in one parsing block; the safety exclusion is overly broad |

All nine are **abstentions**, not incorrect authoritative prices/dates.

## Product decision

The extractor is deliberately conservative. Avoid blindly adding all
nine phrases to the recognizers: such a change could increase recall at
the expense of hallucinated authoritative values. A future revision should
first add *separate* safety regression cases, then compare precision and
recall against this frozen baseline and a fresh, previously unseen corpus.

## What this does not measure

- Digital signature validity.
- Independent real-world field extraction quality.
- Precision on unseen supplier templates, including arbitrary Russian legal terms.
- Throughput/latency with 100,000 documents and role permissions.
- How quickly actual procurement professionals complete verification.

These require consented anonymized real documents, human annotations and
a defined sampling protocol. Until then, the baseline is an honest
regression/coverage instrument, not a production readiness certificate.
