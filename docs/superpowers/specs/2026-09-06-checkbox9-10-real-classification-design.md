# Checkbox9/Checkbox10 Real Classification — Design

**Status:** Approved for planning
**Branch:** `vedlegg-citation-and-followups` (second of three follow-on items this cycle — RLS done, this next, then seed-lovdata rate-limit retry — from PR #1's disclosed follow-ups)
**Builds on:** `lib/hp-classification/classify-sample.ts`'s tri-state `isHazardous` pattern (already established across this branch's earlier work — leaching-only gate, unit-based gate, liquid-stream gate all produce `isHazardous: null`).

## Purpose

Checkbox9 ("Innhold av farlige stoffer: Nei") and Checkbox10 ("Innhold av farlige stoffer: Ja") in `lib/bk-skjema/form-map.ts` are hardcoded — Checkbox9 is always `check: false`, Checkbox10 is always `check: true` — never reading `s.isHazardous` or any real classification data. Confirmed via the real PDF field-map (`bk/field-map-raw.json`): these two checkboxes sit in the same form row as TOC%/Glødetap%, with the literal label context "Innhold av farlige stoffer: Nei/Ja (jfr. analyserapport)" — "does the lab analysis report show a detectable hazardous substance at all." This is a narrower, different question from `isHazardous` (whether the waste as a whole crosses HP1-15 thresholds) — Checkbox10's existing hardcoded note text ("hazardous substances detected above LOQ, though all below HP thresholds") already implicitly assumes this narrower meaning, it's just never checked against real data.

The real signal already exists internally: `classify-sample.ts` builds a local `withClp: NormalizedResultWithClp[]` array (substances detected above LOQ that map to a real CLP hazard classification via `analyteRef`) before calling `classifyHazard`. Whether this array is non-empty is exactly the "innhold av farlige stoffer" answer — it is currently local to `classifySample` and never exposed.

## Design

**1. Expose the signal — `lib/hp-classification/hazard.ts`:** `HazardClassification` gains `hasDetectedHazardousSubstance: boolean | null`.

**2. Compute it in `classify-sample.ts`, not inside `classifyHazard`** (confirmed with the user): `classifyHazard`'s own signature and return shape stay completely untouched — every prior plan on this branch has verified it byte-for-byte unchanged, and this preserves that. `classify-sample.ts` already builds `withClp` in scope right before calling `classifyHazard`; it sets `hasDetectedHazardousSubstance: withClp.length > 0` directly on the `HazardClassification` object `classifyHazard` returns, in the normal (non-gated) path. In every gated path (the leaching-only keyword gate, the unit-based gate, and the liquid-stream gate — all three already return a hardcoded `HazardClassification` before `withClp` is ever built), `hasDetectedHazardousSubstance` is set to `null` — the classification genuinely couldn't run, so the honest answer is "unknown," never a guessed `true`/`false`.

**3. Thread through — `lib/bk-skjema/from-datalab.ts`, `lib/bk-skjema/form-map.ts`:** `BkSource` gains `hasDetectedHazardousSubstance: boolean | null`, set from `classification.hazard.hasDetectedHazardousSubstance` in `from-datalab.ts` — the exact same threading pattern already used for `isHazardous`/`hazardConfidenceFlags`/`hazardConfidenceFlagsNo` immediately above it in that file.

**4. Real Checkbox9/10 — `form-map.ts`:**
```typescript
{ field: "Checkbox9", label: "Innhold av farlige stoffer: Nei", src: "derived",
  check: s.hasDetectedHazardousSubstance === false,
  note: s.hasDetectedHazardousSubstance === null ? "GAP: classification could not run — see TextField38" : undefined },
{ field: "Checkbox10", label: "Innhold av farlige stoffer: Ja", src: "derived",
  check: s.hasDetectedHazardousSubstance === true,
  // legalCitation/legalCitationKey/note logic below UNCHANGED from today — this task only
  // changes `check`, which was the hardcoded part; the note already correctly names a real
  // citation when one resolves and falls back to a plain note otherwise.
  legalCitation: s.legalCitations?.["eal-legal-basis"] ?? null,
  legalCitationKey: "eal-legal-basis",
  note: s.legalCitations?.["eal-legal-basis"]?.citations[0]
    ? `hazardous substances detected above LOQ, though all below HP thresholds. Rettslig grunnlag: ${s.legalCitations["eal-legal-basis"]!.citations[0].label}.`
    : "hazardous substances detected above LOQ, though all below HP thresholds" },
```

**Gated-sample handling (confirmed with the user):** when `hasDetectedHazardousSubstance` is `null` (the sample was gated before any substance-level classification could run), BOTH checkboxes stay unchecked, with a `GAP:` note on Checkbox9 — matching this codebase's existing convention for fields the classification genuinely can't answer (e.g. Checkbox11-32's real GAP notes), never guessing Ja or Nei for a question the underlying classification never actually answered. This is a deliberate, real answer for a checkbox pair that is binary on the physical paper form (no third option exists there) — the honest representation of "unknown" on a binary form is leaving both boxes unchecked with a note explaining why, the same pattern this codebase already uses elsewhere.

## Explicitly disclosed, not solved by this spec

- `classifyHazard` itself remains completely untouched — this spec deliberately keeps the new signal's computation in `classify-sample.ts`, not inside it, per the confirmed design choice above.
- Checkbox10's existing note text is a fixed string ("hazardous substances detected above LOQ, though all below HP thresholds") that doesn't distinguish "many substances detected" from "exactly one, barely above LOQ" — this spec only fixes `check`, which was the actually-hardcoded (and therefore wrong) part; the note's wording is unchanged and out of scope.

## Testing

- `classify-sample.ts`: real regression tests proving `hasDetectedHazardousSubstance` is `true` for a sample with a real detected hazardous substance (reuse the existing `test-carcinogen`/H350 fixture pattern already used throughout this file), `false` for a sample whose results contain no CLP-classified substance above LOQ, and `null` for all three existing gated paths (the keyword leaching-only gate, the unit-based gate, and the liquid-stream gate) — one test per gate, confirming each already-existing gate now also sets this new field to `null`.
- `form-map.ts`: Checkbox9/Checkbox10 tested across all three `hasDetectedHazardousSubstance` states (`true`/`false`/`null`), confirming `check` and the GAP note behave exactly as specified, and that Checkbox10's existing citation/note logic is unaffected by this change (regression coverage for the pre-existing behavior).
