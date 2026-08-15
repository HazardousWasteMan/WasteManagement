# Multi-Sample PDF Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraction becomes two-stage — a cheap "how many samples, which ones?" detection call, then the existing full extraction scoped to one explicit sample — so a bundled multi-sample PDF (like the real Eurofins Alta Lufthavn document) no longer produces malformed JSON from Claude trying to reconcile several samples' data into one response, while a normal single-sample PDF sees zero visible behavior change.

**Architecture:** `lib/hp-classification/extract.ts` gains `listSamples()` (Stage A) and a scoped variant of the existing extraction (Stage B, via a new optional parameter). `/api/extract` runs Stage A first: 0 or 1 samples found → auto-runs Stage B exactly as today (one response, no picker); 2+ samples found → returns the sample list instead of extracted data, and the wizard shows a new **Sample selection** step. A new `/api/extract-sample` route lets the client re-submit the same file with a chosen sample identifier to run scoped Stage B.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk`, Next.js API routes, React, Vitest.

## Global Constraints

- A normal single-sample document must see zero visible behavior change — same number of wizard steps, same extraction result shape, just one extra cheap detection call happening server-side.
- Stage A failure or a 0-sample result falls back to today's unscoped whole-document extraction, never blocks the user.
- No change to `classifySample()`, `normalizeSample()`, `classifyHazard()`, or `assignEalCode()` — this is entirely about getting correctly-scoped extraction input to the already-validated engine.
- One sample is classified per submission — picking a different sample from the same bundled PDF means re-running the Sample selection step, not a new batch-classification flow.

---

### Task 1: `listSamples()` — Stage A detection

**Files:**
- Modify: `lib/hp-classification/extract.ts`
- Test: `tests/hp-classification/extract.test.ts` (extend existing file)

**Interfaces:**
- Produces: `interface DetectedSample { sampleIdentifier: string; matrixType: string | null }`, `validateListSamplesResponse(x: unknown): x is DetectedSample[]`, `listSamples(pdfText: string, pdfBuffer: Buffer): Promise<DetectedSample[]>` — consumed by Task 3's `/api/extract` route.
- Also produces a refactored shared helper `buildDocumentOrTextContent(instructions: string, pdfText: string, pdfBuffer: Buffer): MessageContentBlock[]` — extracted from the existing `buildMessageContent`'s text-vs-document branching logic, so Stage A's prompt can reuse the same text/native-document decision without duplicating it. `buildMessageContent` (Stage B, unchanged from the outside) becomes a thin wrapper calling this shared helper with `buildSchemaInstructions(...)`.

- [ ] **Step 1: Read the current file in full**

Read `lib/hp-classification/extract.ts` completely — this task refactors `buildMessageContent`'s internals (extracting the text-vs-document branching into a shared helper) without changing its existing external signature/behavior, and adds new exports alongside it.

- [ ] **Step 2: Write the failing tests**

Add to `tests/hp-classification/extract.test.ts` (new `describe` block, alongside the existing ones — do not modify the existing `hasUsableText`/`buildMessageContent`/`validateExtractionResponse` tests):

```typescript
import { validateListSamplesResponse } from "@/lib/hp-classification/extract";

