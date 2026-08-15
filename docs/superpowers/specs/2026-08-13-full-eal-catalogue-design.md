# Full EAL Catalogue & Expanded Origin/Process Coverage

Date: 2026-08-13

## Context

The classification engine's EAL (European Waste Catalogue) code assignment currently only
knows about chapter 17 (construction/demolition waste) — `lib/hp-classification/eal.ts`
imports `lib/data/eal-koder-kapittel17.json`, a hand-transcribed 47-entry subset. This is the
"origin_process → EAL chapter lookup starts empty" gap from the original project brief: only
8 origin/process options exist in `lib/hp-classification/origin-options.ts`, all mapping into
chapter 17.

The user supplied two real source files during brainstorming:
- `Avfallstoffnummer.csv` — the full 117-entry official Norwegian avfallsstoffnummer list
  (already confirmed, consistent with earlier session research, to have no EAL cross-references
  — not used further in this slice).
- `EALKoder.csv` (exported from `EALKoder.numbers`) — the **complete official EAL/EWC code
  list in Norwegian**, all 20 chapters, 1,275 rows total (1,126 level-3 entries, 129 level-2,
  20 level-1). Verified consistent with the existing chapter-17 subset already in the repo
  (identical codes, descriptions, and hazard flags for every chapter-17 entry present in both).

This is real, sourced, official data — not invented. This slice loads the full dataset and
uses it to (a) let `assignEalCode` resolve any of the 20 chapters instead of just 17, and
(b) add real origin/process options for 7 chapters the user identified as relevant to their
customer base: 08 (paints/adhesives), 13 (oils), 14 (organic solvents/refrigerants/propellants),
15 (packaging/absorbents), 16 (miscellaneous/WEEE/batteries), 17 (construction — already
covered), 20 (municipal waste).

## Scope of this slice

**In scope:**
- Parse `EALKoder.csv` into `lib/data/eal-koder-full.json`, replacing
  `lib/data/eal-koder-kapittel17.json`, covering all 20 chapters.
