# Wizard Small Fixes — Design Spec

Three small, independent fixes to the classification wizard, bundled into one spec because each
is too small to warrant its own cycle, but kept as separable tasks in the implementation plan.

## Fix 1: Duplicate React key in the sample-picker (`nitrati` warning)

**Problem:** `components/wizard/SampleSelectionStep.tsx` renders one `<Button>` per detected
sample, keyed by `sample.sampleIdentifier` (`lib/hp-classification/extract.ts`'s multi-sample
detection prompt already instructs the extracting LLM that identifiers "must ... uniquely
distinguish this sample from any others in the same document," but nothing enforces that
server-side — a messy or ambiguous real document can still produce two detected samples sharing
one identifier, as observed with `"nitrati"`). When that happens, React logs "Encountered two
children with the same key" and may duplicate or drop a button.

**Fix:**
- Change the list key to the array index (`key={i}`), which is always unique regardless of what
  extraction returns — eliminates the crash/warning unconditionally.
- When two or more samples in the same detected list share an identifier, disambiguate the
  *displayed* label only (not the value passed to `/api/extract-sample`, which still uses the
  real `sampleIdentifier` string) by appending `" (N)"` (1-indexed occurrence count among samples
  sharing that identifier) — e.g. `"nitrati (1)"`, `"nitrati (2)"` — so the user can still tell
  them apart and pick the intended one. Samples with a unique identifier show no suffix.

**Non-goals:** No change to the extraction prompt or to `/api/extract-sample`'s request payload
(`sampleIdentifier` is still sent as-is on `handlePick`) — this is a rendering-layer fix only.
Improving the LLM prompt to reduce duplicate identifiers in the first place is a real follow-up,
but out of scope here: this fix guarantees correctness regardless of what extraction returns,
which a prompt tweak alone could never fully guarantee.

## Fix 2: Add "powder" as a physical state

**Problem:** `physicalState` is typed `"solid" | "liquid"` everywhere it appears
(`lib/hp-classification/types.ts`'s `SampleMetadata`, `lib/hp-classification/extract.ts`'s LLM
extraction schema, `components/wizard/Wizard.tsx`'s `ExtractedMetadata`,
`components/wizard/ExtractionReviewStep.tsx`'s dropdown). Powder samples (a real, common physical
form for waste materials, e.g. cement dust, ash) have no correct option today — they'd have to be
misclassified as "solid" or left blank.

**Fix:** Extend the type to `"solid" | "liquid" | "powder"` in all four locations above, and add a
`<option value="powder">powder</option>` to `ExtractionReviewStep.tsx`'s physical-state `<select>`.

**Hazard-logic impact:** none required. Grepped every use of `metadata.physicalState` in
`lib/hp-classification/hazard.ts` — the only one is `hazard.ts`'s HP5 aspiration-toxicity
carve-out (`metadata.physicalState === "liquid" && ...`), which already treats anything that
isn't `"liquid"` identically. `"powder"` falls through exactly like `"solid"` does today —
correct real-world behavior (aspiration toxicity's Asp. Tox. 1 carve-out is liquid-specific by
definition), not an oversight to patch.

## Fix 3: HP screening shows which chemicals triggered each HP

**Problem:** `lib/hp-classification/hazard.ts`'s `classifyHazard` computes each HP's outcome using
patterns like `results.some(r => r.hStatement === "H350" && ...)` or summed thresholds — the
boolean result is kept, but which specific substance(s) contributed is discarded. The wizard's
results screen (`components/wizard/ClassificationResultsStep.tsx`) shows "HP7: Triggered" with no
way to see which analyte caused it, which matters for review and for explaining the classification
to a customer.

**Fix:** Add a new field to `HazardClassification`:

```ts
triggeringSubstancesByHp: Record<string, string[]>;
```

Populated only for HPs whose outcome derives from substance-level result data, with the real
`substanceName`s (from `NormalizedResultWithClp`) that contributed to that HP being `true`:
**HP4, HP5, HP6, HP7, HP8, HP10, HP11, HP13, HP14**. A key is present only when at least one
substance contributed (mirroring the existing codebase convention of omitting boolean flags that
would just be `false`/empty — see `missingEnglishTranslation` in the EAL translation work). HP1-3
are lab-test-based (`TestResult`, no substance ever "triggers" them) and HP9/HP12/HP15 are
case-specific/non-automatable — none of these six get an entry, since there's nothing real to
attribute.

Where an HP already computes a per-substance filter as an intermediate step (e.g. HP7's `results
.some(r => r.hStatement === "H350" || ...)`), capture the substances passing that same filter
condition rather than re-deriving it — avoids drift between what's counted and what's displayed.
For sum-based HPs (HP6, HP10, HP14) where several substances jointly cross a threshold, all
substances contributing to the winning sum are listed (not just the one that tipped it over) —
this matches how a reviewer would actually want to see it: "these are the substances whose H314
concentrations summed past the HP8 threshold," not an arbitrary single substance.

`classify-sample.ts` requires no change — it already returns the whole `HazardClassification`
object from `classifyHazard` unmodified.

**UI change:** `ClassificationResultsStep.tsx`'s HP1–HP15 list, for each row where
`hazard.triggeringSubstancesByHp[hp]` has entries, shows a small caption under the row, e.g.
`Triggered by: cadmium, lead`. Rows with no entry (untriggered HPs, test-based HPs, case-specific
HPs) show nothing extra, same as today.

## Testing

- Fix 1: a unit or component-level test asserting no duplicate-key scenario crashes rendering, and
  that two same-identifier samples get distinguishable displayed labels (`"nitrati (1)"` /
  `"nitrati (2)"`) while a real API call still uses the unsuffixed identifier.
- Fix 2: `hazard.test.ts` gets a case asserting `physicalState: "powder"` behaves identically to
  `"solid"` for HP5 (i.e., the Asp. Tox. 1 carve-out does not apply). Type-level: the build/tsc
  pass confirms no `physicalState` usage site was missed.
- Fix 3: `hazard.test.ts` gets cases for each of the 9 substance-attributable HPs confirming the
  real substance name(s) expected to trigger a known scenario appear in
  `triggeringSubstancesByHp[hp]`, and that untriggered / test-based / case-specific HPs have no
  entry for that HP.
