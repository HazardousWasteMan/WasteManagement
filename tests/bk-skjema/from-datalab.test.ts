import { describe, it, expect } from "vitest";
import { bkFromDatalab, resolveCitations } from "@/lib/bk-skjema/from-datalab";
import { flattenBlocks } from "@/lib/bk-skjema/datalab";
import { bkSection } from "@/lib/bk-skjema/form-map";

// Shaped exactly like a real /convert json tree: nested children, ids that encode the page.
const CONVERT_JSON = {
  id: "/page/2/Page/2",
  block_type: "Page",
  bbox: [0, 0, 1000, 1400],
  children: [
    { id: "/page/2/Text/3", block_type: "Text", bbox: [10, 20, 200, 40], html: "<p>Avinor <b>AS</b></p>", children: [] },
    { id: "/page/2/Table/11", block_type: "Table", bbox: [24, 500, 900, 1200], html: "<table><tr><td>Arsen (As)</td><td>1.8</td></tr></table>", children: [] },
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
