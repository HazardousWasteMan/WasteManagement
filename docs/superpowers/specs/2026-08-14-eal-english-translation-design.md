# EAL Catalogue English Translation

Date: 2026-08-14

## Context

`lib/data/eal-koder-full.json` (979 real entries, all 20 EAL/EWC chapters, built earlier this
session from a real Norwegian source) has its `beskrivelse` field in Norwegian only. The user
wants classification results shown in English. Only the level-3 "leaf" entries (`nivaa: 3`,
847 of the 979) currently reach the UI — `lib/hp-classification/eal.ts`'s `assignEalCode`
returns `description: match.beskrivelse` as `eal.description`, displayed directly in the
wizard's classification results step.

A real, machine-readable English source was found and verified during brainstorming: a
21-page "European Waste Catalogue" PDF published by Natural Resources Wales (a UK
environmental regulator), covering all 20 chapters with the same harmonised 6-digit code
structure as the Norwegian source (EUR-Lex's own pages did not return fetchable text, despite
being the nominal primary source). Cross-checked directly: code `170101` = "concrete" in this
English source, matching the Norwegian file's `170101` = "Betong" ("concrete") exactly. The
PDF has a real, `pdftotext`-extractable text layer (confirmed: 1091 lines, machine-parseable —
not requiring manual transcription).

The source has occasional real transcription typos ("nitirc acid", "csludges") and a real,
not-yet-reconciled coverage discrepancy against the Norwegian file's 847 leaf codes (an
automated regex count found 839 distinct codes in the English source during brainstorming —
the ~8-entry gap needs honest reconciliation during implementation, not silent omission or
guessing).

## Scope of this slice

**In scope:**
- Add a new `beskrivelseEn: string` field to all 979 entries in `eal-koder-full.json`
  (chapters, subchapters, and leaf codes — not just the 847 currently-displayed leaf codes),
  parsed from the real English source via an extended build script.
- Correct obvious, unambiguous transcription typos in the source (verified against the real
  Norwegian meaning) — e.g. "nitirc acid" → "nitric acid".
- Reconcile the ~8-entry coverage gap between the two sources: for any Norwegian entry with no
  confident English match, flag it explicitly (do not guess a translation, do not silently
  drop the entry — the Norwegian `beskrivelse` stays as a fallback for that entry only, with a
  clear marker distinguishing "genuinely translated" from "gap, Norwegian fallback").
- Switch `eal.ts`'s `assignEalCode` to return the English description
  (`match.beskrivelseEn ?? match.beskrivelse`) instead of the Norwegian one.

**Explicitly out of scope:**
- Removing or altering the existing Norwegian `beskrivelse` field — this is additive
  (dual-language data), not a replacement/migration.
- Translating `origin-options.ts`'s labels — these are already hand-written English, sourced
  from (not copied from) the Norwegian catalogue; unaffected by this change.
- Any change to `assignEalCode`'s matching/ambiguity logic, chapter-filtering, or any other
  part of the classification engine — only the returned description string's language changes.
- Any change to `Avfallstoffnummer.csv`-related data, the avfallsstoffnummer/EAL crosswalk, or
  facility-matching logic — unrelated to this slice.

## Data — build script extension

`scripts/build-eal-koder-full.py` gains a second parsing pass (does not replace the existing
Norwegian-CSV parsing logic) that reads the real English source text (the PDF's extracted text
layer, committed to the repo alongside the existing Norwegian CSV for reproducibility) and
builds a `{code: englishText}` map:

- Parses the indentation-based hierarchy (chapter / subchapter / leaf lines are distinguishable
  by leading whitespace and code length, matching the visual structure already confirmed during
  brainstorming).
- Merges line-wrapped descriptions (a leaf entry's text can continue onto the next line at the
  same indentation level with no new code prefix) into a single string.
- Recognizes the `*` hazard marker (redundant with the Norwegian file's own `farlig` field,
  used only as a cross-check, not as the source of truth for hazard status — the Norwegian
  file's `farlig` field remains authoritative, unchanged).
- Applies a small, explicit list of manually-verified typo corrections (transcribed during
  implementation, each with the original source text and the correction reasoning documented
  in a code comment — not silent).

The two parsed datasets (existing Norwegian, new English) are merged by `kode`. Every
Norwegian entry gets a `beskrivelseEn` field. Where no confident English match exists, the
implementation must produce an honest, visible signal (e.g. a real `missingEnglishTranslation:
true` marker or equivalent, decided during planning) rather than leaving the gap
indistinguishable from a successful translation.

## Logic — `eal.ts`

One-line change: `description: match.beskrivelse` becomes
`description: match.beskrivelseEn ?? match.beskrivelse` — English when available, honest
Norwegian fallback for the handful of unreconciled gap entries (never a blank or fabricated
string). No other logic in `assignEalCode` changes.

## Testing

- Structural test: every one of the 979 entries has a non-empty `beskrivelseEn` OR is
  explicitly marked as a fallback gap (not both missing and unmarked).
- Real spot-checks: `170101` → `"concrete"`, `010101` → `"wastes from mineral metalliferous
  excavation"` — both already verified against the real source during brainstorming.
- Regression test: the existing chapter-1705 `assignEalCode` tests (soil/rock, real fixture
  data) still pass, now asserting the English description text instead of the Norwegian one.
- A test asserting the real, final count of gap-fallback entries is small and bounded (e.g.
  fewer than 15) — a sanity check that reconciliation actually happened rather than silently
  falling back for most of the file.
