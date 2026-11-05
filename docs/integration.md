# Integration guide — Semantic TextNavigator

The parsing core has **no server runtime and no third-party dependencies**. Integrators can reuse it in a browser, Node worker, private on-prem service or n8n's external CLI execution. Source files should be UTF-8 TXT. No PDF/OCR support is implied.

## Option A: import as an ESM library

```js
import { analyze, toPublicResult } from './src/engine.mjs';

const files = [
  { name: 'contract-1.txt', text: 'ДОГОВОР ПОСТАВКИ № ...' },
  { name: 'amendment-1.txt', text: 'ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ № ...' }
];

const analysis = analyze(files, '2026-03-10');
const dto = toPublicResult(analysis);
console.log(dto.contracts, dto.issues);
```

The parser receives *content*, not an uploaded filename. It does not fetch any remote resources. Invalid/missing values are `null`; review warnings are returned as arrays.

## Option B: CLI and file-system integration

```bash
node scripts/analyze.mjs --input ./documents --date 2026-03-10 --output ./out/result.json
# or
npm run analyze:demo > example.json
```

Errors are written to stderr and exit with status 1. Successful output uses [JSON Schema v1](../schema/result.v1.json), with `contracts[]`, `issues[]`, `documentCount`, `schemaVersion`, `asOf`.

An importer can map `contracts[].id` to an ERP supplier contract identifier. Do not treat `review=[]` as proof that a real-world signature is authentic. Keep the complete source trace (`evidence.file/line/endLine/quote`) and the exact parser revision for auditability.

## Option C: GitHub Actions as *asynchronous batch*, not a webhook server

Use **Actions → Analyze synthetic contract batch → Run workflow**, choose `as_of`, and obtain `contract-results` (JSON) from the run artifacts. The workflow processes files already committed under `documents/`, **not arbitrary uploads from users**. This is deliberately a demo/integration sample; do not add real confidential contracts to this public repo.

For machine-to-machine automation, a trusted n8n instance could call GitHub's `workflow_dispatch` REST API using a **server-side, least-privilege credential**, monitor the queued run and retrieve the artifact. This requires external always-on n8n or another service. Never embed GitHub credentials in GitHub Pages HTML/JS; Pages cannot receive a private callback.

A future secure upload protocol would use:

```text
POST /batches (authenticated)
  → validate user + file limits
  → encrypted object storage + job record
  → queue and background worker
  → { jobId, statusUrl }
GET /batches/{jobId} (authorized)
  → { state, result?, review? }
```

This protocol is **a proposed extension, not a currently available endpoint**. It requires a real API/service, access controls, artifact retention policy and privacy review.

## Extend a field without modifying the policy engine

The current example lives at `src/extractors/penalty.mjs`. It is a working
optional extractor, not a mock. Import it into a Node batch or browser app:

```js
import { analyze } from './src/engine.mjs';
import { penaltyRateExtractor } from './src/extractors/penalty.mjs';

const result = analyze(files,'2026-03-10',{
  extractors:[penaltyRateExtractor]
});
console.log(result.rows[0].extraFields.penaltyRate);
// value: 0.1 == 0.1% / day, evidence: {file,line,endLine,quote,valueText,verified}
```

Each future field module exports a descriptor with these contracts:

- `key`: stable unique machine-readable field identifier.
- `label`: field title for UI.
- `parseToken(token)`: deterministic normalization of literal text value.
- `extract(doc,{proposedOnly})`: candidate with `value` and
  `evidence` containing `file,line,endLine,quote,valueText`. Return null
  if no trustworthy candidate.
- `changedIntent(doc)`: evidence of a signed addendum that addresses the
  field even if the replacement value cannot be extracted; return null if
  unchanged.

The common source validator checks that the quote is an exact contiguous
line interval in the correct file and that `valueText` reconstructs
`value`. It does not claim the quote is legally authoritative.
The policy layer then applies signing/effectiveness rules, contradictions,
history and proposals **for all registered fields**. Optional values are
in `contract.extraFields` and `contract.history[key]` (and separate
`proposal.extraFields` for unsigned proposals).

CLI example: `node scripts/analyze.mjs --input documents --date 2026-03-10 --with-penalty`.
The default two-field API is unchanged if the extractor is not registered.

**Limit:** this is a programmatic extension, not a marketplace or runtime
loader for arbitrary third-party packages. Only trusted extractors should
be registered.

## Quality benchmark

Run `npm run benchmark` or inspect
[benchmark/BASELINE.md](../benchmark/BASELINE.md). CI publishes machine-readable
JSON and Markdown with scenario-level mistakes as a separate `quality-benchmark`
artifact. The benchmark is deliberately non-gating so failures cannot be
hidden by dropping difficult examples. This is a **synthetic** 36-case set,
not a measurement of generalization to unseen real contracts.

## Optional small classifier/model

A small CPU NER or sequence classifier could run in a **batch** worker/Action for unfamiliar formats, but it should only generate *candidate* `{field, value, source span}` items. A deterministic verifier must require the proposed span to exist verbatim in the source and evaluate signed/effective status separately. If provenance, temporal status or party identity is uncertain, return `null` + `review`. A model is not required for the acceptance scenario.

Trade-off: GitHub-hosted runners are ephemeral and queued, so per-user real-time model inference cannot reasonably run as an Actions webhook; a real backend is needed if multi-user async processing is introduced.

## Compatibility guidance

- Date-only values are ISO 8601 (`YYYY-MM-DD`).
- Amount is a number in RUB, not formatted currency text.
- Evidence line numbers are **1-based**, interval boundaries inclusive.
- `changedBy` = filename of signed applied amendment or `null` for base terms.
- `effective` = effective date for amended field or `null`.
- Proposal values never change active amounts and deadlines.
- Interpret `null` as unknown or contested; do not convert it to 0.
- Integrators should record `schemaVersion` and allow additive fields in new releases.
- Access control and long-term document storage are outside this prototype.
