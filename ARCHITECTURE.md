# Architecture Decision Record — Semantic TextNavigator MVP

## Design goal

For one procurement user, expose effective contract price and deadline **as of a selected date**, with explicit provenance. Err on the side of **"нет данных / нужна проверка"** when the evidence is ambiguous. The educational rule is: only an addendum signed by *both* parties and effective by the check date modifies the base conditions. File order, name and upload timestamp never determine legal priority.

The test dataset is a six-file synthetic corpus. Arbitrary Russian legal prose remains out of scope for a rules-only MVP; misclassification must be measurable and reviewable, not hidden by confident UI.

## System context

```text
                  browser (no upload / secrets)
      ┌─────────────────────────────────────────────────┐
      │  HTML/CSS/ESM interface on GitHub Pages         │
TXT ──┤  file input → engine.mjs → result object         ├──> Review, citations,
      │  local search, date and filters, JSON export     │     downloadable JSON
      └─────────────────────────────────────────────────┘
                             ▲
                             │ GitHub Pages static deploy
                    GitHub Actions (test + Chrome smoke)
                             │
                      optional offline batch
                  scripts/analyze.mjs → JSON artifact
                             │
                       external importer / n8n
```

**Why not call GitHub Actions on each upload?** Actions is an event-driven CI job runner, not a low-latency public HTTP endpoint. A browser-triggered `workflow_dispatch` would require a private GitHub token on the client or a separate trusted broker. The runner queue and cold startup add seconds/minutes, so local parsing is the correct execution strategy for small TXT files.

## Data flow and invariants

1. **Input:** raw `{name, text}` objects, with `File API` used in the browser and file system in the CLI. Filename is only for provenance. File contents are never published by the browser.
2. **Segmentation:** preserve original lines, make paragraph/numbered-clause blocks with `startLine` and `endLine`. Flatten whitespace only for matching, never in the stored quote.
3. **Classification:** heading + explicit textual status → contract, addendum, draft, letter, unknown. Detect number in *content*, not name. Multiple matching numbers or an unrecognized type create a review issue.
4. **Extraction:** independent candidates for supplier, amount and delivery date. Lexical patterns exclude payment, budgets, advance and penalties as contract price; delivery match excludes unrelated payment dates. Recognized date formats: ISO, `dd.mm.yyyy` and selected Russian long dates. Different explicit candidate values in the same document do not silently overwrite each other: ambiguous → `null`.
5. **Association:** group by contract ID. Reject duplicates as unreliable. Documents that cannot be linked are surfaced.
6. **Temporal policy:** accept addendum modification iff status says signed by both parties, signing date is present and ≤ asOf, effective date present and ≤ asOf, base contract signed by asOf and parties are consistent when available. Otherwise preserve previous conditions and display review reason. Signed effective amendments are ordered by **effective date**; contradictory modifications at equal effective dates cause the affected field to become unavailable for review.
7. **Proposals:** drafts/letters never change active conditions, even if they mention a future value. Their candidates are separately displayed.
8. **Output:** `{schemaVersion:'1.0',asOf,contracts,issues,documentCount}`. Every populated field contains a verbatim source quote, document filename and line interval. `null` is the only representation of missing/inconclusive data.

### Illustrative model

```js
{
  id: 'STN-101',
  supplier: 'ООО «Вектор Прибор»',
  amount: {
    value: 1380000,
    evidence: {
      file: '02_amendment_signed.txt',
      line: 6,
      endLine: 6,
      quote: '1. Пункт 2.1 договора изложить в следующей редакции: «Общая ...'
    },
    changedBy: '02_amendment_signed.txt',
    effective: '2026-03-01'
  },
  deadline: { /* same shape */ },
  proposals: [ /* not applied */ ],
  review: []
}
```

This is an illustrative shape; the actual exact quote is preserved in full by the engine.

## Integration boundaries

Core `src/engine.mjs` is a pure ESM module (no DOM or network). `analyze(files,date)` returns the full in-memory result, `toPublicResult` yields a stable public JSON DTO. The CLI `scripts/analyze.mjs` adapts it to a folder. The versioned [JSON Schema](schema/result.v1.json) defines the transport contract.

For integrations: trigger a batch through n8n or a scheduled job with a trusted runner. A future upload webhook should **not** use public GitHub Pages as a secret-bearing relay. If server-side user uploads are added, introduce authentication, object storage, a queue and worker. See [docs/integration.md](docs/integration.md).

## Security and privacy

- No GitHub secrets, LLM credentials, or API keys inside the browser.
- User TXT stays in the browser; no analytics or external SDKs are requested.
- Text nodes use `textContent` and `createTextNode` instead of inserting untrusted HTML.
- Max 100 TXT / 2 MB each in the UI, duplicate filenames rejected to protect source addressing.
- Synthetic fixture documents are public and committed only for demos. **Never commit confidential procurement documents.**
- The engine reads textual signature labels: this is *not* cryptographic signature verification. `needs review` is operational guidance, not a legal verdict.

## Trade-offs

| Decision | Advantage | Limitation |
|---|---|---|
| Rules and context constraints, no LLM in hot path | Fast, free, reproducible, explainable | Limited linguistic coverage; unseen expressions may become "нет данных" |
| Citation-first value object | Auditable and naturally exportable | More metadata and parsing complexity |
| Browser-first compute | Privacy and zero backend operation | No shared audit trail, roles, persistent history |
| GitHub Pages/Actions | Easy reproducible deployment and CI | Not a synchronous webhook/server |
| Failing conservatively on conflicts | Avoid incorrect authoritative values | More manual review on difficult documents |

## At 100,000 documents

Do not multiply browser upload caps or run a GitHub job per user request. Evolve to:

- **Ingestion API / queue:** authenticated streams, idempotency keys, virus scanning, retriable jobs, backpressure and dead-letter queue.
- **Storage:** encrypted object store for versioned raw documents; PostgreSQL for contracts, relation graph, extracted values, revisions, provenance and human approvals; full-text or hybrid index for retrieval.
- **Workers:** independent classification, OCR/conversion, field candidate extraction (rules + optional model), provenance verifier and temporal policy evaluator.
- **Access:** user/org auth, RBAC+ABAC for document and segment, row-level security where appropriate, audit log and deletion policies. Model inference should not receive unauthorized documents.
- **Ops:** extraction-quality dashboard, drift tracking, versioned parsing rules, explainable reprocessing, queues and SLOs. GitHub Actions remains CI/CD and offline controlled batch only.

## Extension seam: penalty rate

Add `penaltyRate` as a new field extractor to `engine.mjs`, keep `{value,evidence,changedBy,effective}` and add cases to `tests/`. Do not confuse a daily percentage with a total cap. Existing UI evidence renderer can show another field without a new backend. This can be a useful live demo of extending the system with AI assistance and regression tests.

## Quality gate

`npm test` tests the six accepted fixtures, new contracts, variations, missing values, contradictory documents, signed-at chronology, party matching, original citations and CLI. The CI workflow starts a static server and uses headless Chrome with `?demo=1` to verify that the complete DOM renders the expected document rows. A screenshot artifact is attached to PR builds for visual review. These checks establish regression coverage, **not** validity on all legal documents.
