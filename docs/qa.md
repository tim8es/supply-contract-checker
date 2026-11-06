# Reproducible QA and 10-minute demo

## Automated checks

```bash
npm test
node scripts/analyze.mjs --input documents --date 2026-03-10
```

Current suite consists of **121 Node test cases**, including an independently specified **24-scenario synthetic wording corpus**, grouped by:
- basic acceptance (six supplied documents, expected amounts and deadlines);
- exact provenance and non-invention of missing values;
- new contract with different filename/number/amount/date;
- wording variants, multiline clauses and long-form Russian dates;
- proposals vs effective signed amendments;
- signed-at vs effective-date chronology;
- conflicting amendments, duplicate base documents, wrong counterparty and ambiguous amounts;
- CLI output and integration JSON;
- adversarial old→new amount/deadline extraction, including signed amendments;
- conservative invalidation of stale terms when signed amendments clearly change a field without extractable values;
- value history and original evidence for unresolved changes;
- later signed corrections and effective dates written in Russian words.
- exact source-span, file, numeric/date token and normalized value validation;
- optional penalty extractor: daily rate versus cap, signed/unsigned amendments, CLI and JSON;
- a separate non-gating **36-case synthetic holdout** with precision/recall and a permanent list of failures;
- adversarial payment/signing/acceptance dates preceding delivery in the same paragraph, and a legitimate contract price adjacent to an advance or penalty cap.

GitHub Actions runs real headless Chrome through the Chrome DevTools Protocol: loads `/?demo=1`, verifies three rendered contracts, clicks the «До 01.04.2026» filter, opens the STN-101 amount with highlighted original citation, additionally opens the penalty rate and its original source, then uploads a new TXT via the File API and checks its extracted amount/date. A separate DOM smoke test and desktop/mobile screenshots accompany PR CI.

**Limits:** these checks do not exercise every date picker state, export download or every interaction; manual validation remains necessary.

## Manual acceptance checklist

1. Open `http://localhost:8080/?demo=1` (or published Pages URL after merge). Expect 6 TXT, 3 contracts, 5/6 supported current fields, 1 contract needing review, 2 proposals.
2. STN-101 → amount 1 380 000 ₽; deadline 30.04.2026. Click each **«Проверить источник»**. The inspector must cite `02_amendment_signed.txt`, exact paragraph and line; source text must highlight that paragraph. **История условия** должна показывать 1 200 000 ₽ («Исходное условие») и 1 380 000 ₽ («Действует»), со ссылками на оба оригинала.
3. STN-102 → amount 840 000 ₽, deadline 20.03.2026. The letter proposing 27.03.2026 must remain a separate non-effective proposal. Clicking its citation opens `05_supplier_email.txt`.
4. STN-103 → **«Нет данных»** amount and penalty rate; 30.04.2026 deadline. The budget limit 600 000 ₽ must not be shown as the contract value.
4a. Check the optional penalty-rate column: STN-101 **0,1%/day**, STN-102 **0,05%/day**, STN-103 **«Нет данных»**. Clicking a rate must show the original clause; the maximum cap (10% or 5%) must not be shown as a daily rate.
5. Click «До 01.04.2026»:  expect only STN-102 and only its unsanctioned deadline proposal. «На проверку»: expect STN-103. Use search by number/supplier.
6. Change the date to 28.02.2026: STN-101 should return original 1 200 000 ₽ and 15.04.2026; as of 10.03.2026 the signed amendment applies.
7. Download JSON: expect `schemaVersion=1.0`, date, 3 contracts, 2 separate proposals and original quotations.
8. Modify the numeric amount or deadline in one TXT, upload updated set, verify changed number and quote. Rename TXT files: results must depend on text, not filename.
9. Add another TXT contract (any compliant identifier such as `ABC-204`, explicit signed status, recognized amount and delivery wording), upload it with the existing six. Expect fourth row.
10. Upload a document missing amount and date; it must say **«Нет данных»** and require review. Upload two conflicting base documents with the same ID; it must not silently choose one.
11. Create a signed effective addendum that explicitly changes the amount but describes it via a missing specification: the old amount must become **«Нет данных»**, and its history must link to the triggering amendment paragraph.
12. In a signed effective addendum, use `Изменить сумму договора с 1 200 000 рублей на 1 380 000 рублей` and `Перенести срок поставки с 15.04.2026 на 30.04.2026`: the parser must show **new** values, not old ones.

13. In one paragraph put `Оплата до 10.04.2026. Поставка до 03.04.2026`: the active delivery date must be **03.04.2026**, not the earlier payment date. Separately check that `Цена договора 900 000 рублей. Аванс 270 000 рублей.` reports **900 000 рублей**.

## Known limitations and future QA

- New supplier price terms like `«фактическая цена определяется каждой заявкой»` may require a different result type than a scalar price; current app says «Нет данных».
- Dates in relative business-day form are not calculated and should receive manual review.
- Contract numbers with exotic punctuation not covered by `ID_RE` can become unlinked; this is visible in issues.
- No PDF, DOCX, OCR, arbitrary contracts, signature validity, continuous deployment to on-prem environments, user accounts or document permissions.
- Synthetic 36-scenario benchmark is available and exposes all misses; **no real-domain extraction benchmark**. For production, build a consented anonymized corpus, define field-level precision/recall and provenance match, stratify by document source/template and version rule changes.

## Example debugging trace

During an early run, a new contract without blank lines produced the wrong deadline: the signing date **10.03.2026** was mistaken for the delivery date **19.03.2026**. The exact test failure identified an incorrect block boundary. The parser was corrected to split unnumbered field paragraphs, tests were rerun and passed. This is the kind of failure an evaluator can ask to reproduce.
