# Extraction Truncation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop misreporting a real, dense-report response-truncation as "scanned or unreadable", actually fix the truncation itself by switching Stage B extraction to Anthropic's streaming API with a much higher `max_tokens` ceiling, and fix a distinct, more serious bug discovered while verifying the truncation fix: on long multi-page documents, the extraction prompt silently under-extracts (returns a plausible-looking `200 OK` with most result rows missing, no error at all) because it lacks an explicit exhaustiveness instruction.

**Architecture:** `extractSampleData` gains two new distinctly-typed error classes (`ExtractionTruncatedError`, `ExtractionTimeoutError`), switches its Anthropic call from `client.messages.create()` to `client.messages.stream()` with `max_tokens: 64000` and an `AbortController`-based ~270s timeout, and makes both new error types fail fast (no pointless identical retry) instead of going through the existing generic retry loop. Both extraction API routes gain a three-way error branch so each failure mode gets its own honest message. `buildSchemaInstructions` gains an explicit page-exhaustiveness directive, empirically verified (not guessed) to fix the silent under-extraction: the real report that surfaced this bug went from 17 captured result rows (no completeness instruction) to 329 (with it), against a real, independently-known ~346-row ground truth.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (`client.messages.stream`, `APIUserAbortError`), Vitest with `vi.mock`.

## Global Constraints

- `max_tokens` becomes `64000` (Haiku 4.5's real ceiling, confirmed via Anthropic's model docs) — no cost penalty, billing is by actual tokens generated, not the ceiling.
- The streaming call is guarded by an `AbortController` with a ~270s timeout — comfortable margin under Vercel Hobby's hard, non-configurable 300s cap (this repo's current/planned deployment plan).
- A truncation (`stop_reason: "max_tokens"`) or a timeout must NOT be retried by `MAX_EXTRACTION_ATTEMPTS`'s loop — both are deterministic failures for the same input; retrying reproduces the identical multi-minute failure for nothing. Other error types (parse failures, missing text content, network errors) keep retrying exactly as today.
- A truncation/timeout failure must never be reported as "scanned or otherwise unreadable" — that message stays reserved for the narrower case it originally described.
- No change to `hasUsableText()`, `listSamples`, the text-vs-document routing decision, `validateExtractionResponse`, `normalizeSuggestedOriginProcess`, or any downstream JSON-parsing/normalization logic — only the Anthropic call mechanics and error classification change.
- No multi-pass/chunked extraction, no analyte-reference expansion, no Vercel plan upgrade — all explicitly out of scope per the spec.
- `buildSchemaInstructions`'s new exhaustiveness directive is the exact sentence empirically verified to work (329 of ~346 real rows recovered) — do not paraphrase or shorten it; a differently-worded instruction has not been verified and may not produce the same result.

---

### Task 1: Distinct error classes + streaming call + non-retry logic

**Files:**
- Modify: `lib/hp-classification/extract.ts`
- Test: `tests/hp-classification/extract.test.ts`

**Interfaces:**
- Produces: `export class ExtractionTruncatedError extends Error`, `export class ExtractionTimeoutError extends Error` — consumed by Task 2's route files.
- `extractSampleData`'s exported signature is unchanged (`(pdfText: string, pdfBuffer: Buffer, analyteRef: AnalyteReference[], sampleIdentifier: string | null): Promise<ExtractionResult>`) — only its internals and the errors it can throw change.

- [ ] **Step 1: Write the failing tests**

