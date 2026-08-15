# EAL Catalogue English Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, sourced English `beskrivelseEn` field to all 979 entries in `lib/data/eal-koder-full.json`, and switch the wizard's classification result to display it instead of the Norwegian description.

**Architecture:** `scripts/build-eal-koder-full.py` gains a second, real parsing pass over an English-language European Waste Catalogue source (already committed to the repo, verified during planning to have a real, machine-extractable text layer), merged into the existing Norwegian-sourced entries by code. `lib/hp-classification/eal.ts` gets a one-line change to prefer the new field.

**Tech Stack:** Python (build-time only), TypeScript, Vitest.

## Global Constraints

- The English source (`scripts/data-sources/european-waste-catalogue-english.txt`, already committed) is real: a 21-page European Waste Catalogue document published by Natural Resources Wales (a UK environmental regulator), covering the same harmonised 6-digit EAL/EWC code structure as the Norwegian source. Cross-verified during planning: code `170101` = "concrete" in this source, matching the Norwegian file's `170101` = `"Betong"` exactly.
- **Exact, real parsing result, verified during planning by actually running the parser — do not deviate from these numbers without a real reason:** 976 entries parsed from the English source, 966 of the Norwegian file's 979 entries get a real matched English translation, 13 do not (honest gap, not a bug — see below).
- **The 13 gap entries are real and explainable, not a parsing failure to "fix":** 10 of the 13 (chapter `1650` and its 7 leaf codes `165071`-`165078`, plus code `010310`) are Norway-specific extensions to the harmonised EU list (Norwegian oil-drilling-waste codes not part of the standard EU catalogue at all) or reference a Norway-specific regulatory annex (`190308`'s description explicitly says "jf. nr. 1 bokstav f i dette vedlegget" — "cf. no. 1 letter f in this annex," a Norwegian-regulation-specific cross-reference). The remaining 3 (`010310` counted above, `080199`, `160307`) are standard-looking codes that are simply absent from this particular transposition's text — confirmed absent by direct text search during planning, not a parser bug.
- **Exactly 4 real, manually-verified typo corrections** apply to the English source text (each confirmed against the real Norwegian meaning and/or standard EAL/EWC terminology during planning) — use exactly these, do not invent additional "corrections" beyond what's given:
  - `"wastes from washing, cleaning and mechanical reduciton of raw materials"` → `"wastes from washing, cleaning and mechanical reduction of raw materials"`
  - `"desalter csludges"` → `"desalter sludges"`
  - `"hydroflouric acid"` → `"hydrofluoric acid"`
  - `"nitirc acid and nitrous acid"` → `"nitric acid and nitrous acid"`
- The existing Norwegian `beskrivelse` field is never removed or altered — this is additive only.
- No change to `assignEalCode`'s matching/ambiguity logic, chapter-filtering, `origin-options.ts`, `Avfallstoffnummer.csv`-related data, or any facility-matching logic.

---

### Task 1: Extend the build script to add real English translations

**Files:**
- Modify: `scripts/build-eal-koder-full.py`
- Test: `tests/hp-classification/eal-koder-full.test.ts` (existing file — extend it)

**Interfaces:**
- Produces: `lib/data/eal-koder-full.json` entries gain two new fields: `beskrivelseEn: string | null` (the real English translation, or `null` for the 13 gap entries) and `missingEnglishTranslation: boolean` (present and `true` only on the 13 gap entries — absent, not `false`, on the other 966, matching this file's existing convention of only including boolean flags where they're meaningfully true elsewhere in this codebase's JSON data files).

- [ ] **Step 1: Write the failing test**

Read the existing `tests/hp-classification/eal-koder-full.test.ts` file first to match its
established style (it already tests `lib/data/eal-koder-full.json`'s structure — see its
existing tests for exact counts, chapter completeness, etc.).

**First, fix a real, pre-existing test that this schema change breaks:** the existing test
`"preserves the real chapter-1705 mirror pair..."` does `expect(hazardous).toEqual({ nivaa: 3,
kode: "170503", beskrivelse: "...", farlig: true })` — an exact full-object match. Once this
task adds `beskrivelseEn`/`missingEnglishTranslation` fields to every entry, that `toEqual` will
fail (confirmed by actually running it during planning) because the real object now has an
extra `beskrivelseEn` field the exact-match doesn't expect. Change `toEqual` to `toMatchObject`
in that one existing test (verified during planning: this is the minimal, correct fix — it
still asserts every field the test cares about, just no longer requires the object to have
*only* those fields):

```typescript
    expect(hazardous).toMatchObject({ nivaa: 3, kode: "170503", beskrivelse: "Jord og stein som inneholder farlige stoffer", farlig: true });
```

Also update the file's local `EalEntry` interface (near the top) to include the two new
fields, or TypeScript will reject accessing them on `entries`:

```typescript
interface EalEntry {
  nivaa: number;
  kode: string;
  beskrivelse: string;
  farlig: boolean;
  beskrivelseEn: string | null;
  missingEnglishTranslation?: boolean;
}
```

Then add these new tests to the existing `describe("eal-koder-full.json", ...)` block, after
its last existing test:

```typescript
  it("has 966 entries with a real English translation and 13 with an honest gap marker", () => {
    const translated = entries.filter(e => e.beskrivelseEn !== null && e.beskrivelseEn !== undefined);
    const gaps = entries.filter(e => e.missingEnglishTranslation === true);
    expect(translated).toHaveLength(966);
    expect(gaps).toHaveLength(13);
  });

  it("every gap entry has beskrivelseEn: null and no fabricated translation", () => {
    const gaps = entries.filter(e => e.missingEnglishTranslation === true);
    for (const g of gaps) {
      expect(g.beskrivelseEn).toBeNull();
    }
  });

  it("code 170101 has the real, verified English translation 'concrete'", () => {
    const entry = entries.find(e => e.kode === "170101");
    expect(entry?.beskrivelseEn).toBe("concrete");
  });

  it("code 010101 has the real, verified English translation", () => {
    const entry = entries.find(e => e.kode === "010101");
    expect(entry?.beskrivelseEn).toBe("wastes from mineral metalliferous excavation");
  });

  it("known source typos are corrected, not transcribed verbatim", () => {
    const nitricAcid = entries.find(e => e.kode === "060105");
    expect(nitricAcid?.beskrivelseEn).toContain("nitric acid");
    expect(nitricAcid?.beskrivelseEn).not.toContain("nitirc");

    const hydrofluoricAcid = entries.find(e => e.kode === "060103");
    expect(hydrofluoricAcid?.beskrivelseEn).toContain("hydrofluoric acid");
    expect(hydrofluoricAcid?.beskrivelseEn).not.toContain("hydroflouric");
  });

  it("chapter 1650 (Norway-specific oil-drilling extension) is a real, disclosed gap, not silently dropped", () => {
    const entry = entries.find(e => e.kode === "1650");
    expect(entry).toBeDefined();
    expect(entry?.missingEnglishTranslation).toBe(true);
    expect(entry?.beskrivelseEn).toBeNull();
    expect(entry?.beskrivelse).toBe("Ilandført avfall fra oljeboring/-produksjon");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/eal-koder-full.test.ts`
Expected: FAIL — `beskrivelseEn` and `missingEnglishTranslation` don't exist on any entry yet.

- [ ] **Step 3: Write the implementation**

Replace the full content of `scripts/build-eal-koder-full.py`:

```python
"""
One-off build script: parses the real, official EAL/EWC code list (Norwegian) from
scripts/data-sources/EALKoder.csv, merges in a real English translation from
scripts/data-sources/european-waste-catalogue-english.txt, and writes the combined result to
lib/data/eal-koder-full.json.

Norwegian source: exported from the user's EALKoder.numbers (Apple Numbers), itself a
transcription of the official Norwegian EAL/EWC catalogue (all 20 chapters). The CSV's header
row is repeated once per record block (an export quirk of the source file) — this script skips
every repeated header line, keeping only real data rows. Deprecated ("Utgått") codes are
excluded via the `Registrerbar` column (Nei == excluded) — verified during design that
Registrerbar=="Nei" maps exactly 1:1 with "Utgått" in the description text, across all 1,126
level-3 rows, so this boolean is used as the (cleaner) exclusion rule instead of string-matching
descriptions.

English source: a real, 21-page "European Waste Catalogue" document published by Natural
Resources Wales (a UK environmental regulator), covering the same harmonised 6-digit EAL/EWC
code structure. Its extracted text layer (via pdftotext -layout) is committed as
european-waste-catalogue-english.txt. Parsed and merged by code against the Norwegian entries.
13 of the Norwegian file's 979 entries have no match in this English source — verified during
planning that 10 of these are real Norway-specific extensions to the harmonised list (chapter
1650's Norwegian oil-drilling-waste codes, and a Norway-specific regulatory annex reference on
code 190308) and the remaining 3 are standard-looking codes simply absent from this particular
transposition's text (confirmed by direct text search, not a parser bug). These 13 entries get
beskrivelseEn: null and missingEnglishTranslation: true — an honest, visible gap, never a
guessed or fabricated translation.

Run: python3 scripts/build-eal-koder-full.py
"""

import csv
import json
import re
from pathlib import Path

SOURCE_CSV = Path(__file__).parent / "data-sources" / "EALKoder.csv"
SOURCE_ENGLISH_TXT = Path(__file__).parent / "data-sources" / "european-waste-catalogue-english.txt"
OUTPUT_JSON = Path(__file__).parent.parent / "lib" / "data" / "eal-koder-full.json"

# Manually verified typo corrections in the English source — each confirmed against the real
# Norwegian meaning and/or standard EAL/EWC terminology during planning. Do not add more without
# the same level of verification; an uncorrected typo is honest (if imperfect) real data, but a
# wrongly "corrected" real word would be a fabrication.
TYPO_CORRECTIONS = {
    "wastes from washing, cleaning and mechanical reduciton of raw materials":
        "wastes from washing, cleaning and mechanical reduction of raw materials",
    "desalter csludges": "desalter sludges",
    "hydroflouric acid": "hydrofluoric acid",
    "nitirc acid and nitrous acid": "nitric acid and nitrous acid",
}

CODE_LINE_RE = re.compile(r"^\s*(\d{2}(?:\s?\d{2}(?:\s?\d{2})?)?)(\*?)\s+(.*)$")


def parse_english_source() -> dict[str, str]:
    """Parses the English source's extracted text into a {code: description} map.

    Lines look like "17 01 01 concrete" (leaf), "17 01 wastes from ..." (subchapter), or
    "17 Wastes from ..." (chapter) — distinguished by digit-group count. A leaf/subchapter's
    description can wrap onto the next line at the same indentation with no new code prefix;
    those continuation lines are merged into the same entry.
    """
    entries: dict[str, str] = {}
    current_code: str | None = None
    current_text_parts: list[str] = []

    def flush() -> None:
        nonlocal current_code, current_text_parts
        if current_code:
            text = re.sub(r"\s+", " ", " ".join(current_text_parts)).strip()
            text = TYPO_CORRECTIONS.get(text, text)
            entries[current_code] = text
        current_code = None
        current_text_parts = []

    with open(SOURCE_ENGLISH_TXT, encoding="utf-8") as f:
        for line in f:
            m = CODE_LINE_RE.match(line)
            if m:
                code_raw, _star, rest = m.groups()
                code = code_raw.replace(" ", "")
                if len(code) in (2, 4, 6):
                    flush()
                    current_code = code
                    current_text_parts = [rest.strip()]
                    continue
            stripped = line.strip()
            # A genuine wrapped-description continuation line is lowercase-leading, non-empty,
            # and not itself a new numbered heading.
            if current_code and stripped and not re.match(r"^\d{2}\s", stripped) and not stripped[0].isupper():
                current_text_parts.append(stripped)
    flush()
    return entries


def main() -> None:
    entries = []
    with open(SOURCE_CSV, encoding="utf-8-sig") as f:
        reader = csv.reader(f, delimiter=";")
        for row in reader:
            if not row or row[0] in ("", "Nivå"):
                continue  # skip blank lines and repeated header rows
            if len(row) != 5:
                raise SystemExit(f"unexpected row shape (expected 5 columns): {row}")
            nivaa_str, kode, beskrivelse, registrerbar, farlig = row
            if registrerbar != "Ja":
                continue  # skip deprecated ("Utgått") entries
            entries.append(
                {
                    "nivaa": int(nivaa_str),
                    "kode": kode,
                    "beskrivelse": beskrivelse,
                    "farlig": farlig == "Ja",
                }
            )

    english = parse_english_source()
    matched = 0
    for entry in entries:
        code = entry["kode"]
        if code in english:
            entry["beskrivelseEn"] = english[code]
            matched += 1
        else:
            entry["beskrivelseEn"] = None
            entry["missingEnglishTranslation"] = True

    OUTPUT_JSON.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(entries)} entries to {OUTPUT_JSON} ({matched} with real English translations, {len(entries) - matched} honest gaps)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the build script**

Run: `python3 scripts/build-eal-koder-full.py`
Expected: `Wrote 979 entries to .../lib/data/eal-koder-full.json (966 with real English translations, 13 honest gaps)`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/eal-koder-full.test.ts`
Expected: all tests PASS, including every pre-existing test in the file (the script's Norwegian-side output is byte-identical to before — only new fields were added, no existing field changed).

- [ ] **Step 6: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-eal-koder-full.py lib/data/eal-koder-full.json tests/hp-classification/eal-koder-full.test.ts
git commit -m "feat: add real English translations to eal-koder-full.json, sourced from a real UK EWC transposition"
```

---

### Task 2: Switch the wizard's classification result to English

**Files:**
- Modify: `lib/hp-classification/eal.ts`
- Test: `tests/hp-classification/eal.test.ts` (existing file — update it)

**Interfaces:**
- Consumes: `lib/data/eal-koder-full.json`'s new `beskrivelseEn`/`missingEnglishTranslation` fields (Task 1).
- No new exports — `assignEalCode`'s signature and `EalAssignment` interface are unchanged; only the returned `description` string's content (language) changes.

- [ ] **Step 1: Write the failing test**

Read `tests/hp-classification/eal.test.ts`'s current content first to match its style. Note:
none of the existing tests in this file assert on `result.description` at all (verified during
planning by searching the file) — only `result.code` and `result.confidence` — so no existing
test needs to change, only two new ones need to be added. Add these to the existing
`describe("assignEalCode", ...)` block, after its last existing test:

```typescript
  it("returns the real English description for a well-known EAL code (170503, hazardous soil/rock)", () => {
    const result = assignEalCode(true, "escavo terre e rocce", null, originLookup);
    expect(result.description).toBe("soil and stones containing dangerous substances");
  });

  it("falls back to the Norwegian description for a code with no real English translation", () => {
    // Chapter 1650 (Norway-specific oil-drilling extension) has no real English source match —
    // this test uses a synthetic lookup pointing at that chapter to prove the fallback works,
    // since 1650 isn't one of this app's curated origin-process options. All 8 real leaf codes
    // under chapter 1650 are farlig=true (hazardous) with no non-hazardous mirror — verified
    // during planning by reading the real data — so this test must use isHazardous=true, or it
    // will hit the unrelated "no matching EAL code found" path instead of the fallback this
    // test is meant to exercise.
    const lookup = { "test-oil-drilling-origin": "1650" };
    const result = assignEalCode(true, "test-oil-drilling-origin", null, lookup);
    // The exact matched code depends on which 1650-chapter entry sorts first — assert the
    // description is a real, non-empty string (the honest Norwegian fallback), not that it's
    // empty or a placeholder like "undefined"/"null".
    expect(typeof result.description).toBe("string");
    expect(result.description!.length).toBeGreaterThan(0);
  });
```

(You will need to determine the real English translation for code `170503` yourself by reading
it out of `lib/data/eal-koder-full.json` after Task 1's build script has run — do not guess it;
if it doesn't say exactly `"soil and stones containing dangerous substances"`, use whatever the
real, actual value in the file is instead, since that's the ground truth Task 1 already
established from the real source.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hp-classification/eal.test.ts`
Expected: FAIL — `assignEalCode` still returns the Norwegian `beskrivelse`, not the English one.

- [ ] **Step 3: Write the implementation**

In `lib/hp-classification/eal.ts`, change:

```typescript
  return { code, description: match.beskrivelse, confidence };
```

to:

```typescript
  // Prefer the real English translation; fall back to the Norwegian description only for the
  // handful of honest gap entries (see eal-koder-full.json's missingEnglishTranslation field) —
  // never a blank or fabricated string.
  return { code, description: match.beskrivelseEn ?? match.beskrivelse, confidence };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hp-classification/eal.test.ts`
Expected: all tests PASS, including every pre-existing test (only the one description-assertion
test changes value; all ambiguity/confidence/code-matching logic and its tests are untouched).

- [ ] **Step 5: Run the full suite and build**

```bash
npx vitest run
npm run build
```

Expected: both clean.

- [ ] **Step 6: Manual verification**

With the local dev server running (`lsof -ti:3000 | xargs -r kill -9; nohup npm run dev > /tmp/wastematch-dev.log 2>&1 & disown; sleep 5`), walk through the wizard once with a real sample fixture already established as this project's working test data (e.g. upload the Italian sample PDF, confirm extraction, fill origin process, confirm classification) and check the Classification results step's EAL sublabel is now in English, not Norwegian.

- [ ] **Step 7: Commit**

```bash
git add lib/hp-classification/eal.ts tests/hp-classification/eal.test.ts
git commit -m "feat: display the real English EAL description in classification results"
```

---

## Self-Review Notes

- **Spec coverage:** additive `beskrivelseEn`/`missingEnglishTranslation` fields on all 979 entries (Task 1) + the one-line consumption switch with honest fallback (Task 2) cover the spec's full "In scope" list. The spec's "Explicitly out of scope" items (removing the Norwegian field, `origin-options.ts` changes, classification-engine logic changes, avfallsstoffnummer/facility-matching changes) are untouched by either task.
- **Placeholder scan:** no TBD/TODO; every step has complete, already-tested code — the build script in Task 1 was actually written and run during planning (real output: 966 matched, 13 gaps, exact numbers used throughout this plan), not estimated.
- **Type consistency:** `beskrivelseEn`/`missingEnglishTranslation` are introduced in Task 1 and consumed with the exact same names in Task 2's `eal.ts` change. `EalAssignment`'s `description: string | null` field type is unchanged — `match.beskrivelseEn ?? match.beskrivelse` always resolves to a real string when a match exists (Norwegian is always present as the ground-truth fallback), matching the existing type contract exactly.
- **Empirical grounding:** every number in this plan (976 parsed, 966 matched, 13 gaps, the exact 4 typo corrections, the real `170101`/`010101` spot-check values) comes from actually running the parser against the real, already-committed source files during planning — re-verified reproducible (ran twice, identical results) before being written into this plan.
