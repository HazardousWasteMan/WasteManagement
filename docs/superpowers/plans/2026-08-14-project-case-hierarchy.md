# Project/Case Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat, single-waste-per-Analysis model with a three-level Project → Case → WasteEntry hierarchy, add real (never-fabricated) location extraction, and let the wizard build up multiple waste entries in one case from a single multi-sample document.

**Architecture:** A new data layer (`lib/projects.ts`) replaces `lib/analyses.ts` entirely. The wizard gains one new step (project assignment) and a repeatable loop back to sample selection, tracked via a small amount of new state in `Wizard.tsx`. The homepage becomes a project list; a new project-detail page lists that project's cases; the existing analysis-detail page is replaced by a case-detail page that renders one block per waste entry instead of assuming exactly one.

**Tech Stack:** TypeScript, Next.js App Router, React, Vitest, localStorage (frontend-only, no backend).

## Global Constraints

- Location lives only on `Project` — never on `Case` or `WasteEntry`.
- Location extraction never fabricates: `null` when the document doesn't state one, exactly like every other extracted field in this codebase.
- Project assignment during the wizard is always an explicit user choice (existing-project dropdown + "new project" option) — no auto-matching against extracted data.
- Multi-sample handling stays user-driven: one sample picked at a time, never automatic bulk processing.
- This is a full replacement of `lib/analyses.ts` and the current homepage/analysis-detail pages — not an addition alongside them. No code should read the old flat `Analysis` shape once this ships.
- No change to `lib/hp-classification/facility-match.ts`'s eligibility logic — this plan adds the location field to the data model but does not yet wire it into facility-match.

---

### Task 1: Data layer — `lib/projects.ts`

**Files:**
- Create: `lib/projects.ts`
- Delete: `lib/analyses.ts`
- Test: create `tests/projects.test.ts`, delete `tests/analyses.test.ts`
- Modify: `components/dashboard/StatusChip.tsx`

**Interfaces:**
- Produces: `export type CaseStatus = "sent" | "in_progress" | "complete"`, `export interface Project { id: string; name: string; location: string; createdAt: number; }`, `export interface WasteEntry { id: string; sampleLabel: string; isHazardous: boolean; ealCode: string | null; avfallsstoffnr: string | null; summary: string; }`, `export interface Case { id: string; projectId: string; name: string; createdAt: number; wasteEntries: WasteEntry[]; }`, `export function computeStatus(createdAt: number, now?: number): CaseStatus`, `export function listProjects(): Project[]`, `export function getProject(id: string): Project | undefined`, `export function addProject(input: { name: string; location: string }): Project`, `export function listCasesForProject(projectId: string): Case[]`, `export function getCase(id: string): Case | undefined`, `export function createCase(input: { projectId: string; name: string; wasteEntry: Omit<WasteEntry, "id"> }): Case`, `export function addWasteEntryToCase(caseId: string, entry: Omit<WasteEntry, "id">): Case`, `export function __resetForTests(): void` — every later task in this plan depends on these exact names and shapes.

- [ ] **Step 1: Write the failing tests**

Create `tests/projects.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  computeStatus, listProjects, getProject, addProject,
  listCasesForProject, getCase, createCase, addWasteEntryToCase, __resetForTests,
} from "@/lib/projects";

describe("computeStatus", () => {
  const createdAt = 1_000_000;
  it("is 'sent' right after creation", () => {
    expect(computeStatus(createdAt, createdAt + 10_000)).toBe("sent");
  });
  it("is 'in_progress' after 30 seconds", () => {
    expect(computeStatus(createdAt, createdAt + 31_000)).toBe("in_progress");
  });
  it("is 'complete' after 2 minutes", () => {
    expect(computeStatus(createdAt, createdAt + 121_000)).toBe("complete");
  });
});

describe("projects/cases store", () => {
  beforeEach(() => __resetForTests());

  it("seeds at least 3 projects, each with at least one case", () => {
    const projects = listProjects();
    expect(projects.length).toBeGreaterThanOrEqual(3);
    for (const p of projects) {
      expect(listCasesForProject(p.id).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every seed project has a non-empty name and location", () => {
    for (const p of listProjects()) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.location.length).toBeGreaterThan(0);
    }
  });

  it("every seed case belongs to a real, existing project, and every waste entry has a non-empty id", () => {
    const projectIds = new Set(listProjects().map(p => p.id));
    for (const p of listProjects()) {
      for (const c of listCasesForProject(p.id)) {
        expect(projectIds.has(c.projectId)).toBe(true);
        for (const entry of c.wasteEntries) {
          expect(entry.id.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("at least one seed waste entry is hazardous with a real avfallsstoffnr", () => {
    const allEntries = listProjects().flatMap(p => listCasesForProject(p.id)).flatMap(c => c.wasteEntries);
    const hazardous = allEntries.filter(e => e.isHazardous);
    expect(hazardous.length).toBeGreaterThan(0);
    expect(hazardous.some(e => e.avfallsstoffnr !== null)).toBe(true);
  });

  it("addProject persists and is retrievable by id", () => {
    const added = addProject({ name: "Test Project", location: "Testveien 1, Oslo" });
    expect(getProject(added.id)?.name).toBe("Test Project");
    expect(getProject(added.id)?.location).toBe("Testveien 1, Oslo");
    expect(listProjects().some(p => p.id === added.id)).toBe(true);
  });

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

  it("addWasteEntryToCase appends a second entry without disturbing the first", () => {
    const project = addProject({ name: "Test Project 3", location: "Testveien 3, Oslo" });
    const newCase = createCase({
      projectId: project.id,
      name: "Test Case 2",
      wasteEntry: { sampleLabel: "sample-a", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Clean concrete" },
    });
    const updated = addWasteEntryToCase(newCase.id, {
      sampleLabel: "sample-b", isHazardous: true, ealCode: "17 05 03*", avfallsstoffnr: "7022", summary: "Contaminated soil",
    });
    expect(updated.wasteEntries).toHaveLength(2);
    expect(updated.wasteEntries[0].sampleLabel).toBe("sample-a");
    expect(updated.wasteEntries[1].sampleLabel).toBe("sample-b");
    expect(getCase(newCase.id)?.wasteEntries).toHaveLength(2);
  });

  it("addWasteEntryToCase throws for a non-existent case id", () => {
    expect(() =>
      addWasteEntryToCase("does-not-exist", { sampleLabel: "x", isHazardous: false, ealCode: null, avfallsstoffnr: null, summary: "x" })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/projects.test.ts`