Add to `tests/hp-classification/extract.test.ts`. First, add these imports at the top of the file, alongside the existing ones:

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";
```

(Note: the file currently imports `describe, it, expect` from `"vitest"` without `vi`/`beforeEach` — replace that existing import line with the one above, adding the two new named imports to the same line rather than duplicating the import statement.)

Add this near the top of the file, before the first `describe` block, and BEFORE the `import { validateExtractionResponse, ... } from "@/lib/hp-classification/extract";` line (Vitest hoists `vi.mock` calls to the top of the file automatically regardless of where they're written, but writing it first keeps the file readable in execution order):

```typescript
const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", async () => {
  const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
  return {
    ...actual,
    // Must be a `function` expression, not an arrow function — `new Anthropic(...)` requires a
    // real constructor, and arrow functions cannot be called with `new` (verified: an arrow-
    // function mockImplementation here fails every test with "is not a constructor").
    default: vi.fn().mockImplementation(function () {
      return { messages: { stream: mockStream } };
    }),
  };
});
```

Then update the existing import line:

```typescript
import { validateExtractionResponse, hasUsableText, buildMessageContent, validateListSamplesResponse, normalizeSuggestedOriginProcess } from "@/lib/hp-classification/extract";
```

to also bring in the new function and error classes:

```typescript
import { validateExtractionResponse, hasUsableText, buildMessageContent, validateListSamplesResponse, normalizeSuggestedOriginProcess, extractSampleData, ExtractionTruncatedError, ExtractionTimeoutError } from "@/lib/hp-classification/extract";
import { APIUserAbortError } from "@anthropic-ai/sdk";
```

Add a new top-level `describe` block at the end of the file:

```typescript
describe("extractSampleData retry/error behavior", () => {
  const realWordsText = "some real report text with enough real words in it to count as usable, definitely more than ten of them present here";

  beforeEach(() => {
    mockStream.mockReset();
  });

  it("does not retry a truncated (max_tokens) response — fails after exactly 1 attempt", async () => {
    mockStream.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "{}" }],
        }),
    });

    await expect(extractSampleData(realWordsText, Buffer.from(""), [], null)).rejects.toThrow(ExtractionTruncatedError);
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("does not retry a timeout (aborted stream) — fails after exactly 1 attempt", async () => {
    mockStream.mockReturnValue({
      finalMessage: () => Promise.reject(new APIUserAbortError()),
    });

    await expect(extractSampleData(realWordsText, Buffer.from(""), [], null)).rejects.toThrow(ExtractionTimeoutError);
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("retries a malformed-JSON response up to MAX_EXTRACTION_ATTEMPTS times", async () => {
    mockStream.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "end_turn",
          content: [{ type: "text", text: "not valid json" }],
        }),
    });

    await expect(extractSampleData(realWordsText, Buffer.from(""), [], null)).rejects.toThrow(
      "Claude's extraction response was not valid JSON"
    );
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("passes max_tokens: 64000 to the streaming call", async () => {
    mockStream.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          stop_reason: "max_tokens",
          content: [{ type: "text", text: "{}" }],
        }),
    });

    await expect(extractSampleData(realWordsText, Buffer.from(""), [], null)).rejects.toThrow(ExtractionTruncatedError);
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 64000 }),
      expect.anything()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL — `ExtractionTruncatedError`, `ExtractionTimeoutError`, and `extractSampleData`'s new streaming-based behavior don't exist yet (the mock currently has nothing to intercept, since the real code still calls `client.messages.create`, not `.stream`).

- [ ] **Step 3: Write the implementation**

In `lib/hp-classification/extract.ts`, add two new exported error classes right before the existing `const MAX_EXTRACTION_ATTEMPTS = 2;` line:

```typescript
// Thrown when Claude's extraction response hit stop_reason: "max_tokens" — the report's real
// content genuinely doesn't fit in the response length ceiling. Distinct from a generic Error
// so callers (extractSampleData's own retry loop, and the API routes) can tell this apart from
// an actual unreadability failure and from a transient/parse error worth retrying.
export class ExtractionTruncatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionTruncatedError";
  }
}

// Thrown when our own AbortController timeout fires before the streaming call finishes — a
// deliberate, honest failure distinct from Vercel's platform-level kill (which would produce no
// useful error at all), used because this app may run on Vercel Hobby, which hard-caps function
// duration at 300s with no override available.
export class ExtractionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionTimeoutError";
  }
}
```

Add the import for `APIUserAbortError` at the top of the file, changing:

```typescript
import Anthropic from "@anthropic-ai/sdk";
```

to:

```typescript
import Anthropic, { APIUserAbortError } from "@anthropic-ai/sdk";
```

Replace the entire body of `extractSampleData` (from `const client = new Anthropic(...)` through the final `throw lastError instanceof Error ? lastError : new Error("Extraction failed");`) with:

