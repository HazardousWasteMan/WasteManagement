# Scanned PDF Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scanned/image-only lab report PDFs (like the project's own Italian sample fixture) actually extractable through the live app, by sending the raw PDF directly to Claude as a native `document` content block when `pdf-parse` finds no usable text — no image rendering, no native binary dependency, Vercel-safe.

**Architecture:** `lib/hp-classification/extract.ts` gains a small pure content-building function that decides, based on whether `pdf-parse`'s output is usable, whether to send Claude a text prompt (unchanged, fast path) or the same instructions alongside a base64-encoded PDF document block (new path). `app/api/extract/route.ts` stops short-circuiting on empty text and always calls `extractSampleData()`, which now internally picks the right path; the route uses the same usable-text check only to choose the right HTTP status code (422 vs 502) if extraction ultimately fails.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk` (native PDF `document` content block, supported by all active Claude models including `claude-haiku-4-5` — confirmed against Anthropic's current PDF-support documentation: 32MB request size limit, 600 pages max, both well within the real report's size), Vitest.

## Global Constraints

- No image rendering, no `pdftoppm`/poppler, no `child_process`, no native binary dependency — the whole point of this design is Vercel-portability.
- The text-based extraction path's prompt, validation, and behavior for normal (non-scanned) PDFs must not change.
- The 422 "no extractable text" response becomes the genuine last resort: returned only when extraction ultimately fails AND the original `pdf-parse` output was unusable — not returned pre-emptively before an extraction attempt is even made.
- `claude-haiku-4-5` is confirmed to support PDF document input — no model change needed for this feature.

---

### Task 1: PDF-document extraction path in `extractSampleData`

**Files:**
- Modify: `lib/hp-classification/extract.ts`
- Test: `tests/hp-classification/extract.test.ts` (extend existing file)

**Interfaces:**
- Produces: `hasUsableText(pdfText: string): boolean` (exported — the single source of truth for "is this pdf-parse output real text or just page-marker boilerplate", reused by Task 2's route); `extractSampleData(pdfText: string, pdfBuffer: Buffer, analyteRef: AnalyteReference[]): Promise<ExtractionResult>` (signature change — gains the `pdfBuffer` parameter, consumed by Task 2's route).

- [ ] **Step 1: Read the current file**

Read `lib/hp-classification/extract.ts` in full — this task modifies `buildPrompt`, adds new functions, and changes `extractSampleData`'s signature, so confirm the exact current content (including the existing `validateExtractionResponse`, which is untouched by this task) before editing.

- [ ] **Step 2: Write the failing tests**

Add to `tests/hp-classification/extract.test.ts` (the existing `validateExtractionResponse` tests stay as-is; add these new ones in the same file):