Expected: FAIL — `lib/projects.ts` doesn't exist yet.

- [ ] **Step 3: Create `lib/projects.ts`**

```ts
export type CaseStatus = "sent" | "in_progress" | "complete";

export interface Project {
  id: string;
  name: string;
  location: string;
  createdAt: number;
}

export interface WasteEntry {
  id: string;
  sampleLabel: string;
  isHazardous: boolean;
  ealCode: string | null;
  avfallsstoffnr: string | null; // Norwegian waste code; drives depot matching on the map
  summary: string;
}

export interface Case {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  wasteEntries: WasteEntry[];
}

const PROJECTS_KEY = "projects-v1";
const CASES_KEY = "cases-v1";
const IN_PROGRESS_AFTER_MS = 30_000;
const COMPLETE_AFTER_MS = 120_000;

// ponytail: demo progress is just elapsed time since creation; swap for real backend status when one exists
export function computeStatus(createdAt: number, now: number = Date.now()): CaseStatus {
  const age = now - createdAt;
  if (age >= COMPLETE_AFTER_MS) return "complete";
  if (age >= IN_PROGRESS_AFTER_MS) return "in_progress";
  return "sent";
}

function seedProjects(now: number): Project[] {
  const day = 86_400_000;
  return [
    { id: "seed-project-1", name: "Alta Lufthavn — PFAS-prosjektet", location: "Alta lufthavn, Alta", createdAt: now - 3 * day },
    { id: "seed-project-2", name: "Riveprosjekt Økern", location: "Økern, Oslo", createdAt: now - day },
    { id: "seed-project-3", name: "Tankgrav Sandnes", location: "Sandnes", createdAt: now - 60_000 },
  ];
}

function seedCases(now: number): Case[] {
  const day = 86_400_000;
  return [
    {
      id: "seed-case-1",
      projectId: "seed-project-1",
      name: "Betongprøver — batch 1",
      createdAt: now - 3 * day,
      wasteEntries: [
        { id: "seed-entry-1", sampleLabel: "ENAT-BØF1-BO9OB1", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Non-hazardous concrete." },
        { id: "seed-entry-2", sampleLabel: "Kreosotimpregnert trevirke", isHazardous: true, ealCode: "17 02 04*", avfallsstoffnr: "7098", summary: "Hazardous: kreosotimpregnert trevirke (avfallsstoffnr 7098)." },
      ],
    },
    {
      id: "seed-case-2",
      projectId: "seed-project-2",
      name: "Rivemasser",
      createdAt: now - day,
      wasteEntries: [
        { id: "seed-entry-3", sampleLabel: "Betongrester", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Non-hazardous concrete. Eligible for ordinary municipal facilities." },
      ],
    },
    {
      id: "seed-case-3",
      projectId: "seed-project-3",
      name: "Grunnundersøkelse",
      createdAt: now - 60_000,
      wasteEntries: [
        { id: "seed-entry-4", sampleLabel: "Oljeforurenset masse", isHazardous: true, ealCode: "17 05 03*", avfallsstoffnr: "7022", summary: "Hazardous: oljeforurenset masse (avfallsstoffnr 7022). Requires treatment at a licensed receiver." },
        { id: "seed-entry-5", sampleLabel: "Spillolje — verkstedtank", isHazardous: true, ealCode: "13 02 05*", avfallsstoffnr: "7011", summary: "Hazardous: refusjonsberettiget spillolje (avfallsstoffnr 7011). Licensed receivers highlighted on the map." },
      ],
    },
  ];
}

// localStorage in the browser, plain map in tests/SSR (Node has a non-functional localStorage stub)
let memoryProjects: Project[] | null = null;
let memoryCases: Case[] | null = null;

function hasStorage(): boolean {
  return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function";
}

function loadProjects(): Project[] {
  if (!hasStorage()) {
    if (!memoryProjects) memoryProjects = seedProjects(Date.now());
    return memoryProjects;
  }
  const raw = localStorage.getItem(PROJECTS_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as Project[];
    } catch {
      // fall through to reseed
    }
  }
  const fresh = seedProjects(Date.now());
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveProjects(all: Project[]) {
  if (!hasStorage()) {
    memoryProjects = all;
    return;
  }
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(all));
}

function loadCases(): Case[] {
  if (!hasStorage()) {
    if (!memoryCases) memoryCases = seedCases(Date.now());
    return memoryCases;
  }
  const raw = localStorage.getItem(CASES_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as Case[];
    } catch {
      // fall through to reseed
    }
  }
  const fresh = seedCases(Date.now());
  localStorage.setItem(CASES_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveCases(all: Case[]) {
  if (!hasStorage()) {
    memoryCases = all;
    return;
  }
  localStorage.setItem(CASES_KEY, JSON.stringify(all));
}

export function listProjects(): Project[] {
  return [...loadProjects()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getProject(id: string): Project | undefined {
  return loadProjects().find(p => p.id === id);
}

export function addProject(input: { name: string; location: string }): Project {
  const project: Project = {
    id: crypto.randomUUID(),
    name: input.name,
    location: input.location,
    createdAt: Date.now(),
  };
  saveProjects([...loadProjects(), project]);
  return project;
}

export function listCasesForProject(projectId: string): Case[] {
  return loadCases()
    .filter(c => c.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getCase(id: string): Case | undefined {
  return loadCases().find(c => c.id === id);
}

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

export function addWasteEntryToCase(caseId: string, entry: Omit<WasteEntry, "id">): Case {
  const all = loadCases();
  const idx = all.findIndex(c => c.id === caseId);
  if (idx === -1) throw new Error(`Case ${caseId} not found`);
  const updated: Case = { ...all[idx], wasteEntries: [...all[idx].wasteEntries, { ...entry, id: crypto.randomUUID() }] };
  const next = [...all];
  next[idx] = updated;
  saveCases(next);
  return updated;
}

export function __resetForTests() {
  memoryProjects = null;
  memoryCases = null;
  if (hasStorage()) {
    localStorage.removeItem(PROJECTS_KEY);
    localStorage.removeItem(CASES_KEY);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/projects.test.ts`
