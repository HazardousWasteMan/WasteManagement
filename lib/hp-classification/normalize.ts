import type { SampleMetadata, SampleResult, AnalyteReference, NormalizedResult } from "./types";
import { prepareMeasurements, concentrationUnit } from "./measurement";

/** No unsupported numeric fallback and no undisclosed basis conversion. Exclusions remain
 * in the measurement boundary returned by classifySample, including for legacy callers. */
export function normalizeSample(metadata: SampleMetadata, results: SampleResult[], analyteRef: AnalyteReference[]): NormalizedResult[] {
  return prepareMeasurements(metadata, results, analyteRef).measurements.filter(m => m.hpEligibility.eligible).map(m => ({
    measurementId: m.measurementId,
    analyteId: m.mapping.analyteId!,
    resultDryBasisPct: (m.censoring === "detected" ? m.parsedValue! : m.reportedLimit!) / concentrationUnit(m.rawUnit)!.divisor,
    isBelowLoq: m.censoring !== "detected",
    confidenceFlags: m.censoring === "detected" ? [] : [`non-detect at LOQ = ${m.reportedLimit} ${m.rawUnit} — using LOQ as conservative value`],
  }));
}
