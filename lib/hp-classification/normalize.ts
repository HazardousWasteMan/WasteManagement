import type { SampleMetadata, SampleResult, AnalyteReference, NormalizedResult } from "./types";

export function normalizeSample(
  metadata: SampleMetadata,
  results: SampleResult[],
  analyteRef: AnalyteReference[]
): NormalizedResult[] {
  const normalized: NormalizedResult[] = [];

  for (const result of results) {
    if (!result.analyteId) continue; // unmapped analyte — skip, never guess
    const ref = analyteRef.find(a => a.analyteId === result.analyteId);
    if (!ref) continue; // no reference entry for this analyteId — skip, never guess

    const confidenceFlags: string[] = [];
    const rawValue = result.isBelowLoq ? result.loqValue : result.resultValue;
    if (rawValue === null) continue; // no usable value at all

    if (result.isBelowLoq) {
      confidenceFlags.push(`non-detect at LOQ = ${rawValue} ${result.unitRaw} — using LOQ as conservative value`);
    }

    let resultDryBasisPct: number;
    if (result.unitRaw === "%") {
      resultDryBasisPct = rawValue;
    } else if (result.unitRaw === "mg/kg") {
      resultDryBasisPct = rawValue / 10000;
    } else if (result.unitRaw === "µg/kg") {
      resultDryBasisPct = rawValue / 10000000;
    } else {
      confidenceFlags.push(`unrecognized unit "${result.unitRaw}" — value used as-is, may be incorrect`);
      resultDryBasisPct = rawValue;
    }

    if (!result.expressedOnDryBasis) {
      confidenceFlags.push("result not on dry basis — normalization to dry basis not applied (no tørrstoff/residuo value available for this conversion path)");
    }

    normalized.push({
      analyteId: result.analyteId,
      resultDryBasisPct,
      isBelowLoq: result.isBelowLoq,
      confidenceFlags,
    });
  }

  return normalized;
}