Expected: PASS — all tests pass.

- [ ] **Step 5: Update `StatusChip.tsx` to the new type**

Current file:

```tsx
"use client";
import { Chip } from "@heroui/react";
import type { AnalysisStatus } from "@/lib/analyses";

const LABEL: Record<AnalysisStatus, string> = {
  sent: "Sent",
  in_progress: "In progress",
  complete: "Complete",
};

export function StatusChip({ status }: { status: AnalysisStatus }) {
  return (
    <Chip color={status === "complete" ? "success" : status === "in_progress" ? "warning" : "default"} variant="soft">
      {LABEL[status]}
    </Chip>
  );
}
```

Replace with:

```tsx
"use client";
import { Chip } from "@heroui/react";
import type { CaseStatus } from "@/lib/projects";

const LABEL: Record<CaseStatus, string> = {
  sent: "Sent",
  in_progress: "In progress",
  complete: "Complete",
};

export function StatusChip({ status }: { status: CaseStatus }) {
  return (
    <Chip color={status === "complete" ? "success" : status === "in_progress" ? "warning" : "default"} variant="soft">
      {LABEL[status]}
    </Chip>
  );
}
```

- [ ] **Step 6: Delete the old data layer and its test**

```bash
rm lib/analyses.ts tests/analyses.test.ts
```

Do NOT delete or modify `lib/shipments.ts` — its `Shipment.analysisName` field is just a display
label string with no import dependency on `lib/analyses.ts`; it is untouched by this task and
later tasks will simply pass a case/entry-derived string into it.

- [ ] **Step 7: Run the full suite and build**

Run: `npx vitest run`
Expected: FAILS at this point — `app/page.tsx`, `app/analyses/[id]/page.tsx`, and
`components/wizard/Wizard.tsx` still import the now-deleted `lib/analyses.ts`. This is expected;
Tasks 3-5 fix these. Confirm the failure is specifically these three files' imports (via the error
output), not something unrelated to this task's change — if it's anything else, treat that as a
real problem to fix here, not something to leave to a later task.

- [ ] **Step 8: Commit**

```bash
git add lib/projects.ts tests/projects.test.ts components/dashboard/StatusChip.tsx
git rm lib/analyses.ts tests/analyses.test.ts
git commit -m "feat: add Project/Case/WasteEntry data layer, replacing the flat Analysis model"
```

---

### Task 2: Real, never-fabricated location extraction

**Files:**
- Modify: `lib/hp-classification/extract.ts`
- Modify: `components/wizard/Wizard.tsx`
- Test: `tests/hp-classification/extract.test.ts`

**Interfaces:**
- Consumes: none from Task 1.
- Produces: the extraction schema's `metadata.location: string | null` field, and
  `ExtractedMetadata.location: string | null` in `Wizard.tsx` — Task 3 reads
  `extraction.metadata.location` when pre-filling the new-project form.

- [ ] **Step 1: Write the failing test**

In `tests/hp-classification/extract.test.ts`, inside the existing `describe("buildMessageContent", ...)`
block, add:

```ts
  it("includes real, never-fabricated location extraction instructions in the schema", () => {
    const content = buildMessageContent("some real report text with enough real words to count as usable, definitely", Buffer.from(""), analyteRef, null);
    const text = (content[0] as { type: "text"; text: string }).text;
    expect(text).toContain('"location": string | null');
    expect(text.toLowerCase()).toContain("never guess or infer a location");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL — the schema string doesn't mention `"location"` yet.

- [ ] **Step 3: Add the field to the extraction schema**

In `lib/hp-classification/extract.ts`'s `buildSchemaInstructions` function, find this block:

```ts
    "receiptDate": string | null,
    "producerName": string | null,
    "physicalState": "solid" | "liquid" | "powder" | null,
```

Change it to:

```ts
    "receiptDate": string | null,
    "producerName": string | null,
    "location": string | null,
    "physicalState": "solid" | "liquid" | "powder" | null,
```

Then find this sentence, right after the closing `}` of the JSON schema block:

```ts
}${scopingInstruction}

Do NOT populate an "originProcess" field — it is intentionally absent from this schema. It is never present in a lab report and must be supplied by the user, not guessed by you.
```

Change it to (adding one new paragraph, in between the existing two):

```ts
}${scopingInstruction}

For "location", extract the site/property address, name, or municipality where the waste was generated or where the sampling took place, if the document clearly states one (e.g. a project name, site address, or municipality mentioned in the report header or sampling details) — set it to null if the document does not clearly state a location; never guess or infer a location from unrelated context.

Do NOT populate an "originProcess" field — it is intentionally absent from this schema. It is never present in a lab report and must be supplied by the user, not guessed by you.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: PASS — all tests in the file pass, including the new one.

- [ ] **Step 5: Add the field to `Wizard.tsx`'s metadata type**

In `components/wizard/Wizard.tsx`, find:

