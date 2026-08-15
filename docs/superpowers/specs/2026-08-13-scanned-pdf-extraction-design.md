# Scanned PDF Extraction — Native Claude Document Input

Date: 2026-08-13

## Context

`app/api/extract/route.ts` currently extracts text from an uploaded PDF via `pdf-parse`, then structures it into the HP1-15 engine's schema via a Claude text prompt (`extractSampleData()` in `lib/hp-classification/extract.ts`). This fails for scanned/image-only PDFs — `pdf-parse` returns only page-marker boilerplate (already correctly detected and rejected as "no extractable text" by a fix in the prior UI-wiring slice). The project's own regression-fixture PDF (the real Italian LabAnalysis report) is exactly this kind of scanned document, so it currently cannot be classified through the live UI at all, only through the hand-transcribed fixture used by the automated tests.

## Decision: native PDF input, not image-rendering OCR

An earlier version of this design proposed rendering PDF pages to images (via `pdftoppm`/poppler, already installed locally) and sending them to Claude as vision input. That was rejected once the deployment target (Vercel) was clarified: poppler is a native binary with no guarantee of being present in a Vercel serverless function, and rendering-then-vision adds real complexity (subprocess management, per-page image count vs. token-budget tradeoffs, multi-image message construction).

The actual fix is simpler and more portable: Claude's Messages API accepts a PDF directly as a `document` content block (base64-encoded bytes) and reads it natively — no pre-rendering, no subprocess, no native binary dependency, nothing to deploy differently on Vercel than locally. This also resolves the earlier "how many pages to send" question by construction — Claude's document input handles the whole file in one call; there's no manual page-by-page image budget to design around.

## Scope of this slice

**In scope:**
- A second extraction path in `lib/hp-classification/extract.ts` that sends the raw PDF as a `document` content block instead of extracted text.
- Wiring `app/api/extract/route.ts` to try `pdf-parse` first (unchanged, fast path for normal text-layer PDFs) and fall back to the native-PDF path only when the existing (already-fixed) emptiness check fires.
- Verifying `claude-haiku-4-5` (the model already used for extraction) supports PDF document input — if it doesn't, deciding and implementing the correct model choice for this call, with evidence, not a guess.
- Manual verification against the real, currently-unclassifiable Italian sample PDF via the local dev server.

**Explicitly out of scope:**
- Image-rendering OCR (`pdftoppm`, `pdfjs-dist` canvas rendering, or any vision-per-page approach) — rejected per the decision above, not deferred as a "better" alternative.
- Any change to the text-based extraction path's prompt, validation, or behavior for normal (non-scanned) PDFs — it stays exactly as-is.
- Handling PDFs beyond Anthropic's own document-input limits (page count / file size caps on the Messages API) — if the real report or a future report exceeds those limits, that surfaces as an honest error from the API, not something this slice engineers around.

## Architecture

**`lib/hp-classification/extract.ts`** — `extractSampleData()` gains a PDF-bytes parameter alongside its existing `pdfText` parameter. Internal logic: if `pdfText` (after the same page-marker-stripping used by the route's emptiness check) is non-empty, build the existing text-based prompt as today. If it's empty, build the same schema/analyte-matching instructions but send them alongside a `document` content block carrying the raw PDF bytes (base64), letting Claude read the document directly instead of embedded text. Both paths use the same response parsing, `validateExtractionResponse`, and retry-once-on-malformed-response logic already in place — only the request construction differs.

**`app/api/extract/route.ts`** — after computing `pdfText` via `pdf-parse` as today, instead of returning the 422 immediately when the stripped text is empty, it passes both the (empty) `pdfText` and the raw PDF `Buffer` to `extractSampleData()`, which internally decides which path to take. The 422 "no extractable text" response becomes the genuine last resort: only returned if the native-PDF Claude call itself throws (e.g. corrupted file, unsupported format, API-side rejection) after its own retry attempts are exhausted.

**Model verification**: before implementation proceeds past writing the plan, confirm via Anthropic's current API documentation whether `claude-haiku-4-5` supports the `document` content type for PDFs. If not supported on Haiku, the plan must specify the actual model to use for this one call (likely a Sonnet-tier model, since PDF document understanding has historically required stronger models) — this is a concrete decision the plan needs to make with real evidence (checked docs, not assumption), not something deferred to "figure out later."

## Testing

- `validateExtractionResponse` tests are unaffected (already document-format-agnostic).
- A new test confirms `extractSampleData()` selects the PDF-document code path when passed empty/near-empty text, mirroring the route's own trigger condition — this can be tested by asserting on the request shape the function would construct (e.g. via a seam that exposes which prompt-building path was taken) without needing a real network call, matching the existing test file's no-network-calls-in-unit-tests discipline.
- Manual verification (the real proof): with the local dev server running, upload the real Italian sample PDF (`/Users/evenmyrennybo/Downloads/avfallskoderanalyserogtillatelserkonsesjonerformotta/Analyser jord 170503 Hera.pdf`) through the actual wizard Upload step, and confirm extraction now returns real analyte matches (not an empty result) — proceeding on to the Extraction review step where they can be reviewed/edited as already built. This is the exact PDF that exposed the original gap, so it's the correct proof this fix works, not a synthetic substitute.
