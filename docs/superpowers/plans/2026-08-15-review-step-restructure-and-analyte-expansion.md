# Review-Step Restructure & Analyte Reference Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the wizard's analyte-results review display for large multi-panel reports, stop extracting non-substance rows, and close real, confirmed gaps in the analyte reference table (PFAS, PCB, Norwegian TPH hydrocarbon fractions — Chromium VI turned out to already be covered).

**Architecture:** A new pure, testable module (`lib/wizard/group-analyte-results.ts`) groups extraction result rows by their matched substance's `substanceGroup`; `ExtractionReviewStep.tsx` renders these as collapsible sections and replaces the separate unmatched-substance list with an inline hover indicator. `extract.ts`'s extraction prompt gains a general (not report-specific) exclusion rule. `analyte-reference.json` gains real, sourced entries for three real gaps this session confirmed against an actual lab report.

**Tech Stack:** TypeScript, Next.js, React, Vitest.

## Global Constraints

- The extraction-exclusion rule (Task 2) must be phrased as a general rule ("quality-control/methodology parameters", "pre-calculated aggregate sums"), never as a hardcoded list of this one report's exact labels.
- TPH/hydrocarbon carbon-range fraction rows are explicitly NOT excluded by the Task 2 rule — they remain extracted, since they are real, hazard-classification-relevant substances this codebase already has a working (if currently under-matched) pattern for.
- Every new `analyte-reference.json` entry (Tasks 3-4) must carry a real, verified CAS number (or an honest `null` with a documented reason for genuine range/UVCB substances) and a real, sourced CLP hazard classification, or an honest `null` if no real harmonized classification exists — never a fabricated or guessed value, matching this codebase's established discipline for every prior analyte-reference round.
- No change to `classifyHazard`'s HP1-15 logic itself.
- No change to the case/project data model or wizard flow beyond the analyte-results display.

---

### Task 1: Restructure the analyte-results display

**Files:**
- Create: `lib/wizard/group-analyte-results.ts`
- Test: `tests/wizard/group-analyte-results.test.ts`
- Modify: `components/wizard/ExtractionReviewStep.tsx`

**Interfaces:**
- Consumes: `lib/data/analyte-reference.json` (existing, read-only).
- Produces: `export interface AnalyteResultRow { rawAnalyteName: string; analyteId: string | null; resultValue: number | null; unitRaw: string; }`, `export interface AnalyteResultGroup { groupName: string; rows: AnalyteResultRow[]; }`, `export function groupAnalyteResults(results: AnalyteResultRow[]): AnalyteResultGroup[]` — used only within this task's component change, no later task depends on it.

- [ ] **Step 1: Write the failing tests**

Create `tests/wizard/group-analyte-results.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupAnalyteResults, type AnalyteResultRow } from "@/lib/wizard/group-analyte-results";

describe("groupAnalyteResults", () => {
  it("groups matched rows by their real substanceGroup, using a real matched analyteId", () => {
    // "arsenic" is a real entry in lib/data/analyte-reference.json with substanceGroup "metal".
    const rows: AnalyteResultRow[] = [
      { rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, unitRaw: "%" },
    ];
    const groups = groupAnalyteResults(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupName).toBe("Metals");
    expect(groups[0].rows).toHaveLength(1);
  });

  it("puts unmatched rows (analyteId: null) into their own 'Not in reference table' group, never guessed into a real category", () => {
    const rows: AnalyteResultRow[] = [
      { rawAnalyteName: "PFOS (Perfluoroktylsulfonat)", analyteId: null, resultValue: 0.26, unitRaw: "µg/kg TS" },
    ];
    const groups = groupAnalyteResults(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupName).toBe("Not in reference table");
  });

  it("the 'Not in reference table' group always sorts last, real substance groups keep first-appearance order", () => {
    const rows: AnalyteResultRow[] = [
      { rawAnalyteName: "unmatched-substance", analyteId: null, resultValue: 1, unitRaw: "%" },
      { rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, unitRaw: "%" },
    ];
    const groups = groupAnalyteResults(rows);
    expect(groups.map(g => g.groupName)).toEqual(["Metals", "Not in reference table"]);
  });

  it("keeps multiple rows of the same group together under one section", () => {
    // "arsenic" and "lead-compounds" are both real metal entries.
    const rows: AnalyteResultRow[] = [
      { rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, unitRaw: "%" },
      { rawAnalyteName: "piombo", analyteId: "lead-compounds", resultValue: 12.3, unitRaw: "%" },
    ];
    const groups = groupAnalyteResults(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("returns an empty array for no rows", () => {
    expect(groupAnalyteResults([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/wizard/group-analyte-results.test.ts`