```typescript
import { hasUsableText, buildMessageContent } from "@/lib/hp-classification/extract";
import type { AnalyteReference } from "@/lib/hp-classification/types";

describe("hasUsableText", () => {
  it("returns false for pdf-parse's page-marker-only boilerplate", () => {
    expect(hasUsableText("-- 1 of 41 --\n\n-- 2 of 41 --\n\n")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(hasUsableText("")).toBe(false);
  });

  it("returns false for whitespace-only text", () => {
    expect(hasUsableText("   \n\n   ")).toBe(false);
  });

  it("returns true for real extracted report text", () => {
    expect(hasUsableText("EER 170503* terra e rocce, contenenti sostanze pericolose")).toBe(true);
  });

  it("returns true for real text even alongside page markers", () => {
    expect(hasUsableText("-- 1 of 2 --\n\nArsenico 51700 mg/kg\n\n-- 2 of 2 --")).toBe(true);
  });
});

describe("buildMessageContent", () => {
  const analyteRef: AnalyteReference[] = [
    {
      analyteId: "arsenic", canonicalNameNo: "arsen", canonicalNameIt: "arsenico", canonicalNameEn: "arsenic",
      casNumber: "7440-38-2", defaultUnit: "mg/kg", substanceGroup: "metal", mFactorAcute: null, mFactorChronic: null,
      elementSymbol: "As", hStatement: null, hazardClass: null, hStatements: null,
    },
  ];
  const smallPdfBuffer = Buffer.from("%PDF-1.4 fake content for testing");

  it("builds a text-only content block when the PDF has usable extracted text", () => {
    const content = buildMessageContent("Real report text with arsenico 5.17%", smallPdfBuffer, analyteRef);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    expect((content[0] as { type: "text"; text: string }).text).toContain("Real report text with arsenico 5.17%");
    expect((content[0] as { type: "text"; text: string }).text).toContain("arsenic");
  });

  it("builds a document content block plus text instructions when the PDF has no usable text", () => {
    const content = buildMessageContent("-- 1 of 41 --\n\n-- 2 of 41 --", smallPdfBuffer, analyteRef);
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("document");
    const doc = content[0] as { type: "document"; source: { type: string; media_type: string; data: string } };
    expect(doc.source.type).toBe("base64");
    expect(doc.source.media_type).toBe("application/pdf");
    expect(doc.source.data).toBe(smallPdfBuffer.toString("base64"));
    expect(content[1].type).toBe("text");
    expect((content[1] as { type: "text"; text: string }).text).toContain("arsenic");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL with "hasUsableText is not exported" / "buildMessageContent is not exported"

- [ ] **Step 4: Write the implementation**

Replace `lib/hp-classification/extract.ts`'s `buildPrompt` function and `extractSampleData` function with the following (keep `ExtractionResult` and `validateExtractionResponse` exactly as they are today, unchanged):

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { SampleMetadata, SampleResult, AnalyteReference } from "./types";
import type { TestResult } from "./hazard";

export interface ExtractionResult {
  metadata: Partial<SampleMetadata>;
  results: Omit<SampleResult, "sampleId" | "method">[];
  testResults: TestResult[];
  unmatchedAnalytes: string[];
}

export function validateExtractionResponse(x: unknown): x is ExtractionResult {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;

  if (!d.metadata || typeof d.metadata !== "object") return false;
  if (!Array.isArray(d.results)) return false;
  for (const r of d.results) {
    if (!r || typeof r !== "object") return false;
    const row = r as Record<string, unknown>;
    if (typeof row.rawAnalyteName !== "string") return false;
    if (row.analyteId !== null && typeof row.analyteId !== "string") return false;
    if (row.resultValue !== null && typeof row.resultValue !== "number") return false;
    if (typeof row.isBelowLoq !== "boolean") return false;
    if (row.loqValue !== null && typeof row.loqValue !== "number") return false;
    if (typeof row.unitRaw !== "string") return false;
    if (typeof row.expressedOnDryBasis !== "boolean") return false;
  }
  if (!Array.isArray(d.testResults)) return false;
  if (!Array.isArray(d.unmatchedAnalytes)) return false;
  if (!d.unmatchedAnalytes.every(u => typeof u === "string")) return false;

  return true;
}

// The single source of truth for "did pdf-parse actually find real text, or just its own
// page-marker boilerplate ('-- N of M --') on a scanned/image-only PDF". Reused by the API
// route to decide the correct fallback HTTP status if extraction ultimately fails.
export function hasUsableText(pdfText: string): boolean {
  return pdfText.replace(/--\s*\d+\s+of\s+\d+\s*--/g, "").trim().length > 0;
}

function buildSchemaInstructions(analyteRef: AnalyteReference[]): string {
  const knownAnalytes = analyteRef
    .map(a => `- ${a.analyteId}: ${[a.canonicalNameNo, a.canonicalNameIt, a.canonicalNameEn].filter(Boolean).join(" / ")}`)
    .join("\n");

  return `You are extracting structured waste characterization data from a lab report (Italian or Norwegian format).
Return ONLY a JSON object matching this exact shape, with no markdown fences and no commentary:

{
  "metadata": {
    "externalReportNo": string | null,
    "labName": string | null,
    "customerName": string | null,
    "sampleMarking": string | null,
    "matrixType": string | null,
    "samplingDate": string | null,
    "receiptDate": string | null,
    "producerName": string | null,
    "physicalState": "solid" | "liquid" | null,
    "viscosity40cMm2s": number | null,
    "ph": number | null,
    "labClassificationGiven": boolean,
    "labStatedEalCode": string | null
  },
  "results": [
    { "rawAnalyteName": string, "analyteId": string | null, "resultValue": number | null, "isBelowLoq": boolean, "loqValue": number | null, "unitRaw": string, "expressedOnDryBasis": boolean }
  ],
  "testResults": [
    { "testName": "flammability" | "skin_corrosion" | "skin_irritation", "result": string, "isPositive": boolean }
  ],
  "unmatchedAnalytes": [string]
}

