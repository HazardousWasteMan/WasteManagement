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
    const { results: normalized } = normalizeSample(baseMetadata, results, analyteRef);
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
    const { results: normalized } = normalizeSample(baseMetadata, results, analyteRef);
    expect(normalized[0].resultDryBasisPct).toBeCloseTo(5.17, 2);
  });

  it("carries the LOQ value forward as the conservative estimate for a below-LOQ result", () => {
    const results: SampleResult[] = [
      {
        resultId: "r1", sampleId: "test-1", analyteId: "arsenic", rawAnalyteName: "arsenico",
        resultValue: null, isBelowLoq: true, loqValue: 10, unitRaw: "mg/kg", expressedOnDryBasis: true, method: null,
      },
    ];
    const { results: normalized } = normalizeSample(baseMetadata, results, analyteRef);
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
    const { results: normalized } = normalizeSample(baseMetadata, results, analyteRef);
    expect(normalized).toEqual([]);
  });

  it("strips the dry-basis marker real labs write into the unit (mg/kg TS)", () => {
    // Regression: live extraction of the Eurofins concrete report emits "mg/kg TS", which used
    // to fall through to the unrecognized-unit path and be read as a percentage — 1.8 mg/kg
    // arsenic became 1.8%, tripping 8 HP categories on a clean sample.
    const { results: out } = normalizeSample(baseMetadata, [{
      resultId: "r1", sampleId: "s1", analyteId: "arsenic", rawAnalyteName: "Arsen (As)",
      resultValue: 1.8, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS",
      expressedOnDryBasis: true, method: null,
    }], analyteRef);

    expect(out).toHaveLength(1);
    expect(out[0].resultDryBasisPct).toBeCloseTo(0.00018, 10);
    expect(out[0].confidenceFlags).toEqual([]);
  });

  it("strips the µg/kg TS marker too", () => {
    const { results: out } = normalizeSample(baseMetadata, [{
      resultId: "r1", sampleId: "s1", analyteId: "arsenic", rawAnalyteName: "Fenantren",
      resultValue: 320, isBelowLoq: false, loqValue: null, unitRaw: "µg/kg TS",
      expressedOnDryBasis: true, method: null,
    }], analyteRef);

    expect(out[0].resultDryBasisPct).toBeCloseTo(0.000032, 12);
    expect(out[0].confidenceFlags).toEqual([]);
  });

  // Regression for bk/BIG-TEST-FINDINGS.md finding 1. A leaching test says how much of a
  // substance washes out per litre of eluate; an HP threshold is a fraction of the waste's total
  // mass. "mg/l" is not one of the three known units, so it used to be read as a percentage —
  // 0.069 mg/l molybdenum became 0.069 %, and two clean real samples came back "farlig avfall".
  it("excludes a leaching result rather than reading mg/l as a percentage", () => {
    const { results, flags } = normalizeSample(baseMetadata, [{
      resultId: "r1", sampleId: "s1", analyteId: "arsenic", rawAnalyteName: "Arsen (As) L/S=10",
      resultValue: 0.0533, isBelowLoq: false, loqValue: null, unitRaw: "mg/l",
      expressedOnDryBasis: false, method: null,
    }], analyteRef);

    expect(results).toEqual([]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatch(/leaching result/);
  });

  it("excludes a leaching row detected from its L/S= parameter name even when the unit is mg/kg TS", () => {
    const { results, flags } = normalizeSample(baseMetadata, [{
      resultId: "r1", sampleId: "s1", analyteId: "arsenic", rawAnalyteName: "Arsen (As) L/S=10",
      resultValue: 0.05, isBelowLoq: true, loqValue: 0.05, unitRaw: "mg/kg TS",
      expressedOnDryBasis: true, method: null,
    }], analyteRef);

    expect(results).toEqual([]);
    expect(flags[0]).toMatch(/leaching result/);
  });

  it("excludes an unrecognized unit instead of using the number as a percentage", () => {
    const { results, flags } = normalizeSample(baseMetadata, [{
      resultId: "r1", sampleId: "s1", analyteId: "arsenic", rawAnalyteName: "Arsen (As)",
      resultValue: 950, isBelowLoq: false, loqValue: null, unitRaw: "mS/m",
      expressedOnDryBasis: false, method: null,
    }], analyteRef);

    expect(results).toEqual([]);
    expect(flags[0]).toMatch(/unrecognized unit/);
  });

  it("strips '% tørrvekt' — a fourth real dry-basis spelling, from an ALS report", () => {
    const { results } = normalizeSample(baseMetadata, [{
      resultId: "r1", sampleId: "s1", analyteId: "arsenic", rawAnalyteName: "TS",
      resultValue: 82.4, isBelowLoq: false, loqValue: null, unitRaw: "% tørrvekt",
      expressedOnDryBasis: true, method: null,
    }], analyteRef);

    expect(results[0].resultDryBasisPct).toBe(82.4);
    expect(results[0].confidenceFlags).toEqual([]);
  });
});
