#!/usr/bin/env python3
"""Fill the empty permit columns of Farlig avfall mottak.csv.

Takes the registry-linked CSV (facilities + permit_url already resolved),
downloads each permit PDF, parses the acceptance table, re-geocodes to
address precision where possible, and writes the filled CSV + a depots.json
for the portal map.

Usage: python fill_farlig_avfall_csv.py <in.csv> <out.csv> <depots.json>
"""
from __future__ import annotations

import json
import logging
import re
import sys
import time
from dataclasses import dataclass, field, asdict
from io import StringIO
from pathlib import Path

import pandas as pd
import pdfplumber
import requests

log = logging.getLogger("fill")
UA = "farlig-avfall-dataset/1.0 (+kontakt: felix@bluppblupp.no)"
PDFS = Path("out/permits")

CODES_CSV = "https://www.avfallsdeklarering.no/Avfallskoder/AvfallstoffnummerCsv"

CODE = re.compile(r"\b(\d{4})(?:\s*-\s*(\d{4}))?\b")
HDR_TILL = re.compile(r"Tillatelsesn(?:r|ummer)\w*[.:]?\s*([\d.]+T)", re.I)
HDR_ENDRET = re.compile(r"[Ss]ist\s+endret[:\s|]*(\d{2}\.\d{2}\.\d{4})")
TABLE_HEAD = re.compile(
    r"(avfallsstoff\s*\n?n(?:r|ummer)|avfallskode\s*\n?\(avfallsstoffnummer\)|"
    r"avfallstyper\s+som\s+kan\s+mottas|mengder\s+og\s+typer\s+avfall\s+som\s+tillates)",
    re.I)
# a 4-digit token followed by a Capitalized word is a postcode + poststed
# ('7010 Trondheim'), not a waste code ('7142 oljebasert borevæske')
POSTAL = re.compile(r"\b\d{4}\s+[A-ZÆØÅ]")
NOISE_LINE = re.compile(r"postboks|telefon|e-post|www\.|@|org\.?\s*nr", re.I)
AGG_ROW = re.compile(r"\bsum\b.{0,20}\bfarlig\s+avfall\b", re.I)


@dataclass
class Permit:
    doc_id: str
    tillatelsesnummer: str | None = None
    sist_endret: str | None = None
    myndighet: str | None = None
    layout: str = "unknown"
    codes: list[str] = field(default_factory=list)
    max_lagret_tonn: str | None = None
    max_arlig_tonn: str | None = None
    aggregate_only: bool = False
    ekskludert: list[str] = field(default_factory=list)
    scanned: bool = False
    needs_review: bool = True
    note: str = ""


