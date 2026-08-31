// End-to-end over the real Datalab API: convert -> extract -> BK-skjema fields, with citations
// resolved to page + bbox. Live API (~3-5c on 3 pages). Run with:
//   set -a && . ./.env.local && set +a && npx vitest run bk/data-lab.test.ts
import { test, expect } from "vitest";
import fs from "node:fs";
import { convertDocument, extractStructured, buildBkPageSchema } from "@/lib/bk-skjema/datalab";
import { bkFromDatalab } from "@/lib/bk-skjema/from-datalab";
import { fillBkPdf, summarizeCoverage, BK_BLANK_FORM_PATH } from "@/lib/bk-skjema/fill-pdf";

const PDF = "bk/analyse-eurofins-betong.pdf";
const PAGE_RANGE = "2-4";            // the ENAT-BØF1-BO9OB1 concrete sub-report
const ORIGIN = "concrete, brick, tile, or ceramic waste";

test("Datalab -> BK-skjema, with resolvable citations", async () => {
  const pdf = fs.readFileSync(PDF);

  const converted = await convertDocument(pdf, "analyse.pdf", { pageRange: PAGE_RANGE });
  expect(converted.checkpointId).toBeTruthy();
  expect(Object.keys(converted.blocks).length).toBeGreaterThan(10);

  const extracted = await extractStructured(
    buildBkPageSchema(),
    { checkpointId: converted.checkpointId! },
    { pageRange: PAGE_RANGE }
  );

  const result = bkFromDatalab(extracted.data, converted.blocks, ORIGIN);
  const { pdf: filled, outcomes } = await fillBkPdf(fs.readFileSync(BK_BLANK_FORM_PATH), result.fields);
  fs.writeFileSync("bk/bk-skjema-utfylt-datalab.pdf", filled);
  fs.writeFileSync("bk/datalab-output.json", JSON.stringify({
    metadata: result.source.metadata,
    results: result.source.results,
    classification: result.classification,
    unmatchedAnalytes: result.unmatchedAnalytes,
    pages: converted.pages,
    coverage: summarizeCoverage(outcomes),
    fields: result.fields,
    costCents: converted.costCents + extracted.costCents,
  }, null, 2));

  // The customer's own marking — the field the Anthropic path got wrong (it returned the lab no.)
  expect(result.source.metadata.sampleMarking).toBe("ENAT-BØF1-BO9OB1");
  expect(result.source.metadata.matrixType).toMatch(/betong/i);

  // Same verdict as the hand-transcribed gold fixture.
  expect(result.classification.hazard.isHazardous).toBe(false);
  expect(result.classification.hazard.triggeredHps).toEqual([]);
  expect(result.classification.eal.code).toBe("17 01 01");

  // All 103 fields accounted for, nothing failed to set.
  expect(summarizeCoverage(outcomes).fieldsMapped).toBe(103);
  expect(outcomes.filter(o => o.note?.startsWith("could not be set"))).toEqual([]);

  // Citations must be narrowed to the cell/row holding the value. Datalab cites whole blocks, and
  // its table blocks span the sample header plus every analyte row — a citation covering most of
  // the page is useless as a "here is where this came from" pointer.
  const page = converted.pages[0];
  for (const label of ["ID nr. fra avfallsprodusent", "Avfallstype (materiale): Betong eller tegl"]) {
    const f = result.fields.find(x => x.label === label)!;
    const c = f.citations![0];
    const height = c.bbox![3] - c.bbox![1];
    expect(height, `${label} citation is ${height}px tall of ${page.height} — not narrowed`)
      .toBeLessThan(page.height * 0.1);
  }

  // The point of the tab: every extracted field must carry a citation that resolves to a real
  // page and bbox, otherwise the side-by-side view has nothing to point at.
  const extractedFields = result.fields.filter(f => f.src === "extracted" && (f.value || f.check));
  expect(extractedFields.length).toBeGreaterThan(0);
  for (const f of extractedFields) {
    expect(f.citations, `${f.field} (${f.label}) has no citations`).not.toHaveLength(0);
    for (const c of f.citations!) {
      expect(c.page, `${f.field} citation ${c.blockId} did not resolve`).not.toBeNull();
      expect(c.bbox, `${f.field} citation ${c.blockId} has no bbox`).not.toBeNull();
      expect(c.text, `${f.field} citation ${c.blockId} has no text`).toBeTruthy();
    }
  }
}, 600_000);