```ts
interface ExtractedMetadata {
  externalReportNo: string | null;
  labName: string | null;
  customerName: string | null;
  sampleMarking: string | null;
  matrixType: string | null;
  physicalState: "solid" | "liquid" | "powder" | null;
  ph: number | null;
  labClassificationGiven: boolean;
  labStatedEalCode: string | null;
}
```

Add `location: string | null;` to it:

```ts
interface ExtractedMetadata {
  externalReportNo: string | null;
  labName: string | null;
  customerName: string | null;
  sampleMarking: string | null;
  matrixType: string | null;
  location: string | null;
  physicalState: "solid" | "liquid" | "powder" | null;
  ph: number | null;
  labClassificationGiven: boolean;
  labStatedEalCode: string | null;
}
```

This change alone does not affect `ExtractionReviewStep.tsx` (which has its own, separately-defined
`ExtractedMetadata` interface local to that file, unrelated to this one) — no edit needed there in
this task.

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run`
Expected: same pre-existing failures as Task 1 left (three files still importing the deleted
`lib/analyses.ts`) plus all other tests passing — confirms this task introduced no new failures.

Run: `npm run build`
Expected: FAILS at this point, same reason (still-missing `lib/analyses.ts` imports) — expected
until Tasks 3-5 land; confirm the failure is exactly those import errors and nothing else.

- [ ] **Step 7: Commit**

```bash
git add lib/hp-classification/extract.ts components/wizard/Wizard.tsx tests/hp-classification/extract.test.ts
git commit -m "feat: extract real, never-fabricated waste location from the source document"
```

---

### Task 3: Wizard flow — project assignment + repeatable multi-sample loop

**Files:**
- Create: `components/wizard/ProjectAssignmentStep.tsx`
- Modify: `components/wizard/SampleSelectionStep.tsx`
- Modify: `components/wizard/Wizard.tsx`

**Interfaces:**
- Consumes: `Project`, `Case`, `listProjects`, `addProject`, `createCase`, `addWasteEntryToCase` from `lib/projects.ts` (Task 1); `ExtractedMetadata.location` (Task 2).
- Produces: `ProjectAssignmentStep`'s `onConfirm: (choice: { projectId: string } | { newProject: { name: string; location: string } }) => void` prop — used only within this task's `Wizard.tsx` changes, no later task depends on it.

- [ ] **Step 1: Extend `SampleSelectionStep.tsx` to report which sample was picked**

The current file is:

```tsx
"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";
import { RotatingLoadingMessage } from "./RotatingLoadingMessage";
import { disambiguateSamples, type DetectedSample } from "@/lib/wizard/disambiguate-samples";

export function SampleSelectionStep({ samples, file, onSelected, onError }: {
  samples: DetectedSample[];
  file: File;
  onSelected: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }) => void;
  onError: (message: string) => void;
}) {
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const displaySamples = disambiguateSamples(samples);

  async function handlePick(sampleIdentifier: string, index: number) {
    setLoadingIndex(index);
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
      setLoadingIndex(null);
    }
  }

  return (
    <Card>
      <Card.Content className="flex flex-col gap-4 py-6">
        <p className="text-sm font-medium text-forest">This document contains multiple samples</p>
        <p className="text-xs text-black/60">Choose which one to classify:</p>
        <div className="flex flex-col gap-2">
          {displaySamples.map((sample, i) => (
            <Button
              key={i}
              variant="secondary"
              onPress={() => handlePick(sample.sampleIdentifier, i)}
              isDisabled={loadingIndex !== null}
              className="justify-start"
            >
              {loadingIndex === i ? "Extracting…" : sample.displayLabel}
            </Button>
          ))}
        </div>
        {loadingIndex !== null && <RotatingLoadingMessage />}
      </Card.Content>
    </Card>
  );
}
```

`Wizard.tsx` needs to know WHICH sample identifier was just classified, so it can track which
detected samples remain unclassified (to decide whether "Add another sample" should still be
offered). Change `onSelected`'s signature to also pass the real `sampleIdentifier`, and pass it
through in `handlePick`. Replace the `onSelected` prop type and its call site:

```tsx
  onSelected: (data: {
    metadata: Record<string, unknown>;
    results: Record<string, unknown>[];
    testResults: Record<string, unknown>[];
    unmatchedAnalytes: string[];
    suggestedOriginProcess: string | null;
    sourceType: "text" | "document";
  }, sampleIdentifier: string) => void;
```

and:

```tsx
      onSelected(body.data, sampleIdentifier);
```

(replacing the current `onSelected(body.data);` call inside `handlePick`). No other line in this
file changes.

- [ ] **Step 2: Create `ProjectAssignmentStep.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";
import { listProjects, type Project } from "@/lib/projects";

