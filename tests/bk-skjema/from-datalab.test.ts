import { describe, it, expect } from "vitest";
import { bkFromDatalab, resolveCitations } from "@/lib/bk-skjema/from-datalab";
import { flattenBlocks, narrowCitation, parseRegions, buildBkPageSchema } from "@/lib/bk-skjema/datalab";
import { bkSection } from "@/lib/bk-skjema/form-map";

// Shaped exactly like a real /convert json tree: nested children, ids that encode the page.
const CONVERT_JSON = {
  id: "/page/2/Page/2",
  block_type: "Page",
  bbox: [0, 0, 1000, 1400],
  children: [
    { id: "/page/2/Text/3", block_type: "Text", bbox: [10, 20, 200, 40], html: "<p>Avinor <b>AS</b></p>", children: [] },
    // Shaped like a real extras=table_cell_bboxes response: geometry rides in data-bbox
    // attributes on the html, not as JSON fields.
    { id: "/page/2/Table/11", block_type: "Table", bbox: [24, 500, 900, 1200], children: [], html:
      '<table>' +
      '<tr data-bbox="24 500 900 522"><td data-bbox="24 500 437 522">Prøvetype:</td><td data-bbox="437 500 666 522">Aske Asfalt</td></tr>' +
      '<tr data-bbox="24 522 900 544"><td data-bbox="24 522 437 544">Prøvemerking:</td><td data-bbox="437 522 666 544">ENAT-BØF1-MK11</td></tr>' +
      '<tr data-bbox="24 560 900 582"><td data-bbox="24 560 437 582">Arsen (As)</td><td data-bbox="437 560 666 582">1.8</td></tr>' +
      '<tr data-bbox="24 582 900 604"><td data-bbox="24 582 437 604">Bly (Pb)</td><td data-bbox="437 582 666 604">1.8</td></tr>' +
      '</table>' },
  ],
};

const ORIGIN = "concrete, brick, tile, or ceramic waste";

function datalabPayload(overrides: Record<string, unknown> = {}) {
  return {
    rapportnummer: "AR-1",
    rapportnummer_citations: ["/page/2/Text/3"],
    oppdragsgiver: "Avinor AS",
    oppdragsgiver_citations: ["/page/2/Text/3"],
    matrise: "Betong",
    matrise_citations: ["/page/2/Table/11"],
    analyseresultater: [
      { parameter: "Arsen (As)", analyte_id: "arsenic", verdi: 1.8, under_loq: false, loq: 0.95, enhet: "mg/kg TS",
        verdi_citations: ["/page/2/Table/11"] },
      // Datalab reports a non-detect by putting the LOQ in `verdi` — it must not be read as measured.
      { parameter: "Kadmium (Cd)", analyte_id: "cadmium-oxide", verdi: 0.2, under_loq: true, loq: 0.2, enhet: "mg/kg TS",
        verdi_citations: ["/page/2/Table/11"] },
      // No analyte_id, and a name nothing maps to: must be reported as unmatched, never guessed.
      { parameter: "Sum PAH(16) EPA", verdi: 491, under_loq: false, loq: null, enhet: "µg/kg TS" },
      // An analyte_id outside the known vocabulary must be rejected, not trusted.
      { parameter: "Vrøvl", analyte_id: "not-a-real-analyte", verdi: 1, under_loq: false, loq: null, enhet: "mg/kg TS" },
    ],
    ...overrides,
  };
}

describe("flattenBlocks", () => {
  it("flattens the tree, parses the page out of each id, and strips html to text", () => {
    const { blocks, pages } = flattenBlocks(CONVERT_JSON);
    expect(Object.keys(blocks)).toHaveLength(3);
    expect(pages).toEqual([{ page: 2, width: 1000, height: 1400 }]);
    expect(blocks["/page/2/Text/3"].page).toBe(2);
    expect(blocks["/page/2/Text/3"].text).toBe("Avinor AS");
  });
});

describe("resolveCitations", () => {
  it("resolves a citation id to its page, bbox and text", () => {
    const { blocks } = flattenBlocks(CONVERT_JSON);
    const [c] = resolveCitations(datalabPayload(), "oppdragsgiver", blocks);
    expect(c).toEqual({ blockId: "/page/2/Text/3", page: 2, text: "Avinor AS", bbox: [10, 20, 200, 40] });
  });

  it("keeps an unresolvable id visible rather than dropping it", () => {
    const [c] = resolveCitations({ x_citations: ["/page/9/Text/1"] }, "x", {});
    expect(c).toEqual({ blockId: "/page/9/Text/1", page: null, text: null, bbox: null });
  });
});