```typescript
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content = buildMessageContent(pdfText, pdfBuffer, analyteRef, sampleIdentifier);

  // Comfortable margin under Vercel Hobby's hard, non-configurable 300s function-duration cap —
  // this app's real/planned deployment plan. A real streaming test against a dense 41-page
  // report took 284.3s at max_tokens: 64000; this timeout fires before Vercel's own platform-
  // level kill would, so the failure is an honest, explained one instead of a silent kill.
  const EXTRACTION_TIMEOUT_MS = 270_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt++) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), EXTRACTION_TIMEOUT_MS);

    try {
      let message: Anthropic.Message;
      try {
        const stream = client.messages.stream(
          {
            model: "claude-haiku-4-5",
            max_tokens: 64000,
            messages: [{ role: "user", content: content as Anthropic.MessageParam["content"] }],
          },
          { signal: abortController.signal }
        );
        message = await stream.finalMessage();
      } catch (streamErr) {
        if (streamErr instanceof APIUserAbortError) {
          throw new ExtractionTimeoutError(
            "Extraction did not finish within the available processing time — the report may be too large or detailed to process in a single pass."
          );
        }
        throw streamErr;
      }

      if (message.stop_reason === "max_tokens") {
        throw new ExtractionTruncatedError(
          "Claude's extraction response was truncated (exceeded the response length limit) — the report may be too large or complex for a single extraction pass"
        );
      }

      const textBlock = message.content.find(block => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Claude returned no text content for extraction");
      }

      const stripped = textBlock.text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        throw new Error("Claude's extraction response was not valid JSON");
      }

      if (!validateExtractionResponse(parsed)) {
        throw new Error("Claude's extraction response was missing required fields");
      }

      // Never trust Claude's raw suggestedOriginProcess string — only a real, curated
      // ORIGIN_OPTIONS value survives; anything else (including an absent field) becomes null.
      const normalizedSuggestedOrigin = normalizeSuggestedOriginProcess(parsed.suggestedOriginProcess);

      const resultsWithIds = parsed.results.map((row, i) => ({ ...row, resultId: `r${i + 1}` }));

      return {
        ...parsed,
        results: resultsWithIds,
        suggestedOriginProcess: normalizedSuggestedOrigin,
        sourceType: hasUsableText(pdfText) ? "text" : "document",
      };
    } catch (err) {
      lastError = err;
      // Truncation and timeout are both deterministic failures for the same input — retrying
      // with identical parameters would just reproduce the same multi-minute failure. Fail fast
      // rather than burning the retry budget on a guaranteed-identical re-failure.
      if (err instanceof ExtractionTruncatedError || err instanceof ExtractionTimeoutError) {
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Extraction failed");
```

