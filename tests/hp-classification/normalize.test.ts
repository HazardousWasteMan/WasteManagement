import { describe, it, expect } from "vitest";
import { normalizeSample } from "@/lib/hp-classification/normalize";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";

const baseMetadata: SampleMetadata = {
  sampleId: "test-1",
  externalReportNo: "TEST-1",
  labName: "TestLab",
  customerName: "Test Customer",
  sampleMarking: "T-1",
  matrixType: "jord",
  samplingDate: null,
  receiptDate: null,
  originProcess: "test",
  producerName: null,
  physicalState: "solid",
  viscosity40cMm2s: null,
  ph: null,
  labClassificationGiven: false,
  labStatedEalCode: null,
};

const analyteRef: AnalyteReference[] = [
  {
    analyteId: "arsenic",
    canonicalNameNo: "arsen",
    canonicalNameIt: "arsenico",
    canonicalNameEn: "arsenic",
    casNumber: "7440-38-2",
    defaultUnit: "mg/kg",
    substanceGroup: "metal",
    mFactorAcute: null,
    mFactorChronic: null,
    elementSymbol: null,
    hStatement: null,
    hazardClass: null,
    hStatements: null,
  },
];

describe("normalizeSample", () => {
  it("converts an already-percent result through unchanged when already dry-basis", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "test-1", analyteId: "arsenic", rawAnalyteName: "arsenico",
        resultValue: 5.17, isBelowLoq: false, loqValue: null, unitRaw: "%", expressedOnDryBasis: true, method: null,
      },
    ];
    const normalized = normalizeSample(baseMetadata, results, analyteRef);
    expect(normalized).toEqual([
      { analyteId: "arsenic", resultDryBasisPct: 5.17, isBelowLoq: false, confidenceFlags: [] },
    ]);
  });

  it("converts mg/kg to percent (divide by 10000)", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "test-1", analyteId: "arsenic", rawAnalyteName: "arsenico",
        resultValue: 51700, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg", expressedOnDryBasis: true, method: null,
      },
    ];
    const normalized = normalizeSample(baseMetadata, results, analyteRef);
    expect(normalized[0].resultDryBasisPct).toBeCloseTo(5.17, 2);
  });

  it("carries the LOQ value forward as the conservative estimate for a below-LOQ result", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "test-1", analyteId: "arsenic", rawAnalyteName: "arsenico",
        resultValue: null, isBelowLoq: true, loqValue: 10, unitRaw: "mg/kg", expressedOnDryBasis: true, method: null,
      },
    ];
    const normalized = normalizeSample(baseMetadata, results, analyteRef);
    expect(normalized[0].resultDryBasisPct).toBeCloseTo(0.001, 5); // 10 mg/kg -> 0.001%
    expect(normalized[0].isBelowLoq).toBe(true);
  });

  it("skips a result with no matching analyteId, with no crash", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "test-1", analyteId: null, rawAnalyteName: "unknown substance",
        resultValue: 5, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg", expressedOnDryBasis: true, method: null,
      },
    ];
    const normalized = normalizeSample(baseMetadata, results, analyteRef);
    expect(normalized).toEqual([]);
  });
});