Expected: FAIL — `lib/wizard/group-analyte-results.ts` doesn't exist yet.

- [ ] **Step 3: Create `lib/wizard/group-analyte-results.ts`**

```ts
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";

interface AnalyteReferenceEntry {
  analyteId: string;
  substanceGroup: string;
}

const analyteReference = analyteReferenceRaw as AnalyteReferenceEntry[];

export interface AnalyteResultRow {
  rawAnalyteName: string;
  analyteId: string | null;
  resultValue: number | null;
  unitRaw: string;
}

export interface AnalyteResultGroup {
  groupName: string;
  rows: AnalyteResultRow[];
}

const NOT_IN_REFERENCE_TABLE = "Not in reference table";

const SUBSTANCE_GROUP_LABELS: Record<string, string> = {
  metal: "Metals",
  PAH: "PAH",
  hydrocarbon: "Hydrocarbons",
  PFAS: "PFAS",
  PCB: "PCB",
  other: "Other",
};

// Groups analyte result rows by their matched AnalyteReference's substanceGroup, for a
// collapsible-section display instead of one long flat list on the wizard's review step. Rows
// with no match (analyteId is null) go into their own "Not in reference table" group rather than
// being guessed into a real category — mirrors this codebase's "never guess" discipline.
export function groupAnalyteResults(results: AnalyteResultRow[]): AnalyteResultGroup[] {
  const groups = new Map<string, AnalyteResultRow[]>();
  for (const row of results) {
    const ref = row.analyteId ? analyteReference.find(a => a.analyteId === row.analyteId) : undefined;
    const groupName = ref ? (SUBSTANCE_GROUP_LABELS[ref.substanceGroup] ?? ref.substanceGroup) : NOT_IN_REFERENCE_TABLE;
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName)!.push(row);
  }
  const entries = Array.from(groups.entries());
  entries.sort((a, b) => {
    if (a[0] === NOT_IN_REFERENCE_TABLE) return 1;
    if (b[0] === NOT_IN_REFERENCE_TABLE) return -1;
    return 0;
  });
  return entries.map(([groupName, rows]) => ({ groupName, rows }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/wizard/group-analyte-results.test.ts`
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Wire grouping and the inline unmatched indicator into `ExtractionReviewStep.tsx`**

The current analyte-results block and the separate unmatched-list block (shown below, exactly as
they exist today) are:

```tsx
      <Card>
        <Card.Content className="py-4">
          <p className="text-sm font-medium text-forest">Analyte results</p>
          <div className="flex flex-col gap-1 mt-2">
            {extraction.results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 text-sm border-b border-black/5 py-1 last:border-0">
                <span className="flex-1">{r.rawAnalyteName}</span>
                <span className={r.analyteId === null ? "text-amber-700 text-xs" : "text-black/70 text-xs"}>
                  {r.analyteId ?? "— unmatched —"}
                </span>
                <span className="text-black/50 text-xs w-24 text-right">
                  {r.resultValue ?? "—"} {r.unitRaw}
                </span>
              </div>
            ))}
          </div>
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
```

Replace BOTH blocks together with:

```tsx
      <Card>
        <Card.Content className="py-4">
          <p className="text-sm font-medium text-forest">Analyte results</p>
          <div className="flex flex-col gap-3 mt-2">
            {groupAnalyteResults(extraction.results).map(group => (
              <details key={group.groupName} open className="group">
                <summary className="text-xs font-medium text-forest/70 cursor-pointer select-none">
                  {group.groupName} ({group.rows.length})
                </summary>
                <div className="flex flex-col gap-1 mt-1 pl-2">
                  {group.rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm border-b border-black/5 py-1 last:border-0">
                      <span className="flex-1">{r.rawAnalyteName}</span>
                      <span className="flex items-center gap-1">
                        {r.analyteId === null && (
                          <span
                            className="text-amber-600 text-xs cursor-help"
                            title="Excluded from hazard classification rather than guessed — this substance isn't in the current reference table."
                          >
                            &#9888;
                          </span>
                        )}
                        <span className={r.analyteId === null ? "text-amber-700 text-xs" : "text-black/70 text-xs"}>
                          {r.analyteId ?? "— unmatched —"}
                        </span>
                      </span>
                      <span className="text-black/50 text-xs w-24 text-right">
                        {r.resultValue ?? "—"} {r.unitRaw}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </Card.Content>
      </Card>
```