def valid_codes() -> set[str]:
    r = requests.get(CODES_CSV, headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    df = pd.read_csv(StringIO(r.content.decode("utf-8-sig")), sep=";", dtype=str)
    return set(df["Kode"].str.split("-").str[0].str.strip())


def expand(lo: str, hi: str | None) -> list[str]:
    if not hi:
        return [lo]
    a, b = int(lo), int(hi)
    return [str(c) for c in range(a, b + 1)] if 0 < b - a <= 200 else [lo, hi]


def parse(pdf_path: Path, valid: set[str]) -> Permit:
    p = Permit(doc_id=pdf_path.stem)
    with pdfplumber.open(pdf_path) as doc:
        pages = [(pg.extract_text() or "") for pg in doc.pages]
        text = "\n".join(pages)

        if len(text.strip()) < 400 * max(1, len(pages)) / 10:
            p.scanned = True
            p.note = "little/no text layer - needs OCR (ocrmypdf)"
            return p

        if m := HDR_TILL.search(text):
            p.tillatelsesnummer = m.group(1)
        if m := HDR_ENDRET.search(text):
            d, mo, y = m.group(1).split(".")
            p.sist_endret = f"{y}-{mo}-{d}"
        p.myndighet = ("Statsforvalteren" if "statsforvalteren" in text[:3000].lower()
                       else "Miljodirektoratet")

        for i in range(len(doc.pages) - 1, -1, -1):
            page_txt = pages[i]
            if not TABLE_HEAD.search(page_txt):
                continue
            p.layout = ("vedlegg1_tabell1" if re.search(r"avfallsstoff\s*\n?nr", page_txt, re.I)
                        else "vedlegg3_tabell2")
            if AGG_ROW.search(page_txt):
                p.aggregate_only = True
                p.note = ("permit gives farlig avfall as a single aggregate row - "
                          "no per-code breakdown available")
            for tbl in (doc.pages[i].extract_tables() or []):
                for r in tbl:
                    cell = " ".join(c or "" for c in r[:2])
                    for lo, hi in CODE.findall(cell):
                        p.codes.extend(expand(lo, hi))
                    nums = [c for c in (r[2:] if len(r) > 2 else []) if c]
                    if len(nums) >= 2 and not p.max_arlig_tonn:
                        p.max_arlig_tonn, p.max_lagret_tonn = nums[0], nums[1]
            break

        p.codes = sorted({c for c in p.codes if c in valid})

        # Fallback for permits whose acceptance table has no ruling lines
        # (extract_tables finds nothing) or sits as plain text: scan lines,
        # skipping address/contact noise and postcode+poststed patterns.
        if not p.codes:
            found: set[str] = set()
            for line in text.split("\n"):
                if NOISE_LINE.search(line) or POSTAL.search(line):
                    continue
                for lo, hi in CODE.findall(line):
                    found.update(c for c in expand(lo, hi) if c in valid)
            if found:
                p.codes = sorted(found)
                p.layout = "text_line_fallback"
                p.note = "codes scraped from text lines, not a parsed table - verify"

        if m := re.search(r"omfatter ikke[^.]*?:(.{0,300})", text, re.S | re.I):
            p.ekskludert = [x.strip(" •-\n") for x in m.group(1).split("\n")
                            if x.strip(" •-\n")][:6]

    p.needs_review = not (p.codes and p.layout not in ("unknown", "text_line_fallback")
                          and not p.aggregate_only)
    return p


def geocode(adresse: str, postnr: str, poststed: str) -> tuple[float | None, float | None, str]:
    base = "https://ws.geonorge.no/adresser/v1/sok"
    for params, prec in (
        ({"sok": f"{adresse} {postnr} {poststed}", "treffPerSide": 1}, "adresse"),
        ({"postnummer": postnr, "treffPerSide": 1}, "postnummer_centroid"),
    ):
        try:
            r = requests.get(base, params=params, headers={"User-Agent": UA}, timeout=30)
            r.raise_for_status()
            hits = r.json().get("adresser") or []
            if hits:
                pt = hits[0]["representasjonspunkt"]
                return pt["lat"], pt["lon"], prec
        except Exception as e:  # noqa: BLE001
            log.debug("geocode %s: %s", postnr, e)
        time.sleep(0.3)
    return None, None, "failed"


def main(src: str, dst: str, depots_json: str) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    PDFS.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(src, dtype=str).fillna("")
    valid = valid_codes()
    log.info("%d facilities, %d valid avfallsstoffnr", len(df), len(valid))

    s = requests.Session()
    s.headers["User-Agent"] = UA
    parsed: dict[str, Permit] = {}

    for _, row in df.iterrows():
        doc = row["permit_doc_id"]
        if not doc or doc in parsed:
            continue
        dest = PDFS / f"{doc}.pdf"
        if not dest.exists():
            try:
                r = s.get(row["permit_url"], timeout=120)
                r.raise_for_status()
                if not r.content.startswith(b"%PDF"):
                    log.warning("doc %s (%s): not a PDF", doc, row["navn"])
                    continue
                dest.write_bytes(r.content)
                log.info("doc %s: %d KB (%s)", doc, len(r.content) // 1024, row["navn"])
                time.sleep(1.5)
            except Exception as e:  # noqa: BLE001
                log.error("doc %s: %s", doc, e)
                continue
        parsed[doc] = parse(dest, valid)

    for i, row in df.iterrows():
        p = parsed.get(row["permit_doc_id"])
        # upgrade coordinates to address precision where the address resolves
        if row["coord_precision"] != "adresse" and row["postnummer"]:
            lat, lon, prec = geocode(row["adresse"], row["postnummer"], row["poststed"])
            if lat is not None and prec == "adresse":
                df.loc[i, ["lat", "lon", "coord_precision"]] = [f"{lat:.5f}", f"{lon:.5f}", prec]
        if not p:
            df.loc[i, "extraction_status"] = "permit_download_failed"
            continue
        df.loc[i, "tillatelsesnummer"] = p.tillatelsesnummer or ""
        df.loc[i, "permit_sist_endret"] = p.sist_endret or ""
        df.loc[i, "permit_myndighet"] = p.myndighet or ""
        df.loc[i, "accepted_avfallsstoffnr"] = "|".join(p.codes)
        df.loc[i, "max_lagret_tonn"] = p.max_lagret_tonn or ""
        df.loc[i, "max_arlig_tonn"] = p.max_arlig_tonn or ""
        df.loc[i, "eksplisitt_ekskludert"] = "|".join(p.ekskludert)
        df.loc[i, "extraction_status"] = (
            "scanned_pdf_needs_ocr" if p.scanned
            else "aggregate_only" if p.aggregate_only
            else "parsed" if not p.needs_review
            else "parsed_needs_review")
        df.loc[i, "kilde_notat"] = p.note or "Parsed from permit PDF."

    df.to_csv(dst, index=False, encoding="utf-8")
    log.info("wrote %s", dst)

    depots = [
        {
            "id": r["anleggsnummer"] or r["forurensnings_id"],
            "name": r["navn"],
            "lat": float(r["lat"]),
            "lng": float(r["lon"]),
            "kommune": r["kommune"].title(),
            "fylke": r["fylke"],
            "codes": [c for c in r["accepted_avfallsstoffnr"].split("|") if c],
            "maxYearlyTonnes": r["max_arlig_tonn"] or None,
            "permitUrl": r["permit_url"],
            "extractionStatus": r["extraction_status"],
        }
        for _, r in df.iterrows() if r["lat"] and r["lon"]
    ]
    Path(depots_json).write_text(json.dumps(depots, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("wrote %s (%d depots)", depots_json, len(depots))

    for st, n in df["extraction_status"].value_counts().items():
        log.info("  %s: %d", st, n)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
