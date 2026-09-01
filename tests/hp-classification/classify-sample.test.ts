import { describe, it, expect } from "vitest";
import { classifySample } from "@/lib/hp-classification/classify-sample";
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
    // Nothing usable survived, so there is no verdict — and without one the mirror pair
    // (17 05 03* / 17 05 04) cannot be chosen between. This used to assert the non-hazardous
    // half, which on big_test/test_1 called hazardous waste clean.
    expect(result.noDataWarning).toBe(true);
    expect(result.eal.code).toBeNull();
    expect(result.eal.confidence).toMatch(/HALT — no usable total-content analysis/);
  });

  it("halts the EAL code when every row was a leaching result, rather than defaulting to the non-hazardous mirror code", () => {
    // big_test/test_1: both documents are ristetest/kolonnetest end to end. ALS prints the
    // released amount in mg/kg TS under a heading reading "Totale elementer/metaller", so the
    // rows look exactly like a total analysis and were classified as one.
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "t", analyteId: "test-carcinogen", rawAnalyteName: "Pb (Bly)",
        resultValue: 3.64, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS",
        expressedOnDryBasis: true, method: null, isLeachateResult: true,
      },
    ];
    const result = classifySample(baseMetadata, results, [], analyteRef, [], { "test-origin": "1705" });
    expect(result.noDataWarning).toBe(true);
    expect(result.eal.code).toBeNull();
    expect(result.hazard.confidenceFlags.join(" ")).toMatch(/leaching result/);
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
});
