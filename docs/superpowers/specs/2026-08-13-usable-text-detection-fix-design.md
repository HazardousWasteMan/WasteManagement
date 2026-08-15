# Fixing hasUsableText() — Content-Based, Not Pattern-Based

Date: 2026-08-13

## Context

`hasUsableText()` (`lib/hp-classification/extract.ts`) decides whether `/api/extract` uses the fast text-prompt path or falls back to sending Claude the raw PDF as a native document — the fallback built specifically to handle scanned/image-only PDFs. It currently works by stripping the Italian sample PDF's specific page-marker noise pattern (`-- N of M --`) and checking if anything is left after `.trim()`.

Live testing against a second real report (the Eurofins concrete-sample PDF) found this fails: `pdf-parse` returns 43,400 characters for that file, but only 81 of those characters are real letters/digits — the rest is whitespace and page markers in a *different* format (`1of15`, `2of15`, ...) that the existing regex doesn't recognize. `hasUsableText()` wrongly returns `true`, the text path runs on pure noise, and extraction silently returns an empty result (HTTP 200, everything null) instead of falling back to the native-document path that was built to handle exactly this.

## The real fix: count real words, not strip known noise patterns

Regex-stripping specific noise formats is a losing game — every new report's PDF export tool produces different page-marker text, and each one requires its own regex added reactively after it breaks something. The fix instead asks a positive question: **is there a real minimum amount of actual word content**, regardless of what the surrounding noise looks like.

Verified against both real garbage cases already in hand:
- Italian PDF: 729 chars, checked for runs of ≥4 consecutive Unicode letters → **0** such words found (its only real letters are in "of", too short to count).
- Eurofins PDF: 43,400 chars → **0** such words found.

Both correctly score zero under a word-count check, with no regex tuned to either file's specific noise shape. Any genuine extracted report text (substance names, headers, lab terminology) will contain many words of 4+ letters — a threshold of ≥10 such words is a safe, conservative bar that's trivial for real content to clear and impossible for either known garbage case to reach.

## Implementation

Replace `hasUsableText()`'s body:

```typescript
export function hasUsableText(pdfText: string): boolean {
  const words = pdfText.match(/[^\W\d_]{4,}/gu) ?? [];
  return words.length >= 10;
}
```

`[^\W\d_]{4,}` matches runs of 4+ Unicode letter characters (excludes digits and underscore, which `\w` would otherwise include) — this correctly counts "arsenico" or "tørrstoff" as real words while not counting numeric page numbers or stray underscores.

No other function changes — `buildMessageContent()` and `extractSampleData()` already branch on `hasUsableText()`'s return value; only the function's internal logic changes, its signature and role in the pipeline stay identical.

## Scope

**In scope:** the `hasUsableText()` rewrite described above, and updating its existing unit tests (`tests/hp-classification/extract.test.ts`) to test the new word-count logic instead of the old regex-stripping behavior, using both real PDFs' actual extracted text as test fixtures (not synthetic examples) since both are now verified ground truth for "this must return false."

**Out of scope:**
- Re-testing the full live extraction against the Eurofins PDF through the wizard UI as part of this fix — that's real manual verification, covered in the implementation plan, but this spec is about the detection logic itself, not a broader extraction-quality pass.
- Tuning the `>= 10` threshold beyond what's needed to pass both known real cases — if a future real report reveals this threshold is wrong in either direction, that's a real, evidence-based follow-up, not something to over-engineer now against hypothetical cases.
- Any other extraction robustness work (analyte-matching quality, prompt tuning) — this spec is scoped to the one specific bug found.

## Testing

- Unit tests confirm `hasUsableText()` returns `false` for both real garbage extractions (Italian and Eurofins PDFs' actual `pdf-parse` output, captured as literal string fixtures) and `true` for a realistic sample of genuine extracted report text (e.g. a string built from real substance names/report language, verifying the ≥10-word threshold is cleared by genuine content).
- Manual verification: re-run the Eurofins PDF through `/api/extract` (the same curl check already used to diagnose this bug) and confirm it now takes the native-document path and returns real analyte results, not an empty response.
