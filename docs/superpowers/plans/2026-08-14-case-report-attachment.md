# Case Report Attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Case retain and let the user re-view the original uploaded lab report document it was created from.

**Architecture:** A new `lib/wizard/report-storage.ts` module wraps IndexedDB (with an in-memory fallback for SSR/tests, mirroring `lib/projects.ts`'s established pattern) to store the report file's raw bytes, keyed by case id, entirely separate from the `cases-v1` localStorage blob. `Case` gains a `reportFileName` field for display. `Wizard.tsx` is fixed to actually receive the uploaded `File` for the single-sample path (a real gap found during design — today only the multi-sample path forwards it) and saves it to IndexedDB when a case is created. The case detail page gains a "View" affordance that fetches the blob on demand and opens it in a new tab.

**Tech Stack:** TypeScript, Next.js App Router, React, Vitest, IndexedDB (browser), localStorage (existing).

## Global Constraints

- No backend/server-side storage — this stays entirely local to the browser that created the case, same limitation the rest of this app already has.
- One file per case, attached once at case creation — no re-upload/replace flow, no multi-file attachment.
- A report-save failure must never block the classification flow the user is already completing — log/ignore, don't surface a blocking error for this nice-to-have attachment.
- Seed cases get `reportFileName: null` — no fabricated placeholder files for synthetic demo data.

---

### Task 1: Report file storage layer

**Files:**
- Create: `lib/wizard/report-storage.ts`
- Test: `tests/wizard/report-storage.test.ts`

**Interfaces:**
- Produces: `export function saveReportFile(caseId: string, file: File): Promise<void>` and `export function getReportFile(caseId: string): Promise<File | null>` from `lib/wizard/report-storage.ts` — Task 3 (`Wizard.tsx`) calls `saveReportFile`, and the case detail page (a later task in this plan, Task 3 as written below covers both) calls `getReportFile`.

- [ ] **Step 1: Write the failing tests**

Create `tests/wizard/report-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { saveReportFile, getReportFile } from "@/lib/wizard/report-storage";

function makeFile(name: string, content: string): File {
  return new File([content], name, { type: "application/pdf" });
}

describe("report-storage", () => {
  it("saves and retrieves a file by case id", async () => {
    const file = makeFile("report.pdf", "fake pdf bytes");
    await saveReportFile("case-a", file);
    const retrieved = await getReportFile("case-a");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe("report.pdf");
  });

  it("returns null for a case id with no saved file", async () => {
    const retrieved = await getReportFile("no-such-case");
    expect(retrieved).toBeNull();
  });

  it("keeps files for different case ids independent", async () => {
    await saveReportFile("case-b", makeFile("b.pdf", "b content"));
    await saveReportFile("case-c", makeFile("c.pdf", "c content"));
    const b = await getReportFile("case-b");
    const c = await getReportFile("case-c");
    expect(b!.name).toBe("b.pdf");
    expect(c!.name).toBe("c.pdf");
  });

  it("overwriting a case id's file replaces the previous one", async () => {
    await saveReportFile("case-d", makeFile("first.pdf", "first"));
    await saveReportFile("case-d", makeFile("second.pdf", "second"));
    const retrieved = await getReportFile("case-d");
    expect(retrieved!.name).toBe("second.pdf");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/wizard/report-storage.test.ts`
Expected: FAIL — `lib/wizard/report-storage.ts` doesn't exist yet.

- [ ] **Step 3: Create `lib/wizard/report-storage.ts`**

```ts
// Stores the raw bytes of an uploaded lab report, keyed by case id, in IndexedDB — separate
// from lib/projects.ts's cases-v1 localStorage blob, since localStorage's low quota (~5-10MB
// total, one JSON blob per key) would risk filling up fast with real PDF-sized files and would
// bloat every read/write of the whole case list. Falls back to an in-memory Map when IndexedDB
// isn't available (SSR, Node test environment), mirroring lib/projects.ts's hasStorage() pattern
// for localStorage, so this stays genuinely unit testable without a real browser.
const DB_NAME = "waste-portal-reports";
const DB_VERSION = 1;
const STORE_NAME = "reports";

const memory = new Map<string, File>();

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveReportFile(caseId: string, file: File): Promise<void> {
  if (!hasIndexedDb()) {
    memory.set(caseId, file);
    return;
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(file, caseId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getReportFile(caseId: string): Promise<File | null> {
  if (!hasIndexedDb()) {
    return memory.get(caseId) ?? null;
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(caseId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/wizard/report-storage.test.ts`
Expected: PASS — all 4 tests pass. (This exercises the in-memory fallback path, since Vitest's
default `node` test environment — confirm via `vitest.config.ts`'s `test.environment: "node"` —
has no `indexedDB` global; this is fine and intentional, this is exactly the fallback path this
module is designed to use in a test/SSR context.)

- [ ] **Step 5: Commit**

```bash
git add lib/wizard/report-storage.ts tests/wizard/report-storage.test.ts
git commit -m "feat: add IndexedDB-backed report file storage, keyed by case id"
```

---

### Task 2: Add `reportFileName` to the `Case` data model

**Files:**
- Modify: `lib/projects.ts`
- Test: `tests/projects.test.ts`

**Interfaces:**
- Consumes: none from Task 1.
- Produces: `Case.reportFileName: string | null`; `createCase`'s input gains `reportFileName: string | null` — Task 3 passes this when creating a case from the wizard.

- [ ] **Step 1: Write the failing tests**

In `tests/projects.test.ts`, find the existing `"createCase creates a case with exactly one waste entry, scoped to its project"` test:

```ts
  it("createCase creates a case with exactly one waste entry, scoped to its project", () => {
    const project = addProject({ name: "Test Project 2", location: "Testveien 2, Oslo" });
    const newCase = createCase({
      projectId: project.id,
      name: "Test Case",
      wasteEntry: { sampleLabel: "sample-a", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Clean concrete" },
    });
    expect(newCase.wasteEntries).toHaveLength(1);
    expect(newCase.wasteEntries[0].sampleLabel).toBe("sample-a");
    expect(newCase.wasteEntries[0].id.length).toBeGreaterThan(0);
    expect(listCasesForProject(project.id).some(c => c.id === newCase.id)).toBe(true);
    expect(getCase(newCase.id)?.projectId).toBe(project.id);
  });
```

Add `reportFileName: null` to its `createCase` call's input object, and add a new assertion for it:

```ts
  it("createCase creates a case with exactly one waste entry, scoped to its project", () => {
    const project = addProject({ name: "Test Project 2", location: "Testveien 2, Oslo" });
    const newCase = createCase({
      projectId: project.id,
      name: "Test Case",
      wasteEntry: { sampleLabel: "sample-a", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Clean concrete" },
      reportFileName: null,
    });
    expect(newCase.wasteEntries).toHaveLength(1);
    expect(newCase.wasteEntries[0].sampleLabel).toBe("sample-a");
    expect(newCase.wasteEntries[0].id.length).toBeGreaterThan(0);
    expect(newCase.reportFileName).toBeNull();
    expect(listCasesForProject(project.id).some(c => c.id === newCase.id)).toBe(true);
    expect(getCase(newCase.id)?.projectId).toBe(project.id);
  });
```

Similarly, find the `"addWasteEntryToCase appends a second entry without disturbing the first"` test and add `reportFileName: null` to its `createCase` call's input object (no new assertion needed there — this test's `createCase` call must still type-check now that the field is required).