- Update `eal.ts`'s import and the two other consumers of the old file
  (`origin-options.test.ts`'s import/assertion, and a stale comment in `origin-options.ts`).
- Add 17 new origin/process options across chapters 08, 13, 14, 15, 16, 20 (9 + 8, per the
  tables below), bringing the total from 8 to 25.
- Document two real "all-one-way" chapter quirks (13/14 are hazardous-only, 2003 is
  non-hazardous-only) with code comments and tests, so they're never mistaken for bugs later.
- Extend `origin-options.test.ts` and `eal.test.ts` to cover the new data.

**Explicitly out of scope:**
- Any change to `assignEalCode`'s matching/ambiguity logic itself — it already works
  generically by chapter-prefix + hazard-flag filtering; this slice only feeds it more data.
- Expanding `analyte-reference.json` (substance/CAS mapping) — a separate, later spec per the
  user's own prioritization.
- The "smart chemical-matching/lookup" feature the user described — also a separate, later
  spec, and one that will benefit from this slice's fuller EAL data once it exists.
- Any chapters beyond the 7 named above — the remaining 13 chapters (01, 02, 04, 05, 06, 07,
  09, 10, 11, 12, 18, 19) are present in the full data file, so the data itself is ready, but
  get no dedicated origin/process options in this slice. **Correction from an earlier draft of
  this spec:** the `customChapter` manual override does NOT already reach these chapters today —
  both `app/api/classify/route.ts` and `ExtractionReviewStep.tsx`'s custom-chapter picker
  validate against `ORIGIN_OPTIONS` only, so all 112 real level-2 subchapters except the 25
  curated ones remain genuinely unreachable by any user path until a future slice either widens
  that validation or adds more curated options.
- Touching `Avfallstoffnummer.csv` or the existing avfallsstoffnummer-EAL crosswalk — unrelated
  to this slice, already handled in Stage 4.

## Data — `lib/data/eal-koder-full.json`

Built by parsing `EALKoder.csv` (semicolon-delimited, UTF-8 BOM, header row repeated per
record block — an export quirk of the source Numbers file). Same shape as today's file:

```json
{ "nivaa": 1 | 2 | 3, "kode": "170101", "beskrivelse": "Betong", "farlig": true | false }
```

**Exclusion rule:** entries with `Registrerbar !== "Ja"` are dropped. Verified this maps
**exactly** to "Utgått" (deprecated) status across all 1,126 level-3 rows — zero mismatches
either direction — so it's used as the (cleaner, boolean) exclusion rule instead of matching
on the description text, while producing the identical excluded set the existing chapter-17
file's own precedent already established.

Result: 20 chapters, ~850 non-deprecated entries total (level 1 + 2 + 3 combined), all real
government-code data.

## Logic — `eal.ts`

**No behavior change.** `assignEalCode`'s candidate filter
(`e.nivaa === 3 && e.kode.startsWith(chapter) && e.farlig === isHazardous`) already works for
any chapter — it only needs a richer `ealKoder` import. The one-line change:

```typescript
import ealKoder from "../data/eal-koder-full.json";
```

## `origin-options.ts` — 17 new entries

Chapters 13/14 (oils, solvents, refrigerants — both entirely hazardous-only in the real
catalogue, no non-hazardous mirror codes exist):

| value | chapter |
|---|---|
| hydraulic oil waste | 1301 |
| engine, gear, or lubricating oil waste | 1302 |
| transformer or heat-transfer oil waste | 1303 |
| bilge oil waste | 1304 |
| oil/water separator content | 1305 |
| liquid fuel waste (heating oil, diesel, petrol) | 1307 |
| other oil waste, not otherwise specified | 1308 |
| organic solvent, refrigerant, or propellant waste | 1406 |

Chapters 08/15/16/20 (real mirror pairs exist for all except 2003, which is non-hazardous-only):

| value | chapter |
|---|---|
| paint or varnish production/use/removal waste | 0801 |
| adhesive or sealant (incl. waterproofing) waste | 0804 |
| packaging waste (incl. separately collected) | 1501 |
| absorbents, filter materials, wiping cloths, or protective clothing | 1502 |
| electrical or electronic equipment waste (WEEE) | 1602 |
| gas in pressurized containers or discarded chemicals | 1605 |
| batteries and accumulators | 1606 |
| separately collected municipal waste fraction | 2001 |
| other municipal waste | 2003 |

**Documented quirks (code comments + tests, not bugs to "fix"):**
- Chapters 1301–1308 and 1406: entirely hazardous. Selecting one of these origins with
  `isHazardous=false` correctly yields `"no matching EAL code found in chapter …"` — there is
  no non-hazardous code to fall back to in the real catalogue.
- Chapter 2003: entirely non-hazardous. Selecting it with `isHazardous=true` correctly yields
  the same "no matching EAL code found" message, for the opposite reason.

Both existing behaviors already handle this correctly (`assignEalCode` returns a clear "no
match" message rather than guessing) — this slice adds comments and tests documenting *why*,
so a future contributor doesn't mistake the empty-candidate case for a data bug and "fix" it
into a wrong guess.

## Testing

- `origin-options.test.ts`: extend the existing "every chapter code corresponds to a real
  nivaa:2 entry in the EAL data" check to cover all 25 options against the new full file
  (mechanical extension of an existing test, not new logic).
- `eal.test.ts`: add cases for
  - a hazardous-only chapter (1301) resolving correctly for `isHazardous=true`, and correctly
    reporting "no matching EAL code" (not a guess) for `isHazardous=false`;
  - the non-hazardous-only chapter (2003) resolving correctly for `isHazardous=false`, and
    correctly reporting "no matching EAL code" for `isHazardous=true`;
  - one of the newly added chapters with real hazardous/non-hazardous mirror pairs (e.g. 1602
    WEEE) resolving both directions correctly, as a sanity check that the richer data file
    didn't change existing chapter-17 behavior for a chapter with genuine mirror pairs.