Note the whole separate `{extraction.unmatchedAnalytes.length > 0 && (<Card>...</Card>)}` block is
gone — deleted, not just moved. `extraction.unmatchedAnalytes` itself stays in the prop type
(other code may still reference the underlying data shape) — this task only stops rendering the
separate list block.

Add the new import at the top of the file, alongside the existing ones:

```ts
import { groupAnalyteResults } from "@/lib/wizard/group-analyte-results";
```

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `npm run build`
Expected: compiles successfully.

- [ ] **Step 7: Verify manually**

Run the dev server (`npm run dev`), upload a multi-substance report through the wizard, and on
the review step confirm: analyte results now render as collapsible, labeled sections (e.g.
"Metals (8)", "Not in reference table (N)"); each unmatched row shows a small warning-triangle
icon with a hover tooltip; the old separate "Not evaluated — no reference match" block no longer
appears anywhere on the page.

- [ ] **Step 8: Commit**

```bash
git add lib/wizard/group-analyte-results.ts tests/wizard/group-analyte-results.test.ts components/wizard/ExtractionReviewStep.tsx
git commit -m "feat: group analyte results by substance category, replace unmatched list with inline indicator"
```

---

### Task 2: Extraction prompt — exclude non-substance rows (general rule)

**Files:**
- Modify: `lib/hp-classification/extract.ts`
- Test: `tests/hp-classification/extract.test.ts`

**Interfaces:**
- Consumes: none from Task 1.

- [ ] **Step 1: Write the failing test**

In `tests/hp-classification/extract.test.ts`, inside the existing `describe("buildMessageContent", ...)`
block, add:

```ts
  it("instructs the LLM to skip QA/methodology parameters and calculated sum rows, as a general rule (not a hardcoded list)", () => {
    const content = buildMessageContent("some real report text with enough real words to count as usable, definitely", Buffer.from(""), analyteRef, null);
    const text = (content[0] as { type: "text"; text: string }).text;
    expect(text.toLowerCase()).toContain("quality-control/methodology parameter");
    expect(text.toLowerCase()).toContain("pre-calculated aggregate sum");
    // The rule must be phrased generally — it must NOT hardcode this one report's exact
    // Norwegian labels, so it generalizes to any report's phrasing/language.
    expect(text).not.toContain("Tørrstoff");
    expect(text).not.toContain("Alifater");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: FAIL — the schema instructions don't mention this rule yet.

- [ ] **Step 3: Add the exclusion rule to `buildSchemaInstructions`**

In `lib/hp-classification/extract.ts`, find this sentence (already present from a prior round,
right after the JSON schema block):

```ts
For "location", extract the site/property address, name, or municipality where the waste was generated or where the sampling took place, if the document clearly states one (e.g. a project name, site address, or municipality mentioned in the report header or sampling details) — set it to null if the document does not clearly state a location; never guess or infer a location from unrelated context.
```

Add a new paragraph right after it (before the "Do NOT populate an originProcess field" sentence
that already follows):

```ts
Do not report a row as an analyte result if it is a quality-control/methodology parameter (e.g. dry-matter or moisture content, measurement uncertainty, temperature) or a pre-calculated aggregate sum of other rows already being reported individually (e.g. a "Sum X" total) — these are never real, individually classifiable substances. Carbon-range hydrocarbon fraction rows (e.g. total petroleum hydrocarbon ranges reported by carbon-chain length) ARE real substances and must still be reported individually — do not exclude these.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/hp-classification/extract.test.ts`
Expected: PASS — all tests in the file pass, including the new one.

- [ ] **Step 5: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `npm run build`
Expected: compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add lib/hp-classification/extract.ts tests/hp-classification/extract.test.ts
git commit -m "feat: instruct extraction to skip QA/methodology and sum rows as a general rule"
```