describe("bkFromDatalab", () => {
  const { blocks } = flattenBlocks(CONVERT_JSON);

  it("treats a below-LOQ row as a non-detect, not a measurement", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const cd = source.results.find(r => r.rawAnalyteName.startsWith("Kadmium"))!;
    expect(cd.resultValue).toBeNull();
    expect(cd.isBelowLoq).toBe(true);
    expect(cd.loqValue).toBe(0.2);
  });

  it("reports rows it cannot tie to a known analyte instead of guessing", () => {
    const { unmatchedAnalytes } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    expect(unmatchedAnalytes).toContain("Sum PAH(16) EPA");
    expect(unmatchedAnalytes).toContain("Vrøvl"); // analyte_id outside the known vocabulary
    expect(unmatchedAnalytes).not.toContain("Arsen (As)");
  });

  it("halts EAL assignment when no origin process is supplied", () => {
    const { fields, classification } = bkFromDatalab(datalabPayload(), blocks, null);
    expect(classification.eal.code).toBeNull();
    expect(classification.eal.confidence).toMatch(/HALT/);
    expect(fields.filter(f => f.label.startsWith("EAL-kode siffer")).every(f => !f.value)).toBe(true);
  });

  it("ticks the waste type the matrix implies and cites it", () => {
    const { fields } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const betong = fields.find(f => f.label === "Avfallstype (materiale): Betong eller tegl")!;
    expect(betong.check).toBe(true);
    expect(betong.citations?.[0].page).toBe(2);
    // and nothing else in that column is ticked
    expect(fields.filter(f => f.label.startsWith("Avfallstype (materiale):") && f.check).map(f => f.label))
      .toEqual(["Avfallstype (materiale): Betong eller tegl"]);
  });

  it("puts a matrix the form does not list under \"Annet\" rather than leaving the column blank", () => {
    // Real case: the form's waste-type list has no row for asphalt, and "Asfalt" is exactly what
    // the Eurofins asphalt report states. "Annet" is the right answer, not an empty column.
    const { fields } = bkFromDatalab(datalabPayload({ matrise: "Asfalt" }), blocks, ORIGIN);
    const ticked = fields.filter(f => f.label.startsWith("Avfallstype (materiale):") && f.check);
    expect(ticked.map(f => f.label)).toEqual(["Avfallstype (materiale): Annet"]);
    expect(ticked[0].note).toMatch(/not one of the form's listed waste types/);
  });

  it("ticks nothing in that column when no matrix was read at all", () => {
    const payload = datalabPayload();
    delete (payload as Record<string, unknown>).matrise;
    const { fields } = bkFromDatalab(payload, blocks, ORIGIN);
    const column = fields.filter(f => f.label.startsWith("Avfallstype (materiale):"));
    expect(column.every(f => !f.check)).toBe(true);
    expect(column[0].src).toBe("human");
  });

  it("does not ask the extractor about pre-treatment at all", () => {
    // Asking produced "Oppmaling / kverning" on four of six Alta sub-reports — inferred from the
    // lab's own "Homogenisering, knusing" (SS-EN 15002, test-portion preparation), and on one
    // sub-report with no such row in its results whatsoever. An explicit instruction not to do
    // this did not stop it, so the question is gone: part 4's forbehandling column is a person's
    // to answer. Re-adding it needs a better answer than a stronger prompt.
    const props = (buildBkPageSchema() as { properties: Record<string, unknown> }).properties;
    expect(props).not.toHaveProperty("forbehandling");
    expect(props).toHaveProperty("fysisk_form");
  });

  it("does not read the lab's own sample prep as pre-treatment of the waste", () => {
    // The Alta report lists "Homogenisering, knusing" with method SS-EN 15002:2015 — that is
    // preparation of a test portion from the laboratory sample, not treatment of the waste
    // stream. Ticking "Oppmaling / kverning" off the back of it would be a category error, so the
    // column stays clear unless the extraction actually returned a forbehandling value.
    const payload = datalabPayload();
    (payload.analyseresultater as Record<string, unknown>[]).push({
      parameter: "Homogenisering, knusing", verdi: 1, under_loq: false, loq: null, enhet: "SS-EN 15002:2015",
    });
    const { fields } = bkFromDatalab(payload, blocks, ORIGIN);
    const column = fields.filter(f => f.label.startsWith("Forbehandlet:"));
    expect(column).toHaveLength(6);
    expect(column.every(f => !f.check)).toBe(true);
    expect(column.find(f => f.label.includes("Oppmaling"))!.note).toMatch(/SS-EN 15002/);
  });

  it("ticks the physical form only when the report actually stated one", () => {
    const blank = bkFromDatalab(datalabPayload(), blocks, ORIGIN).fields
      .filter(f => f.label.startsWith("Fysiske egenskaper:"));
    expect(blank).toHaveLength(6);
    expect(blank.every(f => !f.check)).toBe(true);

    const stated = bkFromDatalab(datalabPayload({ fysisk_form: "Flytende" }), blocks, ORIGIN).fields
      .filter(f => f.label.startsWith("Fysiske egenskaper:") && f.check);
    expect(stated.map(f => f.label)).toEqual(["Fysiske egenskaper: Flytende"]);
    expect(stated[0].src).toBe("extracted");
  });

  it("covers all 103 form fields and gives every derived field something to point at", () => {
    const { fields } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    expect(fields).toHaveLength(103);
    for (const f of fields.filter(f => f.src === "derived" && (f.value || f.check || f.select))) {
      expect(f.citations, `${f.field} has nothing to cite`).not.toHaveLength(0);
    }
  });
});