Do NOT populate an "originProcess" field — it is intentionally absent from this schema. It is never present in a lab report and must be supplied by the user, not guessed by you.

For each analyte/substance result row in the report, match it against this list of known analytes by name (any language) and set "analyteId" to the matching id. If a row's substance does not match any of these, set "analyteId": null and add its raw name to the top-level "unmatchedAnalytes" array instead — never guess a match, and never invent an analyteId not in this list:

${knownAnalytes}

For "testResults", look for free-text statements about flammability, skin corrosion (e.g. "non corrosivo"/"corrosivo", "not corrosive"/"corrosive"), or skin irritation (e.g. "non irritante"/"irritante", "not irritating"/"irritating") and report each one found, with "isPositive" true if the test indicates the hazard IS present, false if it indicates it is NOT present.`;
}

type MessageContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

// Decides the extraction strategy: if pdf-parse found real text, send it as a text prompt
// (fast, cheap, unchanged from before). If not (a scanned/image-only PDF), send the raw PDF
// bytes as a native document content block instead — Claude reads it directly, no OCR
// pre-processing, no rendering, no native binary dependency.
export function buildMessageContent(
  pdfText: string,
  pdfBuffer: Buffer,
  analyteRef: AnalyteReference[]
): MessageContentBlock[] {
  const instructions = buildSchemaInstructions(analyteRef);

  if (hasUsableText(pdfText)) {
    return [{ type: "text", text: `${instructions}\n\nReport text:\n${pdfText}` }];
  }

  return [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: pdfBuffer.toString("base64") },
    },
    { type: "text", text: `${instructions}\n\nRead the attached PDF document directly — pdf-parse found no usable text in it, so it is likely scanned/image-only.` },
  ];
}

const MAX_EXTRACTION_ATTEMPTS = 2;

export async function extractSampleData(
  pdfText: string,
  pdfBuffer: Buffer,
  analyteRef: AnalyteReference[]
): Promise<ExtractionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content = buildMessageContent(pdfText, pdfBuffer, analyteRef);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt++) {
    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: content as never }],
      });

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

      return parsed;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Extraction failed");
}
```

Note: the `content as never` cast on the `messages.create` call is because `@anthropic-ai/sdk`'s exact `document` content-block type may have a slightly different shape than the minimal one declared here (e.g. it may support a `citations` field or a discriminated union with more source types) — if `npm run build`'s typecheck flags a real mismatch rather than accepting the cast, adjust `MessageContentBlock`'s `document` variant to match the SDK's actual exported type instead of widening the cast further.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: PASS (all cases, old `validateExtractionResponse` tests and new `hasUsableText`/`buildMessageContent` tests)

- [ ] **Step 6: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: `npx vitest run` passes. `npm run build` will FAIL at `app/api/extract/route.ts` — it still calls `extractSampleData(pdfText, analyteReferenceRaw)` with the old 2-argument signature, which no longer matches. This is expected and is Task 2's job to fix; confirm the build failure is isolated to that one call site.

- [ ] **Step 7: Commit**

```bash
git add lib/hp-classification/extract.ts tests/hp-classification/extract.test.ts
git commit -m "feat: add native PDF document extraction path for scanned/image-only reports"
```

---

### Task 2: Wire the route, remove the early short-circuit, manual verification

**Files:**
- Modify: `app/api/extract/route.ts`

**Interfaces:**
- Consumes: `hasUsableText`, `extractSampleData` (Task 1, new 3-argument signature).

- [ ] **Step 1: Read the current route file**

Read `app/api/extract/route.ts` in full to confirm its exact current content before editing.

- [ ] **Step 2: Rewrite the route**