Add a new test asserting the field round-trips a real filename, right after the test above:

```ts
  it("createCase persists a real reportFileName and every seed case has one (possibly null)", () => {
    const project = addProject({ name: "Test Project 4", location: "Testveien 4, Oslo" });
    const newCase = createCase({
      projectId: project.id,
      name: "Test Case 3",
      wasteEntry: { sampleLabel: "sample-a", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Clean concrete" },
      reportFileName: "AR-25-MM-118438-01.pdf",
    });
    expect(newCase.reportFileName).toBe("AR-25-MM-118438-01.pdf");
    expect(getCase(newCase.id)?.reportFileName).toBe("AR-25-MM-118438-01.pdf");
    for (const p of listProjects()) {
      for (const c of listCasesForProject(p.id)) {
        expect(c).toHaveProperty("reportFileName");
      }
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/projects.test.ts`
Expected: FAIL — TypeScript error, `reportFileName` is not a valid property on `createCase`'s input type, and the new test's `expect(c).toHaveProperty("reportFileName")` fails for seed cases (which don't have the field yet).

- [ ] **Step 3: Add the field to the `Case` interface**

In `lib/projects.ts`, change:

```ts
export interface Case {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  wasteEntries: WasteEntry[];
}
```

to:

```ts
export interface Case {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  reportFileName: string | null;
  wasteEntries: WasteEntry[];
}
```

- [ ] **Step 4: Add `reportFileName: null` to every seed case**

In `lib/projects.ts`'s `seedCases` function, add `reportFileName: null,` to each of the three seed case objects (`seed-case-1`, `seed-case-2`, `seed-case-3`) — right after their `createdAt` field, before `wasteEntries`. For example, the first one:

```ts
    {
      id: "seed-case-1",
      projectId: "seed-project-1",
      name: "Betongprøver — batch 1",
      createdAt: now - 3 * day,
      reportFileName: null,
      wasteEntries: [
```

Apply the same one-line addition to `seed-case-2` and `seed-case-3`.

- [ ] **Step 5: Update `createCase`'s signature and implementation**

Change:

```ts
export function createCase(input: { projectId: string; name: string; wasteEntry: Omit<WasteEntry, "id"> }): Case {
  const newCase: Case = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    name: input.name,
    createdAt: Date.now(),
    wasteEntries: [{ ...input.wasteEntry, id: crypto.randomUUID() }],
  };
  saveCases([...loadCases(), newCase]);
  return newCase;
}
```

to:

```ts
export function createCase(input: { projectId: string; name: string; wasteEntry: Omit<WasteEntry, "id">; reportFileName: string | null }): Case {
  const newCase: Case = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    name: input.name,
    createdAt: Date.now(),
    reportFileName: input.reportFileName,
    wasteEntries: [{ ...input.wasteEntry, id: crypto.randomUUID() }],
  };
  saveCases([...loadCases(), newCase]);
  return newCase;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/projects.test.ts`
Expected: PASS — all tests pass, including the two updated ones and the new one.

- [ ] **Step 7: Run the full suite and build**

Run: `npx vitest run`
Expected: FAIL at this point — `components/wizard/Wizard.tsx`'s existing `createCase({ projectId, name: caseName, wasteEntry: entry })` call is now missing the required `reportFileName` field, so it won't type-check. This is expected; Task 3 fixes it. Confirm via `npx tsc --noEmit` that this is the ONLY new compile error (comparing against the pre-Task-2 baseline) — if anything else is affected, that's a real problem to investigate, not something to leave for Task 3.

- [ ] **Step 8: Commit**

```bash
git add lib/projects.ts tests/projects.test.ts
git commit -m "feat: add reportFileName field to Case, threading it through createCase and seed data"
```

---

### Task 3: Wire the report file through the wizard and case detail page

**Files:**
- Modify: `components/wizard/UploadStep.tsx`
- Modify: `components/wizard/Wizard.tsx`
- Modify: `app/cases/[id]/page.tsx`

**Interfaces:**
- Consumes: `saveReportFile`, `getReportFile` from `lib/wizard/report-storage.ts` (Task 1); `Case.reportFileName`, `createCase`'s `reportFileName` field (Task 2).

- [ ] **Step 1: Fix `UploadStep.tsx` to forward the uploaded `File` on the single-sample path**

The current `onExtracted` prop type and call site:

```tsx
export function UploadStep({ onExtracted, onSamplesFound, onError }: {
  onExtracted: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }) => void;
  onSamplesFound: (samples: DetectedSample[], file: File) => void;
  onError: (message: string) => void;
}) {
```

and, inside `handleFile`:

```ts
      if (body.samples) {
        onSamplesFound(body.samples, file);
        return;
      }
      onExtracted(body.data);
```

Change the `onExtracted` prop type to accept the file too:

```tsx
export function UploadStep({ onExtracted, onSamplesFound, onError }: {
  onExtracted: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }, file: File) => void;
  onSamplesFound: (samples: DetectedSample[], file: File) => void;
  onError: (message: string) => void;
}) {
```

and change the call site:

```ts
      if (body.samples) {
        onSamplesFound(body.samples, file);
        return;
      }
      onExtracted(body.data, file);
```

- [ ] **Step 2: Update `Wizard.tsx`'s `handleExtracted` to receive and store the file**

`handleExtracted`'s current signature and new-document branch:

```ts
  function handleExtracted(
    data: {
      metadata: Record<string, unknown>;
      results: Record<string, unknown>[];
      testResults: Record<string, unknown>[];
      unmatchedAnalytes: string[];
      suggestedOriginProcess: string | null;
      sourceType: "text" | "document";
    },
    sampleIdentifier: string | null = null
  ) {
    setError(null);
    if (shouldStartNewCase(sampleIdentifier)) {
      // A genuinely fresh single-sample upload — reset everything tied to a previous
      // document/case so it cannot contaminate this new one. A direct single-document
      // upload has no multi-sample list, so detectedSamples/pendingFile are cleared here
      // (unlike handleSamplesFound, which sets them to the new document's real values).
      resetForNewDocument();
      setDetectedSamples(null);
      setPendingFile(null);
    } else {
```

Change the signature to accept an optional `file` parameter, and change the new-document branch to store it in `pendingFile` instead of nulling it:

```ts
  function handleExtracted(
    data: {
      metadata: Record<string, unknown>;
      results: Record<string, unknown>[];
      testResults: Record<string, unknown>[];
      unmatchedAnalytes: string[];
      suggestedOriginProcess: string | null;
      sourceType: "text" | "document";
    },
    sampleIdentifier: string | null = null,
    file: File | null = null
  ) {
    setError(null);
    if (shouldStartNewCase(sampleIdentifier)) {
      // A genuinely fresh single-sample upload — reset everything tied to a previous
      // document/case so it cannot contaminate this new one. A direct single-document
      // upload has no multi-sample list, so detectedSamples is cleared here (unlike
      // handleSamplesFound, which sets it to the new document's real values) — but
      // pendingFile is now set to the uploaded file itself (not cleared), so it's
      // available later if this extraction becomes a case (see handleAssignProject),
      // the same way the multi-sample path already retains its file.
      resetForNewDocument();
      setDetectedSamples(null);
      setPendingFile(file);
    } else {
```

Note: `pendingFile` being set for a single-sample document does not change the "Add another
sample" button's visibility — that also requires `remainingSamples.length > 0`, which stays `0`
here since `detectedSamples` is `null` on this path.

- [ ] **Step 3: Update `UploadStep`'s call site in the JSX to match the new signature**

Find where `UploadStep` is rendered in `Wizard.tsx`:

```tsx
        <Tabs.Panel id="upload">
          <UploadStep onExtracted={handleExtracted} onSamplesFound={handleSamplesFound} onError={setError} />
        </Tabs.Panel>
```

This already passes `handleExtracted` directly as `onExtracted` — since `UploadStep` now calls
`onExtracted(body.data, file)` (two arguments) and `handleExtracted`'s signature is `(data,
sampleIdentifier = null, file = null)`, this direct pass-through would incorrectly bind
`UploadStep`'s `file` argument to `handleExtracted`'s `sampleIdentifier` parameter (both are the
second positional argument). Fix this by wrapping it in an explicit arrow function instead of a
direct reference:

```tsx
        <Tabs.Panel id="upload">
          <UploadStep
            onExtracted={(data, file) => handleExtracted(data, null, file)}
            onSamplesFound={handleSamplesFound}
            onError={setError}
          />
        </Tabs.Panel>