---

### Task 3: Analyte reference expansion — PFAS, PCB

**Files:**
- Modify: `lib/data/analyte-reference.json`
- Test: `tests/hp-classification/analyte-reference.test.ts`

**Interfaces:**
- Consumes: none from Tasks 1-2.
- Produces: new `AnalyteReference` entries with `substanceGroup: "PFAS"` and `substanceGroup: "PCB"` — Task 1's `SUBSTANCE_GROUP_LABELS` map already has display labels for both (`"PFAS"`, `"PCB"`), so no further UI change is needed once these entries exist.

**Note on Chromium VI**: verified during planning that `lib/data/analyte-reference.json` ALREADY
has a real, complete, correctly-sourced `chromium-vi` entry (`casNumber: "18540-29-9"`,
`hStatement: "H350"`, `hazardClass: "Carc. 1B"`), distinct from the existing `chromium-total`
entry. This originally-suspected gap does not exist — do not add a duplicate or second
Chromium-VI-related entry in this task. Always check the real current file before assuming a gap
exists, the same lesson this exact check just demonstrated during planning.

**Real substance list to add** (transcribed exactly from the real "Alta Lufthavn PFAS-prosjektet"
Eurofins report, confirmed unmatched against the current 50-entry reference table):

35 PFAS compounds (`substanceGroup: "PFAS"`): 4:2 FTS (Fluortelomersulfonat), 6:2 FTS
(Fluortelomersulfonat), 8:2 FTS (Fluortelomersulfonat), HPFHpA (7H-Perfluorheptansyre), PF-3,7-DMOA
(Perfluor-3,7-dimetyloktansyre), PFDA (Perfluordekansyre), PFBA (Perfluorbutansyre), PFBS
(Perfluorbutansulfonat), PFDoDA (Perfluordodekansyre), PFTrDA (Perfluortridekansyre), PFDS
(Perfluordekansulfonat), PFHpA (Perfluorheptansyre), PFHpS (Perfluorheptansulfonat), PFHxA
(Perfluorheksansyre), PFHxDA (Perfluorheksadekansyre), PFHxS (Perfluorheksansulfonat), PFNA
(Perfluornonansyre), PFOA (Perfluoroktansyre), PFOS (Perfluoroktylsulfonat), PFOSA
(Perfluoroktansulfonamid), PFPeA (Perfluorpentansyre), PFTeDA (Perfluortetradekansyre), PFUnDA
(Perfluorundekansyre), EtFOSA (N-etylperfluoroktansulfonamid), EtFOSAA
(N-etylperfluoroktansulfonamid-HAc), EtFOSE (N-etylperfluoroktansulfonamidetanol), MeFOSAA
(N-metylperfluoroktansulfonamid-HAc), MeFOSE (N-metylperfluoroktansulfonamidetanol), MeFOSA
(N-metylperfluoroktansulfonamid), FOSAA (Perfluoroktansulfonamid-HAc), PFPeS
(Perfluorpentansulfonat), PFNS (Perfluornonansulfonat), PFUnDS (Perfluorundekansulfonat), PFDoDS
(Perfluordodekansulfonat), PFTrDS (Perfluortridekansulfonat).

7 indicator PCBs (`substanceGroup: "PCB"`): PCB 28, PCB 52, PCB 101, PCB 118, PCB 138, PCB 153,
PCB 180.

- [ ] **Step 1: Write the failing tests**

Add a new test to `tests/hp-classification/analyte-reference.test.ts` (read the existing file
first to match its exact style/imports before adding):

