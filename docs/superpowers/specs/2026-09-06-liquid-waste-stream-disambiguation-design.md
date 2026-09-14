# Liquid-Waste-Stream Disambiguation — Design

**Status:** Approved for planning
**Branch:** `vedlegg-citation-and-followups` (branched from `compliance`, currently open as [PR #1](https://github.com/HazardousWasteMan/WasteManagement/pull/1); this is item 3 of 4 disclosed follow-ups, following item 2's Vedlegg/annex addressing)
**Builds on:** the unit-based leachate detection and liquid-row exclusion added in the compliance branch's final review fixes (`lib/hp-classification/classify-sample.ts`).

## Purpose

`unitsIndicateLeachate` and the liquid-row-exclusion-from-classification logic in `classifySample` both treat any result row reporting a liquid-concentration unit (`mg/l`-class) as evidence of a leachate/eluate test, not real total-content data. This is correct for a solid sample whose report also carries a leaching-test table (the eluate row is a re-reporting, not the analyte's real classification-relevant value). It is **wrong** for a genuinely liquid waste stream — a sample that IS liquid, not a solid with a leachate extract — whose real, legitimate total-content basis is naturally reported in mg/l. Today, both mechanisms silently strip or gate that sample's only real classification data with no way to tell the two cases apart, and (per the design that added the exclusion) this exact risk was disclosed as a known, deferred gap rather than solved.

`SampleMetadata.physicalState` (`"solid" | "liquid" | "powder"`) is a real, already-existing field — already trusted for a real classification computation (`hazard.ts:119`'s ASP1 applicability check) — flagged as the likely disambiguator but never wired into this specific decision.

## Research: is `physicalState` reliable enough to gate this decision?

`physicalState` is populated two different ways depending on extraction pipeline, and their reliability differs:

- **Anthropic pipeline** (`lib/hp-classification/extract.ts`): a first-class LLM-extracted field (`"solid" | "liquid" | "powder" | null`) — a direct judgment, no derivation.
- **Datalab pipeline** (`lib/bk-skjema/from-datalab.ts:102-104`): *derived* from a raw `fysisk_form` string field, itself constrained by the extraction schema's own prompt (`lib/bk-skjema/datalab.ts:317`) to be exactly one of three Norwegian words: "fast, flytende eller pulver". The current regex (`/flyt|liquid/` → liquid, `/pulver|powder/` → powder, else "solid") already anticipates an English slip, but has no coverage for an Italian slip — and the older Anthropic pipeline's own prompt explicitly expects "Italian or Norwegian format" source reports, so a model occasionally mirroring the source document's own language instead of the requested Norwegian word is a real, plausible failure mode, not a hypothetical one.

**Decision (confirmed with the user):** harden the Datalab-side regex alongside wiring `physicalState` into the classification bypass, rather than trusting an under-covered signal. Scope stays concrete and defensible — cover the specific, known-real slip cases this pipeline's own stated inputs (Italian + Norwegian reports) call for, not an open-ended list of synonyms.

## Design

**1. Harden `fysisk_form` keyword matching (`lib/bk-skjema/from-datalab.ts`):**
```typescript
const physicalState: SampleMetadata["physicalState"] =
  /flyt|liquid|liquido|væske/.test(physical) ? "liquid" :
  /pulver|powder|polvere/.test(physical) ? "powder" : "solid";
```
Adds: Italian `liquido` (liquid) and `polvere` (powder) — the direct Italian equivalents of the two keywords already covered in English/Norwegian, matching this pipeline's own stated real input languages — and the Norwegian noun form `væske` (liquid), a common alternative to the schema-requested adjective `flytende`. `physical` is already lowercased before this test (unchanged). No change to the `"powder"`/default-`"solid"` structure — "fast" (solid) still correctly falls to the default, matching the schema's own literal requested word.

**2. Bypass leachate detection for a confirmed liquid sample (`lib/hp-classification/classify-sample.ts`):**

Two call sites change, both gated the same way — `metadata.physicalState === "liquid"` skips the unit-based interpretation entirely, treating mg/l as the sample's real, legitimate basis rather than leachate evidence:

- `unitFlaggedLeachingOnly`: becomes `metadata.physicalState === "liquid" ? false : unitsIndicateLeachate(results)`. A liquid sample never gates to `isHazardous: null` purely because its results are reported in mg/l — that's expected for a liquid, not evidence of a leachate/eluate re-reporting.
- `resultsForClassification`: becomes `metadata.physicalState === "liquid" ? results : results.filter(r => !LIQUID_UNIT_PATTERN.test(r.unitRaw))`. A liquid sample's mg/l rows are never excluded from classification — they ARE its total-content basis.

**What does NOT change:** `keywordFlaggedLeachingOnly` (the `ristetestUtfort`/`totalinnholdUtfort` keyword gate) is untouched and orthogonal — a liquid waste stream can still genuinely have only a leaching sub-test performed on it with no real total-content analysis (the LLM's own explicit flags say so), and that case must still gate exactly as it does today, physicalState notwithstanding. This design only bypasses the *unit-based* interpretation of mg/l, not the keyword-based signal.

## Explicitly disclosed, not solved by this spec

- `physicalState`'s Datalab-side derivation remains keyword-regex-based even after hardening — a sufficiently unusual `fysisk_form` phrasing (in a language or wording this pipeline hasn't seen) could still default to `"solid"` and miss the bypass. This spec narrows the known gap to the concrete cases this pipeline's own stated inputs call for; it does not make the signal infallible.
- No new confidenceFlags note is added when the bypass fires (physicalState === "liquid" skipping the unit checks) — the sample classifies normally and shows no special note, matching how a normal solid sample already classifies with no note. This is a deliberate scope decision: the bypass restores normal classification behavior for a case that should never have been treated specially in the first place, not a new special case needing its own disclosure.

## Testing

- `from-datalab.ts`'s physicalState derivation: unit tests for `liquido` → `"liquid"`, `polvere` → `"powder"`, `væske` → `"liquid"`, alongside regression coverage for the existing `flytende`/`pulver`/`fast`/`liquid`/`powder` cases (all must still resolve identically).
- `classify-sample.ts`: a real regression test proving a genuinely liquid sample (`physicalState: "liquid"`, results in mg/l for a real HP7/H350-classified analyte at a real hazardous concentration) now classifies correctly (`isHazardous: true`) instead of gating to `null` or losing its data — the direct fix for the disclosed risk.
- A test proving the bypass is genuinely scoped to `physicalState === "liquid"` only: a `physicalState: "solid"` sample with the same mg/l data still gates/excludes exactly as before (no regression to the mixed-report and unit-majority fixes from the prior cycle).
- A test proving `keywordFlaggedLeachingOnly` still gates a liquid sample when the LLM's own flags explicitly say leaching-only (`ristetestUtfort: true`, `totalinnholdUtfort: false`), confirming the bypass is scoped to the unit-based signal only, not a blanket "liquid samples never gate" rule.