describe("validateListSamplesResponse", () => {
  it("accepts a well-formed single-sample array", () => {
    expect(validateListSamplesResponse([{ sampleIdentifier: "ENAT-BØF1-BO9OB1", matrixType: "Betong" }])).toBe(true);
  });

  it("accepts a well-formed multi-sample array", () => {
    const samples = [
      { sampleIdentifier: "AR-25-MM-120316-01", matrixType: null },
      { sampleIdentifier: "AR-25-MM-118438-01", matrixType: "Betong" },
      { sampleIdentifier: "AR-25-MM-118439-01", matrixType: "Betong" },
    ];
    expect(validateListSamplesResponse(samples)).toBe(true);
  });

  it("accepts an empty array (no distinguishable samples found)", () => {
    expect(validateListSamplesResponse([])).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(validateListSamplesResponse({ sampleIdentifier: "x", matrixType: null })).toBe(false);
  });

  it("rejects an array element missing sampleIdentifier", () => {
    expect(validateListSamplesResponse([{ matrixType: "Betong" }])).toBe(false);
  });

  it("rejects an array element with a non-string sampleIdentifier", () => {
    expect(validateListSamplesResponse([{ sampleIdentifier: 123, matrixType: null }])).toBe(false);
  });

  it("rejects an array element where matrixType is present but not string-or-null", () => {
    expect(validateListSamplesResponse([{ sampleIdentifier: "x", matrixType: 5 }])).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL with "validateListSamplesResponse is not exported"

- [ ] **Step 4: Refactor `buildMessageContent` to extract the shared text-vs-document helper, and add `listSamples()`**

In `lib/hp-classification/extract.ts`, replace the existing `buildMessageContent` function with:

```typescript
// Shared text-vs-document branching decision, used by both the full extraction (Stage B) and
// the lightweight sample-detection call (Stage A) — the choice of "send text" vs "send the raw
// PDF as a native document" only depends on hasUsableText(pdfText), never on which stage is
// calling it.
function buildDocumentOrTextContent(
  instructions: string,
  pdfText: string,
  pdfBuffer: Buffer
): MessageContentBlock[] {
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

// Decides the extraction strategy: if pdf-parse found real text, send it as a text prompt
// (fast, cheap, unchanged from before). If not (a scanned/image-only PDF), send the raw PDF
// bytes as a native document content block instead — Claude reads it directly, no OCR
// pre-processing, no rendering, no native binary dependency.
export function buildMessageContent(
  pdfText: string,
  pdfBuffer: Buffer,
  analyteRef: AnalyteReference[]
): MessageContentBlock[] {
  return buildDocumentOrTextContent(buildSchemaInstructions(analyteRef), pdfText, pdfBuffer);
}
```

Then add the new Stage A types/functions, placed after `buildMessageContent`:

```typescript
export interface DetectedSample {
  sampleIdentifier: string;
  matrixType: string | null;
}

export function validateListSamplesResponse(x: unknown): x is DetectedSample[] {
  if (!Array.isArray(x)) return false;
  for (const item of x) {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    if (typeof row.sampleIdentifier !== "string") return false;
    if (row.matrixType !== null && typeof row.matrixType !== "string") return false;
  }
  return true;
}

function buildListSamplesInstructions(): string {
  return `You are analyzing a lab report document that may contain data for ONE or MULTIPLE distinct waste/environmental samples (some lab reports bundle several separate sample sub-reports into one document).

Return ONLY a JSON array (no markdown fences, no commentary) where each element represents one distinct sample found in this document:

[
  { "sampleIdentifier": string, "matrixType": string | null }
]

"sampleIdentifier" must be the sample's own report/sample number or marking exactly as printed in the document (e.g. a "Prøvenr." value, an "AR-..." report number, or a sample marking code) — something that uniquely distinguishes this sample from any others in the same document. If the document clearly describes only one sample, return an array with exactly one element. Never invent or guess a sample identifier — if you cannot find any clearly distinguishable sample identifiers in the document, return an empty array.`;
}

export async function listSamples(pdfText: string, pdfBuffer: Buffer): Promise<DetectedSample[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content = buildDocumentOrTextContent(buildListSamplesInstructions(), pdfText, pdfBuffer);

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: content as Anthropic.MessageParam["content"] }],
    });

    const textBlock = message.content.find(block => block.type === "text");
    if (!textBlock || textBlock.type !== "text") return [];

    const stripped = textBlock.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    const parsed: unknown = JSON.parse(stripped);
    if (!validateListSamplesResponse(parsed)) return [];

    return parsed;
  } catch {
    // Stage A is a detection optimization, not a hard gate — any failure here (network error,
    // malformed response) falls back to the caller treating this as "0 samples detected", which
    // triggers the existing unscoped whole-document extraction, identical to today's behavior.
    return [];
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: PASS (all cases, old and new — confirm the pre-existing `buildMessageContent` tests still pass unchanged, proving the refactor preserved external behavior).

- [ ] **Step 6: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/hp-classification/extract.ts tests/hp-classification/extract.test.ts
git commit -m "feat: add listSamples() Stage A detection, refactor shared text/document content builder"
```

---

### Task 2: Scope Stage B extraction to an explicit sample identifier

**Files:**
- Modify: `lib/hp-classification/extract.ts`
- Test: `tests/hp-classification/extract.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing new from Task 1 beyond what's already in the file.
- Produces: `extractSampleData(pdfText: string, pdfBuffer: Buffer, analyteRef: AnalyteReference[], sampleIdentifier: string | null): Promise<ExtractionResult>` — signature gains a 4th parameter, consumed by Task 3's routes. `buildMessageContent` gains the same 4th parameter.

- [ ] **Step 1: Read the current file**

Read `lib/hp-classification/extract.ts` (post-Task-1 state) in full.

- [ ] **Step 2: Write the failing test**

Add to `tests/hp-classification/extract.test.ts`, inside (or alongside) the existing `describe("buildMessageContent", ...)` block:

```typescript
it("includes a scoping instruction when a sampleIdentifier is provided", () => {
  const content = buildMessageContent("Some report text with enough real words to pass the usable-text check for sure", smallPdfBuffer, analyteRef, "ENAT-BØF1-BO9OB1");
  expect(content[0].type).toBe("text");
  const text = (content[0] as { type: "text"; text: string }).text;
  expect(text).toContain("ENAT-BØF1-BO9OB1");
  expect(text.toLowerCase()).toContain("only");
});

it("has no scoping instruction when sampleIdentifier is null", () => {
  const content = buildMessageContent("Some report text with enough real words to pass the usable-text check for sure", smallPdfBuffer, analyteRef, null);
  const text = (content[0] as { type: "text"; text: string }).text;
  expect(text).not.toContain("ENAT-BØF1-BO9OB1");
});
```

(These use the same `smallPdfBuffer`/`analyteRef` fixtures already declared at the top of the existing `describe("buildMessageContent", ...)` block — reuse them, don't redeclare.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL with "Expected 3 arguments, but got 4" (TypeScript) or a runtime argument-count mismatch.

- [ ] **Step 4: Update `buildSchemaInstructions`, `buildMessageContent`, and `extractSampleData` to accept and use `sampleIdentifier`**

In `lib/hp-classification/extract.ts`, update `buildSchemaInstructions` to accept an optional identifier and append a scoping sentence when present:

```typescript
function buildSchemaInstructions(analyteRef: AnalyteReference[], sampleIdentifier: string | null): string {
  const knownAnalytes = analyteRef
    .map(a => `- ${a.analyteId}: ${[a.canonicalNameNo, a.canonicalNameIt, a.canonicalNameEn].filter(Boolean).join(" / ")}`)
    .join("\n");

  const scopingInstruction = sampleIdentifier
    ? `\n\nThis document contains data for MULTIPLE distinct samples. Extract data for ONLY the sample identified as "${sampleIdentifier}" — ignore all other samples' data entirely, including their metadata and results.`
    : "";

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
}${scopingInstruction}

Do NOT populate an "originProcess" field — it is intentionally absent from this schema. It is never present in a lab report and must be supplied by the user, not guessed by you.

For each analyte/substance result row in the report, match it against this list of known analytes by name (any language) and set "analyteId" to the matching id. If a row's substance does not match any of these, set "analyteId": null and add its raw name to the top-level "unmatchedAnalytes" array instead — never guess a match, and never invent an analyteId not in this list:

${knownAnalytes}

"expressedOnDryBasis" should be true when the report indicates the value is on a dry-matter/dry-substance basis (Italian: look for "s.s." or "sostanza secca"; Norwegian: look for "TS" or "tørrstoff" in the unit or a footnote), and false otherwise.

For "testResults", look for free-text statements about flammability, skin corrosion (e.g. "non corrosivo"/"corrosivo", "not corrosive"/"corrosive"), or skin irritation (e.g. "non irritante"/"irritante", "not irritating"/"irritating") and report each one found, with "isPositive" true if the test indicates the hazard IS present, false if it indicates it is NOT present.`;
}
```

Update `buildMessageContent`:

```typescript
export function buildMessageContent(
  pdfText: string,
  pdfBuffer: Buffer,
  analyteRef: AnalyteReference[],
  sampleIdentifier: string | null
): MessageContentBlock[] {
  return buildDocumentOrTextContent(buildSchemaInstructions(analyteRef, sampleIdentifier), pdfText, pdfBuffer);
}
```

Update `extractSampleData`'s signature and its call to `buildMessageContent`:

```typescript
export async function extractSampleData(
  pdfText: string,
  pdfBuffer: Buffer,
  analyteRef: AnalyteReference[],
  sampleIdentifier: string | null
): Promise<ExtractionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content = buildMessageContent(pdfText, pdfBuffer, analyteRef, sampleIdentifier);

  // ... rest of the function body is UNCHANGED from the current implementation ...
}
```

(Only the function signature and the `buildMessageContent(...)` call line change — the retry loop, JSON parsing, validation, and return statement stay exactly as they are today.)

- [ ] **Step 5: Update the existing `buildMessageContent` test calls in the same file to pass the 4th argument**

The pre-existing tests in `describe("buildMessageContent", ...)` (from before this plan) call `buildMessageContent(pdfText, buffer, analyteRef)` with 3 arguments — update every call site in this describe block to pass a 4th argument of `null` (since those tests are exercising the single-sample, unscoped case): e.g. `buildMessageContent("Real report text with arsenico 5.17%", smallPdfBuffer, analyteRef, null)`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: `npx vitest run` passes. `npm run build` will FAIL at `app/api/extract/route.ts` — it still calls `extractSampleData(pdfText, buffer, analyteRef)` with the old 3-argument signature. This is expected; Task 3 fixes it. Confirm the build failure is isolated to that one call site.

- [ ] **Step 8: Commit**

```bash
git add lib/hp-classification/extract.ts tests/hp-classification/extract.test.ts
git commit -m "feat: scope extractSampleData/buildMessageContent to an explicit sample identifier"
```

---

### Task 3: API routes — two-stage `/api/extract` + new `/api/extract-sample`

**Files:**
- Modify: `app/api/extract/route.ts`
- Create: `app/api/extract-sample/route.ts`

**Interfaces:**
- Consumes: `listSamples`, `DetectedSample`, `extractSampleData` (Task 1/2, both from `lib/hp-classification/extract.ts`).
- Produces: `POST /api/extract` now returns EITHER `{ data: ExtractionResult }` (0 or 1 samples detected — auto-resolved, unchanged shape from before) OR `{ samples: DetectedSample[] }` (2+ samples detected — new response shape, requires a follow-up call). `POST /api/extract-sample` accepts `file` (same PDF re-uploaded) + `sampleIdentifier` (string) as FormData, returns `{ data: ExtractionResult }` — consumed by Task 4's wizard UI.

- [ ] **Step 1: Read the current `app/api/extract/route.ts`**

Read the file in full to confirm its exact current structure before restructuring it.

- [ ] **Step 2: Rewrite `app/api/extract/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractSampleData, listSamples, hasUsableText } from "@/lib/hp-classification/extract";
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

  const detectedSamples = await listSamples(pdfText, buffer);

  if (detectedSamples.length > 1) {
    return NextResponse.json({ samples: detectedSamples });
  }

  // 0 or 1 samples detected: proceed exactly as before this feature existed — a single
  // sampleIdentifier (or null if Stage A found nothing/failed) scoped extraction call.
  const sampleIdentifier = detectedSamples.length === 1 ? detectedSamples[0].sampleIdentifier : null;

  try {
    const data = await extractSampleData(pdfText, buffer, analyteReferenceRaw as AnalyteReference[], sampleIdentifier);
    return NextResponse.json({ data });
  } catch (err) {
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
}
```

- [ ] **Step 3: Create `app/api/extract-sample/route.ts`**

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
  const sampleIdentifier = formData.get("sampleIdentifier");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!sampleIdentifier || typeof sampleIdentifier !== "string") {
    return NextResponse.json({ error: "Missing sampleIdentifier" }, { status: 400 });
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
    const data = await extractSampleData(pdfText, buffer, analyteReferenceRaw as AnalyteReference[], sampleIdentifier);
    return NextResponse.json({ data });
  } catch (err) {
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
}
```

- [ ] **Step 4: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: `npx vitest run` passes (no test file directly tests these two routes — this repo's established pattern is no route-level unit tests, per the earlier origin-process-dropdown branch's finding; the logic these routes call is already tested at the `lib/hp-classification/extract.ts` level). `npm run build` should be clean now — this is the last file needing the 4-argument `extractSampleData` signature update.

- [ ] **Step 5: Commit**

```bash
git add app/api/extract/route.ts app/api/extract-sample/route.ts
git commit -m "feat: wire /api/extract to Stage A detection, add /api/extract-sample for scoped Stage B"
```

---

### Task 4: Wizard UI — Sample selection step, manual verification

**Files:**
- Create: `components/wizard/SampleSelectionStep.tsx`
- Modify: `components/wizard/UploadStep.tsx`
- Modify: `components/wizard/Wizard.tsx`

**Interfaces:**
- Consumes: `POST /api/extract`'s new dual response shape (`{ data }` or `{ samples }`), `POST /api/extract-sample` (Task 3).
- Produces: a working end-to-end flow for both single-sample (unchanged) and multi-sample (new picker step) documents, manually verified against both real PDFs in hand.

- [ ] **Step 1: Read the current files**

Read `components/wizard/UploadStep.tsx` and `components/wizard/Wizard.tsx` in full — this task changes `UploadStep`'s callback contract (it now needs to report EITHER extracted data OR a samples-need-selection state) and adds orchestration logic to `Wizard.tsx`.

- [ ] **Step 2: Update `UploadStep.tsx` to handle the dual response shape**

Replace the file's content:

```tsx
"use client";
import { useState } from "react";
import { Card } from "@heroui/react";