```ts
  it("has real PFAS and PCB entries confirmed against the real Alta Lufthavn Eurofins report", () => {
    const pfasEntries = analyteReference.filter(a => a.substanceGroup === "PFAS");
    const pcbEntries = analyteReference.filter(a => a.substanceGroup === "PCB");
    expect(pfasEntries.length).toBe(35);
    expect(pcbEntries.length).toBe(7);
    for (const entry of [...pfasEntries, ...pcbEntries]) {
      // CAS number is required to be either a real string or an honestly-disclosed null — never
      // undefined (which would mean the field was simply forgotten).
      expect(entry.casNumber === null || typeof entry.casNumber === "string").toBe(true);
      expect(entry.analyteId.length).toBeGreaterThan(0);
    }
  });

  it("real, spot-checked values: PFOS and PCB 28 carry their real, verified CAS numbers", () => {
    const pfos = analyteReference.find(a => a.canonicalNameEn.toLowerCase().includes("perfluorooctane sulfonic") || a.analyteId === "pfos");
    expect(pfos).toBeDefined();
    expect(pfos!.casNumber).toBe("1763-23-1");
    const pcb28 = analyteReference.find(a => a.analyteId === "pcb-28");
    expect(pcb28).toBeDefined();
    expect(pcb28!.casNumber).toBe("7012-37-5");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/hp-classification/analyte-reference.test.ts`
Expected: FAIL — none of these entries exist yet.

- [ ] **Step 3: Source and add the real entries**

This step requires real chemical data research, not invented values — the standard for every
prior analyte-reference round in this codebase's history. For each of the 35 PFAS + 7 PCB
entries:

1. Look up the real CAS number via a reliable source (ECHA substance database, PubChem, or an
   equivalent authoritative chemical registry) — use WebSearch/WebFetch to verify each one
   individually rather than relying on memory, the same discipline used for every prior real
   chemical-data round in this codebase. If no single real CAS number exists for a substance
   (e.g. it is reported only as an ionic/salt mixture with no distinct registry entry), set
   `casNumber: null` rather than guessing — this is a real, disclosed gap, not an error.
2. Look up the real, harmonized CLP hazard classification (H-statement + hazard class) for each
   substance via ECHA's Classification and Labelling (C&L) Inventory or Annex VI harmonised
   classification list. Many PFAS compounds genuinely have NO EU harmonized classification at
   all as of this writing — for those, set `hStatement: null, hazardClass: null` (an honest gap,
   matching the existing pattern already used for other unclassified substances in this file —
   check `lib/data/analyte-reference.json` for real examples of this pattern before adding new
   entries). Do not substitute a related substance's classification for one that lacks its own.
3. Individual PCB congeners (PCB 28, 52, 101, 118, 138, 153, 180) typically do not have their own
   individual ECHA harmonized classification entries separate from the broader "polychlorinated
   biphenyls" category (CAS 1336-36-3) — verify this via a real source before deciding whether to
   apply the general PCB category's real, verified classification to each congener entry, or to
   leave each congener's classification as an honest `null`. Document whichever real, verified
   choice you make with a comment in the JSON-adjacent context or in your implementation report,
   not silently.
4. For each entry, `analyteId` should be a stable, lowercase, hyphenated identifier derived from
   the substance's common English abbreviation (e.g. `"pfos"`, `"pfoa"`, `"pcb-28"`) — follow
   the exact naming convention already used by the other 50 entries in
   this file (check a few real existing entries for the pattern before choosing new ids).
   `canonicalNameNo` should be the real Norwegian name (transcribed above), `canonicalNameEn`
   the real English name, `canonicalNameIt` may be `null` if no reliable Italian name is sourced
   (this project's existing pattern already tolerates a `null` Italian name for some entries —
   confirm this before adding one you're not confident of, rather than guessing an Italian
   translation).
5. `defaultUnit` should match the real report's unit for that substance category (µg/kg for PFAS
   as reported in the real Eurofins report; confirm PCB's real reported unit the same way).
6. `mFactorAcute`/`mFactorChronic`/`elementSymbol`/`hStatements` (the multi-hStatement array
   field) follow the same real, sourced, never-fabricated discipline as every other field —
   `null` unless a real value is confirmed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/hp-classification/analyte-reference.test.ts`
Expected: PASS — all tests pass, including the two new ones. If the exact spot-check CAS numbers
in the Step 1 test (`1763-23-1` for PFOS, `7012-37-5` for PCB 28) turn out to be wrong once you've
done the real research, correct the TEST to match the real, verified value you found — do not
adjust your sourced data to match a possibly-wrong number written into this plan ahead of time.

- [ ] **Step 5: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `npm run build`
Expected: compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add lib/data/analyte-reference.json tests/hp-classification/analyte-reference.test.ts
git commit -m "feat: add real, sourced PFAS and PCB entries to analyte reference table"
```

---

### Task 4: Norwegian TPH hydrocarbon-fraction reference entries