export function ProjectAssignmentStep({ suggestedName, suggestedLocation, onConfirm }: {
  suggestedName: string;
  suggestedLocation: string | null;
  onConfirm: (choice: { projectId: string } | { newProject: { name: string; location: string } }) => void;
}) {
  const [projects] = useState<Project[]>(() => listProjects());
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [isNewProject, setIsNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState(suggestedName);
  const [newProjectLocation, setNewProjectLocation] = useState(suggestedLocation ?? "");

  function handleConfirm() {
    if (isNewProject) {
      onConfirm({ newProject: { name: newProjectName.trim(), location: newProjectLocation.trim() } });
    } else {
      onConfirm({ projectId: selectedProjectId });
    }
  }

  const canConfirm = isNewProject
    ? newProjectName.trim() !== "" && newProjectLocation.trim() !== ""
    : selectedProjectId !== "";

  return (
    <Card>
      <Card.Content className="flex flex-col gap-3 py-6">
        <p className="text-sm font-medium text-forest">Which project does this belong to?</p>
        <select
          id="project-select"
          value={isNewProject ? "__new__" : selectedProjectId}
          onChange={e => {
            if (e.target.value === "__new__") {
              setIsNewProject(true);
              setSelectedProjectId("");
            } else {
              setIsNewProject(false);
              setSelectedProjectId(e.target.value);
            }
          }}
          className="border border-black/10 rounded-lg px-2 py-1 text-sm"
        >
          <option value="">— select a project —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name} — {p.location}</option>
          ))}
          <option value="__new__">+ New project</option>
        </select>

        {isNewProject && (
          <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-black/10">
            <label htmlFor="new-project-name" className="text-xs font-medium text-forest">Project name</label>
            <input
              id="new-project-name"
              type="text"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            />
            <label htmlFor="new-project-location" className="text-xs font-medium text-forest">Location</label>
            <p className="text-xs text-black/60">
              {suggestedLocation
                ? "Pre-filled from the document — review and correct if needed."
                : "Not found in the document — enter it manually."}
            </p>
            <input
              id="new-project-location"
              type="text"
              value={newProjectLocation}
              onChange={e => setNewProjectLocation(e.target.value)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            />
          </div>
        )}
      </Card.Content>
      <Card.Content className="py-4">
        <Button variant="primary" onPress={handleConfirm} isDisabled={!canConfirm}>
          Continue to facility match
        </Button>
      </Card.Content>
    </Card>
  );
}
```

- [ ] **Step 3: Rewrite `Wizard.tsx`**

Replace the entire file content with:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, Button } from "@heroui/react";
import { addProject, createCase, addWasteEntryToCase, type Case } from "@/lib/projects";
import { UploadStep } from "./UploadStep";
import { SampleSelectionStep } from "./SampleSelectionStep";
import { ExtractionReviewStep } from "./ExtractionReviewStep";
import { ClassificationResultsStep } from "./ClassificationResultsStep";
import { ProjectAssignmentStep } from "./ProjectAssignmentStep";
import { FacilityMatchStep } from "./FacilityMatchStep";
import { ProgressCard } from "@/components/dashboard/DashboardCards";

type Step = "upload" | "select-sample" | "review" | "results" | "assign-project" | "facility-match";

const STAGE_NAMES = ["Submitted", "Reviewed", "Classified", "Project", "Facility match"];

interface ExtractedMetadata {
  externalReportNo: string | null;
  labName: string | null;
  customerName: string | null;
  sampleMarking: string | null;
  matrixType: string | null;
  location: string | null;
  physicalState: "solid" | "liquid" | "powder" | null;
  ph: number | null;
  labClassificationGiven: boolean;
  labStatedEalCode: string | null;
}

interface ExtractedResultRow {
  rawAnalyteName: string;
  analyteId: string | null;
  resultValue: number | null;
  unitRaw: string;
}

interface ExtractionData {
  metadata: ExtractedMetadata;
  results: ExtractedResultRow[];
  testResults: Record<string, unknown>[];
  unmatchedAnalytes: string[];
  suggestedOriginProcess: string | null;
  sourceType: "text" | "document";
}

export function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [extraction, setExtraction] = useState<ExtractionData | null>(null);
  const [classificationResult, setClassificationResult] = useState<{ hazard: unknown; eal: unknown; noDataWarning: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [detectedSamples, setDetectedSamples] = useState<{ sampleIdentifier: string; matrixType: string | null }[] | null>(null);
  const [consumedSampleIdentifiers, setConsumedSampleIdentifiers] = useState<Set<string>>(new Set());
  const [activeCase, setActiveCase] = useState<Case | null>(null);

  const remainingSamples = (detectedSamples ?? []).filter(s => !consumedSampleIdentifiers.has(s.sampleIdentifier));

  function handleSamplesFound(samples: { sampleIdentifier: string; matrixType: string | null }[], file: File) {
    setError(null);
    setDetectedSamples(samples);
    setPendingFile(file);
    setStep("select-sample");
  }

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
    setExtraction(data as unknown as ExtractionData);
    if (sampleIdentifier) setConsumedSampleIdentifiers(prev => new Set(prev).add(sampleIdentifier));
    setStep("review");
  }

  async function handleConfirmOrigin(originProcess: string, editedMetadata: Partial<ExtractedMetadata>, customChapter: string | null) {
    if (!extraction) return;
    setError(null);
    setClassifying(true);
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: { ...extraction.metadata, ...editedMetadata, originProcess },
          results: extraction.results,
          testResults: extraction.testResults,
          customChapter,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Classification failed");
        return;
      }
      setClassificationResult({ hazard: body.hazard, eal: body.eal, noDataWarning: Boolean(body.noDataWarning) });
      setStep("results");
    } catch {
      setError("Could not reach the classification service.");
    } finally {
      setClassifying(false);
    }
  }

  function buildWasteEntry() {
    if (!extraction || !classificationResult) return null;
    const hazard = classificationResult.hazard as { isHazardous: boolean };
    const eal = classificationResult.eal as { code: string | null };
    return {
      sampleLabel: extraction.metadata.sampleMarking ?? extraction.metadata.customerName ?? "Waste sample",
      isHazardous: hazard.isHazardous,
      ealCode: eal.code,
      // ponytail: classification outputs EAL only; map EAL -> avfallsstoffnr when that table exists
      avfallsstoffnr: null,
      summary: hazard.isHazardous
        ? "Classified as hazardous waste. See facility match for eligible treatment partners."
        : "Classified as non-hazardous waste. See facility match for eligible facilities.",
    };
  }

  function handleContinueFromResults() {
    if (activeCase) {
      // Already have an in-progress case for this document — append this entry directly, no
      // need to re-ask which project it belongs to.
      const entry = buildWasteEntry();
      if (!entry) return;
      const updated = addWasteEntryToCase(activeCase.id, entry);
      setActiveCase(updated);
      setStep("facility-match");
    } else {
      setStep("assign-project");
    }
  }

  function handleAssignProject(choice: { projectId: string } | { newProject: { name: string; location: string } }) {
    if (!extraction) return;
    const entry = buildWasteEntry();
    if (!entry) return;
    const projectId = "projectId" in choice ? choice.projectId : addProject(choice.newProject).id;
    const caseName = extraction.metadata.customerName ?? extraction.metadata.externalReportNo ?? "New case";
    const newCase = createCase({ projectId, name: caseName, wasteEntry: entry });
    setActiveCase(newCase);
    setStep("facility-match");
  }

  function handleFinishCase() {
    if (!activeCase) return;
    router.push(`/cases/${activeCase.id}`);
  }

  const stageIndex = step === "upload" || step === "select-sample" ? 0 : step === "review" ? 1 : step === "results" ? 2 : step === "assign-project" ? 3 : 4;

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 flex flex-col gap-6">
      <ProgressCard
        stageLabel={STAGE_NAMES[stageIndex]}
        stageIndex={stageIndex}
        totalStages={5}
        stageNames={STAGE_NAMES}
      />
      <Tabs selectedKey={step} onSelectionChange={key => setStep(key as Step)} aria-label="Wizard steps">
        <Tabs.List>
          <Tabs.Tab id="upload">1. Submit</Tabs.Tab>
          <Tabs.Tab id="review" isDisabled={!extraction}>2. Review extraction</Tabs.Tab>
          <Tabs.Tab id="results" isDisabled={!classificationResult}>3. Classification</Tabs.Tab>
          <Tabs.Tab id="assign-project" isDisabled={!classificationResult || Boolean(activeCase)}>4. Project</Tabs.Tab>
          <Tabs.Tab id="facility-match" isDisabled={!activeCase}>5. Facility match</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="upload">
          <UploadStep onExtracted={handleExtracted} onSamplesFound={handleSamplesFound} onError={setError} />
        </Tabs.Panel>
        <Tabs.Panel id="select-sample">
          {detectedSamples && pendingFile && (
            <SampleSelectionStep samples={remainingSamples} file={pendingFile} onSelected={handleExtracted} onError={setError} />
          )}
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
              noDataWarning={classificationResult.noDataWarning}
              onContinue={handleContinueFromResults}
            />
          )}
        </Tabs.Panel>
        <Tabs.Panel id="assign-project">
          {extraction && !activeCase && (
            <ProjectAssignmentStep
              suggestedName={extraction.metadata.customerName ?? "New project"}
              suggestedLocation={extraction.metadata.location}
              onConfirm={handleAssignProject}
            />
          )}
        </Tabs.Panel>
        <Tabs.Panel id="facility-match">
          {classificationResult && extraction && activeCase && (
            <>
              <FacilityMatchStep
                isHazardous={(classificationResult.hazard as { isHazardous: boolean }).isHazardous}
                ealCode={(classificationResult.eal as { code: string | null }).code}
                matrixType={extraction.metadata.matrixType}
              />
              <div className="mt-6 flex justify-end gap-2">
                {remainingSamples.length > 0 && pendingFile && (
                  <Button variant="secondary" onPress={() => setStep("select-sample")}>
                    Add another sample from this document
                  </Button>
                )}
                <Button variant="primary" onPress={handleFinishCase}>
                  Finish case
                </Button>
              </div>
            </>
          )}
        </Tabs.Panel>
      </Tabs>
      {error && <p className="text-danger mt-4">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run the full suite and build**

Run: `npx vitest run`
Expected: same pre-existing failures as before (only `app/page.tsx` and
`app/analyses/[id]/page.tsx` still import the deleted `lib/analyses.ts`) — confirms this task's
`Wizard.tsx`/`SampleSelectionStep.tsx`/`ProjectAssignmentStep.tsx` changes introduced no new
failures beyond what's expected until Tasks 4-5 land.

Run: `npm run build`
Expected: FAILS at this point, same reason — confirm the failure is exactly the two remaining
`lib/analyses.ts` imports and nothing else (e.g. no TypeScript error inside `Wizard.tsx` or
`ProjectAssignmentStep.tsx` itself).

- [ ] **Step 5: Commit**

```bash
git add components/wizard/SampleSelectionStep.tsx components/wizard/ProjectAssignmentStep.tsx components/wizard/Wizard.tsx
git commit -m "feat: add project assignment step and repeatable multi-sample case building to the wizard"
```

---

### Task 4: Project overview + project detail pages

**Files:**
- Modify: `app/page.tsx`
- Create: `app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `listProjects`, `getProject`, `listCasesForProject`, `computeStatus`, `type Project`, `type Case` from `lib/projects.ts` (Task 1).
- Produces: nothing new for later tasks (Task 5 is independent of this task's page content, only shares the same data layer).

- [ ] **Step 1: Replace `app/page.tsx` with the project overview**

The current file (`app/page.tsx`, the "My analyses" homepage) reads:

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatCard } from "@/components/dashboard/DashboardCards";
import { StatusChip } from "@/components/dashboard/StatusChip";
import { listAnalyses, computeStatus, type Analysis } from "@/lib/analyses";