(This is a full replacement of the function body — the signature line `export async function extractSampleData(...): Promise<ExtractionResult> {` and the function's closing `}` stay exactly as they are today, only the body between them changes.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: all tests PASS, including every pre-existing test in the file (the mock only intercepts calls made through `extractSampleData`'s own client instance; `validateExtractionResponse`, `hasUsableText`, `buildMessageContent`, `validateListSamplesResponse`, and `normalizeSuggestedOriginProcess` are pure functions untouched by the mock).

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/extract.ts tests/hp-classification/extract.test.ts
git commit -m "fix: switch Stage B extraction to streaming, raise max_tokens to 64000, fail fast on truncation/timeout instead of retrying"
```

---

### Task 2: Distinct, honest error messages in both extraction routes

**Files:**
- Modify: `app/api/extract/route.ts`
- Modify: `app/api/extract-sample/route.ts`

**Interfaces:**
- Consumes: `ExtractionTruncatedError`, `ExtractionTimeoutError` (Task 1).
- No new exports — both routes' request/response shapes are unchanged; only their internal error-to-message mapping and an added `maxDuration` export change.

- [ ] **Step 1: Update `app/api/extract/route.ts`**

Change the import line:

```typescript
import { extractSampleData, listSamples, hasUsableText } from "@/lib/hp-classification/extract";
```

to:

```typescript
import { extractSampleData, listSamples, hasUsableText, ExtractionTruncatedError, ExtractionTimeoutError } from "@/lib/hp-classification/extract";
```

Add this line right after the existing `GlobalWorkerOptions.workerSrc = ...;` block, before `export async function POST(request: NextRequest) {`:

```typescript
// Comfortable margin under Vercel Hobby's hard 300s cap — extractSampleData's own internal
// timeout (270s) fires first and produces an honest error; this is a backstop, not the primary
// mechanism. See lib/hp-classification/extract.ts's EXTRACTION_TIMEOUT_MS for the real guard.
export const maxDuration = 300;
```

Replace the existing `catch (err) { ... }` block (the one currently starting with `const status = hasUsableText(pdfText) ? 502 : 422;`) with:

```typescript
  } catch (err) {
    if (err instanceof ExtractionTruncatedError) {
      console.error("Extraction truncated (response length limit):", err);
      return NextResponse.json(
        {
          error:
            "This report is too large or detailed to extract in a single pass — its data exceeded the processing response limit. Try a smaller or simpler report, or contact support.",
        },
        { status: 422 }
      );
    }
    if (err instanceof ExtractionTimeoutError) {
      console.error("Extraction timed out:", err);
      return NextResponse.json(
        {
          error:
            "This report is too large or detailed to finish processing in the available time. Try a smaller or simpler report, or contact support.",
        },
        { status: 422 }
      );
    }
    const status = hasUsableText(pdfText) ? 502 : 422;
    if (status === 422) {
      console.error("Native-PDF extraction fallback failed:", err);
      return NextResponse.json(
        {
          error:
            "This PDF appears to be scanned or otherwise unreadable, and automatic extraction from the document image was unsuccessful. Try a different file, or a report with an embedded text layer.",
        },
        { status: 422 }
      );
    }
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
```

- [ ] **Step 2: Update `app/api/extract-sample/route.ts`**

Apply the exact same three changes: widen the import to add `ExtractionTruncatedError, ExtractionTimeoutError`, add the same `export const maxDuration = 300;` line after the `GlobalWorkerOptions.workerSrc = ...;` block, and replace this file's `catch (err) { ... }` block (structurally identical to `app/api/extract/route.ts`'s, since both files share the same error-mapping pattern today) with the same three-way branch shown above, verbatim.

- [ ] **Step 3: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean — no test file exists for either route (matches this repo's established convention of not unit-testing route handlers directly; the logic they call is already tested at the `lib/hp-classification/extract.ts` level in Task 1).

- [ ] **Step 4: Manual verification**

With the local dev server running (`lsof -ti:3000 | xargs -r kill -9; nohup npm run dev > /tmp/wastematch-dev.log 2>&1 & disown; sleep 5`), re-run the real report that surfaced this bug through the actual API:

```bash
curl -s -X POST http://localhost:3000/api/extract \
  -F "file=@/Users/evenmyrennybo/Downloads/Analyser jord 170503 Hera.pdf" \
  -w "\nHTTP_STATUS:%{http_code}\n" --max-time 300
```

Expected: HTTP 200, with a `data.results` array containing real extracted rows (not a 422 "scanned or unreadable" error). **Important:** at this point in the plan (before Task 3), the real result count will likely still be low (empirically verified: ~17 rows, ~25s) — that under-extraction is Task 3's fix, not a regression to chase down here. This step is only checking that the truncation/timeout/unreadability error handling is wired correctly (a 200 response, not a 422), not checking completeness. This call may take anywhere from tens of seconds to several minutes; do not cancel it early. If it fails, read `/tmp/wastematch-dev.log` for the real error and compare it against Task 1's error classes before concluding this task is done — a leftover `422 scanned or unreadable` here means the route-level branch order or import didn't wire up correctly, not that the underlying fix is wrong (Task 1's tests already prove the extraction logic itself works).

- [ ] **Step 5: Commit**

```bash
git add app/api/extract/route.ts app/api/extract-sample/route.ts
git commit -m "fix: distinguish truncation/timeout from genuine unreadability in both extraction routes, add explicit maxDuration"
```

---

### Task 3: Fix silent under-extraction on long multi-page documents

**Files:**
- Modify: `lib/hp-classification/extract.ts`
- Test: `tests/hp-classification/extract.test.ts`

**Interfaces:**
- No new exports — `buildSchemaInstructions`'s return value (a prompt string) gains one new
  sentence; `buildMessageContent`'s exported signature and behavior are otherwise unchanged.

**Background (why this task exists):** verifying Task 1+2's fix against the real report that
surfaced this whole bug (`Analyser jord 170503 Hera.pdf`, 41 pages) showed the truncation/timeout
fix works exactly as designed — a clean `200 OK`, no error — but the extraction itself only
captured 17 of the report's real ~346 result rows, with no error or warning signaling the
shortfall. Root cause: `buildSchemaInstructions`'s prompt has no instruction telling Claude to be
exhaustive across every page of a long document, so on a genuinely long report Claude appears to
stop early rather than transcribe everything. Empirically verified fix: adding one explicit
completeness sentence to the prompt took the same real report from 17 → 329 captured rows (close
to the independently-known ~346 ground truth; the small remaining gap is ordinary LLM
non-determinism, not evidence the fix is incomplete) in the same real end-to-end test, with the
Task 1+2 streaming/timeout fix still working correctly alongside it (no truncation, no timeout).

- [ ] **Step 1: Write the failing test**

Add to `tests/hp-classification/extract.test.ts`, inside the existing `describe("buildMessageContent", ...)` block, after its last existing test:

```typescript
  it("instructs Claude to extract every result row across all pages of a long document, not just a subset", () => {
    const analyteRef: AnalyteReference[] = [];
    const content = buildMessageContent("some real report text with enough real words to count as usable, definitely", Buffer.from(""), analyteRef, null);
    const textBlock = content.find(b => b.type === "text");
    expect(textBlock).toBeDefined();
    const text = (textBlock as { text: string }).text;
    expect(text).toContain("EVERY result row");
    expect(text).toContain("ALL pages");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL — the current prompt text doesn't contain "EVERY result row" or "ALL pages" yet.

- [ ] **Step 3: Write the implementation**

In `lib/hp-classification/extract.ts`'s `buildSchemaInstructions` function, change the opening line of the returned template string from:

```typescript
  return `You are extracting structured waste characterization data from a lab report (Italian or Norwegian format).
Return ONLY a JSON object matching this exact shape, with no markdown fences and no commentary:
```

to:

```typescript
  return `You are extracting structured waste characterization data from a lab report (Italian or Norwegian format). This report may span many pages and contain many dozens or hundreds of individual analyte/substance result rows across those pages. You MUST extract EVERY result row found anywhere in the document, across ALL pages — do not summarize, sample a subset, or stop early. If the document is long, keep reading and extracting until you have covered every page and every result row it contains.
Return ONLY a JSON object matching this exact shape, with no markdown fences and no commentary:
```

(Only this one paragraph changes — nothing else in `buildSchemaInstructions` or the rest of the file changes in this task.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: all tests PASS, including every pre-existing test in the file.

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 6: Manual verification**

With the local dev server running (`lsof -ti:3000 | xargs -r kill -9; nohup npm run dev > /tmp/wastematch-dev.log 2>&1 & disown; sleep 5`), re-run the exact same real-file check as Task 2's manual verification:

```bash
curl -s -X POST http://localhost:3000/api/extract \
  -F "file=@/Users/evenmyrennybo/Downloads/Analyser jord 170503 Hera.pdf" \
  -w "\nHTTP_STATUS:%{http_code}\n" --max-time 300 -o /tmp/hera-final-check.json
python3 -c "
import json
d = json.load(open('/tmp/hera-final-check.json'))
print('results:', len(d['data']['results']) if 'data' in d else d)
"
```

Expected: HTTP 200, and `results` count in the low hundreds (empirically verified real value: 329) — a large jump from Task 2's ~17-row checkpoint, confirming the completeness fix actually closed the gap on the real report that surfaced this whole bug, not just in the isolated unit test. This call will take several minutes (the empirical test took ~2.7 minutes); do not cancel it early.

- [ ] **Step 7: Commit**

```bash
git add lib/hp-classification/extract.ts tests/hp-classification/extract.test.ts
git commit -m "fix: instruct extraction to cover every page/result row on long documents, fixing silent under-extraction"
```

---

## Self-Review Notes

- **Spec coverage:** distinct error classes + streaming + non-retry logic + `max_tokens: 64000` → Task 1. Three-way route error branching + `maxDuration` → Task 2. Silent under-extraction fix (discovered while verifying Tasks 1-2, folded into this plan per the user's explicit choice) → Task 3. The spec's "Explicitly out of scope" items (multi-pass extraction, `hasUsableText`/Stage A changes, analyte-reference expansion, Vercel plan changes) are untouched by any task.
- **Placeholder scan:** no TBD/TODO; every step has complete code, or an exact command with expected output and a concrete, real fallback file (`Analyser jord 170503 Hera.pdf`) for manual verification.
- **Type consistency:** `ExtractionTruncatedError`/`ExtractionTimeoutError` (Task 1) are imported and `instanceof`-checked with the exact same names in Task 2's two route files. `extractSampleData`'s public signature and `ExtractionResult` return shape are unchanged from what Task 2's callers (and the rest of the app) already expect. Task 3 touches only one paragraph of `buildSchemaInstructions`'s returned string — no signature or type changes anywhere.
- **Empirical grounding — every number in this plan was actually measured, not estimated, and re-verified together as a whole before finalizing:** `max_tokens: 64000` and the `270_000`ms timeout (Task 1) were validated via a real streaming test (284.3s, 346 results, no truncation). The full combined fix (Tasks 1+2+3 together) was then re-verified end-to-end through the real dev server and the real `/api/extract` route on the same real file: 329 results, HTTP 200, no truncation, no timeout, ~2.7 minutes — confirming the streaming/timeout fix and the completeness fix work correctly together, not just in isolation. Task 2's own manual-verification checkpoint (before Task 3 lands) was corrected to expect the real, empirically-observed low count (~17 rows) rather than the final 329, so the implementer doesn't mistake Task 3's not-yet-applied fix for a Task 2 regression.
