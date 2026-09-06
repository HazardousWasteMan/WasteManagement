import { describe, it, expect } from "vitest";
import { classifySample, unitsIndicateLeachate } from "@/lib/hp-classification/classify-sample";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";

const baseMetadata: SampleMetadata = {
  sampleId: "t", externalReportNo: "t", labName: "t", customerName: "t", sampleMarking: "t",
  matrixType: "jord", samplingDate: null, receiptDate: null, originProcess: "test-origin",
  producerName: null, physicalState: "solid", viscosity40cMm2s: null, ph: null,
  labClassificationGiven: false, labStatedEalCode: null,
};

const analyteRef: AnalyteReference[] = [
  {
    analyteId: "test-carcinogen", canonicalNameNo: "test", canonicalNameIt: null, canonicalNameEn: "test",
    casNumber: null, defaultUnit: "%", substanceGroup: "other", mFactorAcute: null, mFactorChronic: null,
    elementSymbol: null, hStatement: "H350", hazardClass: "Carc. 1A", hStatements: null,
  },
];

describe("classifySample", () => {
  it("composes normalize -> classifyHazard -> assignEalCode for a simple non-speciated substance", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.resultsByHp.HP7).toBe(true);
    expect(result.hazard.isHazardous).toBe(true);
    expect(result.eal.code).toBe("17 05 03*");
  });

  it("skips a result with no matching AnalyteReference entry, never crashing", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "unregistered", rawAnalyteName: "unknown",
        resultValue: 99, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBe(false);
    expect(result.eal.code).toBe("17 05 04");
  });

  it("sets noDataWarning true when no results are provided, false otherwise", () => {
    const emptyResult = classifySample(baseMetadata, [], [], analyteRef, [], { "test-origin": "1705" });
    expect(emptyResult.noDataWarning).toBe(true);
    expect(emptyResult.hazard.isHazardous).toBe(false);

    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const nonEmptyResult = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(nonEmptyResult.noDataWarning).toBe(false);
  });

  it("sets noDataWarning true when results are present but none match a known analyte (all analyteId null or unmatched)", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: null, rawAnalyteName: "unrecognized analyte 1",
        resultValue: 1.2, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
      {
        resultId: "r2", sampleId: "t", analyteId: "unregistered-analyte", rawAnalyteName: "unrecognized analyte 2",
        resultValue: 3.4, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
      {
        resultId: "r3", sampleId: "t", analyteId: null, rawAnalyteName: "unrecognized analyte 3",
        resultValue: 5.6, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    // results.length is 3 (> 0), but none of these rows normalize to a known analyte,
    // so the old `results.length === 0` check would have missed this and left noDataWarning false.
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(results.length).toBeGreaterThan(0);
    expect(result.noDataWarning).toBe(true);
    expect(result.hazard.isHazardous).toBe(false);
  });

  it("a real newly-added PAH with a confirmed carcinogenicity classification correctly triggers HP7", () => {
    const realAnalyteRef = analyteReferenceRaw as AnalyteReference[];
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "benzo-a-anthracene", rawAnalyteName: "test",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const result = classifySample(baseMetadata, results, [], realAnalyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.resultsByHp.HP7).toBe(true);
  });

  it("negative control: the same PAH below the real 0.1% Carc. 1B threshold does NOT trigger HP7", () => {
    const realAnalyteRef = analyteReferenceRaw as AnalyteReference[];
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "benzo-a-anthracene", rawAnalyteName: "test",
        resultValue: 0.05, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const result = classifySample(baseMetadata, results, [], realAnalyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.resultsByHp.HP7).toBe(false);
  });

  it("gates HP classification to isHazardous: null when only leaching-test data exists (no total content)", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS", expressedOnDryBasis: true, method: null,
      },
    ];
    const leachateOnlyMetadata: SampleMetadata = {
      ...baseMetadata,
      ristetestUtfort: true,
      kolonnetestUtfort: false,
      totalinnholdUtfort: false,
    };
    const result = classifySample(leachateOnlyMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBeNull();
    expect(result.hazard.confidenceFlags.some(f => f.includes("leach") || f.includes("total content"))).toBe(true);
    expect(result.hazard.confidenceFlagsNo?.some(f => f.includes("utlekkingstest") || f.includes("totalinnhold"))).toBe(true);
    expect(result.eal.code).toBeNull();
  });

  it("does NOT gate when totalinnholdUtfort is absent (default-absent means assume present)", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const metadataWithLeachFlagOnly: SampleMetadata = { ...baseMetadata, ristetestUtfort: true };
    const result = classifySample(metadataWithLeachFlagOnly, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBe(true); // unaffected — same as the existing non-gated test above
  });

  it("does NOT gate when totalinnholdUtfort is explicitly true, even alongside a leaching flag", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const mixedMetadata: SampleMetadata = {
      ...baseMetadata, ristetestUtfort: true, totalinnholdUtfort: true,
    };
    const result = classifySample(mixedMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBe(true);
  });

  it("gates via the unit check alone (overriding an explicit totalinnholdUtfort: true) and carries the distinct override message", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "Ba",
        resultValue: 0.13, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
      { resultId: "r2", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "Cr",
        resultValue: 0.059, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
    ];
    const metadataWithExplicitTotalContentClaim: SampleMetadata = {
      ...baseMetadata, totalinnholdUtfort: true,
    };
    const result = classifySample(metadataWithExplicitTotalContentClaim, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBeNull();
    expect(result.hazard.confidenceFlags[0]).toContain("overriding the extraction's own totalinnhold_utfort flag");
    expect(result.hazard.confidenceFlagsNo?.[0]).toContain("overstyrer ekstraksjonens eget totalinnhold_utfort-flagg");
    expect(result.eal.code).toBeNull();
  });

  it("does NOT gate a mixed report where total-content data exists for the same analytes also re-reported in mg/l (real dual-reporting pattern)", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen (total)",
        resultValue: 5000, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS", expressedOnDryBasis: true, method: null }, // 5000 mg/kg TS = 0.5% dry basis, above the 0.1% HP7 threshold
      { resultId: "r2", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen (eluat)",
        resultValue: 0.01, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    // The mg/l row for "test-carcinogen" is excluded (its analyte has a solid-basis row), so
    // unitsIndicateLeachate returns false; the keyword flag is also false (baseMetadata has no
    // leaching flags set) — so classification proceeds normally on the real total-content row.
    expect(result.hazard.isHazardous).toBe(true);
  });

  it("does NOT misclassify a mixed report by feeding a dual-reported analyte's liquid-unit row into classification as if it were dry-basis %", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen (total)",
        resultValue: 10, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS", expressedOnDryBasis: true, method: null }, // 10 mg/kg TS = 0.001% dry basis — well below the 0.1% HP7/H350 threshold
      { resultId: "r2", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen (eluat)",
        resultValue: 0.13, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null }, // same analyte, liquid-basis re-reporting — must be excluded from classification entirely
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    // Without this fix, the 0.13 mg/l row would be misread as 0.13% dry basis (> 0.1% threshold),
    // wrongly triggering HP7. With the fix, only the real 10 mg/kg TS (0.001%) row is classified,
    // which is safely below threshold.
    expect(result.hazard.isHazardous).toBe(false);
    expect(result.hazard.resultsByHp.HP7).not.toBe(true);
  });

  it("leaves a traceable confidenceFlags note when a liquid-basis row was excluded from a non-gated classification", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen (total)",
        resultValue: 10, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS", expressedOnDryBasis: true, method: null },
      { resultId: "r2", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen (eluat)",
        resultValue: 0.13, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBe(false); // real classification proceeded, not gated
    expect(result.hazard.confidenceFlags.some(f => f.includes("excluded from HP classification") && f.includes("liquid/eluate"))).toBe(true);
    expect(result.hazard.confidenceFlagsNo?.some(f => f.includes("utelatt fra HP-klassifiseringen") && f.includes("væske-/eluat"))).toBe(true);
  });

  it("does NOT add the exclusion note when no liquid-basis rows were present", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "test carcinogen",
        resultValue: 0.5, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS", expressedOnDryBasis: true, method: null },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.confidenceFlags.some(f => f.includes("excluded from HP classification"))).toBe(false);
  });

  it("uses the non-overclaiming unit-triggered message when totalinnholdUtfort was never claimed true (absent)", () => {
    const results: SampleResult[] = [
      { resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "Ba",
        resultValue: 0.13, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
      { resultId: "r2", sampleId: "t", analyteId: "test-carcinogen-2", rawAnalyteName: "Cr",
        resultValue: 0.059, isBelowLoq: false, loqValue: null, unitRaw: "mg/l", expressedOnDryBasis: true, method: null },
    ];
    // baseMetadata has totalinnholdUtfort left unset (undefined) — no claim was ever made to override.
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.hazard.isHazardous).toBeNull();
    expect(result.hazard.confidenceFlags[0]).not.toContain("overriding the extraction's own totalinnhold_utfort flag");
    expect(result.hazard.confidenceFlags[0]).toContain("even though the extraction did not confirm total-content data was collected");
  });
});

