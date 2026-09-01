// Unit tests for sub-report detection. The live counterpart is bk/segment.test.ts.
import { describe, it, expect } from "vitest";
import { detectSubReports } from "@/lib/bk-skjema/segment";
import type { DatalabBlock } from "@/lib/bk-skjema/datalab";

/** A page whose header table states the given "label: value" pairs, as convert returns them. */
function page(n: number, pairs: [string, string][]): DatalabBlock {
  const cells = pairs.flatMap(([k, v]) => [k, v]);
  return {
    id: `/page/${n}/Table/1`,
    page: n,
    blockType: "Table",
    bbox: [0, 0, 100, 100],
    text: cells.join(" "),
    regions: [{ text: cells.join(" "), cells, bbox: [0, 0, 100, 10], kind: "row" }],
  };
}

const index = (blocks: DatalabBlock[]) => Object.fromEntries(blocks.map(b => [b.id, b]));

describe("detectSubReports", () => {
  it("merges the tests of one delivery: same Prøvemerking and Prøvetakingsdato, different Prøvenr.", () => {
    // big_test/test_3: a betongslam delivery analysed three ways — total analysis, ristetest,
    // kolonnetest — each with its own Prøvenr. Splitting on Prøvenr. produced three forms, and
    // the total-analysis one reported "ristetest: nei" because the ristetest sat on another form.
    const blocks = index([
      page(0, [["Prøvenr.:", "439-2026-06010138"], ["Prøvemerking:", "1 prøve - 2 bokser"], ["Prøvetakingsdato:", "28.05.2026"]]),
      page(1, []),
      page(2, [["Prøvenr.:", "439-2026-06010141"], ["Prøvemerking:", "1 prøve - 2 bokser"], ["Prøvetakingsdato:", "28.05.2026"]]),
      page(3, [["Prøvenr.:", "439-2026-06010142"], ["Prøvemerking:", "1 prøve - 2 bokser"], ["Prøvetakingsdato:", "28.05.2026"]]),
    ]);
    const reports = detectSubReports(blocks, [0, 1, 2, 3]);

    expect(reports).toHaveLength(1);
    expect(reports[0].pageRange).toBe("0-3");
    expect(reports[0].sampleNos).toEqual(["439-2026-06010138", "439-2026-06010141", "439-2026-06010142"]);
  });

  it("keeps genuinely separate deliveries apart — same date, different marking", () => {
    // big_test/test_4: four asphalt cores sampled the same day. One form each, as before.
    const blocks = index([
      page(0, [["Prøvenr.:", "439-2026-07270002"], ["Prøvemerking:", "ENAT-BØF-ASF1"], ["Prøvetakingsdato:", "21.07.2026"]]),
      page(1, [["Prøvenr.:", "439-2026-07270003"], ["Prøvemerking:", "ENAT-BØF-ASF2"], ["Prøvetakingsdato:", "21.07.2026"]]),
    ]);
    expect(detectSubReports(blocks, [0, 1]).map(r => r.marking)).toEqual(["ENAT-BØF-ASF1", "ENAT-BØF-ASF2"]);
  });

  it("does not merge on a matching date alone when the marking is missing", () => {
    // Both halves must be stated. An unmarked pair could be two unrelated samples.
    const blocks = index([
      page(0, [["Prøvenr.:", "A-1"], ["Prøvetakingsdato:", "21.07.2026"]]),
      page(1, [["Prøvenr.:", "A-2"], ["Prøvetakingsdato:", "21.07.2026"]]),
    ]);
    expect(detectSubReports(blocks, [0, 1])).toHaveLength(2);
  });
});
