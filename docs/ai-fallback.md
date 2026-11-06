# Optional BYOK AI fallback

The main Supply Contract Checker is **offline-first and functional without a
model or API key**. The AI mode is optional and starts only when the procurement
user explicitly clicks **«Уточнить пропущенные поля через AI»**.

## Why the original sample may not change

The six initial files are **not an AI quality demonstration**: rules already
extract all available agreed amounts/deadlines except a missing STN-103
contract price, which lives in an absent annex. No model can legitimately
supply this value from the uploaded text. A correct fallback returns null.

**To observe a measurable difference**, open
[the separate AI demo](https://tim8es.github.io/supply-contract-checker/?ai-demo=1)
or click the **«Открыть сложный пример для AI»** button. It loads a seventh
synthetic TXT *instead of* the original six. Its price and delivery date
are stated in unfamiliar but explicit wording; the deterministic parser
starts with two missing fields. After a real API call, the comparison
panel shows each original missing field, any verified-by-source new value,
and why a field remained unknown.

The comparison reports separately: fields for which the model returned
null, proposals rejected by the citation/context checker, and network/API
failures. It never fabricates a result or pretends a model was called.
Unit and browser E2E tests use a fake provider to verify this workflow;
they are **not** evidence of any particular external model's accuracy.

## How to use

1. Open the public or local HTML app and upload TXT documents as usual.
2. Expand **Дополнительный AI-анализ**.
3. Enter a complete OpenAI-compatible **Chat Completions endpoint**, e.g.
   `https://your-provider.example/v1/chat/completions`.
4. Enter the provider's exact model identifier and your own API key.
5. After reading the external-data-transfer warning, click the AI action.
6. Inspect each proposed value in the table (badge **«ИИ · проверить»**),
   click its exact source quote, and verify the semantics manually.
7. Click **Удалить AI-результаты и ключ** when finished.

A model is not bundled. This is a **bring-your-own-key** capability.
Provider charges may apply. The app does not validate credentials until the
user executes the explicit action. **There is no live-model quality claim**
for the current benchmark.

## What leaves the browser

At most **12** relevant TXT source documents per action, each at most
**14,000 characters**, submitted to the API selected by the user.

Only signed base contracts missing an extractable amount/deadline and signed
effective amendments with unresolved relevant terms are eligible. The
fallback deliberately excludes drafts, letters, unknown or unlinked files,
unsigned/future addenda, duplicate base contracts, cross-supplier addenda
and already extracted fields.

Requests contain the selected file name, source paragraph texts with line
numbers, the missing field names and an extraction instruction. **No other
uploaded files are transmitted**, and no document is uploaded by merely
opening or loading the app.

The browser sends your API key as an Authorization Bearer header **directly**
to the endpoint you entered. The app does not send it to GitHub, save it to
localStorage, write it to disk, include it in exported JSON or log it.
The key remains in the page's password field until cleared/reloaded.

**Trust warning:** A provider or browser extension can observe a request to
that provider; read its data-retention terms. Do not send restricted
procurement documents without organizational authorization. This browser
prototype has no secure enterprise identity, user authentication, DLP or
server-side API budget controls.

## API behavior and technical limitations

- HTTPS is required, except localhost HTTP for local model testing.
- Provider must accept browser-origin cross-site requests (**CORS**). Many
  commercial endpoints deliberately block browser direct calls. This mode
  **cannot bypass CORS**. Use a trusted, access-controlled backend if needed.
- Endpoint must end in `/chat/completions` (full path, not the base URL).
- Expected API shape: `POST` of model/messages/temperature/max_tokens,
  response in `choices[0].message.content` containing a small JSON object.
- JSON with a fixed `blockLine` and literal `valueText` is reconstructed
  locally from the uploaded source, not trusted as an opaque quote.
- The existing source verifier then requires an exact original line span,
  verbatim full quote, reconstructable amount/date and a local term context.
- Finally, the deterministic temporal policy handles signing, effective
  dates, linkage and priority. **The model cannot change legal status.**
- Even if a candidate passes every mechanical check, **its interpretation
  may still be wrong**. An AI-assisted field is visibly flagged for manual
  review and exported with `via:"ai"`.
- Only previously missing base amount/deadline fields or relevant effective
  signed amendment terms can be filled. AI is not permitted to override
  reliable rule-based extraction or resolve already detected contradictions.
- Relative dates, handwritten signatures and arbitrary legal language are
  outside supported guarantees.

## Reproducible QA (without API key)

Use `npm test`. The tests use fake API responses to verify request shape,
no unintended transfers, bounded target selection, data isolation, source
checks, false amount/date rejection and the unchanged signing rules.

The Chrome browser smoke test also intercepts a **fake** provider endpoint
and checks the full upload → explicit AI click → cited result → reset flow.
These checks do not prove an external provider will enable CORS or follow
the requested JSON protocol. A live provider integration test needs an
explicitly supplied key and permission to transmit non-sensitive fixtures.

## Architecture

```text
Upload TXT → deterministic parser → missing fields only
       └─ no network without explicit click
Click AI → allowlisted eligible signed documents → user's API endpoint
       → model returns proposed blockLine/valueText (not document status)
       → original-line quote reconstruction + evidence verification
       → deterministic signed/effective-date policy
       → visible review badge and source navigation
```

No GitHub Actions runner or database is needed for inference: Pages remains
a static front end; CI and batch workflows run without an API key.
