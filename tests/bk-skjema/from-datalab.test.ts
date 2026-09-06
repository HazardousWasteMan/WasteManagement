import { describe, it, expect } from "vitest";
import { bkFromDatalab, resolveCitations } from "@/lib/bk-skjema/from-datalab";
import { flattenBlocks, narrowCitation, parseRegions } from "@/lib/bk-skjema/datalab";
import { bkSection, buildBkFields, type BkSource } from "@/lib/bk-skjema/form-map";

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

  it("flags an unrecognised matrix rather than silently ticking nothing", () => {
    const { fields } = bkFromDatalab(datalabPayload({ matrise: "Kryptonitt" }), blocks, ORIGIN);
    const row = fields.find(f => f.label.startsWith("Avfallstype (materiale):"))!;
    expect(row.src).toBe("human");
    expect(row.note).toMatch(/matched none/);
  });

  it("covers all 103 form fields and gives every derived field something to point at", () => {
    const { fields } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    expect(fields).toHaveLength(103);
    for (const f of fields.filter(f => f.src === "derived" && (f.value || f.check || f.select))) {
      expect(f.citations, `${f.field} has nothing to cite`).not.toHaveLength(0);
    }
  });

  it("Checkbox10's note includes the real legal citation when one is supplied via legalCitations", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const withCitation: BkSource = {
      ...source,
      legalCitations: {
        "eal-legal-basis": {
          citations: [{
            paragraphId: "no-avfallsforskriften-11-4",
            label: "Avfallsforskriften § 11-4",
            sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
            verifiedAt: "2026-09-03T19:26:14.030Z",
            disputed: false,
            primary: true,
          }],
        },
      },
    };
    const fields = buildBkFields(withCitation);
    const checkbox10 = fields.find(f => f.field === "Checkbox10")!;
    expect(checkbox10.note).toContain("Avfallsforskriften § 11-4");
    expect(checkbox10.legalCitation?.citations[0]?.paragraphId).toBe("no-avfallsforskriften-11-4");
  });

  it("Checkbox10 has no legalCitation and a plain note when legalCitations is absent", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const fields = buildBkFields(source);
    const checkbox10 = fields.find(f => f.field === "Checkbox10")!;
    expect(checkbox10.legalCitation ?? null).toBeNull();
    expect(checkbox10.note).toContain("hazardous substances detected above LOQ");
  });

  it("TextField38 carries the hp-methodology-basis legal citation unconditionally, regardless of isHazardous state", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const citation = {
      citations: [{
        paragraphId: "no-avfallsforskriften-11-2",
        label: "Avfallsforskriften § 11-2",
        sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-2",
        verifiedAt: "2026-09-06T00:00:00.000Z",
        disputed: false,
        primary: true,
      }],
    };
    for (const isHazardousOverride of [true, false, null]) {
      const withCitation: BkSource = {
        ...source, isHazardous: isHazardousOverride,
        legalCitations: { "hp-methodology-basis": citation },
      };
      const fields = buildBkFields(withCitation);
      const textField38 = fields.find(f => f.field === "TextField38")!;
      expect(textField38.legalCitation?.citations[0]?.paragraphId).toBe("no-avfallsforskriften-11-2");
    }
  });

  it("TextField38 has no legalCitation when hp-methodology-basis wasn't resolved", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const fields = buildBkFields(source);
    const textField38 = fields.find(f => f.field === "TextField38")!;
    expect(textField38.legalCitation ?? null).toBeNull();
  });

  it("Checkbox1/2/3 all carry the same deponi-category-basis citation when one is resolved", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const citation = {
      citations: [
        { paragraphId: "no-avfallsforskriften-9-5", label: "Avfallsforskriften § 9-5", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-5", verifiedAt: "2026-09-04T00:00:00.000Z", disputed: false, primary: false },
        { paragraphId: "no-avfallsforskriften-9-6", label: "Avfallsforskriften § 9-6", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-6", verifiedAt: "2026-09-04T00:00:00.000Z", disputed: false, primary: true },
      ],
    };
    const withCitation: BkSource = {
      ...source,
      legalCitations: { "deponi-category-basis": citation },
    };
    const fields = buildBkFields(withCitation);
    const checkbox1 = fields.find(f => f.field === "Checkbox1")!;
    const checkbox2 = fields.find(f => f.field === "Checkbox2")!;
    const checkbox3 = fields.find(f => f.field === "Checkbox3")!;
    expect(checkbox1.legalCitation?.citations).toHaveLength(2);
    expect(checkbox2.legalCitation?.citations).toHaveLength(2);
    expect(checkbox3.legalCitation?.citations).toHaveLength(2);
  });

  it("Checkbox1/2/3 have no legalCitation when deponi-category-basis wasn't resolved", () => {
    const { source } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    const fields = buildBkFields(source);
    expect(fields.find(f => f.field === "Checkbox1")!.legalCitation ?? null).toBeNull();
    expect(fields.find(f => f.field === "Checkbox2")!.legalCitation ?? null).toBeNull();
    expect(fields.find(f => f.field === "Checkbox3")!.legalCitation ?? null).toBeNull();
  });

  it("gates to isHazardous: null for a leaching-test-only sample (ristetest metals, no total content)", () => {
    const { classification, source } = bkFromDatalab(
      datalabPayload({
        matrise: "Jord",
        ristetest_utfort: true,
        kolonnetest_utfort: false,
        totalinnhold_utfort: false,
        analyseresultater: [
          { parameter: "Arsen (As)", analyte_id: "arsenic", verdi: 1.17, under_loq: false, loq: 0.5, enhet: "mg/kg TS" },
          { parameter: "Kadmium (Cd)", analyte_id: "cadmium-oxide", verdi: 0.189, under_loq: false, loq: 0.05, enhet: "mg/kg TS" },
        ],
      }),
      blocks,
      ORIGIN
    );
    expect(classification.hazard.isHazardous).toBeNull();
    expect(source.isHazardous).toBeNull();
    expect(classification.eal.code).toBeNull();
  });

  it("does not gate a normal total-content report — regression, using this file's default fixture", () => {
    // datalabPayload() with NO overrides has no ristetest_utfort/totalinnhold_utfort at all
    // (both absent) — per the default-absent rule, this must NOT gate, exactly like every other
    // existing test in this file that already calls bkFromDatalab(datalabPayload(), blocks, ORIGIN).
    const { classification } = bkFromDatalab(datalabPayload(), blocks, ORIGIN);
    expect(classification.hazard.isHazardous).not.toBeNull();
  });

  it("gates per-sample, not per-document: sample A has both test types, sample B has leaching only", () => {
    const sampleA = bkFromDatalab(
      datalabPayload({
        matrise: "Jord",
        ristetest_utfort: true,
        totalinnhold_utfort: true,
        analyseresultater: [{ parameter: "Benzo[a]pyren", analyte_id: "benzo-a-pyrene", verdi: 2.5, under_loq: false, loq: 0.1, enhet: "mg/kg TS" }],
      }),
      blocks,
      ORIGIN
    );
    const sampleB = bkFromDatalab(
      datalabPayload({
        matrise: "Jord",
        ristetest_utfort: true,
        totalinnhold_utfort: false,
        analyseresultater: [{ parameter: "Arsen (As)", analyte_id: "arsenic", verdi: 1.17, under_loq: false, loq: 0.5, enhet: "mg/kg TS" }],
      }),
      blocks,
      ORIGIN
    );
    expect(sampleA.classification.hazard.isHazardous).not.toBeNull();
    expect(sampleB.classification.hazard.isHazardous).toBeNull();
  });

  it("Checkbox1/3/4/6 and TextField41 render an indeterminate state, grounded in § 9-6, when isHazardous is null", () => {
    const legalCitations = {
      "hazard-indeterminate-basis": {
        citations: [{
          paragraphId: "no-avfallsforskriften-9-6", label: "Avfallsforskriften § 9-6",
          sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-6",
          verifiedAt: "2026-09-06T00:00:00.000Z", disputed: false, primary: true,
        }],
      },
    };
    const { fields, classification } = bkFromDatalab(
      datalabPayload({
        matrise: "Jord",
        ristetest_utfort: true,
        totalinnhold_utfort: false,
        analyseresultater: [{ parameter: "Arsen (As)", analyte_id: "arsenic", verdi: 1.17, under_loq: false, loq: 0.5, enhet: "mg/kg TS" }],
      }),
      blocks,
      ORIGIN,
      legalCitations
    );
    const checkbox1 = fields.find(f => f.field === "Checkbox1")!;
    const checkbox3 = fields.find(f => f.field === "Checkbox3")!;
    const checkbox4 = fields.find(f => f.field === "Checkbox4")!;
    const checkbox6 = fields.find(f => f.field === "Checkbox6")!;
    const textField41 = fields.find(f => f.field === "TextField41")!;

    expect(checkbox1.check).toBe(false);
    expect(checkbox3.check).toBe(false);
    expect(checkbox4.check).toBe(false);
    expect(checkbox6.check).toBe(false);
    expect(checkbox1.legalCitation?.citations[0]?.paragraphId).toBe("no-avfallsforskriften-9-6");
    expect(checkbox4.legalCitation?.citations[0]?.paragraphId).toBe("no-avfallsforskriften-9-6");
    expect(checkbox6.legalCitation?.citations[0]?.paragraphId).toBe("no-avfallsforskriften-9-6");
    expect(checkbox4.note).toBe(classification.hazard.confidenceFlags[0]);
    expect(checkbox6.note).toBe(classification.hazard.confidenceFlags[0]);
    expect(textField41.value).toContain("Ikke bestemt");

    // TextField41/buildDescription are Norwegian-only — must quote the Norwegian companion flag,
    // never the English confidenceFlags text.
    expect(textField41.value).toContain(classification.hazard.confidenceFlagsNo?.[0]);
    expect(textField41.value).not.toContain(classification.hazard.confidenceFlags[0]);

    // Single-source-of-truth: Checkbox notes are machine/reviewer-facing and stay English — the
    // note text must be the EXACT confidenceFlags string, not an independently-paraphrased one.
    expect(checkbox1.note).toBe(classification.hazard.confidenceFlags[0]);
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

  it("decodes HTML entities in cell text rather than leaving them literal (e.g. Fluoren &lt; 0.030)", () => {
    const rawHtml = `<tr data-bbox="24 700 900 722"><td>Fluoren</td><td>&lt; 0.030 mg/kg TS</td></tr>`;
    const regions = parseRegions(rawHtml);
    expect(regions).toHaveLength(1);
    expect(regions[0].cells).toEqual(["Fluoren", "< 0.030 mg/kg TS"]);
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
