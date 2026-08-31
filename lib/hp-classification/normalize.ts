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

    // Real lab reports write the dry-basis marker into the unit itself ("mg/kg TS",
    // "µg/kg TS", Italian "mg/kg ss"), and that is exactly what extraction emits. Matching
    // unitRaw literally sent every such row down the "unrecognized unit" path, where the value
    // was used as-is *as a percentage* — 1.8 mg/kg arsenic became 1.8%, 18000x too high, which
    // tripped 8 HP categories on a genuinely clean concrete sample. The dry-basis fact is
    // already carried by expressedOnDryBasis, so the marker is stripped, not interpreted.
    const unit = result.unitRaw.replace(/\s*(TS|ts|tørrstoff|ss|s\.s\.|dw|DW)\s*$/u, "").trim();

    let resultDryBasisPct: number;
    if (unit === "%") {
      resultDryBasisPct = rawValue;
    } else if (unit === "mg/kg") {
      resultDryBasisPct = rawValue / 10000;
    } else if (unit === "µg/kg") {
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
