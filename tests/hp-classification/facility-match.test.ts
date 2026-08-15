import { describe, it, expect } from "vitest";
import facilityStoleheia from "@/lib/data/facility-stoleheia.json";
import facilityReturkraft from "@/lib/data/facility-returkraft.json";
import crosswalk from "@/lib/data/avfallsstoffnummer-eal-crosswalk.json";
import { matchFacilities } from "@/lib/hp-classification/facility-match";

describe("facility data shape", () => {
  it("Støleheia has exactly 4 fixed hazardous EAL lines with real codes", () => {
    expect(facilityStoleheia.fixedHazardousEalLines).toHaveLength(4);
    const codes = facilityStoleheia.fixedHazardousEalLines.map(l => l.ealCode);
    expect(codes).toEqual(["12 01 16*", "13 05 03*", "16 02 12*", "17 06 01*"]);
  });

  it("Returkraft excludes mineral matrices including jord and betong", () => {
    expect(facilityReturkraft.mineralMatrixExclusion).toContain("jord");
    expect(facilityReturkraft.mineralMatrixExclusion).toContain("betong");
  });

  it("the crosswalk has exactly 4 real, permit-cited entries, all marked approximate", () => {
    expect(crosswalk).toHaveLength(4);
    for (const entry of crosswalk) {
      expect(entry.isApproximate).toBe(true);
      expect(entry.sourceNote.length).toBeGreaterThan(0);
    }
  });

  it("the crosswalk includes the 1614 -> 17 01 06* entry used by the Returkraft crosswalk-match test case", () => {
    const entry = crosswalk.find(e => e.avfallsstoffnummer === "1614");
    expect(entry?.ealCode).toBe("17 01 06*");
  });
});

describe("matchFacilities", () => {
  it("Italian sample (hazardous, 17 05 03*, Terra e rocce): Støleheia falls to the generic bucket, Returkraft reports the honest gap (unrecognized matrix vocabulary)", () => {
    const result = matchFacilities({ isHazardous: true, ealCode: "17 05 03*", matrixType: "Terra e rocce" });

    expect(result.stoleheia.eligible).toBe("likely");
    expect(result.stoleheia.route).toBe("generic hazardous bucket (avfallsforskriften vedlegg II pkt 2.3)");
    expect(result.stoleheia.caveat).toBeDefined();

    expect(result.returkraft.eligible).toBe("insufficient data");
    expect(result.returkraft.route).toBe("composition exclusion / avfallsstoffnummer crosswalk");
    expect(result.returkraft.reason).toContain("Norwegian-language");
  });

  it("a fixed-hazardous-line EAL code (17 06 01*, asbestos) matches Støleheia's fixed line directly", () => {
    const result = matchFacilities({ isHazardous: true, ealCode: "17 06 01*", matrixType: "Isolasjonsmateriale" });
    expect(result.stoleheia.eligible).toBe(true);
    expect(result.stoleheia.route).toBe("fixed hazardous EAL line");
  });

  it("Eurofins concrete sample (non-hazardous, 17 01 01, Betong): Støleheia reports insufficient data, Returkraft excluded on mineral matrix", () => {
    const result = matchFacilities({ isHazardous: false, ealCode: "17 01 01", matrixType: "Betong" });

    expect(result.stoleheia.eligible).toBe("insufficient data");
    expect(result.stoleheia.reason).toContain("eluat");

    expect(result.returkraft.eligible).toBe(false);
  });

  it("a matrix not recognized by the Norwegian mineral-exclusion vocabulary, even with a crosswalk-covered EAL code (17 01 06*), reports the honest gap rather than a confident match", () => {
    // Synthetic case (no real fixture uses this exact combination). Documents the honest-gap
    // discipline added in the final-review fix wave: since `mineralMatrixExclusion` is a
    // Norwegian-only term list with no corresponding "confirmed non-mineral" vocabulary, ANY
    // matrix string not found in that list — even one that reads as unambiguously non-mineral,
    // like "Sortert plastfraksjon" (sorted plastic fraction) — cannot be trusted to rule out the
    // composition exclusion. The crosswalk's true-positive path (a real ealCode -> avfallsstoffnummer
    // match) is still exercised here; it now correctly downgrades to "insufficient data" instead of
    // producing a false-confidence `eligible: true`.
    const result = matchFacilities({ isHazardous: true, ealCode: "17 01 06*", matrixType: "Sortert plastfraksjon" });
    expect(result.returkraft.eligible).toBe("insufficient data");
    expect(result.returkraft.detail).toBeDefined();
    expect(result.returkraft.caveat).toContain("approximate");
  });

  it("a non-mineral matrix with an EAL code not in the crosswalk reports the honest gap for Returkraft", () => {
    const result = matchFacilities({ isHazardous: false, ealCode: "20 01 99", matrixType: "Blandet avfall" });
    expect(result.returkraft.eligible).toBe("requires crosswalk (not available for this code)");
  });
});