function result(overrides: Partial<SampleResult>): SampleResult {
  return {
    resultId: "r", sampleId: "t", analyteId: "x", rawAnalyteName: "x",
    resultValue: 1, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS",
    expressedOnDryBasis: true, method: null,
    ...overrides,
  };
}

describe("unitsIndicateLeachate", () => {
  it("returns true for the real Test-1 leachate pattern (Ba/Cr/Mo/Cl in mg/l, pH unitless)", () => {
    const results: SampleResult[] = [
      result({ analyteId: "ba", rawAnalyteName: "Ba", resultValue: 0.13, unitRaw: "mg/l" }),
      result({ analyteId: "cr", rawAnalyteName: "Cr", resultValue: 0.059, unitRaw: "mg/l" }),
      result({ analyteId: "mo", rawAnalyteName: "Mo", resultValue: 0.069, unitRaw: "mg/l" }),
      result({ analyteId: "cl", rawAnalyteName: "Cl", resultValue: 23, unitRaw: "mg/l" }),
      result({ analyteId: "ph", rawAnalyteName: "pH", resultValue: 12.5, unitRaw: "" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(true);
  });

  it("returns false for a normal total-content sample (mg/kg TS units)", () => {
    const results: SampleResult[] = [
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("returns false at exactly a 50/50 liquid/solid split (majority requires strictly more than half)", () => {
    const results: SampleResult[] = [
      result({ analyteId: "ba", unitRaw: "mg/l" }),
      result({ analyteId: "cr", unitRaw: "mg/l" }),
      result({ analyteId: "mo", unitRaw: "mg/kg TS" }),
      result({ analyteId: "cl", unitRaw: "mg/kg TS" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("returns false for a single stray liquid-unit row among mostly-solid rows", () => {
    const results: SampleResult[] = [
      result({ analyteId: "ba", unitRaw: "mg/l" }),
      result({ analyteId: "cr", unitRaw: "mg/kg TS" }),
      result({ analyteId: "mo", unitRaw: "mg/kg TS" }),
      result({ analyteId: "cl", unitRaw: "mg/kg TS" }),
      result({ analyteId: "zn", unitRaw: "mg/kg TS" }),
      result({ analyteId: "pb", unitRaw: "mg/kg TS" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("returns false when no rows have a recognized liquid or solid unit (absence of evidence is not evidence)", () => {
    const results: SampleResult[] = [
      result({ unitRaw: "%" }),
      result({ unitRaw: "" }),
      result({ unitRaw: "mg/m3" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("recognizes µg/l and ng/l and g/l as liquid units, and mg/kg (no TS suffix) as solid", () => {
    const results: SampleResult[] = [
      result({ analyteId: "ug-l-analyte", unitRaw: "µg/l" }),
      result({ analyteId: "ng-l-analyte", unitRaw: "ng/l" }),
      result({ analyteId: "g-l-analyte", unitRaw: "g/l" }),
      result({ analyteId: "mg-kg-analyte", unitRaw: "mg/kg" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(true); // 3 liquid / 1 solid = 75% > 50%
  });

  it("excludes a liquid-unit row from the count when the same analyte also has a solid-unit (total-content) row — the mixed-report case", () => {
    const results: SampleResult[] = [
      result({ analyteId: "ba", rawAnalyteName: "Ba", unitRaw: "mg/kg TS" }),
      result({ analyteId: "ba", rawAnalyteName: "Ba", unitRaw: "mg/l" }), // same analyte, re-reported — excluded from liquid count
      result({ analyteId: "cr", rawAnalyteName: "Cr", unitRaw: "mg/kg TS" }),
      result({ analyteId: "cr", rawAnalyteName: "Cr", unitRaw: "mg/l" }), // same analyte, re-reported — excluded from liquid count
    ];
    // Both liquid rows are excluded (their analytes have solid counterparts) — liquidCount=0, solidCount=2 → false.
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("does NOT exclude a liquid-unit row when its analyte has no solid-unit counterpart, even in a report that also has unrelated solid-unit rows", () => {
    const results: SampleResult[] = [
      result({ analyteId: "ba", rawAnalyteName: "Ba", unitRaw: "mg/kg TS" }),
      result({ analyteId: "cr", rawAnalyteName: "Cr", unitRaw: "mg/l" }), // different analyte, no solid counterpart — counted
      result({ analyteId: "mo", rawAnalyteName: "Mo", unitRaw: "mg/l" }), // different analyte, no solid counterpart — counted
      result({ analyteId: "cl", rawAnalyteName: "Cl", unitRaw: "mg/l" }), // different analyte, no solid counterpart — counted
    ];
    // liquidCount=3, solidCount=1 → 75% > 50% → true.
    expect(unitsIndicateLeachate(results)).toBe(true);
  });

  it("excludes only the dual-reported analyte's liquid row while still counting a genuinely leachate-only analyte's liquid row", () => {
    const results: SampleResult[] = [
      result({ analyteId: "ba", rawAnalyteName: "Ba", unitRaw: "mg/kg TS" }),
      result({ analyteId: "ba", rawAnalyteName: "Ba", unitRaw: "mg/l" }), // dual-reported — excluded
      result({ analyteId: "cr", rawAnalyteName: "Cr", unitRaw: "mg/l" }), // leachate-only — counted
    ];
    // liquidCount=1 (cr only), solidCount=1 (ba) → 1/2=0.5, not > 0.5 → false.
    expect(unitsIndicateLeachate(results)).toBe(false);
  });
});
