# Extraction Truncation Fix

Date: 2026-08-14

## Context

Uploading a real, dense lab report (`Analyser jord 170503 Hera.pdf` — 41 pages, 346 real analyte
result rows, the same Italian Hera soil report used as this project's `fixtures/italian-sample.json`
source) fails with:

> "This PDF appears to be scanned or otherwise unreadable, and automatic extraction from the
> document image was unsuccessful."

That message is false for this file. Root-caused via direct investigation:

- `pdftotext` finds 0 real words in the file — genuinely no embedded text layer, so
  `hasUsableText()` correctly routes it to the native-document (Claude vision) extraction path.
  This part of the system is working as designed.
- The document-mode extraction call to Claude **succeeds at reading the file** — verified
  directly, since Claude's own multimodal read of the same PDF earlier this session produced
  real, correct content from its pages.
- What actually fails is `extractSampleData`'s non-streaming call hitting
  `stop_reason: "max_tokens"` — the report's structured extraction output (346 result rows)
  doesn't fit in the current `max_tokens: 8192` ceiling and gets cut off mid-response.
- `app/api/extract/route.ts` (and `extract-sample/route.ts`) then map **any** extraction
  failure on a document with no usable text to the same "scanned/unreadable" 422 message,
  regardless of the real cause — conflating a genuine OCR/readability failure with an
  unrelated response-length limit.

Empirically verified via a real streaming test against this exact file (not guessed):

| Attempt | Result |
|---|---|
| `max_tokens: 8192` (current) | Truncated |
| `max_tokens: 16000` (non-streaming) | Still truncated, 3.3 min wall time |
| `max_tokens: 32000` (non-streaming) | Anthropic SDK refuses the call outright: *"Streaming is required for operations that may take longer than 10 minutes."* |
| `max_tokens: 64000`, **streaming** | Success — `stop_reason: "end_turn"`, 36,596 output tokens used, 346 real results parsed correctly, 284.3s wall time |

`claude-haiku-4-5` supports up to 64,000 output tokens (confirmed against Anthropic's current
model documentation) — the code was using 1/8th of the real ceiling. Above a certain
`max_tokens` value, the Anthropic SDK's non-streaming `.create()` call refuses to run at all;
switching to the streaming API is both necessary and Anthropic's own recommended pattern for
this situation, not an optional optimization.

Separately confirmed against Vercel's real platform limits: Hobby plan is hard-capped at 300s
per function invocation with **no way to raise it**; Pro/Enterprise can go to 800s via
`maxDuration`. This repo's current/planned Vercel plan is Hobby (or not yet decided) — so the
284.3s observed duration leaves uncomfortably little margin, and an even denser report could
exceed the platform's hard ceiling with no override available.

## Scope of this slice

**In scope:**
- Split the truncation error into its own distinct message in `extractSampleData`'s caller
  logic, so `app/api/extract/route.ts` and `app/api/extract-sample/route.ts` no longer report
  a length-limit failure as "scanned or unreadable."
- Switch `extractSampleData`'s Anthropic call from `client.messages.create()` to
  `client.messages.stream()`, raising `max_tokens` from 8192 to 64000 (Haiku 4.5's real
  ceiling — no cost penalty, since billing is by actual tokens generated, not the ceiling).
- Make a `max_tokens` truncation non-retryable: `MAX_EXTRACTION_ATTEMPTS`'s retry loop
  currently retries an identical call on any failure, including truncation — retrying a
  truncated call with the same `max_tokens` value is a guaranteed-identical failure that wastes
  a second multi-minute attempt. Other error types (network, JSON parse) keep retrying as today.
- Add an explicit timeout (via `AbortController`, ~270s) around the streaming call, since this
  repo may run on Vercel Hobby (hard-capped at 300s, no override possible) — if the timeout
  fires, return a clear, honest "this report is too large/detailed to finish processing in the
  time available" message, rather than letting Vercel's platform-level kill produce a generic,
  unexplained failure.

**Explicitly out of scope:**
- Multi-pass/chunked extraction (splitting one report's extraction across multiple Claude
  calls) — a real, larger architectural change, not needed for the report that surfaced this
  bug (it used 36,596 of the new 64,000-token ceiling, well within the new limit). If a future
  report is ever dense enough to still truncate at 64k, that's a signal for this follow-on work,
  not something to build speculatively now.
- Any change to `hasUsableText()`, the Stage A sample-detection call (`listSamples`), or the
  text-vs-document routing decision — all confirmed working correctly for this file; only the
  Stage B extraction call itself and its error handling change.
- Any change to `analyte-reference.json` or the substance-matching logic — this report's 230
  unmatched analytes (out of 346 total results) reflect the already-known, already-tracked gap
  that the substance reference table only has 18 entries; expanding it is a separate,
  previously-identified future slice, not this one.
- Upgrading the Vercel plan or otherwise changing deployment infrastructure — the fix must work
  honestly within Hobby's real constraints, not assume a plan upgrade.

## Logic — `lib/hp-classification/extract.ts`

`extractSampleData` changes from `client.messages.create(...)` to `client.messages.stream(...)`,
awaiting `.finalMessage()` to get the same `Message` shape the rest of the function already
consumes (`stop_reason`, `content`, etc. — no downstream parsing logic changes). `max_tokens`
becomes `64000`.

The retry loop distinguishes truncation from other failures: when `stop_reason === "max_tokens"`,
the function throws a distinctly-typed/tagged error (e.g. an `ExtractionTruncatedError` class, or
an error whose message the caller can pattern-match on) and the loop does not retry it — it fails
immediately on the first occurrence rather than burning `MAX_EXTRACTION_ATTEMPTS` on an identical,
predictable re-failure.

A wrapping `AbortController` with a ~270s timeout guards the streaming call. If it fires before
`.finalMessage()` resolves, the function throws a distinctly-typed timeout error, again not
retried (retrying an already-270s-consuming call would only compound the risk of exceeding
Vercel's hard 300s ceiling on Hobby).

## Wiring — `app/api/extract/route.ts` and `app/api/extract-sample/route.ts`

Both routes' current error-mapping collapses every extraction failure on a no-usable-text
document into the same "scanned or unreadable" 422. This becomes a three-way branch:
- A genuine extraction failure on a document with no usable text (the original, narrower
  case) → the existing "scanned or unreadable" 422 message, unchanged.
- A truncation error → a new, distinct 422 (or 503) message explaining the report is too
  large/detailed for a single extraction pass, not that it's unreadable.
- A timeout error → a new, distinct message explaining processing didn't finish in the
  available time, distinct from both of the above.
- Any other error on a document that DOES have usable text → the existing generic 502 path,
  unchanged.

## Testing

- Unit tests for `extractSampleData`'s retry logic: a mocked truncation response is not
  retried (only 1 call attempt observed), while a mocked transient/parse-error response is
  retried up to `MAX_EXTRACTION_ATTEMPTS` times, matching existing behavior.
- Unit tests confirming the three new distinct error paths in both route files return the
  correct, distinct messages for truncation vs. timeout vs. genuine unreadability — not the
  same conflated message for all three.
- No new live-API test is added to the automated suite (the real 284s empirical test that
  grounded this design was a manual, one-off verification against the real Hera report, not
  something to run in CI) — this matches the project's existing pattern of manual verification
  against real fixtures for anything requiring a live Anthropic API call.