```

This explicitly passes `null` for `sampleIdentifier` (a direct upload is never a same-document
sample pick) and forwards `file` into the correct third parameter.

- [ ] **Step 4: Save the report file when a case is created**

Import `saveReportFile` at the top of `Wizard.tsx`:

```ts
import { saveReportFile } from "@/lib/wizard/report-storage";
```

Find `handleAssignProject`:

```ts
  function handleAssignProject(choice: { projectId: string } | { newProject: { name: string; location: string } }) {
    if (!extraction) return;
    if (!canCommitEntry(entryCommitted)) return;
    const entry = buildWasteEntry();
    if (!entry) return;
    const projectId = "projectId" in choice ? choice.projectId : addProject(choice.newProject).id;
    const caseName = extraction.metadata.customerName ?? extraction.metadata.externalReportNo ?? "New case";
    const newCase = createCase({ projectId, name: caseName, wasteEntry: entry });
    setActiveCase(newCase);
    setEntryCommitted(true);
    setStep("facility-match");
  }
```

Change it to pass `reportFileName` and save the file (fire-and-forget — a save failure must not
block the classification flow the user is already completing):

```ts
  function handleAssignProject(choice: { projectId: string } | { newProject: { name: string; location: string } }) {
    if (!extraction) return;
    if (!canCommitEntry(entryCommitted)) return;
    const entry = buildWasteEntry();
    if (!entry) return;
    const projectId = "projectId" in choice ? choice.projectId : addProject(choice.newProject).id;
    const caseName = extraction.metadata.customerName ?? extraction.metadata.externalReportNo ?? "New case";
    const newCase = createCase({ projectId, name: caseName, wasteEntry: entry, reportFileName: pendingFile?.name ?? null });
    if (pendingFile) {
      // Fire-and-forget: this is a nice-to-have attachment, not the core classification
      // result the user is mid-way through — a save failure here should never block or
      // error out the flow. Log for diagnostics only.
      saveReportFile(newCase.id, pendingFile).catch(err => {
        console.error("Failed to save report file for case", newCase.id, err);
      });
    }
    setActiveCase(newCase);
    setEntryCommitted(true);
    setStep("facility-match");
  }