export default function MyAnalysesPage() {
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setAnalyses(listAnalyses());
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, []);

  if (!now) return null; // avoid SSR/client mismatch: localStorage only exists client-side

  const withStatus = analyses.map(a => ({ ...a, status: computeStatus(a.createdAt, now) }));
  const completeCount = withStatus.filter(a => a.status === "complete").length;
  const pendingCount = withStatus.length - completeCount;
  const hazardousCount = withStatus.filter(a => a.status === "complete" && a.result?.isHazardous).length;

  return (
    <div className="max-w-4xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-forest">My analyses</h1>
        <Link
          href="/order"
          className="rounded-xl bg-forest text-lime px-4 py-2 text-sm font-medium hover:bg-forest-light transition-colors"
        >
          Order analysis
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Completed" value={String(completeCount)} />
        <StatCard label="In progress" value={String(pendingCount)} />
        <StatCard label="Hazardous" value={String(hazardousCount)} sublabel="of completed" />
      </div>

      <div className="flex flex-col gap-2">
        {withStatus.map(a => (
          <Link
            key={a.id}
            href={`/analyses/${a.id}`}
            className="rounded-2xl bg-white/80 border border-black/5 px-5 py-4 flex items-center justify-between gap-4 hover:border-forest/30 transition-colors"
          >
            <div className="min-w-0">
              <p className="font-medium text-forest truncate">{a.name}</p>
              <p className="text-xs text-black/40 mt-0.5">
                Sent {new Date(a.createdAt).toLocaleString()}
                {a.status === "complete" && a.result?.ealCode && ` · EAL ${a.result.ealCode}`}
              </p>
            </div>
            <StatusChip status={a.status} />
          </Link>
        ))}
        {withStatus.length === 0 && <p className="text-black/40 text-sm py-8 text-center">No analyses yet.</p>}
      </div>
    </div>
  );
}
```

Replace it in full with:

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatCard } from "@/components/dashboard/DashboardCards";
import { listProjects, listCasesForProject, type Project } from "@/lib/projects";

interface ProjectRow {
  project: Project;
  caseCount: number;
  hazardousEntryCount: number;
}

export default function ProjectsPage() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const projects = listProjects();
    setRows(
      projects.map(project => {
        const cases = listCasesForProject(project.id);
        const entries = cases.flatMap(c => c.wasteEntries);
        return { project, caseCount: cases.length, hazardousEntryCount: entries.filter(e => e.isHazardous).length };
      })
    );
    setNow(Date.now());
  }, []);

  if (!now) return null; // avoid SSR/client mismatch: localStorage only exists client-side

  const totalCases = rows.reduce((sum, r) => sum + r.caseCount, 0);
  const totalHazardous = rows.reduce((sum, r) => sum + r.hazardousEntryCount, 0);

  return (
    <div className="max-w-4xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-forest">My projects</h1>
        <Link
          href="/order"
          className="rounded-xl bg-forest text-lime px-4 py-2 text-sm font-medium hover:bg-forest-light transition-colors"
        >
          Order analysis
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Projects" value={String(rows.length)} />
        <StatCard label="Cases" value={String(totalCases)} />
        <StatCard label="Hazardous entries" value={String(totalHazardous)} />
      </div>

      <div className="flex flex-col gap-2">
        {rows.map(({ project, caseCount, hazardousEntryCount }) => (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className="rounded-2xl bg-white/80 border border-black/5 px-5 py-4 flex items-center justify-between gap-4 hover:border-forest/30 transition-colors"
          >
            <div className="min-w-0">
              <p className="font-medium text-forest truncate">{project.name}</p>
              <p className="text-xs text-black/40 mt-0.5">
                {project.location} · {caseCount} case{caseCount === 1 ? "" : "s"}
                {hazardousEntryCount > 0 && ` · ${hazardousEntryCount} hazardous`}
              </p>
            </div>
          </Link>
        ))}
        {rows.length === 0 && <p className="text-black/40 text-sm py-8 text-center">No projects yet.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/projects/[id]/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject, listCasesForProject, computeStatus, type Project, type Case } from "@/lib/projects";
import { StatusChip } from "@/components/dashboard/StatusChip";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [cases, setCases] = useState<Case[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setProject(getProject(id) ?? null);
    setCases(listCasesForProject(id));
    setNow(Date.now());
  }, [id]);

  if (project === undefined || !now) return null;
  if (project === null) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6">
        <p className="text-black/50">Project not found.</p>
        <Link href="/" className="text-forest underline text-sm">Back to my projects</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-black/40 hover:text-forest">&larr; My projects</Link>
        <h1 className="text-2xl font-semibold text-forest mt-2">{project.name}</h1>
        <p className="text-sm text-black/50 mt-1">{project.location}</p>
      </div>

      <div className="flex flex-col gap-2">
        {cases.map(c => {
          const status = computeStatus(c.createdAt, now);
          const hazardousCount = c.wasteEntries.filter(e => e.isHazardous).length;
          return (
            <Link
              key={c.id}
              href={`/cases/${c.id}`}
              className="rounded-2xl bg-white/80 border border-black/5 px-5 py-4 flex items-center justify-between gap-4 hover:border-forest/30 transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium text-forest truncate">{c.name}</p>
                <p className="text-xs text-black/40 mt-0.5">
                  Sent {new Date(c.createdAt).toLocaleString()} · {c.wasteEntries.length} waste entr{c.wasteEntries.length === 1 ? "y" : "ies"}
                  {hazardousCount > 0 && ` · ${hazardousCount} hazardous`}
                </p>
              </div>
              <StatusChip status={status} />
            </Link>
          );
        })}
        {cases.length === 0 && <p className="text-black/40 text-sm py-8 text-center">No cases yet for this project.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run the full suite and build**

Run: `npx vitest run`
Expected: same pre-existing failure as before (only `app/analyses/[id]/page.tsx` still imports
the deleted `lib/analyses.ts`) — confirms this task's two page files introduced no new failures.

Run: `npm run build`
Expected: FAILS at this point, same reason — confirm the failure is exactly
`app/analyses/[id]/page.tsx`'s import and nothing else.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/projects/
git commit -m "feat: replace flat analyses homepage with a project overview and project detail page"
```