interface DetectedSample {
  sampleIdentifier: string;
  matrixType: string | null;
}

export function UploadStep({ onExtracted, onSamplesFound, onError }: {
  onExtracted: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    sourceType: "text" | "document";
  }) => void;
  onSamplesFound: (samples: DetectedSample[], file: File) => void;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setFileName(file.name);
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/extract", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        onError(body.error ?? "Extraction failed");
        return;
      }
      if (body.samples) {
        onSamplesFound(body.samples, file);
        return;
      }
      onExtracted(body.data);
    } catch {
      onError("Could not reach the extraction service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Card.Content className="flex flex-col items-center gap-4 py-12">
        <label
          htmlFor="pdf-upload"
          className="w-full max-w-md rounded-2xl border-2 border-dashed border-forest/30 bg-cream/50 flex flex-col items-center gap-2 py-10 cursor-pointer hover:border-forest/60 transition-colors"
        >
          <p className="text-lg font-medium text-forest">Upload a waste characterization report</p>
          <p className="text-sm text-forest/60">Click to choose a PDF, or drag one here</p>
          <input
            id="pdf-upload"
            type="file"
            accept="application/pdf"
            disabled={loading}
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </label>
        {fileName && <p className="text-sm text-default-500">{fileName}</p>}
        {loading && <p className="text-sm">Extracting data…</p>}
      </Card.Content>
    </Card>
  );
}
```

- [ ] **Step 3: Create `components/wizard/SampleSelectionStep.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";