**Files:**
- Modify: `lib/data/analyte-reference.json`
- Test: `tests/hp-classification/analyte-reference.test.ts`

**Interfaces:**
- Consumes: none from Tasks 1-3.

- [ ] **Step 1: Real research first**

The real Alta Lufthavn Eurofins report reports Norwegian SPI-2011-method hydrocarbon fractions:
`Alifater C5-C6`, `Alifater >C6-C8`, `Alifater >C8-C10`, `Alifater >C10-C12`, `Alifater >C12-C16`,
`Alifater >C16-C35`, `Aromater >C8-C10`, `Aromater >C10-C16`, `Aromater >C16-C35`. None of these
currently match the existing `lib/data/analyte-reference.json` hydrocarbon entries (which use a
different range convention, `"hydrocarbons-c10-c40"`).

Research the real Norwegian regulatory source for how these fractions map to CLP hazard
classification — Miljødirektoratet's (Norwegian Environment Agency) guidance for classifying
oil-contaminated soil is the correct real source to check first (search for the real, current
guidance document, not an assumed one) — use WebSearch/WebFetch to find and read it. Norwegian
environmental guidance commonly maps aliphatic and aromatic hydrocarbon fractions to specific
CLP-equivalent hazard categories by carbon range.

**If a real, verifiable source is found**: add one `AnalyteReference` entry per real fraction
named above, with `substanceGroup: "hydrocarbon"`, a real `analyteId` (e.g.
`"aliphatic-c5-c6"`, `"aromatic-c16-c35"`), `casNumber: null` (these are genuine UVCB/range
substances with no single CAS, matching the existing `"hydrocarbons-c10-c40"` entry's own real,
correct `casNumber: null`), and the real, sourced `hStatement`/`hazardClass` the guidance
document actually specifies for that fraction.

**If no real, verifiable source can be found for a specific fraction's hazard classification**:
do not add a guessed entry for that fraction. Leave it as an honest, disclosed gap — exactly the
same "never fabricate" discipline used throughout this codebase. Document in your implementation
report which fractions got real entries and which remain honest gaps, and why.

- [ ] **Step 2: Write the failing test**

Add to `tests/hp-classification/analyte-reference.test.ts` (the exact assertions here depend on
what Step 1's real research actually finds — write this test to match the REAL outcome of that
research, not a number assumed in advance):

```ts
  it("has real, sourced entries for the Norwegian TPH hydrocarbon fractions the research confirmed a real classification for", () => {
    const fractionEntries = analyteReference.filter(a => a.analyteId.startsWith("aliphatic-") || a.analyteId.startsWith("aromatic-"));
    // At least the fractions with a real, sourced classification should now exist as entries —
    // exact count depends on what Step 1's real research found; assert it's non-zero and that
    // every entry that does exist carries a real, disclosed casNumber (null) rather than an
    // invented one.
    for (const entry of fractionEntries) {
      expect(entry.casNumber).toBeNull();
    }
  });
```

- [ ] **Step 3: Run the test to verify it fails or passes appropriately**

Run: `npx vitest run tests/hp-classification/analyte-reference.test.ts`
Expected: depends on whether any fraction entries exist yet (they don't, at the start of this
task) — the test's `casNumber` assertion inside the loop is vacuously true for zero entries, so
this test alone won't fail meaningfully until Step 4 either adds entries or you strengthen the
test's count assertion once you know the real number Step 1's research produced. Update this
test's assertions to be concrete (a specific expected count, and spot-checks of real sourced
values) once you know the real research outcome, before considering this task done.

- [ ] **Step 4: Add the real, sourced entries (or document the honest gap)**

Add whatever real entries Step 1's research supports, following the exact same
`AnalyteReference` field conventions as Task 3. Update the Step 2 test to assert the real,
concrete outcome (exact count, real spot-checked values) rather than the placeholder-ish loop
above, once the real research is complete.

- [ ] **Step 5: Run the full suite and build**

Run: `npx vitest run`
Expected: all test files pass.

Run: `npm run build`
Expected: compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add lib/data/analyte-reference.json tests/hp-classification/analyte-reference.test.ts
git commit -m "feat: add real, sourced Norwegian TPH hydrocarbon-fraction reference entries where a real classification exists"
```