---

### Task 5: Case detail page

**Files:**
- Create: `app/cases/[id]/page.tsx`
- Delete: `app/analyses/[id]/page.tsx`

**Interfaces:**
- Consumes: `getCase`, `computeStatus`, `type Case`, `type WasteEntry` from `lib/projects.ts` (Task 1); `addShipment` from `lib/shipments.ts` (unchanged).

- [ ] **Step 1: Create `app/cases/[id]/page.tsx`**

The old `app/analyses/[id]/page.tsx` assumed exactly one result per analysis. This replacement
renders one self-contained block per `WasteEntry`, each with its own local transport-booking
state (a case can have several entries, each potentially needing a different depot/mode choice).

```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Chip, Button } from "@heroui/react";
import { StatusChip } from "@/components/dashboard/StatusChip";
import { getCase, computeStatus, type Case, type WasteEntry } from "@/lib/projects";
import type { Depot } from "@/lib/depots";
import { ORIGIN, MODES, ASSUMED_LOAD_TONNES, haversineKm, co2Kg, addShipment, type TransportMode } from "@/lib/shipments";
import { useRouter } from "next/navigation";

const DepotMap = dynamic(() => import("@/components/dashboard/DepotMap"), { ssr: false });

function WasteEntryCard({ caseName, entry }: { caseName: string; entry: WasteEntry }) {
  const router = useRouter();
  const [transportDepot, setTransportDepot] = useState<Depot | null>(null);
  const [mode, setMode] = useState<TransportMode>("truck");

  return (
    <div className="rounded-2xl bg-white/80 border border-black/5 px-6 py-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="font-medium text-forest">{entry.sampleLabel}</p>
        <Chip color={entry.isHazardous ? "danger" : "success"} variant="soft">
          {entry.isHazardous ? "Hazardous" : "Non-hazardous"}
        </Chip>
        {entry.ealCode && <span className="text-sm font-mono text-forest">EAL {entry.ealCode}</span>}
      </div>
      <p className="text-sm text-black/70">{entry.summary}</p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-forest">Eligible depot stations</h3>
        <p className="text-xs text-black/40">
          Norwegian farlig avfall receivers (avfallsdeklarering.no / norskeutslipp.no permits).{" "}
          {entry.isHazardous
            ? entry.avfallsstoffnr
              ? `Glowing stations hold a permit covering avfallsstoffnr ${entry.avfallsstoffnr} — zoom and click one for its permitted codes and permit PDF.`
              : "Glowing stations are licensed to receive hazardous waste — zoom and click one for its permitted codes and permit PDF."
            : "This waste is non-hazardous and can go to ordinary municipal facilities; hazardous receivers are shown dimmed."}
        </p>
        <DepotMap
          isHazardous={entry.isHazardous}
          avfallsstoffnr={entry.avfallsstoffnr}
          onRequestTransport={setTransportDepot}
        />
      </div>

      {transportDepot && (
        <div className="rounded-xl border border-black/5 bg-cream/50 px-4 py-4 flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-forest">Transport to {transportDepot.name}</h3>
            <p className="text-xs text-black/40 mt-0.5">
              {ORIGIN.label} → {transportDepot.name} ·{" "}
              {Math.round(haversineKm(ORIGIN.lat, ORIGIN.lng, transportDepot.lat, transportDepot.lng))} km ·{" "}
              assumed load {ASSUMED_LOAD_TONNES} t
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.keys(MODES) as TransportMode[]).map(m => {
              const km = haversineKm(ORIGIN.lat, ORIGIN.lng, transportDepot.lat, transportDepot.lng);
              const active = m === mode;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                    active ? "border-forest bg-forest text-cream" : "border-black/10 bg-white hover:border-forest/40"
                  }`}
                >
                  <p className={`text-sm font-medium ${active ? "text-lime" : "text-forest"}`}>{MODES[m].label}</p>
                  <p className={`text-xs mt-0.5 ${active ? "text-cream/70" : "text-black/40"}`}>
                    ~{co2Kg(m, km).toLocaleString()} kg CO₂
                  </p>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={() => setTransportDepot(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onPress={() => {
                addShipment({ analysisName: `${caseName} — ${entry.sampleLabel}`, depotId: transportDepot.id, mode });
                router.push("/shipments");
              }}
            >
              Book transport
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [caseData, setCaseData] = useState<Case | null | undefined>(undefined);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setCaseData(getCase(id) ?? null);
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, [id]);

  if (caseData === undefined || !now) return null;
  if (caseData === null) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6">
        <p className="text-black/50">Case not found.</p>
        <Link href="/" className="text-forest underline text-sm">Back to my projects</Link>
      </div>
    );
  }

  const status = computeStatus(caseData.createdAt, now);

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div>
        <Link href={`/projects/${caseData.projectId}`} className="text-sm text-black/40 hover:text-forest">&larr; Back to project</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-forest">{caseData.name}</h1>
          <StatusChip status={status} />
        </div>
        <p className="text-xs text-black/40 mt-1">Sent {new Date(caseData.createdAt).toLocaleString()}</p>
      </div>

      {status !== "complete" && (
        <p className="text-sm text-black/50">
          The lab is processing this case. Results appear here automatically when it completes.
        </p>
      )}

      {status === "complete" &&
        caseData.wasteEntries.map(entry => <WasteEntryCard key={entry.id} caseName={caseData.name} entry={entry} />)}

      {status === "complete" && caseData.wasteEntries.length === 0 && (
        <p className="text-sm text-black/50">Case complete — no waste entries attached.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Delete the old analysis-detail page**

```bash
rm -rf app/analyses
```

- [ ] **Step 3: Run the full suite and build**

Run: `npx vitest run`
Expected: PASS — every test file passes, no remaining references to the deleted `lib/analyses.ts`
anywhere in the codebase.

Run: `npm run build`
Expected: compiles successfully — `/cases/[id]` and `/projects/[id]` routes generated,
`/analyses/[id]` no longer present.

Also run: `grep -rn "lib/analyses\|from \"@/lib/analyses\"" --include="*.ts" --include="*.tsx" .`
Expected: no output (no remaining references anywhere in the codebase).

- [ ] **Step 4: Commit**

```bash
git add app/cases/
git rm -r app/analyses
git commit -m "feat: add case detail page rendering multiple waste entries, replacing the old analysis-detail page"
```
