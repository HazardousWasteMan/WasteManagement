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
      result({ rawAnalyteName: "Ba", resultValue: 0.13, unitRaw: "mg/l" }),
      result({ rawAnalyteName: "Cr", resultValue: 0.059, unitRaw: "mg/l" }),
      result({ rawAnalyteName: "Mo", resultValue: 0.069, unitRaw: "mg/l" }),
      result({ rawAnalyteName: "Cl", resultValue: 23, unitRaw: "mg/l" }),
      result({ rawAnalyteName: "pH", resultValue: 12.5, unitRaw: "" }),
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
      result({ unitRaw: "mg/l" }),
      result({ unitRaw: "mg/l" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(false);
  });

  it("returns false for a single stray liquid-unit row among mostly-solid rows", () => {
    const results: SampleResult[] = [
      result({ unitRaw: "mg/l" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
      result({ unitRaw: "mg/kg TS" }),
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
      result({ unitRaw: "µg/l" }),
      result({ unitRaw: "ng/l" }),
      result({ unitRaw: "g/l" }),
      result({ unitRaw: "mg/kg" }),
    ];
    expect(unitsIndicateLeachate(results)).toBe(true); // 3 liquid / 1 solid = 75% > 50%
  });
});