describe("narrowCitation", () => {
  const { blocks } = flattenBlocks(CONVERT_JSON);
  const table = blocks["/page/2/Table/11"];

  it("parses one region per table row, with its cell texts", () => {
    const rawHtml = (CONVERT_JSON.children.find(c => c.id === "/page/2/Table/11")?.html) ?? "";
    expect(parseRegions(rawHtml)).toHaveLength(4);
    expect(table.regions).toHaveLength(4);
    expect(table.regions[0].cells).toEqual(["Prøvetype:", "Aske Asfalt"]);
  });

  it("narrows a table citation to the row holding the value", () => {
    // Without this the box covers the entire 700px-tall table. Row geometry, not cell geometry:
    // Datalab's per-cell x-boundaries are unreliable (see narrowCitation).
    const { bbox } = narrowCitation(table, "Aske Asfalt");
    expect(bbox).toEqual([24, 500, 900, 522]);
  });

  it("narrows the sample marking to its own row", () => {
    expect(narrowCitation(table, "ENAT-BØF1-MK11").bbox).toEqual([24, 522, 900, 544]);
  });

  it("uses the analyte name to disambiguate rows sharing a value", () => {
    // "1.8" is the value in two different rows, so the parameter name is what identifies one.
    expect(narrowCitation(table, "Arsen (As)").bbox).toEqual([24, 560, 900, 582]);
    expect(narrowCitation(table, "Bly (Pb)").bbox).toEqual([24, 582, 900, 604]);
  });

  it("keeps the whole block when nothing matches, rather than guessing", () => {
    expect(narrowCitation(table, "Kryptonitt").bbox).toEqual(table.bbox);
    expect(narrowCitation(table, null).bbox).toEqual(table.bbox);
  });

  it("leaves blocks with no table geometry alone", () => {
    expect(narrowCitation(blocks["/page/2/Text/3"], "Avinor AS").bbox).toEqual([10, 20, 200, 40]);
  });
});

describe("bkSection", () => {
  it("puts each field in the part of the paper form it belongs to", () => {
    expect(bkSection("group1")).toBe(0);
    expect(bkSection("TextField2")).toBe(1);   // 1. Fylles ut av avfallsmottaker
    expect(bkSection("TextField6")).toBe(2);   // 2. Avfallsprodusent
    expect(bkSection("TextField17")).toBe(3);  // 3. EAL-kode
    expect(bkSection("Checkbox10")).toBe(3);
    expect(bkSection("Checkbox23")).toBe(4);   // 4. Avfallets egenskaper
    expect(bkSection("TextField41")).toBe(4);
    expect(bkSection("group6")).toBe(5);       // 5. Avfall som oppstår jevnlig
    expect(bkSection("TextField53")).toBe(5);
  });
});
