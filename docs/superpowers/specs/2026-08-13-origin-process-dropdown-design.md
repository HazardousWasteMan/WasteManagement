# Origin/Process Searchable Dropdown

Date: 2026-08-13

## Context

The origin/process field in `ExtractionReviewStep.tsx` is currently a free-text input, and the backing lookup table (`ORIGIN_TO_CHAPTER_LOOKUP` in `app/api/classify/route.ts`) has exactly one real entry ("escavo terre e rocce" → chapter 1705), left over from the Italian sample fixture. This field is never extracted or inferred from the PDF by design — `decision_engine.md`'s Stage 0 requires it as a real, honest user input, since a lab report never states what generated the waste. That constraint is unchanged by this spec; this is purely a UX and lookup-table-coverage improvement on the human-input side.

## Scope of this slice

**In scope:**
- Expanding `ORIGIN_TO_CHAPTER_LOOKUP` from 1 entry to real, English-labeled entries covering all of EAL chapter 17's construction/demolition subchapters (transcribed from `lib/data/eal-koder-kapittel17.json`, no invented data).
- Replacing the free-text origin-process input with a searchable combobox showing each option as "Name — EAL chapter code".
- A "custom" fallback: user types their own description and explicitly picks which chapter it belongs to, so a custom entry always resolves to a real EAL code rather than silently failing lookup.

**Explicitly out of scope:**
- Extraction or inference of origin/process from the PDF — never done, per the project's foundational honesty constraint (Stage 0 halts rather than guesses).
- Persisting a custom entry as a new permanent dropdown option across requests/sessions — a custom mapping is scoped to the one submission it was entered for, no database or config-file write.
- Expanding coverage beyond EAL chapter 17 (construction/demolition waste) — the app's only real validated sample (the Italian excavated-soil report) and its whole surrounding design (facility permits, matching) are chapter-17-scoped; other chapters are a different, undesigned scope.

## Data — expanded lookup table

Real chapter-17 origin types, transcribed from `lib/data/eal-koder-kapittel17.json`'s level-2 subchapter descriptions, translated to English labels:

| Dropdown label | EAL chapter | Norwegian source description |
|---|---|---|
| Excavated soil or rock | 1705 | Jord (herunder overskuddsmasse fra forurensede byggeplasser), stein og mudringsslam |
| Concrete, brick, tile, or ceramic waste | 1701 | Betong, murstein, takstein, keramikk |
| Wood, glass, or plastic waste | 1702 | Tre, glass og plast |
| Bituminous mixtures / asphalt | 1703 | Bitumenblandinger, kulltjære og tjæreprodukter |
| Metal waste | 1704 | Metaller (herunder legeringer) |
| Insulation material or asbestos-containing building material | 1706 | Isolasjonsmaterialer og asbestholdige byggematerialer |
| Gypsum-based building material | 1708 | Gipsbaserte byggematerialer |
| Other construction/demolition waste | 1709 | Annet avfall fra bygge- og rivingsarbeid |

Each entry's dropdown display combines label and code: `"Excavated soil or rock — 17 05"`. The underlying `originProcess` value sent to the backend stays a plain string key (e.g. `"excavated soil or rock"`) matching `ORIGIN_TO_CHAPTER_LOOKUP`'s keys — no schema change to `SampleMetadata.originProcess` (still `string | null`).

## UI — searchable combobox

`ExtractionReviewStep.tsx`'s origin-process control becomes a searchable combobox (typeahead filtering by name or code) rather than a plain `<select>`, given 8+ options. Implementation checks this codebase's actual HeroUI version for the right searchable-select primitive (Autocomplete/Combobox) during planning/implementation rather than assuming an API now — match existing component usage conventions in `components/wizard/*` (e.g. how `Card`/`Chip`/`Tabs` are already imported and used) rather than introducing a new UI pattern.

The last option is always `"Other / custom…"`. Selecting it reveals two additional controls: a free-text field for the custom description, and a required chapter combobox (same 8 real chapters, same "Name — Code" display) — the user must explicitly pick a chapter for a custom entry, the tool never infers one.

## Wiring — request-scoped custom mapping

No backend schema change. When a custom entry is used, `Wizard.tsx`'s POST to `/api/classify` includes both the typed `originProcess` string and the user-picked `chapter` code in the request body (e.g. `{ ..., originProcess: "demolished retaining wall", customChapter: "1705" }`). `app/api/classify/route.ts` merges `{ [originProcess]: customChapter }` into its existing `ORIGIN_TO_CHAPTER_LOOKUP` object for that one request, before calling `classifySample()` — `assignEalCode`'s signature and the lookup's shape (`Record<string, string>`) are both unchanged. When the dropdown's built-in options are used (not custom), no extra field is sent; the existing lookup already has the matching key.

## Testing

- Unit test on the expanded `ORIGIN_TO_CHAPTER_LOOKUP` (or wherever it's extracted to, if moved out of the route file for testability): each of the 8 entries resolves to its stated chapter.
- A test in `app/api/classify/route.ts`'s existing coverage (or a new one, since this route currently has no dedicated test file per the prior slice's finding that this repo doesn't unit-test API routes directly — note whether that's still true and decide accordingly) confirming a custom `originProcess`/`customChapter` pair correctly merges into the lookup and resolves to the right EAL code for that one request, without mutating the base `ORIGIN_TO_CHAPTER_LOOKUP` object for subsequent requests (no shared-mutable-state bug).
- Manual verification: in the local dev server, confirm the combobox shows all 8 real options with correct "Name — Code" labels, typing filters correctly, and both a built-in selection and a custom entry each classify correctly end-to-end.
