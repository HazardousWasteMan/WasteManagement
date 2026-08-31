"""Map the BK-skjema AcroForm's generic field names (TextField1..53, Checkbox1..46,
groupN) to the human label printed next to them, by geometry."""
import json, re, subprocess, sys, xml.etree.ElementTree as ET
from pypdf import PdfReader

PDF = "../public/forms/bk-skjema-blank.pdf"

# --- words with bboxes (pdftotext -bbox uses top-left origin, y down) ---
xml = subprocess.run(["pdftotext", "-bbox", PDF, "-"], capture_output=True, text=True).stdout
ns = {"x": "http://www.w3.org/1999/xhtml"}
pages_words = []
for pg in ET.fromstring(xml).iter("{http://www.w3.org/1999/xhtml}page"):
    h = float(pg.get("height"))
    ws = [(float(w.get("xMin")), float(w.get("yMin")), float(w.get("xMax")),
           float(w.get("yMax")), (w.text or "").strip())
          for w in pg.findall("x:word", ns)]
    pages_words.append((h, [w for w in ws if w[4]]))

# --- widgets ---
reader = PdfReader(PDF)
rows = []
for pi, page in enumerate(reader.pages):
    ph, words = pages_words[pi]
    for annot in page.get("/Annots") or []:
        a = annot.get_object()
        if a.get("/Subtype") != "/Widget":
            continue
        name, node = None, a
        while node is not None and name is None:          # field name may live on the parent
            name = node.get("/T")
            node = node.get("/Parent")
        x0, y0, x1, y1 = (float(v) for v in a["/Rect"])
        # PDF y-up -> pdftotext y-down
        t0, t1 = ph - max(y0, y1), ph - min(y0, y1)
        cy = (t0 + t1) / 2
        export = None
        ap = a.get("/AP", {}).get("/N")
        if ap is not None:
            export = [k for k in ap.keys() if k != "/Off"]
        def near(pred):
            c = [w for w in words if pred(w)]
            return " ".join(w[4] for w in sorted(c, key=lambda w: (round(w[1]/4), w[0])))[:90]
        left = near(lambda w: w[2] <= min(x0, x1) + 2 and abs((w[1]+w[3])/2 - cy) < 6
                    and min(x0, x1) - w[2] < 260)
        above = near(lambda w: w[3] <= t0 + 2 and t0 - w[3] < 16
                     and w[0] < max(x0, x1) + 8 and w[2] > min(x0, x1) - 8)
        right = near(lambda w: w[0] >= max(x0, x1) - 2 and abs((w[1]+w[3])/2 - cy) < 6
                     and w[0] - max(x0, x1) < 200)
        rows.append(dict(field=str(name), page=pi + 1, x=round(min(x0, x1)), y=round(t0),
                         w=round(abs(x1-x0)), h=round(abs(y1-y0)), export=export,
                         left=left, above=above, right=right))

rows.sort(key=lambda r: (r["page"], round(r["y"]/6), r["x"]))
json.dump(rows, open("field-map-raw.json", "w"), ensure_ascii=False, indent=1)
for r in rows:
    print(f'{r["page"]} y{r["y"]:>4} x{r["x"]:>4} {r["field"]:<12} {str(r["export"] or ""):<10} '
          f'L[{r["left"]}] A[{r["above"]}] R[{r["right"]}]')

# --- also emit the widget geometry the UI needs to draw a box on each field ---
# Radio groups have one widget per option sharing a single field name, so rows are keyed by
# (field, export) and the UI matches the export value it selected.
import pypdf
reader2 = PdfReader(PDF)
geom = {"pages": [], "widgets": []}
for pi, page in enumerate(reader2.pages):
    box = page.mediabox
    pw, ph = float(box.width), float(box.height)
    geom["pages"].append({"page": pi, "width": round(pw, 2), "height": round(ph, 2)})
    for annot in page.get("/Annots") or []:
        a = annot.get_object()
        if a.get("/Subtype") != "/Widget":
            continue
        name, node = None, a
        while node is not None and name is None:
            name = node.get("/T")
            node = node.get("/Parent")
        x0, y0, x1, y1 = (float(v) for v in a["/Rect"])
        ap = a.get("/AP", {}).get("/N")
        exports = [k[1:] for k in ap.keys() if k != "/Off"] if hasattr(ap, "keys") else []
        # /AP/N on a text field is a stream, not a dict of states — only radios/checkboxes have real exports
        export = exports[0] if len(exports) == 1 and exports[0].startswith(("Radio", "YES")) else None
        geom["widgets"].append({
            "field": str(name),
            "export": export,
            "page": pi,
            # top-left origin, PDF points, to match how the browser lays the overlay out
            "x": round(min(x0, x1), 2),
            "y": round(ph - max(y0, y1), 2),
            "w": round(abs(x1 - x0), 2),
            "h": round(abs(y1 - y0), 2),
        })

geom["widgets"].sort(key=lambda w: (w["page"], round(w["y"] / 6), w["x"]))
with open("../lib/data/bk-skjema-field-geometry.json", "w") as f:
    json.dump(geom, f, ensure_ascii=False, indent=1)
print(f"\nwrote geometry: {len(geom['widgets'])} widgets on {len(geom['pages'])} pages")
