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
                rest_stripped = rest.strip()
                # Only treat this as the start of a NEW entry if it has real description text
                # (an empty match is never a real heading) and we haven't already parsed this
                # code. Without the second check, a wrapped continuation line that merely starts
                # with digits resembling a code (e.g. "20 01 23 containing hazardous components",
                # the tail end of a wrapped 20 01 35 entry, or "13 and 16 01 14", the tail end of
                # a wrapped 16 01 21 entry) would be mistaken for a new heading and silently
                # overwrite/corrupt the already-correctly-parsed earlier entry for that code.
                if len(code) in (2, 4, 6) and rest_stripped and code not in entries:
                    flush()
                    current_code = code
                    current_text_parts = [rest_stripped]
                    continue
            stripped = line.strip()
            # A genuine wrapped-description continuation line is any non-empty, non-footer text
            # that isn't itself a fresh heading (that case is handled above). Real continuation
            # lines may start with a capitalized word (e.g. "Coal", "Otherwise Specified", a
            # proper noun continuing a chapter title) or with digits that merely echo a code
            # reference from the previous line ("20 01 23 containing...", "13 and 16 01 14") —
            # both must be merged, not dropped. The only thing excluded is a whole-line, all-caps
            # document footer/header artifact (e.g. "END OF LISTING"), which is never real
            # waste-catalogue description text.
            if current_code and stripped and not stripped.isupper():
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

    # Sanity guard: beskrivelseEn must always be a real, non-empty string or None (with the
    # honest missingEnglishTranslation gap marker) — an empty string is never a valid state and
    # historically indicated a parser bug silently corrupting an entry.
    blank_codes = [e["kode"] for e in entries if e["beskrivelseEn"] == ""]
    if blank_codes:
        raise SystemExit(
            "parse_english_source() produced empty-string beskrivelseEn for codes "
            f"{blank_codes} — this indicates a parser bug (an entry was overwritten/corrupted). "
            "beskrivelseEn must always be a real string or None."
        )

    OUTPUT_JSON.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(entries)} entries to {OUTPUT_JSON} ({matched} with real English translations, {len(entries) - matched} honest gaps)")


if __name__ == "__main__":
    main()
