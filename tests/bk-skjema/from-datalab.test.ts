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
    // The "Utførende laboratorium/Underleverandør" table every Eurofins report ends with.
    { id: "/page/2/Table/44", block_type: "Table", bbox: [24, 1250, 900, 1330], children: [], html:
      '<table>' +
      '<tr data-bbox="24 1250 900 1272"><td data-bbox="24 1250 900 1272">Utførende laboratorium/ Underleverandør:</td></tr>' +
      '<tr data-bbox="24 1272 900 1294"><td data-bbox="24 1272 900 1294">a) Eurofins Food &amp; Feed Testing Sweden (Lidköping), Sockerbruksg 3</td></tr>' +
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
    expect(Object.keys(blocks)).toHaveLength(4);
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

  it("leaves the column blank for a matrix the form does not list, rather than ticking \"Annet\"", () => {
    // The form's waste-type list has no row for asphalt. This used to tick "Annet"; the human
    // form for the Alta asphalt delivery (big_test/test_4) ticks nothing in this column at all,
    // so an unlistable matrix is the column's problem, not "Annet"'s.
    const { fields } = bkFromDatalab(datalabPayload({ matrise: "Asfalt" }), blocks, ORIGIN);
    const column = fields.filter(f => f.label.startsWith("Avfallstype (materiale):"));
    expect(column.filter(f => f.check)).toEqual([]);
    expect(column[0].note).toMatch(/not one of the form's listed waste types/);
  });

  it("ticks nothing when Prøvetype is the lab's non-answer (\"Uspesifisert jord\")", () => {
    // big_test/test_3: Eurofins booked a betongslam delivery in as "Uspesifisert jord", which
    // ticked "Jord og sediment som er forurenset" where the human ticked "Avløpsslam".
    const { fields } = bkFromDatalab(datalabPayload({ matrise: "Uspesifisert jord" }), blocks, ORIGIN);
    const column = fields.filter(f => f.label.startsWith("Avfallstype (materiale):"));
    expect(column.filter(f => f.check)).toEqual([]);
    expect(column[0].note).toMatch(/states no material/);
  });

  it("marks a matched material row as a suggestion to confirm, not as extracted", () => {
    const { fields } = bkFromDatalab(datalabPayload({ matrise: "Betong" }), blocks, ORIGIN);
    const betong = fields.find(f => f.label === "Avfallstype (materiale): Betong eller tegl")!;
    expect(betong.check).toBe(true);
    expect(betong.src).toBe("human");
    expect(betong.note).toMatch(/Confirm/);
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

describe("values the document states but does not mean", () => {
  const blocks = flattenBlocks(CONVERT_JSON).blocks;

  it("drops a lab name read from the subcontractor list rather than reporting the wrong lab", () => {
    // 5 of 6 real reports came back with a Swedish sub-lab because extraction cited the
    // "Utførende laboratorium/Underleverandør" table instead of the page-1 header
    // (bk/BIG-TEST-FINDINGS.md finding 4). A blank lab is visibly missing; a wrong one is not.
    const { source } = bkFromDatalab(datalabPayload({
      laboratorium: "Eurofins Food & Feed Testing Sweden (Lidköping)",
      laboratorium_citations: ["/page/2/Table/44"],
    }), blocks, ORIGIN);

    expect(source.metadata.labName).toBeFalsy();
    expect(source.metadata.labNameNote).toMatch(/subcontractor/);
    expect(source.citations?.labName).toEqual([]);
  });

  it("drops a lab name cited to the footnote-prefixed list Datalab splits off from its heading", () => {
    // Real shape: convert returns the heading as its own SectionHeader and the lab lines as a
    // ListGroup whose text is just "a)* Eurofins … a) Eurofins …". Matching the heading alone
    // missed the block the citation points at, so the footnote marker is the tell.
    const listOnly = {
      ...blocks,
      "/page/1/ListGroup/5": {
        id: "/page/1/ListGroup/5", page: 1, blockType: "ListGroup",
        bbox: [0, 0, 10, 10] as [number, number, number, number], regions: [],
        text: "a)* Eurofins Food & Feed Testing Sweden (Lidköping), Sockerbruksg 3 a) Eurofins Food & Feed Testing Sweden (Lidköping)",
      },
    };
    const { source } = bkFromDatalab(datalabPayload({
      laboratorium: "Eurofins Food & Feed Testing Sweden (Lidköping)",
      laboratorium_citations: ["/page/1/ListGroup/5"],
    }), listOnly, ORIGIN);

    expect(source.metadata.labName).toBeFalsy();
    expect(source.metadata.labNameNote).toMatch(/subcontractor/);
  });

  it("keeps a lab name cited anywhere else", () => {
    const { source } = bkFromDatalab(datalabPayload({
      laboratorium: "Eurofins Environment Testing Norway (Moss)",
      laboratorium_citations: ["/page/2/Text/3"],
    }), blocks, ORIGIN);

    expect(source.metadata.labName).toBe("Eurofins Environment Testing Norway (Moss)");
    expect(source.metadata.labNameNote).toBeNull();
  });

  it("drops a hentested that is really the report's Referanse field", () => {
    const { source, fields } = bkFromDatalab(
      datalabPayload({ hentested: "Referanse: PFAS-prosjektet Alta" }), blocks, ORIGIN);

    expect(source.metadata.pickupLocation).toBeNull();
    const hentested = fields.find(f => f.label === "Hentested for avfallet")!;
    expect(hentested.value).toBeUndefined();
    expect(hentested.src).toBe("human");
  });

  it("keeps a hentested that names a real place", () => {
    const { source } = bkFromDatalab(datalabPayload({ hentested: "Alta lufthavn" }), blocks, ORIGIN);
    expect(source.metadata.pickupLocation).toBe("Alta lufthavn");
  });

  it("offers part 2 as a suggestion to confirm, not as a fact from the document", () => {
    // The report names its customer; the form asks for the waste producer. On two of three real
    // forms those were different companies (bk/BIG-TEST-FINDINGS.md finding 3), so the value is
    // prefilled but the field belongs to a person.
    const { fields } = bkFromDatalab(datalabPayload({
      oppdragsgiver: "Prosjektil AS",
      oppdragsgiver_adresse: "Gamle Forusveien 1",
    }), blocks, ORIGIN);

    for (const label of ["Avfallsprodusent", "Adresse", "Postnummer", "Poststed", "Kontaktperson"]) {
      const f = fields.find(x => x.label === label)!;
      expect(f.src, `${label} must not claim to be extracted`).toBe("human");
    }
    const produsent = fields.find(f => f.label === "Avfallsprodusent")!;
    expect(produsent.value).toBe("Prosjektil AS");
    expect(produsent.note).toMatch(/Confirm before use/);
  });
});

describe("leaching results must not become a hazard verdict", () => {
  const blocks = flattenBlocks(CONVERT_JSON).blocks;

  /** An ALS ristetest page: bare element names, mg/kg TS, but the release, not the content. */
  const alsRistetest = () => datalabPayload({
    provemerking: "G5 Utlekkingstest 1-2 m ristetest",
    matrise: "JORD",
    analyseresultater: [
      { parameter: "Pb (Bly)", analyte_id: "lead-compounds", verdi: 3.64, under_loq: false, enhet: "mg/kg TS" },
      { parameter: "Zn (Sink)", analyte_id: "zinc-oxide", verdi: 13.4, under_loq: false, enhet: "mg/kg TS" },
    ],
  });

  it("treats every row of a sub-report labelled as a leaching test as a release, whatever the unit says", () => {
    const { source } = bkFromDatalab(alsRistetest(), blocks, ORIGIN);
    expect(source.results.every(r => r.isLeachateResult)).toBe(true);
    expect(source.hazardAssessable).toBe(false);
  });

  it("halts instead of ticking \"ordinært avfall\" when no total content survived", () => {
    // The failure this replaces: big_test/test_1's two documents are leaching data end to end,
    // and the form asserted "ikke farlig avfall, EAL 17 05 04, deponi for ordinært avfall" on
    // waste the producer had classified as farlig avfall.
    const { fields, source } = bkFromDatalab(alsRistetest(), blocks, ORIGIN);
    expect(source.eal.code).toBeNull();

    for (const label of ["Deponi for ordinært avfall", "Avfallstype: Ordinært avfall",
                         "Deponi for farlig avfall", "Avfallstype: Farlig avfall"]) {
      const f = fields.find(x => x.label === label)!;
      expect(f.check, `${label} must not be ticked without a verdict`).toBe(false);
      expect(f.src, `${label} must be a person's call`).toBe("human");
      expect(f.note).toMatch(/no usable total-content analysis/);
    }
  });

  it("still classifies normally when the same sub-report carries real total content alongside leaching rows", () => {
    // big_test/test_3 after the delivery merge: 50 total-analysis rows plus the ristetest and
    // kolonnetest panels in one form. The leaching rows drop out; the verdict survives.
    const { source, fields } = bkFromDatalab(datalabPayload({
      provemerking: "1 prøve - 2 bokser",
      analyseresultater: [
        { parameter: "Arsen (As)", analyte_id: "arsenic", verdi: 1.8, under_loq: false, enhet: "mg/kg TS" },
        { parameter: "Barium (Ba) L/S=10", analyte_id: "barium-compounds", verdi: 3.3, under_loq: false, enhet: "mg/kg TS" },
        { parameter: "DOC L/S=10", verdi: 89, under_loq: false, enhet: "mg/l" },
      ],
    }), blocks, ORIGIN);

    expect(source.hazardAssessable).toBe(true);
    expect(source.eal.code).toBeTruthy();
    expect(fields.find(f => f.label === "Avfallstype: Ordinært avfall")!.src).toBe("derived");
  });

  it("halts on a layout with no sample-label field when the document says it holds no total analysis", () => {
    // ALS's Excel support sheet: no "Prøvemerking:" anywhere, its two column headings are the
    // sample labels. Label matching alone missed it and 19 mg/kg TS leaching rows were classified.
    const { source } = bkFromDatalab(datalabPayload({
      provemerking: "",
      har_totalanalyse: false,
      analyseresultater: [
        { parameter: "Pb (Bly)", analyte_id: "lead-compounds", verdi: 3.64, under_loq: false, enhet: "mg/kg TS" },
      ],
    }), blocks, ORIGIN);
    expect(source.results.every(r => r.isLeachateResult)).toBe(true);
    expect(source.hazardAssessable).toBe(false);
    expect(source.eal.code).toBeNull();
  });

  it("does not let a lab non-answer win the description match", () => {
    // "Uspesifisert jord" scored against 10 13 99 "Avfall som ikke er spesifisert andre steder"
    // and won it — a confident wrong code off a word that means the lab did not know.
    const { source } = bkFromDatalab(datalabPayload({ matrise: "Uspesifisert jord" }), blocks, "eal-1013");
    expect(source.eal.code).not.toBe("10 13 99");
    expect(source.eal.confidence).toMatch(/AMBIGUOUS/);
  });

  it("picks the EAL code whose description matches the waste, not whichever comes first in the file", () => {
    // Chapter 1013 non-hazardous holds nine candidates; file order gives 10 13 01 "Avfall av
    // råstoffblanding før varmebehandling". The real answer for concrete sludge is 10 13 14.
    const { source } = bkFromDatalab(
      datalabPayload({ matrise: "Betongslam" }), blocks, "eal-1013");
    expect(source.eal.code).toBe("10 13 14");
    expect(source.eal.confidence).toMatch(/matched on description/);
  });
});
