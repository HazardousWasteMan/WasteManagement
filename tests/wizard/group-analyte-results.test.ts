import { describe, it, expect } from "vitest";
import { groupAnalyteResults, type AnalyteResultRow } from "@/lib/wizard/group-analyte-results";

describe("groupAnalyteResults", () => {
  it("groups matched rows by their real substanceGroup, using a real matched analyteId", () => {
    // "arsenic" is a real entry in lib/data/analyte-reference.json with substanceGroup "metal".
    const rows: AnalyteResultRow[] = [
      { rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, unitRaw: "%" },
    ];
    const groups = groupAnalyteResults(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupName).toBe("Metals");
    expect(groups[0].rows).toHaveLength(1);
  });

  it("puts unmatched rows (analyteId: null) into their own 'Not in reference table' group, never guessed into a real category", () => {
    const rows: AnalyteResultRow[] = [
      { rawAnalyteName: "PFOS (Perfluoroktylsulfonat)", analyteId: null, resultValue: 0.26, unitRaw: "µg/kg TS" },
    ];
    const groups = groupAnalyteResults(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupName).toBe("Not in reference table");
  });

  it("the 'Not in reference table' group always sorts last, real substance groups keep first-appearance order", () => {
    const rows: AnalyteResultRow[] = [
      { rawAnalyteName: "unmatched-substance", analyteId: null, resultValue: 1, unitRaw: "%" },
      { rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, unitRaw: "%" },
    ];
    const groups = groupAnalyteResults(rows);
    expect(groups.map(g => g.groupName)).toEqual(["Metals", "Not in reference table"]);
  });

  it("keeps multiple rows of the same group together under one section", () => {
    // "arsenic" and "lead-compounds" are both real metal entries.
    const rows: AnalyteResultRow[] = [
      { rawAnalyteName: "arsenico", analyteId: "arsenic", resultValue: 5.17, unitRaw: "%" },
      { rawAnalyteName: "piombo", analyteId: "lead-compounds", resultValue: 12.3, unitRaw: "%" },
    ];
    const groups = groupAnalyteResults(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("returns an empty array for no rows", () => {
    expect(groupAnalyteResults([])).toEqual([]);
  });
});
