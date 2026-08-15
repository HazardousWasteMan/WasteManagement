# Analyte Reference Expansion (Metals & PAHs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ~11 real metals and ~21-22 real PAHs to `lib/data/analyte-reference.json`, each with a genuinely sourced CAS number, GHS hazard classification (or an honest `null` when none exists), and real Norwegian/English/Italian names — closing a large fraction of the 406-substance gap found in a real, live extraction against an actual dense lab report.

**Architecture:** Two tasks, each adding a batch of new entries to the existing flat JSON array — no schema changes, no changes to the classification engine (`classify-sample.ts`, `hazard.ts`, `hp-thresholds.json`), since the existing `hStatements`-array pattern already used by most current entries covers everything these new substances need.

**Tech Stack:** TypeScript, Vitest, real chemical-database sourcing (ECHA C&L Inventory, PubChem GHS Classification, Miljødirektoratet or equivalent for Norwegian names) via WebSearch/WebFetch during implementation.

## Global Constraints

- **CAS numbers for the metals and 21 of the 22 PAHs are already real-verified below — use them exactly as given, do not re-derive or alter them.** They were independently confirmed during planning (metals via periodictable.com's elemental CAS reference table; PAHs via multiple cross-checked chemical-supplier/registry sources).
- **`dibenzo[a,j]pyrene`'s CAS number could NOT be confidently found during planning** (search results kept surfacing a different compound, dibenz[a,j]anthracene, CAS 224-41-9 — verified during planning that this is NOT the same substance and must not be used for dibenzo[a,j]pyrene). The implementer must independently verify this substance's real CAS number via ECHA/PubChem before adding it; if no confident, distinctly-sourced CAS number can be found, add the entry with `casNumber: null` and a clear comment explaining why, rather than reusing another compound's number or guessing.
- **GHS hazard classification** (the `hStatements` array) and **real Norwegian names** were NOT sourced during planning (budget constraints) — the implementer must source both, for every new entry, from real, citable sources: ECHA's C&L Inventory (`https://echa.europa.eu/information-on-chemicals/cl-inventory-database`) as primary, PubChem's GHS Classification section as secondary cross-check, for hazard data; Miljødirektoratet's substance database or an equivalent real, checkable Norwegian chemical-terminology source for names. Every sourced value must be traceable to a real citation, named in the implementer's report.
- **A substance with no real harmonised GHS classification gets `hStatements: null`, `hStatement: null`, `hazardClass: null`** — this is honest, correct information, not a gap. Never guess a classification. Several existing entries (e.g. `arsenic`) already work this way.
- **`mFactorAcute`/`mFactorChronic` stay `null` unless a real, ECHA-documented M-factor exists** for that specific substance's `H400`/`H410` aquatic classification — never default to `1` or any other guessed value.
- **`elementSymbol: null` for every new entry in this slice** — do not use the elemental-speciation path (`lib/data/element-compound-forms.json`); use the substance's own direct `hStatements` classification instead, matching how `chromium-vi`, `mercury`, and `benzo-a-pyrene` already work.
- **`defaultUnit: "%"` and `substanceGroup: "metal"` (Task 1) / `"PAH"` (Task 2)** for every new entry — matches the existing convention exactly, do not invent new group values.
- No changes to `lib/hp-classification/hazard.ts`, `lib/hp-classification/classify-sample.ts`, or `lib/data/hp-thresholds.json` — confirmed during planning that the existing threshold table already covers the full standard GHS vocabulary these new entries will use.

---

### Task 1: Add 11 new metal entries

**Files:**
- Modify: `lib/data/analyte-reference.json`
- Test: `tests/hp-classification/analyte-reference.test.ts` (existing file — extend it)

**Interfaces:**
- Consumes: nothing new — the existing `AnalyteReference` interface (`lib/hp-classification/types.ts`) and existing `analyte-reference.json` array.
- Produces: 11 new entries in `lib/data/analyte-reference.json`, with these exact `analyteId`s (for Task 2 and any future cross-referencing to use consistently): `aluminum`, `boron`, `iron`, `lithium`, `selenium`, `strontium`, `thallium`, `tellurium`, `titanium`, `chromium-total`, `tin-inorganic`.

**Real, pre-verified data to use for each entry's `casNumber` field (do not alter):**

| analyteId | Real element | CAS number (verified) |
|---|---|---|
| `aluminum` | Aluminum | `7429-90-5` |
| `boron` | Boron | `7440-42-8` |
| `iron` | Iron | `7439-89-6` |
| `lithium` | Lithium | `7439-93-2` |
| `selenium` | Selenium | `7782-49-2` |
| `strontium` | Strontium | `7440-24-6` |
| `thallium` | Thallium | `7440-28-0` |
| `tellurium` | Tellurium | `13494-80-9` |
| `titanium` | Titanium | `7440-32-6` |
| `chromium-total` | Chromium (total, elemental — distinct from the existing `chromium-vi` entry) | `7440-47-3` |
| `tin-inorganic` | Tin (inorganic/elemental — distinct from the existing `tin-organostannic-compounds` entry) | `7440-31-5` |

- [ ] **Step 1: Write the failing structural test**

Read the existing `tests/hp-classification/analyte-reference.test.ts` file first (if it doesn't exist, create it) to see what's already tested for the current 18 entries — match its existing style. Add these new tests (adjust the `describe` block name/structure to fit whatever's already there):

```typescript
import { describe, it, expect } from "vitest";
import analyteReference from "@/lib/data/analyte-reference.json";
import type { AnalyteReference } from "@/lib/hp-classification/types";

describe("analyte-reference.json — metals batch (Task 1)", () => {
  const entries = analyteReference as AnalyteReference[];
  const newMetalIds = [
    "aluminum", "boron", "iron", "lithium", "selenium", "strontium",
    "thallium", "tellurium", "titanium", "chromium-total", "tin-inorganic",
  ];

  it("has all 11 new metal entries present", () => {
    for (const id of newMetalIds) {
      expect(entries.some(e => e.analyteId === id), `missing analyteId ${id}`).toBe(true);
    }
  });

  it("has no duplicate analyteIds anywhere in the file (old 18 + new 11)", () => {
    const ids = entries.map(e => e.analyteId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const id of newMetalIds) {
    it(`${id}: has the real, pre-verified CAS number and correct structural shape`, () => {
      const entry = entries.find(e => e.analyteId === id)!;
      expect(entry).toBeDefined();
      expect(entry.substanceGroup).toBe("metal");
      expect(entry.defaultUnit).toBe("%");
      expect(entry.elementSymbol).toBeNull();
      expect(typeof entry.canonicalNameEn).toBe("string");
      expect(entry.canonicalNameEn.length).toBeGreaterThan(0);
      expect(typeof entry.canonicalNameNo).toBe("string");
      expect(entry.canonicalNameNo.length).toBeGreaterThan(0);
      // Every hStatements entry (if any) must have both fields — no partial hazard rows.
      if (entry.hStatements) {
        for (const h of entry.hStatements) {
          expect(typeof h.hStatement).toBe("string");
          expect(typeof h.hazardClass).toBe("string");
        }
      }
    });
  }

  it("aluminum has the real, independently-verified CAS number 7429-90-5", () => {
    const entry = entries.find(e => e.analyteId === "aluminum")!;
    expect(entry.casNumber).toBe("7429-90-5");
  });

  it("iron has the real, independently-verified CAS number 7439-89-6", () => {
    const entry = entries.find(e => e.analyteId === "iron")!;
    expect(entry.casNumber).toBe("7439-89-6");
  });

  it("chromium-total and chromium-vi are distinct entries with different CAS numbers", () => {
    const total = entries.find(e => e.analyteId === "chromium-total")!;
    const hexavalent = entries.find(e => e.analyteId === "chromium-vi")!;
    expect(total).toBeDefined();
    expect(hexavalent).toBeDefined();
    expect(total.casNumber).not.toBe(hexavalent.casNumber);
  });

  it("tin-inorganic and tin-organostannic-compounds are distinct entries", () => {
    const inorganic = entries.find(e => e.analyteId === "tin-inorganic")!;
    const organostannic = entries.find(e => e.analyteId === "tin-organostannic-compounds")!;
    expect(inorganic).toBeDefined();
    expect(organostannic).toBeDefined();
    expect(inorganic.casNumber).not.toBe(organostannic.casNumber);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/analyte-reference.test.ts`
Expected: FAIL — the 11 new `analyteId`s don't exist in `analyte-reference.json` yet.

- [ ] **Step 3: Source real GHS classification and Norwegian names, then add the 11 entries**

For each of the 11 metals, use WebSearch/WebFetch against ECHA's C&L Inventory
(`https://echa.europa.eu/information-on-chemicals/cl-inventory-database`) as the primary
source for its real harmonised GHS classification (if any exists — many pure elemental metals
genuinely have none, which is a correct, honest `null` result, not a gap), cross-checked
against PubChem's GHS Classification section where available. Source each substance's real
Norwegian name from Miljødirektoratet's substance database or an equivalent real, checkable
source (not machine translation).

Add each entry to `lib/data/analyte-reference.json` (append to the array) using the exact
`analyteId` and `casNumber` values from the table above, with your sourced
`canonicalNameNo`/`hStatements`/`mFactorChronic` (only if a real M-factor is documented)
values. Example shape (values below are illustrative of the STRUCTURE only — replace
`canonicalNameNo` and `hStatements` with what you actually find sourced; if a metal has no
real harmonised classification, use `"hStatements": null, "hStatement": null, "hazardClass": null`
exactly like the existing `arsenic` entry does):

```json
{
  "analyteId": "aluminum",
  "canonicalNameNo": "REPLACE WITH REAL SOURCED NORWEGIAN NAME",
  "canonicalNameIt": "alluminio",
  "canonicalNameEn": "aluminum",
  "casNumber": "7429-90-5",
  "defaultUnit": "%",
  "substanceGroup": "metal",
  "mFactorAcute": null,
  "mFactorChronic": null,
  "elementSymbol": null,
  "hStatement": null,
  "hazardClass": null,
  "hStatements": null
}
```

(`canonicalNameIt` for each of the 11 metals is the real Italian word already present in the
source report's own unmatched-analyte list, transcribed here for convenience: aluminum →
"alluminio", boron → "boro", iron → "ferro", lithium → "litio", selenium → "selenio",
strontium → "stronzio", thallium → "tallio", tellurium → "tellurio", titanium → "titanio",
chromium-total → "cromo", tin-inorganic → "stagno". Use these exactly — they are real,
already-confirmed values from the actual report, not invented.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/analyte-reference.test.ts`
Expected: PASS (all tests, including every pre-existing test for the original 18 entries).

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add lib/data/analyte-reference.json tests/hp-classification/analyte-reference.test.ts
git commit -m "feat: add 11 real metal entries to analyte-reference.json, sourced from ECHA/PubChem/Miljødirektoratet"
```

In your task report, list each of the 11 substances with the real source URL(s) you used for its GHS classification and Norwegian name — this is required for the task reviewer to spot-check.

---

### Task 2: Add ~21-22 new PAH entries

**Files:**
- Modify: `lib/data/analyte-reference.json`
- Test: `tests/hp-classification/analyte-reference.test.ts`

**Interfaces:**
- Consumes: the same `AnalyteReference` interface; the array now includes Task 1's 11 metals plus the original 18.
- Produces: ~21-22 new entries with these exact `analyteId`s: `naphthalene`, `acenaphthylene`, `acenaphthene`, `fluorene`, `phenanthrene`, `anthracene`, `fluoranthene`, `pyrene`, `benzo-a-anthracene`, `chrysene`, `indeno-123cd-pyrene`, `benzo-b-fluoranthene`, `benzo-j-fluoranthene`, `benzo-k-fluoranthene`, `benzo-e-pyrene`, `dibenzo-ah-anthracene`, `benzo-ghi-perylene`, `dibenzo-ae-pyrene`, `dibenzo-ai-pyrene`, `perylene`, and (conditionally, see below) `dibenzo-aj-pyrene`.

**Real, pre-verified data to use for each entry's `casNumber` field (do not alter):**

| analyteId | Real PAH | CAS number (verified) |
|---|---|---|
| `naphthalene` | Naphthalene | `91-20-3` |
| `acenaphthylene` | Acenaphthylene | `208-96-8` |
| `acenaphthene` | Acenaphthene | `83-32-9` |
| `fluorene` | Fluorene | `86-73-7` |
| `phenanthrene` | Phenanthrene | `85-01-8` |
| `anthracene` | Anthracene | `120-12-7` |
| `fluoranthene` | Fluoranthene | `206-44-0` |
| `pyrene` | Pyrene | `129-00-0` |
| `benzo-a-anthracene` | Benzo[a]anthracene | `56-55-3` |
| `chrysene` | Chrysene | `218-01-9` |
| `indeno-123cd-pyrene` | Indeno[1,2,3-cd]pyrene | `193-39-5` |
| `benzo-b-fluoranthene` | Benzo[b]fluoranthene | `205-99-2` |
| `benzo-j-fluoranthene` | Benzo[j]fluoranthene | `205-82-3` |
| `benzo-k-fluoranthene` | Benzo[k]fluoranthene | `207-08-9` |
| `benzo-e-pyrene` | Benzo[e]pyrene | `192-97-2` |
| `dibenzo-ah-anthracene` | Dibenzo[a,h]anthracene | `53-70-3` |
| `benzo-ghi-perylene` | Benzo[g,h,i]perylene | `191-24-2` |
| `dibenzo-ae-pyrene` | Dibenzo[a,e]pyrene | `192-65-4` |
| `dibenzo-ai-pyrene` | Dibenzo[a,i]pyrene | `189-55-9` |
| `perylene` | Perylene | `198-55-0` |

**`dibenzo-aj-pyrene` (Dibenzo[a,j]pyrene) — special handling required:** its real CAS number
could not be confidently confirmed during planning. Search results kept surfacing
`224-41-9`, which was independently verified during planning to belong to a **different**
compound (dibenz[a,j]anthracene, not dibenzo[a,j]pyrene) — do not use that number. Before
adding this entry: independently search ECHA/PubChem for "dibenzo[a,j]pyrene" specifically. If
you find a real, confidently-sourced CAS number distinct from `224-41-9`, use it and cite the
source. If you cannot confirm one, add the entry with `"casNumber": null` and a code comment
explaining the CAS number could not be confidently sourced — do not guess, and do not reuse
`224-41-9`.

- [ ] **Step 1: Write the failing structural test**

Add to `tests/hp-classification/analyte-reference.test.ts`:

```typescript
describe("analyte-reference.json — PAH batch (Task 2)", () => {
  const entries = analyteReference as AnalyteReference[];
  const newPahIds = [
    "naphthalene", "acenaphthylene", "acenaphthene", "fluorene", "phenanthrene",
    "anthracene", "fluoranthene", "pyrene", "benzo-a-anthracene", "chrysene",
    "indeno-123cd-pyrene", "benzo-b-fluoranthene", "benzo-j-fluoranthene",
    "benzo-k-fluoranthene", "benzo-e-pyrene", "dibenzo-ah-anthracene",
    "benzo-ghi-perylene", "dibenzo-ae-pyrene", "dibenzo-ai-pyrene", "perylene",
  ];

  it("has all 20 confidently-sourced new PAH entries present", () => {
    for (const id of newPahIds) {
      expect(entries.some(e => e.analyteId === id), `missing analyteId ${id}`).toBe(true);
    }
  });

  it("has no duplicate analyteIds anywhere in the file (18 original + 11 metals + PAHs)", () => {
    const ids = entries.map(e => e.analyteId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const id of newPahIds) {
    it(`${id}: has correct structural shape`, () => {
      const entry = entries.find(e => e.analyteId === id)!;
      expect(entry).toBeDefined();
      expect(entry.substanceGroup).toBe("PAH");
      expect(entry.defaultUnit).toBe("%");
      expect(entry.elementSymbol).toBeNull();
      expect(typeof entry.canonicalNameEn).toBe("string");
      expect(entry.canonicalNameEn.length).toBeGreaterThan(0);
      if (entry.hStatements) {
        for (const h of entry.hStatements) {
          expect(typeof h.hStatement).toBe("string");
          expect(typeof h.hazardClass).toBe("string");
        }
      }
    });
  }

  it("naphthalene has the real, independently-verified CAS number 91-20-3", () => {
    const entry = entries.find(e => e.analyteId === "naphthalene")!;
    expect(entry.casNumber).toBe("91-20-3");
  });

  it("pyrene has the real, independently-verified CAS number 129-00-0", () => {
    const entry = entries.find(e => e.analyteId === "pyrene")!;
    expect(entry.casNumber).toBe("129-00-0");
  });

  it("dibenzo-aj-pyrene, if present, does NOT use the wrong 224-41-9 CAS number (that belongs to a different compound, dibenz[a,j]anthracene)", () => {
    const entry = entries.find(e => e.analyteId === "dibenzo-aj-pyrene");
    if (entry) {
      expect(entry.casNumber).not.toBe("224-41-9");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/analyte-reference.test.ts`
Expected: FAIL — the new PAH `analyteId`s don't exist yet.

- [ ] **Step 3: Source real GHS classification and Norwegian names, then add the entries**

Same sourcing method as Task 1 (ECHA C&L Inventory primary, PubChem GHS Classification
secondary, real Norwegian names from Miljødirektoratet or equivalent). PAHs are a
well-documented substance class — most of these will have real, well-established harmonised
classifications (many are `Carc.`/`Muta.`/aquatic-hazard classified), unlike several of
Task 1's elemental metals which may legitimately have none. Do not assume this pattern without
verifying each one individually — some of the less common isomers in this batch may still lack
a harmonised entry, which is again an honest `null`, not a gap.

Add each entry using the exact `analyteId`/`casNumber` from the table above.
`canonicalNameIt` for each (the real Italian names already in the source report, transcribed
here): naphthalene → "naftalone" (note: this is very likely the report's own OCR/typo for
"naftalene" — use the correct Italian spelling "naftalene" in this field, since
`canonicalNameIt` should be the real chemical name, not a transcription artifact — but keep in
mind the raw extracted report text may say "naftalone", which the existing name-matching logic
in `extract.ts` already handles via loose any-language substring matching, not exact-string
equality, so this correction doesn't break matching), acenaphthylene → "acenaftilene",
acenaphthene → "acenaftene", fluorene → "fluorene", phenanthrene → "fenantrene", anthracene →
"antracene", fluoranthene → "fluorantene", pyrene → "pirene", benzo-a-anthracene →
"benzo(a)antracene", chrysene → "crisene", indeno-123cd-pyrene → "indeno[1,2,3-c,d]pirene",
benzo-b-fluoranthene → "benzo(b)fluorantene", benzo-j-fluoranthene → "benzo(j)fluorantene",
benzo-k-fluoranthene → "benzo(k)fluorantene", benzo-e-pyrene → "benzo(e)pirene",
dibenzo-ah-anthracene → "dibenzo(a,h)antracene", benzo-ghi-perylene →
"benzo(g,h,i)perilene", dibenzo-ae-pyrene → "dibenzo(a,e)pirene", dibenzo-ai-pyrene →
"dibenzo(a,i)pirene", perylene → "perilene", dibenzo-aj-pyrene (if added) →
"dibenzo(a,j)pirene".

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/analyte-reference.test.ts`
Expected: PASS (all tests, including every pre-existing test and every Task 1 test).

- [ ] **Step 5: Add a classify-sample.ts-level regression test proving real data flows through**

`tests/hp-classification/classify-sample.test.ts` already exists with this real, exact
pattern (confirmed by reading the file during planning) — a `baseMetadata: SampleMetadata`
constant, an inline `AnalyteReference[]` array, and `SampleResult[]` built inline per test,
calling `classifySample(metadata, results, testResults, analyteRef, elementCompoundForms,
originToChapterLookup)` and asserting on `result.hazard.resultsByHp.HPn === true`. Add a new
test to that file following the exact same real pattern its first test already uses. Pick ONE
new PAH entry you sourced with a real, confirmed carcinogenicity classification (most classic
PAHs like benzo[a]anthracene or chrysene have a real `Carc.` H-statement — use whichever one
you actually confirmed has one) and write a test proving a sample containing that substance
above the real threshold correctly triggers HP7. Exact shape (matches the file's own first
test, adapted — replace `SUBSTANCE_ID` with the real `analyteId` you confirmed has a `Carc.`
classification, and use the real entry from `lib/data/analyte-reference.json` — do not
reconstruct a fake `AnalyteReference` object for it, import and use the real, just-sourced one
so this test genuinely proves the real data flows through):

```typescript
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";

it("a real newly-added PAH with a confirmed carcinogenicity classification correctly triggers HP7", () => {
  const realAnalyteRef = analyteReferenceRaw as AnalyteReference[];
  const results: SampleResult[] = [
    {
      resultId: "r1", sampleId: "t", analyteId: "SUBSTANCE_ID", rawAnalyteName: "test",
      resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
    },
  ];
  const result = classifySample(baseMetadata, results, [], realAnalyteRef, [], { "test-origin": "1705" });
  expect(result.hazard.resultsByHp.HP7).toBe(true);
});
```

(`resultValue: 0.5` assumes a 0.1% `Carc. 1A`/`1B` threshold — if the substance you picked is
`Carc. 2` instead, its real threshold is 1%, so use a `resultValue` above 1 instead; check
`lib/data/hp-thresholds.json`'s real HP7 rows, already read during planning, to pick the
correct value for whichever hazard class you actually sourced.)

- [ ] **Step 6: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/data/analyte-reference.json tests/hp-classification/analyte-reference.test.ts tests/hp-classification/classify-sample.test.ts
git commit -m "feat: add real PAH entries to analyte-reference.json, sourced from ECHA/PubChem/Miljødirektoratet"
```

In your task report, list each substance with the real source URL(s) you used, and explicitly
state what you found (or didn't find) for `dibenzo-aj-pyrene`'s CAS number.

---

## Self-Review Notes

- **Spec coverage:** ~11 metals (Task 1) and ~20-21 PAHs (Task 2, with `dibenzo-aj-pyrene` conditionally included pending real sourcing) cover the spec's full "In scope" list. The spec's "Explicitly out of scope" items (all other substance categories, fixing the existing 18 entries' Norwegian names, `hazard.ts`/`hp-thresholds.json`/`element-compound-forms.json` changes) are untouched by either task.
- **Placeholder scan:** every CAS number is real and pre-verified, cited in the plan. The only intentionally-open items are the GHS classification and Norwegian-name sourcing (explicitly delegated to implementation-time WebSearch/WebFetch work per the Global Constraints, not left vague — the exact sources, the exact honest-null fallback behavior, and the exact reporting requirement are all specified) and `dibenzo-aj-pyrene`'s CAS number (explicitly flagged as unconfirmed during planning, with an exact, non-guessing resolution procedure given). Neither is a "TBD, fill in later" — both have a fully specified process and acceptance criteria.
- **Type consistency:** the `AnalyteReference` interface, `analyteId` naming, and the `hStatements`-array-only pattern (no `elementSymbol`) are used identically across both tasks and match the existing 18 entries' established conventions exactly.
- **Cross-task consistency check:** Task 1's `analyteId`s (metals) and Task 2's `analyteId`s (PAHs) don't collide with each other or with the existing 18 — verified during planning by comparing every new ID against the existing list.
- **Empirical grounding:** every CAS number in this plan was independently verified during planning via WebSearch against real chemical registries (periodictable.com's elemental CAS table for metals; multiple cross-checked chemical-supplier/registry pages for PAHs) — including catching one real cross-compound confusion (`224-41-9` belonging to a different substance than the one initially searched for) before it could be written into the plan as a wrong fact.
