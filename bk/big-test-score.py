#!/usr/bin/env python3
"""Score the live Datalab extraction (bk/big-test-out/*.json) against the hand-transcribed
BK-skjema gold (bk/big-test-gold.json). Prints a per-field table and the headline percentage."""
import json, re, sys, unicodedata
from pathlib import Path

OUT = Path("bk/big-test-out")
GOLD = json.load(open("bk/big-test-gold.json"))

# which extraction dumps feed which gold test
DOCS = {
    "test_2": ["test_2-filterkake-1A", "test_2-filterkake-2A", "test_2-filterkake-testfase1"],
    "test_3": ["test_3-betongslam"],
    "test_4": ["test_4-asfalt"],
    "test_1": ["test_1-gravemasser", "test_1-gravemasser-toc"],
}

def norm(s):
    if s is None: return ""
    s = unicodedata.normalize("NFKD", str(s)).lower()
    s = re.sub(r"[^\w\s@.+-]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def digits(s):
    return re.sub(r"\D", "", str(s or ""))

def load(test):
    out = []
    for d in DOCS[test]:
        p = OUT / f"{d}.json"
        if p.exists(): out.append(json.load(open(p)))
    return out

def ticked_box(samples, label):
    """ja/nei from a checkbox the form builder set, or None if it is not offered at all."""
    for s_ in samples:
        for f in s_["fields"]:
            if f["label"] == label:
                return "ja" if f.get("check") else "nei"
    return None

def first(vals):
    for v in vals:
        if v not in (None, "", []): return v
    return None

MATRIX_LABEL = "Avfallstype (materiale): "

# Gold field -> the BkField the form builder produces for it, so the scorer can see whether a
# value is asserted (src extracted/derived) or offered as a suggestion for a person to confirm
# (src human). A wrong suggestion and a wrong assertion are not the same failure.
FIELD_LABEL = {
    "hentested": "Hentested for avfallet",
    "idNrFraProdusent": "ID nr. fra avfallsprodusent",
    "avfallsprodusent": "Avfallsprodusent",
    "adresse": "Adresse",
    "postnummer": "Postnummer",
    "poststed": "Poststed",
    "kontaktperson": "Kontaktperson",
    "telefon": "Telefon (produsent)",
    "epost": "e-post (produsent)",
    "innholdFarligeStoffer": "Innhold av farlige stoffer: Ja",
}

def predict(dumps):  # -> (predicted fields, samples, field label -> src)
    """Collapse every sub-report of every document for this test into one predicted form."""
    samples = [s for d in dumps for s in d["samples"]]
    if not samples: return {}, samples, {}
    md = [s["metadata"] for s in samples]
    raws = [s["raw"] for s in samples]
    cls = [s["classification"] for s in samples]

    def m(k): return first([x.get(k) for x in md])
    def r(k): return first([x.get(k) for x in raws])

    # A sample with no usable total-content row has no verdict at all — the form now leaves the
    # deponikategori and avfallstype columns blank rather than ticking the non-hazardous half.
    assessable = [c for c in cls if not c["noDataWarning"]]
    hazardous = any(c["hazard"]["isHazardous"] for c in assessable)
    verdict = ("farlig" if hazardous else "ordinært") if assessable else None
    ticked = None
    for s in samples:
        for f in s["fields"]:
            if f["label"].startswith(MATRIX_LABEL) and f.get("check"):
                ticked = f["label"][len(MATRIX_LABEL):]
    srcs = {}
    for s_ in samples:
        for f in s_["fields"]:
            srcs.setdefault(f["label"], f["src"])
            if f["label"].startswith(MATRIX_LABEL) and f.get("check"):
                srcs["__matrix__"] = f["src"]
    ristetest = first([x.get("ristetest_utfort") for x in raws])
    kolonnetest = first([x.get("kolonnetest_utfort") for x in raws])
    return {
        "hentested": m("pickupLocation"),
        "idNrFraProdusent": m("sampleMarking"),
        "avfallsprodusent": first([x.get("producerName") or x.get("customerName") for x in md]),
        "organisasjonsnummer": None,
        "adresse": m("address"),
        "postnummer": m("postCode"),
        "poststed": m("postArea"),
        "kontaktperson": m("contactPerson"),
        "telefon": m("contactPhone"),
        "epost": m("contactEmail"),
        "transportor": None,
        "ealKode": first([c["eal"]["code"] for c in cls]),
        "avfallsstoffnummer": None,
        "deponikategori": verdict,
        "avfallstypeKlasse": verdict,
        "testpliktig": "ja",
        # No longer asserted: the same facts are filed both ways on real forms, so the form ticks
        # it as a suggestion for a person to confirm. Read the box, not a hardcoded answer.
        "innholdFarligeStoffer": ticked_box(samples, "Innhold av farlige stoffer: Ja"),
        "tocPct": m("tocPct"),
        "glodetapPct": m("glodetapPct"),
        "ristetest": None if ristetest is None else ("ja" if ristetest else "nei"),
        "kolonnetest": None if kolonnetest is None else ("ja" if kolonnetest else "nei"),
        "tilstandsklasse": None,
        "opprinnelse": None,
        "materialeType": ticked,
        "fysiskeEgenskaper": m("physicalForm"),
        "forbehandlet": None,
        "farge": None,
        "lukt": None,
        "ekstraForhandsregler": None,
        "jevnlig": None,
        "matrise": m("matrixType"),
        "provemerking": m("sampleMarking"),
        "labnavn": m("labName"),
    }, samples, srcs

# Fields no lab report can carry — counted separately so the headline number is not dragged
# down by things that are out of scope by construction.
DERIVABLE = json.load(open("bk/big-test-derivable.json"))

def in_scope(test, field):
    """True when the value is actually obtainable from the chemical report — either printed in it
    or computable by the classification engine. Verified per test by grepping the source text."""
    d = DERIVABLE.get(test)
    return bool(d) and (field in d["insource"] or field in d["derived"])

def match(field, gold, pred):
    # "(ingen)" means the human ticked nothing in that column, so producing nothing is right.
    if gold == "(ingen)": return "CORRECT" if pred in (None, "") else "WRONG"
    if pred in (None, ""): return "MISSING"
    g, p = norm(gold), norm(pred)
    if field in ("ealKode", "postnummer", "telefon", "organisasjonsnummer", "avfallsstoffnummer"):
        return "CORRECT" if digits(gold) == digits(pred) else "WRONG"
    if field in ("tocPct", "glodetapPct"):
        try: return "CORRECT" if abs(float(gold) - float(pred)) < 0.15 else "WRONG"
        except (TypeError, ValueError): return "WRONG"
    if g == p: return "CORRECT"
    if g and p and (g in p or p in g): return "CORRECT"
    # token overlap for free text / names
    gt, pt = set(g.split()), set(p.split())
    if gt and pt and len(gt & pt) / len(gt | pt) >= 0.6: return "CORRECT"
    return "WRONG"

rows, totals = [], {}
for test in ["test_1", "test_2", "test_3", "test_4"]:
    gold = GOLD.get(test)
    dumps = load(test)
    pred, samples, srcs = predict(dumps) if dumps else ({}, [], {})
    if gold is None:
        rows.append((test, "—", "NO GOLD", f"{len(samples)} sub-reports extracted", ""))
        continue
    tally = {"CORRECT": 0, "WRONG": 0, "SUGGESTED": 0, "MISSING": 0}
    tally_core = {"CORRECT": 0, "WRONG": 0, "SUGGESTED": 0, "MISSING": 0}
    for field, g in gold["fields"].items():
        if g in (None, ""):        # form leaves it blank / form has no such field
            continue
        v = match(field, g, pred.get(field))
        # A value the form marks "You fill in" is a prefilled suggestion the reviewer confirms,
        # not a claim. Still not the gold answer, but a different (and much cheaper) failure.
        src = srcs.get("__matrix__" if field == "materialeType" else FIELD_LABEL.get(field, ""))
        if v == "WRONG" and src == "human": v = "SUGGESTED"
        tally[v] += 1
        if in_scope(test, field): tally_core[v] += 1
        rows.append((test, field, ("  " if in_scope(test, field) else "· ") + v, str(g)[:60], str(pred.get(field))[:60]))
    totals[test] = (tally, tally_core, len(samples), sum(d["costCents"] for d in dumps))

w = max(len(r[1]) for r in rows) + 1
print("'·' = the value is not in the chemical report at all (out of scope for extraction)\n")
print(f"{'test':8} {'field':{w}} {'verdict':11} {'gold':62} predicted")
print("-" * 160)
for t, f, v, g, p in rows:
    print(f"{t:8} {f:{w}} {v:11} {g:62} {p}")

print("\n" + "=" * 90)
allc = allw = alls = allm = 0
for test, (t, tc, n, cost) in totals.items():
    tot = sum(t.values()); totc = sum(tc.values())
    allc += t["CORRECT"]; allw += t["WRONG"]; alls += t["SUGGESTED"]; allm += t["MISSING"]
    print(f"{test}: {t['CORRECT']}/{tot} = {100*t['CORRECT']/tot:.0f}% of all filled gold fields "
          f"| {tc['CORRECT']}/{totc} = {100*tc['CORRECT']/totc:.0f}% of fields the chemical report can supply "
          f"| wrong {t['WRONG']}, unconfirmed suggestion {t['SUGGESTED']}, blank {t['MISSING']} | {n} sub-reports, {cost:.1f}c")
tot = allc + allw + alls + allm
print(f"\nOVERALL: {allc}/{tot} = {100*allc/tot:.1f}% correct | {allw} asserted wrong ({100*allw/tot:.1f}%) "
      f"| {alls} wrong but flagged as a suggestion to confirm | {allm} blank ({100*allm/tot:.1f}%)")