interface DetectedSample {
  sampleIdentifier: string;
  matrixType: string | null;
}

export function SampleSelectionStep({ samples, file, onSelected, onError }: {
  samples: DetectedSample[];
  file: File;
  onSelected: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    sourceType: "text" | "document";
  }) => void;
  onError: (message: string) => void;
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function handlePick(sampleIdentifier: string) {
    setLoadingId(sampleIdentifier);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("sampleIdentifier", sampleIdentifier);

    try {
      const res = await fetch("/api/extract-sample", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        onError(body.error ?? "Extraction failed");
        return;
      }
      onSelected(body.data);
    } catch {
      onError("Could not reach the extraction service. Check your connection and try again.");
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <Card>
      <Card.Content className="flex flex-col gap-4 py-6">
        <p className="text-sm font-medium text-forest">This document contains multiple samples</p>
        <p className="text-xs text-black/60">Choose which one to classify:</p>
        <div className="flex flex-col gap-2">
          {samples.map(sample => (
            <Button
              key={sample.sampleIdentifier}
              variant="secondary"
              onPress={() => handlePick(sample.sampleIdentifier)}
              isDisabled={loadingId !== null}
              className="justify-start"
            >
              {loadingId === sample.sampleIdentifier
                ? "Extracting…"
                : `${sample.sampleIdentifier}${sample.matrixType ? ` — ${sample.matrixType}` : ""}`}
            </Button>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}
```

- [ ] **Step 4: Update `Wizard.tsx` to orchestrate the new step**

Read the current file (post earlier plans) in full first. Add a new step to the `Step` union and wire it in:

```typescript
type Step = "upload" | "select-sample" | "review" | "results";
```

Add state for the pending file and detected samples:

```typescript
const [pendingFile, setPendingFile] = useState<File | null>(null);
const [detectedSamples, setDetectedSamples] = useState<{ sampleIdentifier: string; matrixType: string | null }[] | null>(null);
```

Add a handler:

```typescript
function handleSamplesFound(samples: { sampleIdentifier: string; matrixType: string | null }[], file: File) {
  setError(null);
  setDetectedSamples(samples);
  setPendingFile(file);
  setStep("select-sample");
}
```

Update `handleExtracted` (the existing single-sample handler) to also work when called from the new sample-selection path — it already just sets `extraction` state and moves to `"review"`, so it can be reused as-is for both call sites without changes to its own body.

Update `STAGE_NAMES` and the stage-index calculation to account for the new step (only shown when it's actually used — when a single-sample document skips straight from upload to review, the stage numbering should still make sense; simplest approach: keep `STAGE_NAMES` as `["Submitted", "Reviewed", "Classified"]` unchanged, and treat `"select-sample"` as still counting toward stage index 0 ("Submitted") since it's part of getting the submission resolved, not a new top-level stage):

```typescript
const stageIndex = step === "upload" || step === "select-sample" ? 0 : step === "review" ? 1 : 2;
```

Add the new `Tabs.Panel`/`Tabs.Tab` and wire `UploadStep`'s new prop:

```tsx
<Tabs.List>
  <Tabs.Tab id="upload">1. Submit</Tabs.Tab>
  <Tabs.Tab id="review" isDisabled={!extraction}>2. Review extraction</Tabs.Tab>
  <Tabs.Tab id="results" isDisabled={!classificationResult}>3. Classification</Tabs.Tab>
</Tabs.List>
<Tabs.Panel id="upload">
  <UploadStep onExtracted={handleExtracted} onSamplesFound={handleSamplesFound} onError={setError} />
</Tabs.Panel>
<Tabs.Panel id="select-sample">
  {detectedSamples && pendingFile && (
    <SampleSelectionStep samples={detectedSamples} file={pendingFile} onSelected={handleExtracted} onError={setError} />
  )}
</Tabs.Panel>
```

(`Tabs.List`/`Tabs.Tab` don't need a `"select-sample"` tab explicitly listed if the design intends it to only appear transiently as part of the upload flow, not as a persistently-clickable tab — check the existing `Tabs` component's behavior: since `selectedKey={step}` already drives which panel shows regardless of whether a corresponding `Tabs.Tab` exists in the list, omitting a `select-sample` tab entry is fine and keeps the visible tab list at 3 items as before; only add the `Tabs.Panel` for it, not a `Tabs.Tab`.)

Import `SampleSelectionStep` at the top of the file:

```typescript
import { SampleSelectionStep } from "./SampleSelectionStep";
```

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 6: Manual verification against both real PDFs**

With the local dev server running (check `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000`; restart if needed: `cd /Users/evenmyrennybo/WastemanagementPortal && lsof -ti:3000 | xargs -r kill -9; nohup npm run dev > /tmp/wastematch-dev.log 2>&1 & disown; sleep 5`):

1. **Italian sample (single-sample, must show zero behavior change)**: `curl -s -X POST http://localhost:3000/api/extract -F "file=@/Users/evenmyrennybo/Downloads/avfallskoderanalyserogtillatelserkonsesjonerformotta/Analyser jord 170503 Hera.pdf" -m 120` — confirm the response has a top-level `data` key (not `samples`), with real extracted content as before this plan.

2. **Eurofins bundle (multi-sample, the case this plan was built for)**: `curl -s -X POST http://localhost:3000/api/extract -F "file=@/Users/evenmyrennybo/Downloads/avfallskoderanalyserogtillatelserkonsesjonerformotta/Totalanalyse betongprøver - Alta Lufthavn Avinor.pdf" -m 120` — confirm the response now has a top-level `samples` array (not `data`) listing multiple detected samples with real sample identifiers (not empty/guessed).

3. Pick one sample identifier from step 2's response and call the follow-up endpoint directly: `curl -s -X POST http://localhost:3000/api/extract-sample -F "file=@/Users/evenmyrennybo/Downloads/avfallskoderanalyserogtillatelserkonsesjonerformotta/Totalanalyse betongprøver - Alta Lufthavn Avinor.pdf" -F "sampleIdentifier=<the real identifier from step 2>" -m 120` — confirm this now succeeds with real extracted data for just that one sample (not the malformed-JSON failure this whole feature was built to fix).

Report the actual observed responses honestly in your commit message/report — this is the real proof the feature works, and per this project's established discipline, a discrepancy from expectations should be investigated and reported, not forced or hidden.

- [ ] **Step 7: Commit**

```bash
git add components/wizard/SampleSelectionStep.tsx components/wizard/UploadStep.tsx components/wizard/Wizard.tsx
git commit -m "feat: add Sample selection wizard step for multi-sample PDFs"
```

---

## Self-Review Notes

- **Spec coverage:** Stage A detection (`listSamples`) → Task 1. Stage B scoping → Task 2. Two-stage API routing (`/api/extract` dual response + new `/api/extract-sample`) → Task 3. Wizard UI (Sample selection step) + manual verification against both real PDFs → Task 4.
- **Placeholder scan:** no TBD/TODO — every code block in every task is complete and directly transcribable.
- **Type consistency:** `DetectedSample` (Task 1) is used identically in Task 3's route responses, Task 4's `UploadStep`/`SampleSelectionStep`/`Wizard.tsx` state and props. `extractSampleData`'s 4-argument signature (`pdfText, pdfBuffer, analyteRef, sampleIdentifier`) is introduced in Task 2 and used identically by both `app/api/extract/route.ts` and the new `app/api/extract-sample/route.ts` in Task 3.
