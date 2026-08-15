# Custom Chapter Reach Gap — Design Spec

## Problem

`ORIGIN_OPTIONS` (`lib/hp-classification/origin-options.ts`) curates 25 real origin/process
descriptions spanning only 7 of the EAL catalogue's 20 real top-level chapters (17, 13, 14, 08,
15, 16, 20). This list backs two things in `components/wizard/ExtractionReviewStep.tsx`:

1. The primary origin-process type-ahead (a `<datalist>` of curated descriptions).
2. The **custom-chapter fallback** `<select>`, shown when the user types an origin process that
   doesn't match any curated option. This fallback exists specifically so a genuinely novel
   origin process can still be classified — the user picks the EAL chapter by hand instead of
   relying on a curated mapping.

The fallback dropdown's options are drawn from `ORIGIN_OPTIONS` too — the exact same 7-chapter
list it exists to work around. A user whose real origin process belongs to any of the other 13
real chapters (01–07, 09–12, 18, 19 — mining/quarrying, agriculture, wood processing, leather/
textile, petroleum refining, inorganic/organic chemical processes, photographic industry,
thermal processes, metal surface treatment/hydrometallurgy, metal/plastics shaping, medical/
veterinary waste, waste-management-facility waste) has no way to select a chapter for it at all,
even though `lib/data/eal-koder-full.json` has full, real, non-gap data for every one of those
chapters. This is a hard reach limit on the escape hatch that's supposed to have no reach limit.

Server-side, `app/api/classify/route.ts` independently re-validates any submitted `customChapter`
against the same `ORIGIN_OPTIONS.chapter` set. Widening only the UI without also widening this
check would mean a user could select the correct chapter and still get rejected at submission.

## Fix

Add a new, real, complete constant listing all 20 EAL top-level chapters, each with its real
English title — sourced directly from `lib/data/eal-koder-full.json`'s `nivaa: 1` entries (all 20
already have a real, non-gap `beskrivelseEn`, verified during this design). Use this new constant
to widen the custom-chapter fallback's reach to the full real catalogue, and to widen the
server-side validation to match. The primary type-ahead (`ORIGIN_OPTIONS`) is untouched — this
is strictly a fix to the fallback's reach, not a redesign of the curated list.

### Data

New exported constant in `lib/hp-classification/origin-options.ts`:

```ts
export interface EalChapter {
  chapter: string; // 2-digit EAL chapter code, e.g. "05"
  label: string;   // real English chapter title, sourced from eal-koder-full.json's nivaa:1 beskrivelseEn
}

export const EAL_CHAPTERS: EalChapter[] = [
  { chapter: "01", label: "Wastes resulting from exploration, Mining, Quarrying, Physical and Chemical treatment of Minerals" },
  { chapter: "02", label: "Wastes from Agriculture, Horticulture, Aquaculture, Forestry, Hunting and Fishing, Food Preparation and Processing" },
  { chapter: "03", label: "Wastes from Wood Processing and the Production of Panels and Furniture, Pulp, Paper and Cardboard" },
  { chapter: "04", label: "Wastes from the Leather, Fur and Textile Industries" },
  { chapter: "05", label: "Wastes from the Petroleum Refining, Natural Gas Purification and Pyrolitic Treatment of Coal" },
  { chapter: "06", label: "Wastes from Inorganic Chemical Processes" },
  { chapter: "07", label: "Wastes from Organic Chemical Processes" },
  { chapter: "08", label: "Wastes from the MFSU of Coatings (Paints, Varnishes and Vitreous Enamels), Adhesives, Sealants and Printing Inks" },
  { chapter: "09", label: "Wastes from the Photographic Industry" },
  { chapter: "10", label: "Waste From Thermal Processes" },
  { chapter: "11", label: "Wastes from Chemical Surface Treatment and Coating of Metals and Other Materials, Non- Ferrous HydroMetallurgy" },
  { chapter: "12", label: "Wastes from Shaping and Physical and Mechanical Surface Treatment of Metals and Plastics" },
  { chapter: "13", label: "Oil Wastes and Wastes of Liquid Fuels (except edible oils and those in chapters 05,12 and 19)" },
  { chapter: "14", label: "Waste Organic Solvents, Refrigerants and Propellants (except 07 and 08)" },
  { chapter: "15", label: "Waste Packaging, Absorbents, Wiping Cloths, Filter Materials and Protective Clothing Not Otherwise Specified" },
  { chapter: "16", label: "Wastes Not Otherwise Specified in the List" },
  { chapter: "17", label: "Construction and Demolition Wastes (including Excavated Soil from Contaminated Sites)" },
  { chapter: "18", label: "Wastes From Human or Animal Health Care and/or Related Research (except kitchen wastes not arising from immediate health care)" },
  { chapter: "19", label: "Wastes from Waste Management Facilities, Off-Site Waste Water Treatment Plants and the Preparation of Water for Human Consumption and Water for Industrial Use" },
  { chapter: "20", label: "Municipal Wastes (Household Waste and Similar Commercial, Industrial and Institutional Wastes) Including Separately Collected Fractions" },
];
```