Replace the file's content with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractSampleData, hasUsableText } from "@/lib/hp-classification/extract";
import type { AnalyteReference } from "@/lib/hp-classification/types";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import path from "node:path";

GlobalWorkerOptions.workerSrc = path.join(
  process.cwd(),
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
);

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  const file = formData.get("file");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let pdfText: string;
  try {
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    pdfText = parsed.text;
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded PDF" }, { status: 422 });
  }

  try {
    const data = await extractSampleData(pdfText, buffer, analyteReferenceRaw as AnalyteReference[]);
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    // The 422 "no extractable text" outcome is now a genuine last resort: it only surfaces
    // when extraction ultimately failed AND pdf-parse's own output was unusable to begin with
    // (i.e. the native-PDF fallback path was attempted and also failed) — not pre-emptively
    // before any extraction attempt is made.
    const status = hasUsableText(pdfText) ? 502 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
```

Note what changed from the prior version: the early `strippedForCheck`/empty-text short-circuit that immediately returned 422 before attempting extraction is gone — `extractSampleData` is now always called, and it internally picks the text or native-PDF-document path via `hasUsableText`. The only remaining use of `hasUsableText` in this file is to pick the right status code if extraction throws.

- [ ] **Step 3: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean — this is the first time in this plan the build should fully succeed.

- [ ] **Step 4: Manual verification with the real scanned PDF**

The dev server should already be running locally on port 3000 (started earlier in this session via `nohup npm run dev`). If it's not running, start it: `cd /Users/evenmyrennybo/WastemanagementPortal && npm run dev &`.

Open the app in a browser (or use `curl` directly against the API for a faster check first):

```bash
curl -s -X POST http://localhost:3000/api/extract \
  -F "file=@/Users/evenmyrennybo/Downloads/avfallskoderanalyserogtillatelserkonsesjonerformotta/Analyser jord 170503 Hera.pdf" \
  | head -c 2000
```

Expected: a JSON response with `data.results` containing real analyte entries (arsenic, sulfur, lead compounds, etc. — matching what the hand-transcribed regression fixture already proves the report contains), NOT an empty `results: []` and NOT a 422 error. This is the actual proof this feature works — it's the exact PDF that exposed the original gap.

Then, in an actual browser at `http://localhost:3000`, upload the same PDF through the real Upload step, confirm the Extraction review step shows the extracted metadata and a non-empty per-analyte table, fill in `escavo terre e rocce` as the origin process, and confirm the Classification step renders `HP6`, `HP7`, `HP10`, `HP14` as triggered and EAL `17 05 03*` — completing the full live loop this whole multi-slice project has been building toward.

If the live extraction's `analyteId` matches differ from the hand-transcribed fixture (a real possibility — this is the LLM's first time reading this exact PDF as a native document rather than from pre-extracted text), report the actual discrepancy honestly rather than forcing or hiding a mismatch; the underlying HP1-15 engine is already proven correct by the function-level regression test regardless of what live extraction produces.

- [ ] **Step 5: Commit**

```bash
git add app/api/extract/route.ts
git commit -m "feat: wire /api/extract to the native-PDF fallback, remove pre-emptive 422 short-circuit"
```

---

## Self-Review Notes

- **Spec coverage:** the PDF-document extraction path → Task 1. Route wiring, removal of the pre-emptive 422, and the "422 as genuine last resort" status-code logic → Task 2. Manual verification against the real scanned PDF (the actual proof this works) → Task 2 Step 4. Model verification (claude-haiku-4-5 supports PDF input) was resolved with real evidence before this plan was written, per the spec's own requirement — documented in the Tech Stack line above, not deferred into a task.
- **Placeholder scan:** no TBD/TODO. The `content as never` cast note in Task 1 Step 4 is a disclosed, bounded escape hatch for a real SDK-type-shape uncertainty, not a glossed-over gap — it tells the implementer exactly what to check and what to do if the cast turns out to be masking a real problem.
- **Type consistency:** `extractSampleData`'s new 3-argument signature (`pdfText`, `pdfBuffer`, `analyteRef`) is used identically in Task 1's own function definition and Task 2's route call site. `hasUsableText` and `buildMessageContent` are both exported from the same file Task 2 imports from, with no signature drift between the two tasks.