```

- [ ] **Step 5: Add a "View report" affordance to the case detail page**

In `app/cases/[id]/page.tsx`, add the import:

```ts
import { getReportFile } from "@/lib/wizard/report-storage";
```

Find the header block:

```tsx
      <div>
        <Link href={`/projects/${caseData.projectId}`} className="text-sm text-black/40 hover:text-forest">&larr; Back to project</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-forest">{caseData.name}</h1>
          <StatusChip status={status} />
        </div>
        <p className="text-xs text-black/40 mt-1">Sent {new Date(caseData.createdAt).toLocaleString()}</p>
      </div>
```

Add a new block right after it, only rendered when `reportFileName` is set:

```tsx
      <div>
        <Link href={`/projects/${caseData.projectId}`} className="text-sm text-black/40 hover:text-forest">&larr; Back to project</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-forest">{caseData.name}</h1>
          <StatusChip status={status} />
        </div>
        <p className="text-xs text-black/40 mt-1">Sent {new Date(caseData.createdAt).toLocaleString()}</p>
      </div>

      {caseData.reportFileName && <ReportLink caseId={caseData.id} fileName={caseData.reportFileName} />}
```

Add a new small component in the same file, above `CaseDetailPage`, after the `WasteEntryCard`
component's closing brace:

```tsx
function ReportLink({ caseId, fileName }: { caseId: string; fileName: string }) {
  const [notFound, setNotFound] = useState(false);

  async function handleView() {
    const file = await getReportFile(caseId);
    if (!file) {
      setNotFound(true);
      return;
    }
    const url = URL.createObjectURL(file);
    window.open(url, "_blank");
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-black/50">Original report: {fileName}</span>
      <Button variant="secondary" onPress={handleView}>View</Button>
      {notFound && <span className="text-xs text-danger">Report file not available.</span>}
    </div>
  );
}
```

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run`
Expected: PASS — every test file passes.

Run: `npm run build`
Expected: compiles successfully — zero TypeScript errors anywhere, confirming the
`handleExtracted`/`UploadStep` signature changes and the `createCase` call site are all
consistent.

- [ ] **Step 7: Commit**

```bash
git add components/wizard/UploadStep.tsx components/wizard/Wizard.tsx app/cases/\[id\]/page.tsx
git commit -m "feat: attach and let users view the original report document for a case"
```