This list is hand-transcribed from real data (verified against `eal-koder-full.json` during this
design) rather than computed at runtime from the JSON import — 20 chapters never change, and a
static, reviewable constant keeps this file's existing style (`ORIGIN_OPTIONS` is also a static
array) and avoids adding a new runtime dependency on the full 979-entry catalogue to this file.

### Component change

`components/wizard/ExtractionReviewStep.tsx`: the custom-chapter `<select>`'s `.map()` currently
iterates `ORIGIN_OPTIONS`; change it to iterate `EAL_CHAPTERS` instead. Its rendered `<option>`
`key`/`value` (`option.chapter`) and label formatting (`{option.label} — {chapter.slice(0,2)}
{chapter.slice(2)}`) stay structurally the same, adjusted for `EAL_CHAPTERS`' 2-digit-only
`chapter` field (no `.slice(2)` remainder to append, since chapter is already exactly 2 digits —
render just the chapter code, not a split 2+2 digit group). The primary type-ahead `<datalist>`
is untouched.

### Server-side validation change

`app/api/classify/route.ts`: replace the `ORIGIN_OPTIONS.some(o => o.chapter === customChapter)`
check with `EAL_CHAPTERS.some(c => c.chapter === customChapter)`, importing `EAL_CHAPTERS`
alongside the existing `ORIGIN_OPTIONS`/`withCustomOrigin` import.

### Non-goals

- No change to `ORIGIN_OPTIONS`, the primary type-ahead, or the curated-origin matching logic in
  `deriveOriginFromLabCode`/`suggestOriginProcess`.
- No change to `withCustomOrigin`'s merge logic — it already accepts any `(originProcess,
  chapter)` pair by construction; only the set of *offerable* chapters was too narrow.
- No sub-chapter (4-digit, nivaa-2) granularity for the fallback. `ORIGIN_OPTIONS` uses 4-digit
  codes because each entry is a specific curated process description; `EAL_CHAPTERS` intentionally
  stays at the 2-digit chapter level because the fallback's job is "get an otherwise-unclassifiable
  sample into approximately the right chapter for manual review," not to replace the curated list's
  precision. `assignEalCode` already selects among the chapter's real leaf codes and flags
  ambiguity when there are multiple hazardous/non-hazardous nivaa-3 candidates (see
  `eal.ts`/`eal.test.ts`) — that mechanism is unaffected and continues to do the fine-grained work.

## Testing

- New unit test(s) confirming `EAL_CHAPTERS` has exactly 20 entries, and that its chapter codes
  are exactly `"01"`–`"20"` in order (a static array is trivial to typo — this test would catch
  it).
- New unit test confirming every `EAL_CHAPTERS` label matches the real
  `eal-koder-full.json` nivaa-1 `beskrivelseEn` for that chapter (guards against transcription
  drift between this file and the source of truth).
- API-route test: a previously-invalid `customChapter` (e.g. `"05"`) is now accepted (200, not
  400) when paired with a novel `originProcess` not in `ORIGIN_TO_CHAPTER_LOOKUP`.
- API-route test: an actually-invalid chapter code (e.g. `"99"`, not a real chapter) is still
  rejected (400) — confirms the validation still rejects nonsense, just against the wider real
  set.
