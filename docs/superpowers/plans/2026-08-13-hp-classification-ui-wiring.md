# HP1-15 UI Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the old ExtractedWasteData/WMR-demo wizard flow and replace it with a real end-to-end path — PDF upload → Claude-based extraction into the HP1-15 engine's schema → user-supplied origin process → `classifySample()` → rendered HP1-15/EAL results — proven against the real Italian sample PDF in the browser.

**Architecture:** A new `classifySample()` orchestrator in `lib/hp-classification/` composes the four already-tested pipeline stages into one production entry point. A new `lib/hp-classification/extract.ts` mirrors the old extractor's pdfjs+Claude pattern but targets the richer schema. The wizard becomes three steps (Upload → Extraction review → Classification results) calling two rewritten API routes. The old flow (extraction/classification/matching/WMR data, and their tests/components) is deleted outright, not deprecated alongside the new one.

**Tech Stack:** TypeScript, Next.js API routes, Anthropic SDK (Claude Haiku, same as the old extractor), Vitest, HeroUI, existing pdfjs-dist PDF text extraction.

## Global Constraints

- `originProcess` is never requested from or inferred by the extraction LLM — it is always empty after extraction and must be filled in by the user before classification can run (mirrors the engine's own Stage 0 halt behavior).
- Extraction must tag each result row with a matched `analyteId` from the current `AnalyteReference` table or leave it `null` with the raw name preserved in `unmatchedAnalytes` — never guess a match.
- The regression test (`tests/hp-classification/italian-sample.test.ts`) must be refactored to call the new `classifySample()` orchestrator rather than duplicate its assembly logic inline — it proves the shipped path, not a parallel one.
- No facility/partner matching in this slice — the flow ends at classification results.
- The old flow's files, data, and tests are deleted, not left dead in the tree.

---

### Task 1: Retire the old flow

**Files:**
- Delete: `lib/extraction.ts`, `lib/classification.ts`, `lib/search-classify.ts`, `lib/matching.ts`, `lib/report-pdf.tsx`, `lib/wmr-cases.ts`, `lib/chemical-coverage.ts`, `lib/wmr-business-areas.ts`
- Delete: `lib/data/eal-codes.json`, `lib/data/avfallsstoffnummer.json`, `lib/data/pops.json`, `lib/data/nuklider.json`, `lib/data/wmr-cases.json`, `lib/data/wmr-partners.json`, `lib/data/facilities.json`
- Delete: `tests/classification.test.ts`, `tests/matching.test.ts`, `tests/search-classify.test.ts`, `tests/wmr-business-areas.test.ts`, `tests/wmr-cases.test.ts`
- Delete: `app/api/search-classify/route.ts`, `app/api/report/route.ts`
- Delete: `components/wizard/SearchStep.tsx`, `components/wizard/MatchesStep.tsx`
- Modify: `lib/types.ts` (remove `ExtractedWasteData`, `ComplianceFlag`, `ClassificationResult`, `Facility`, `FacilityMatch` — everything in this file was old-flow-specific)

**Interfaces:**
- Produces: a codebase with zero references to the old flow, ready for the new orchestrator/extractor/routes/components to occupy the freed space.

- [ ] **Step 1: Delete the old flow's library files, data, tests, routes, and components**

```bash
git rm lib/extraction.ts lib/classification.ts lib/search-classify.ts lib/matching.ts lib/report-pdf.tsx lib/wmr-cases.ts lib/chemical-coverage.ts lib/wmr-business-areas.ts
git rm lib/data/eal-codes.json lib/data/avfallsstoffnummer.json lib/data/pops.json lib/data/nuklider.json lib/data/wmr-cases.json lib/data/wmr-partners.json lib/data/facilities.json
git rm tests/classification.test.ts tests/matching.test.ts tests/search-classify.test.ts tests/wmr-business-areas.test.ts tests/wmr-cases.test.ts
git rm app/api/search-classify/route.ts app/api/report/route.ts
git rm components/wizard/SearchStep.tsx components/wizard/MatchesStep.tsx
```

- [ ] **Step 2: Remove the old-flow interfaces from `lib/types.ts`**

Read the current file first. Remove `ExtractedWasteData`, `ComplianceFlag`, `ClassificationResult`, `Facility`, `FacilityMatch` entirely — every interface in this file today is old-flow-specific, so after this step the file should be empty of interfaces (Task 2 will add the new orchestrator's exported type here, or a task-owner may choose to delete this file too if nothing remains — check after removal whether the file is empty; if so, `git rm lib/types.ts` instead of leaving an empty file).

- [ ] **Step 3: Confirm the build fails only in the expected places**

```bash
npx vitest run
npm run build
```

Expected: the build FAILS — `app/api/extract/route.ts`, `app/api/classify/route.ts`, `components/wizard/Wizard.tsx`, `components/wizard/UploadStep.tsx`, `components/wizard/ReviewStep.tsx` all still import the now-deleted old types/functions. This is expected and intentional — Tasks 4 and 5 replace these files' contents. Confirm via the build output that these are the ONLY remaining errors (no unrelated breakage), then commit this intentionally-broken intermediate state.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old extraction/classification/WMR-matching flow, superseded by HP1-15 engine"
```

---

### Task 2: `classifySample()` orchestrator

**Files:**
- Create: `lib/hp-classification/classify-sample.ts`
- Modify: `lib/hp-classification/types.ts` (extend `AnalyteReference` with the fields the JSON data already carries)
- Modify: `lib/data/analyte-reference.json` (no content change — just confirm it already matches the extended type; fix if any entry doesn't)
- Modify: `tests/hp-classification/italian-sample.test.ts` (replace inline assembly with a call to `classifySample`)
- Test: `tests/hp-classification/classify-sample.test.ts`

**Interfaces:**
- Consumes: `normalizeSample` (`lib/hp-classification/normalize.ts`), `speciateElement`/`ElementCompoundForm` (`lib/hp-classification/speciate.ts`), `classifyHazard`/`NormalizedResultWithClp`/`TestResult`/`HazardClassification` (`lib/hp-classification/hazard.ts`), `assignEalCode`/`EalAssignment` (`lib/hp-classification/eal.ts`).
- Produces: `classifySample(metadata: SampleMetadata, results: SampleResult[], testResults: TestResult[], analyteRef: AnalyteReference[], compoundForms: ElementCompoundForm[], originToChapterLookup: Record<string, string>): { hazard: HazardClassification; eal: EalAssignment }` — consumed by Task 3's fixture-based tests, Task 4's API route, and the regression test.

- [ ] **Step 1: Extend `AnalyteReference` to match what `lib/data/analyte-reference.json` already stores**

Read `lib/data/analyte-reference.json` in full first — its entries today carry `elementSymbol` (for speciated elements like arsenic), OR a single `hStatement`/`hazardClass` pair, OR an `hStatements` array (multiple simultaneous classifications), plus an optional `mFactorChronic`, none of which are declared on the `AnalyteReference` interface in `lib/hp-classification/types.ts` — the italian-sample test currently works around this with `as`/structural-narrowing casts.

In `lib/hp-classification/types.ts`, replace the `AnalyteReference` interface with:

```typescript
export interface AnalyteReference {
  analyteId: string;
  canonicalNameNo: string;
  canonicalNameIt: string | null;
  canonicalNameEn: string;
  casNumber: string | null;
  defaultUnit: string;
  substanceGroup: string;
  mFactorAcute: number | null;
  mFactorChronic: number | null;
  elementSymbol: string | null;
  hStatement: string | null;
  hazardClass: string | null;
  hStatements: { hStatement: string; hazardClass: string }[] | null;
}
```

Then update `lib/data/analyte-reference.json`: for every entry, ensure it has all of `elementSymbol`, `hStatement`, `hazardClass`, `hStatements`, `mFactorAcute`, `mFactorChronic`, `canonicalNameNo`, `canonicalNameEn` present (`null` where not applicable) — an entry with a single `hStatement`/`hazardClass` pair sets `elementSymbol: null` and `hStatements: null`; an entry with `elementSymbol` set (e.g. arsenic) sets `hStatement: null`, `hazardClass: null`, `hStatements: null`; an entry with `hStatements` (multi-classification) sets `elementSymbol: null`, `hStatement: null`, `hazardClass: null`. Do not change any existing CAS numbers, H-statements, or hazard classes — only add the missing null fields so every entry has a consistent shape. Also fill `canonicalNameNo` (use the same value as `canonicalNameIt` where the report only gives an Italian name — there is no separate Norwegian name for these Italian-report-sourced substances yet) if any entry is missing it.

- [ ] **Step 2: Write the failing test**

Create `tests/hp-classification/classify-sample.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";

const baseMetadata: SampleMetadata = {
  sampleId: "t", externalReportNo: "t", labName: "t", customerName: "t", sampleMarking: "t",
  matrixType: "jord", samplingDate: null, receiptDate: null, originProcess: "test-origin",
  producerName: null, physicalState: "solid", viscosity40cMm2s: null, ph: null,
  labClassificationGiven: false, labStatedEalCode: null,
};

const analyteRef: AnalyteReference[] = [
  {
    analyteId: "test-carcinogen", canonicalNameNo: "test", canonicalNameIt: null, canonicalNameEn: "test",
    casNumber: null, defaultUnit: "%", substanceGroup: "other", mFactorAcute: null, mFactorChronic: null,
    elementSymbol: null, hStatement: "H350", hazardClass: "Carc. 1A", hStatements: null,
  },
];

describe("classifySample", () => {
  it("composes normalize -> classifyHazard -> assignEalCode for a simple non-speciated substance", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.resultsByHp.HP7).toBe(true);
    expect(result.hazard.isHazardous).toBe(true);
    expect(result.eal.code).toBe("17 05 03*");
  });

  it("skips a result with no matching AnalyteReference entry, never crashing", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "unregistered", rawAnalyteName: "unknown",
        resultValue: 99, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBe(false);
    expect(result.eal.code).toBe("17 05 04");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts`
Expected: FAIL with "Cannot find module '@/lib/hp-classification/classify-sample'"

- [ ] **Step 4: Write the implementation**

Create `lib/hp-classification/classify-sample.ts`, extracting the assembly logic currently duplicated inline in `tests/hp-classification/italian-sample.test.ts` into a real function:

```typescript
import { normalizeSample } from "./normalize";
import { speciateElement, type ElementCompoundForm } from "./speciate";
import { classifyHazard, type NormalizedResultWithClp, type TestResult, type HazardClassification } from "./hazard";
import { assignEalCode, type EalAssignment } from "./eal";
import type { SampleMetadata, SampleResult, AnalyteReference } from "./types";

export function classifySample(
  metadata: SampleMetadata,
  results: SampleResult[],
  testResults: TestResult[],
  analyteRef: AnalyteReference[],
  compoundForms: ElementCompoundForm[],
  originToChapterLookup: Record<string, string>
): { hazard: HazardClassification; eal: EalAssignment } {
  const normalized = normalizeSample(metadata, results, analyteRef);

  const withClp: NormalizedResultWithClp[] = [];
  for (const n of normalized) {
    const ref = analyteRef.find(a => a.analyteId === n.analyteId);
    if (!ref) continue; // no reference entry — skip, never guess (should already be filtered by normalizeSample, defensive here too)

    if (ref.elementSymbol) {
      const compounds = speciateElement(ref.elementSymbol, n.resultDryBasisPct, compoundForms);
      for (const c of compounds) {
        for (const clp of c.clpClassifications) {
          withClp.push({
            substanceName: c.compoundName,
            resultPct: c.resultPct,
            hStatement: clp.hStatement,
            hazardClass: clp.hazardClass,
            mFactorAcute: clp.hStatement === "H400" ? clp.mFactorAcute : null,
            mFactorChronic: clp.hStatement === "H410" ? clp.mFactorChronic : null,
          });
        }
      }
    } else if (ref.hStatement && ref.hazardClass) {
      withClp.push({
        substanceName: ref.analyteId,
        resultPct: n.resultDryBasisPct,
        hStatement: ref.hStatement,
        hazardClass: ref.hazardClass,
        mFactorAcute: null,
        mFactorChronic: ref.mFactorChronic,
      });
    } else if (ref.hStatements) {
      for (const h of ref.hStatements) {
        withClp.push({
          substanceName: ref.analyteId,
          resultPct: n.resultDryBasisPct,
          hStatement: h.hStatement,
          hazardClass: h.hazardClass,
          mFactorAcute: null,
          mFactorChronic: ref.mFactorChronic,
        });
      }
    }
    // an AnalyteReference entry with none of elementSymbol/hStatement/hStatements set has no known
    // hazard classification — its normalized result is silently excluded from HP classification,
    // never guessed into a category.
  }

  const hazard = classifyHazard(withClp, metadata, testResults);
  const eal = assignEalCode(hazard.isHazardous, metadata.originProcess, metadata.labStatedEalCode, originToChapterLookup);

  return { hazard, eal };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/classify-sample.test.ts`
Expected: PASS (2/2)

- [ ] **Step 6: Refactor the regression test to call `classifySample`**

Replace the entire body of `tests/hp-classification/italian-sample.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import type { TestResult } from "@/lib/hp-classification/hazard";
import elementCompoundForms from "@/lib/data/element-compound-forms.json";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import fixture from "@/fixtures/italian-sample.json";

const originLookup = { "escavo terre e rocce": "1705" };

describe("Italian sample regression test (Rapporto di Prova EV-21-039071-288752)", () => {
  it("reproduces the lab's own stated HP triggers and EAL code", () => {
    const metadata = fixture.metadata as SampleMetadata;
    const results = fixture.results.map(r => ({ ...r, sampleId: metadata.sampleId, method: null })) as SampleResult[];
    const analyteRef = analyteReferenceRaw as AnalyteReference[];

    const { hazard, eal } = classifySample(
      metadata,
      results,
      fixture.testResults as TestResult[],
      analyteRef,
      elementCompoundForms as ElementCompoundForm[],
      originLookup
    );

    expect(hazard.triggeredHps.sort()).toEqual(["HP10", "HP14", "HP6", "HP7"]);
    expect(hazard.isHazardous).toBe(true);
    expect(eal.code).toBe("17 05 03*");
    expect(eal.confidence).toBe("high — engine agrees with lab's own classification");
  });
});
```

Note: this requires `lib/data/analyte-reference.json`'s entries to already carry the full extended shape from Step 1 (e.g. `canonicalNameNo` populated, `hStatement`/`hStatements`/`elementSymbol` fields present as `null` where not applicable) — if any entry is missing a field, the `as AnalyteReference[]` cast will not catch it at runtime (JSON casts don't validate), so if this test fails after the refactor, check the JSON file's shape against Step 1's field list before assuming `classify-sample.ts` has a bug.

- [ ] **Step 7: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: `npx vitest run` passes (all tests, including the refactored regression test). The build will still show the SAME expected failures from Task 1 Step 3 (routes/components not yet updated) — confirm no NEW build errors were introduced by this task's type changes.

- [ ] **Step 8: Commit**

```bash
git add lib/hp-classification/classify-sample.ts lib/hp-classification/types.ts lib/data/analyte-reference.json tests/hp-classification/classify-sample.test.ts tests/hp-classification/italian-sample.test.ts
git commit -m "feat: add classifySample() orchestrator, refactor regression test to use it"
```

---

### Task 3: Extraction into the new schema

**Files:**
- Create: `lib/hp-classification/extract.ts`
- Test: `tests/hp-classification/extract.test.ts`

**Interfaces:**
- Consumes: `SampleMetadata`, `SampleResult`, `AnalyteReference` (`lib/hp-classification/types.ts`), `TestResult` (`lib/hp-classification/hazard.ts`).
- Produces: `extractSampleData(pdfText: string, analyteRef: AnalyteReference[]): Promise<{ metadata: Partial<SampleMetadata>; results: Omit<SampleResult, "sampleId" | "method">[]; testResults: TestResult[]; unmatchedAnalytes: string[] }>` — consumed by Task 4's API route.

- [ ] **Step 1: Write the failing test**

Create `tests/hp-classification/extract.test.ts`. This test does NOT call the real Claude API (no network calls in unit tests) — it tests the response-parsing/validation logic in isolation by exercising a small validator function the module also exports:

```typescript
import { describe, it, expect } from "vitest";
import { validateExtractionResponse } from "@/lib/hp-classification/extract";

describe("validateExtractionResponse", () => {
  const validResponse = {
    metadata: { customerName: "Test Co", matrixType: "jord", physicalState: "solid" },
    results: [
      { rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true },
    ],
    testResults: [],
    unmatchedAnalytes: [],
  };

  it("accepts a well-formed extraction response", () => {
    expect(validateExtractionResponse(validResponse)).toBe(true);
  });

  it("rejects a response missing the results array", () => {
    const { results: _results, ...rest } = validResponse;
    expect(validateExtractionResponse(rest)).toBe(false);
  });

  it("rejects a response where a result row is missing rawAnalyteName", () => {
    const bad = { ...validResponse, results: [{ analyteId: "arsenic", resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true }] };
    expect(validateExtractionResponse(bad)).toBe(false);
  });

  it("accepts a result row with analyteId: null (unmatched)", () => {
    const withUnmatched = { ...validResponse, results: [{ rawAnalyteName: "some unknown thing", analyteId: null, resultValue: 1, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true }] };
    expect(validateExtractionResponse(withUnmatched)).toBe(true);
  });

  it("rejects a response that isn't an object", () => {
    expect(validateExtractionResponse(null)).toBe(false);
    expect(validateExtractionResponse("a string")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL with "Cannot find module '@/lib/hp-classification/extract'"

- [ ] **Step 3: Write the implementation**

Create `lib/hp-classification/extract.ts`:

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

function buildPrompt(pdfText: string, analyteRef: AnalyteReference[]): string {
  const knownAnalytes = analyteRef
    .map(a => `- ${a.analyteId}: ${[a.canonicalNameNo, a.canonicalNameIt, a.canonicalNameEn].filter(Boolean).join(" / ")}`)
    .join("\n");

  return `You are extracting structured waste characterization data from a lab report (Italian or Norwegian format).
Read the report text and return ONLY a JSON object matching this exact shape, with no markdown fences and no commentary:

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

For "testResults", look for free-text statements about flammability, skin corrosion (e.g. "non corrosivo"/"corrosivo", "not corrosive"/"corrosive"), or skin irritation (e.g. "non irritante"/"irritante", "not irritating"/"irritating") and report each one found, with "isPositive" true if the test indicates the hazard IS present, false if it indicates it is NOT present.

Report text:
`;
}

const MAX_EXTRACTION_ATTEMPTS = 2;

export async function extractSampleData(pdfText: string, analyteRef: AnalyteReference[]): Promise<ExtractionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = buildPrompt(pdfText, analyteRef) + pdfText;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EXTRACTION_ATTEMPTS; attempt++) {
    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: full suite passes (no network call is made in the unit test — `validateExtractionResponse` is a pure function). Build still shows only the Task-1-expected failures (routes/components not yet updated).

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/extract.ts tests/hp-classification/extract.test.ts
git commit -m "feat: add extractSampleData() targeting the HP1-15 engine schema"
```

---

### Task 4: API routes

**Files:**
- Modify: `app/api/extract/route.ts` (rewrite to call `extractSampleData`)
- Modify: `app/api/classify/route.ts` (rewrite to call `classifySample`)

**Interfaces:**
- Consumes: `extractSampleData` (Task 3), `classifySample` (Task 2), `lib/data/analyte-reference.json`, `lib/data/element-compound-forms.json`.
- Produces: `POST /api/extract` returning `{ data: ExtractionResult }` on success; `POST /api/classify` accepting `{ metadata, results, testResults }` and returning `{ hazard: HazardClassification, eal: EalAssignment }` — consumed by Task 5's wizard components.

- [ ] **Step 1: Read the current route files**

Read `app/api/extract/route.ts` and `app/api/classify/route.ts` in full — this task keeps the PDF-text-extraction (pdfjs) and request-parsing plumbing from `app/api/extract/route.ts` but swaps the function it calls; `app/api/classify/route.ts` is rewritten more substantially since its old shape (`{ data }` → `classifyWaste` → `{ classification, matches }`) no longer applies (no `matches` in this slice).

- [ ] **Step 2: Rewrite `app/api/extract/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractSampleData } from "@/lib/hp-classification/extract";
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

  let pdfText: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    pdfText = parsed.text;
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded PDF" }, { status: 422 });
  }

  if (!pdfText.trim()) {
    return NextResponse.json({ error: "The PDF appears to contain no extractable text" }, { status: 422 });
  }

  try {
    const data = await extractSampleData(pdfText, analyteReferenceRaw as AnalyteReference[]);
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 3: Rewrite `app/api/classify/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import type { TestResult } from "@/lib/hp-classification/hazard";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import elementCompoundForms from "@/lib/data/element-compound-forms.json";

const ORIGIN_TO_CHAPTER_LOOKUP: Record<string, string> = {
  "escavo terre e rocce": "1705",
};

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { metadata, results, testResults } = body as {
    metadata?: SampleMetadata;
    results?: SampleResult[];
    testResults?: TestResult[];
  };

  if (!metadata || !Array.isArray(results)) {
    return NextResponse.json({ error: "Missing sample metadata or results" }, { status: 400 });
  }
  if (!metadata.originProcess) {
    return NextResponse.json({ error: "originProcess is required before classification can run" }, { status: 400 });
  }

  const { hazard, eal } = classifySample(
    metadata,
    results,
    testResults ?? [],
    analyteReferenceRaw as AnalyteReference[],
    elementCompoundForms as ElementCompoundForm[],
    ORIGIN_TO_CHAPTER_LOOKUP
  );

  return NextResponse.json({ hazard, eal });
}
```

- [ ] **Step 4: Verify the build no longer fails on these two files**

```bash
npm run build 2>&1 | grep -A3 "app/api"
```

Expected: no errors referencing `app/api/extract/route.ts` or `app/api/classify/route.ts` specifically. The build as a whole may still fail on `components/wizard/*` (Task 5's job) — confirm the remaining failures are only there.

- [ ] **Step 5: Commit**

```bash
git add app/api/extract/route.ts app/api/classify/route.ts
git commit -m "feat: wire /api/extract and /api/classify to the HP1-15 engine"
```

---

### Task 5: Wizard UI rebuild

**Files:**
- Modify: `components/wizard/UploadStep.tsx`
- Create: `components/wizard/ExtractionReviewStep.tsx`
- Create: `components/wizard/ClassificationResultsStep.tsx`
- Modify: `components/wizard/Wizard.tsx`
- Delete: `components/wizard/ReviewStep.tsx` (replaced by `ExtractionReviewStep.tsx`, whose responsibility is different — reviewing/editing extracted data before classification, not reviewing a classification result)

**Interfaces:**
- Consumes: `ExtractionResult` (Task 3's shape, as returned by `POST /api/extract`), `{ hazard, eal }` (Task 4's `POST /api/classify` response shape), `HazardClassification`/`EalAssignment` types.
- Produces: a working three-step wizard, manually verified against the real Italian sample PDF.

- [ ] **Step 1: Rewrite `components/wizard/UploadStep.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Card } from "@heroui/react";

export function UploadStep({ onExtracted, onError }: {
  onExtracted: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
  }) => void;
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

(Only change from the old file: the `onExtracted` callback's payload type reflects the new `ExtractionResult` shape instead of `ExtractedWasteData` — the fetch/error-handling logic is otherwise identical, since it was already schema-agnostic.)

- [ ] **Step 2: Create `components/wizard/ExtractionReviewStep.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";

interface ExtractedMetadata {
  externalReportNo: string | null;
  labName: string | null;
  customerName: string | null;
  sampleMarking: string | null;
  matrixType: string | null;
  physicalState: "solid" | "liquid" | null;
  ph: number | null;
  labClassificationGiven: boolean;
  labStatedEalCode: string | null;
}

export function ExtractionReviewStep({ extraction, onConfirm }: {
  extraction: {
    metadata: ExtractedMetadata;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
  };
  onConfirm: (originProcess: string) => void;
}) {
  const [originProcess, setOriginProcess] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <Card.Content className="flex flex-col gap-3 py-6">
          <p className="text-sm font-medium text-forest">Extracted sample details</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <p className="text-black/50">Report No.</p>
            <p>{extraction.metadata.externalReportNo ?? "—"}</p>
            <p className="text-black/50">Lab</p>
            <p>{extraction.metadata.labName ?? "—"}</p>
            <p className="text-black/50">Customer</p>
            <p>{extraction.metadata.customerName ?? "—"}</p>
            <p className="text-black/50">Matrix</p>
            <p>{extraction.metadata.matrixType ?? "—"}</p>
            <p className="text-black/50">Physical state</p>
            <p>{extraction.metadata.physicalState ?? "—"}</p>
          </div>
          <p className="text-sm text-black/60">{extraction.results.length} analyte result(s) matched.</p>
        </Card.Content>
      </Card>

      {extraction.unmatchedAnalytes.length > 0 && (
        <Card>
          <Card.Content className="py-4">
            <p className="text-sm font-medium text-amber-700">Not evaluated — no reference match</p>
            <p className="text-xs text-black/60 mt-1">
              These substances were found in the report but aren&rsquo;t in the current reference table, so they
              were excluded from hazard classification rather than guessed:
            </p>
            <ul className="text-sm mt-2 flex flex-col gap-1">
              {extraction.unmatchedAnalytes.map(name => (
                <li key={name} className="text-black/70">{name}</li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      )}

      <Card>
        <Card.Content className="py-6 flex flex-col gap-2">
          <label htmlFor="origin-process" className="text-sm font-medium text-forest">
            Origin / process <span className="text-danger">*</span>
          </label>
          <p className="text-xs text-black/60">
            Never present in a lab report — required to select the correct EAL chapter. This is never guessed.
          </p>
          <input
            id="origin-process"
            type="text"
            value={originProcess}
            onChange={e => setOriginProcess(e.target.value)}
            placeholder="e.g. escavo terre e rocce"
            className="border border-black/10 rounded-lg px-3 py-2 text-sm"
          />
        </Card.Content>
      </Card>

      <Button
        variant="primary"
        onPress={() => onConfirm(originProcess)}
        isDisabled={originProcess.trim() === ""}
        className="self-start"
      >
        Classify
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/wizard/ClassificationResultsStep.tsx`**

```tsx
"use client";
import { Card, Chip } from "@heroui/react";
import { HeroCard, StatCard } from "@/components/dashboard/DashboardCards";

type HpOutcome = boolean | "not tested — assumed not applicable" | "requires case-specific assessment — not automatable from lab data alone" | "superseded by HP8";

interface HazardClassification {
  resultsByHp: Record<string, HpOutcome>;
  isHazardous: boolean;
  triggeredHps: string[];
  confidenceFlags: string[];
}

interface EalAssignment {
  code: string | null;
  description: string | null;
  confidence: string;
}

function outcomeLabel(outcome: HpOutcome): string {
  if (outcome === true) return "Triggered";
  if (outcome === false) return "Not triggered";
  return outcome;
}

export function ClassificationResultsStep({ hazard, eal }: { hazard: HazardClassification; eal: EalAssignment }) {
  return (
    <div className="flex flex-col gap-4">
      <HeroCard
        label="EAL Code"
        value={eal.code ?? "Not determined"}
        sublabel={eal.description ?? eal.confidence}
      />

      <StatCard label="Confidence" value={eal.confidence} valueClassName="text-sm break-words" />

      <StatCard label="Hazardous waste" value={hazard.isHazardous ? "Yes" : "No"} />

      <Card>
        <Card.Content className="flex flex-col gap-2 py-4">
          <p className="text-sm font-medium text-forest">HP1–HP15 outcomes</p>
          {Object.entries(hazard.resultsByHp)
            .sort(([a], [b]) => Number(a.slice(2)) - Number(b.slice(2)))
            .map(([hp, outcome]) => (
              <div key={hp} className="flex items-center gap-3 text-sm">
                <Chip color={outcome === true ? "danger" : "default"} variant="soft" className="w-14 justify-center">
                  {hp}
                </Chip>
                <span className="text-black/70">{outcomeLabel(outcome)}</span>
              </div>
            ))}
        </Card.Content>
      </Card>

      {hazard.confidenceFlags.length > 0 && (
        <Card>
          <Card.Content className="py-4">
            <p className="text-sm font-medium">Caveats</p>
            <ul className="text-xs text-black/60 mt-1 flex flex-col gap-1">
              {hazard.confidenceFlags.map((flag, i) => (
                <li key={i}>{flag}</li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      )}

      <p className="text-xs text-black/40">
        Facility matching against permitted handlers is a future stage — not part of this result.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `components/wizard/Wizard.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Tabs } from "@heroui/react";
import { UploadStep } from "./UploadStep";
import { ExtractionReviewStep } from "./ExtractionReviewStep";
import { ClassificationResultsStep } from "./ClassificationResultsStep";
import { ProgressCard } from "@/components/dashboard/DashboardCards";

type Step = "upload" | "review" | "results";

const STAGE_NAMES = ["Submitted", "Reviewed", "Classified"];

interface ExtractionData {
  metadata: {
    externalReportNo: string | null;
    labName: string | null;
    customerName: string | null;
    sampleMarking: string | null;
    matrixType: string | null;
    physicalState: "solid" | "liquid" | null;
    ph: number | null;
    labClassificationGiven: boolean;
    labStatedEalCode: string | null;
  };
  results: Record<string, unknown>[];
  testResults: Record<string, unknown>[];
  unmatchedAnalytes: string[];
}

export function Wizard() {
  const [step, setStep] = useState<Step>("upload");
  const [extraction, setExtraction] = useState<ExtractionData | null>(null);
  const [classificationResult, setClassificationResult] = useState<{ hazard: unknown; eal: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);

  function handleExtracted(data: ExtractionData) {
    setError(null);
    setExtraction(data);
    setStep("review");
  }

  async function handleConfirmOrigin(originProcess: string) {
    if (!extraction) return;
    setError(null);
    setClassifying(true);
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { ...extraction.metadata, originProcess },
          results: extraction.results,
          testResults: extraction.testResults,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Classification failed");
        return;
      }
      setClassificationResult({ hazard: body.hazard, eal: body.eal });
      setStep("results");
    } catch {
      setError("Could not reach the classification service.");
    } finally {
      setClassifying(false);
    }
  }

  const stageIndex = step === "upload" ? 0 : step === "review" ? 1 : 2;

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 flex flex-col gap-6">
      <ProgressCard
        stageLabel={STAGE_NAMES[stageIndex]}
        stageIndex={stageIndex}
        totalStages={3}
        stageNames={STAGE_NAMES}
      />
      <Tabs selectedKey={step} onSelectionChange={key => setStep(key as Step)} aria-label="Wizard steps">
        <Tabs.List>
          <Tabs.Tab id="upload">1. Submit</Tabs.Tab>
          <Tabs.Tab id="review" isDisabled={!extraction}>2. Review extraction</Tabs.Tab>
          <Tabs.Tab id="results" isDisabled={!classificationResult}>3. Classification</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="upload">
          <UploadStep onExtracted={handleExtracted} onError={setError} />
        </Tabs.Panel>
        <Tabs.Panel id="review">
          {extraction && (
            <>
              <ExtractionReviewStep extraction={extraction} onConfirm={handleConfirmOrigin} />
              {classifying && <p className="text-sm mt-2">Classifying…</p>}
            </>
          )}
        </Tabs.Panel>
        <Tabs.Panel id="results">
          {classificationResult && (
            <ClassificationResultsStep
              hazard={classificationResult.hazard as never}
              eal={classificationResult.eal as never}
            />
          )}
        </Tabs.Panel>
      </Tabs>
      {error && <p className="text-danger mt-4">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Delete the old `ReviewStep.tsx`**

```bash
git rm components/wizard/ReviewStep.tsx
```

- [ ] **Step 6: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean, no remaining errors anywhere in the codebase.

- [ ] **Step 7: Manual end-to-end verification**

Start the dev server (`npm run dev` or via the project's preview tooling) and, in a browser, upload the real Italian sample PDF (`/Users/evenmyrennybo/Downloads/avfallskoderanalyserogtillatelserkonsesjonerformotta/Analyser jord 170503 Hera.pdf`) through the actual Upload step. Confirm: extraction completes and the Extraction review step shows sensible metadata (matrix, physical state, customer); enter `escavo terre e rocce` as the origin process (the only entry the lookup table has); confirm the Classification step renders `HP6`, `HP7`, `HP10`, `HP14` as "Triggered" and the EAL code as `17 05 03*` — the same ground truth the regression test already proves at the function level. If the live extraction produces different `analyteId` matches than the hand-transcribed fixture (a real possibility, since this is the LLM's first time parsing this specific report), that's useful signal about extraction quality, not necessarily a bug — note any discrepancy in the commit message rather than silently accepting or forcing a match.

- [ ] **Step 8: Commit**

```bash
git add components/wizard/
git commit -m "feat: rebuild wizard UI around the HP1-15 engine (Upload -> Extraction review -> Classification results)"
```

---

## Self-Review Notes

- **Spec coverage:** `classifySample()` orchestrator → Task 2. `extractSampleData()` targeting both report layouts via one Claude prompt → Task 3. API routes → Task 4. Three-step wizard UI, retirement of the old flow → Tasks 1 and 5. Manual end-to-end verification against the real PDF → Task 5 Step 7.
- **Placeholder scan:** no TBD/TODO. Task 5 Step 7's live-extraction-may-differ note is a genuine acknowledged uncertainty about LLM output on first real run, not a plan gap — the plan's own testing philosophy (established in the prior engine's plan) is to investigate real discrepancies honestly rather than force a match, and that's what's instructed here.
- **Type consistency:** `AnalyteReference`'s extended shape (Task 2 Step 1) is the single source every later task's mock/fixture data conforms to — Task 3's extraction prompt describes `analyteId` matching against exactly this table, Task 4's routes pass the same JSON files through untouched, Task 5's components consume `HazardClassification`/`EalAssignment` shapes matching Task 2's orchestrator return type exactly (field names `resultsByHp`/`isHazardous`/`triggeredHps`/`confidenceFlags` and `code`/`description`/`confidence` are used identically in the UI components and the orchestrator).
- **Known scope reduction, disclosed rather than hidden:** Task 1 removes PDF report generation (`lib/report-pdf.tsx`, `/api/report`) since it was built against the old `FacilityMatch` model and this slice's UI flow (per the approved spec) ends at classification results with no report/download step — this isn't silently dropped, it's the direct consequence of "no facility/partner matching in this slice."
