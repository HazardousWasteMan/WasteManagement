import type { SampleMetadata, SampleResult, AnalyteReference, NormalizedResult } from "./types";

/**
 * A leaching test (ristetest EN 12457-2, kolonnetest) reports how much of a substance washes
 * OUT of the waste, in mg per litre of eluate at a given liquid:solid ratio. That is a mobility
 * figure. HP thresholds are fractions of the total mass of the waste. Comparing the two is
 * meaningless, and because "mg/l" is not one of the three units below it used to fall through
 * to the percentage branch: 0.069 mg/l molybdenum became 0.069 %, 280 mg/l DOC became 280 %.
 * That produced "farlig avfall" on two clean real samples (bk/BIG-TEST-FINDINGS.md finding 1),
 * once off a below-LOQ nickel row.
 *
 * Detected three ways: the unit is per volume; the parameter name carries "L/S=" (Eurofins writes
 * "Barium (Ba) L/S=10"); or the caller set `isLeachateResult`, which is how the ALS case is
 * caught — ALS prints the release in mg/kg TS with bare element names under a heading reading
 * "Totale elementer/metaller", inside a table whose sample label says "Utlekkingstest ...
 * ristetest". Nothing about that row is distinguishable in isolation, so the document's own
 * section heading has to travel with it.
 */
const isLeachateUnit = (unit: string) => /\/\s*l$/i.test(unit.trim());
const isLeachateName = (name: string) => /\bl\s*\/\s*s\s*=/i.test(name);

export interface NormalizedSample {
  results: NormalizedResult[];
  /** Rows excluded from classification, and why. Surfaced on `hazard.confidenceFlags`. */
  flags: string[];
}

export function normalizeSample(
  metadata: SampleMetadata,
  results: SampleResult[],
  analyteRef: AnalyteReference[]
): NormalizedSample {
  const normalized: NormalizedResult[] = [];
  const flags: string[] = [];

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
    // "µg/kg TS", "% tørrvekt", Italian "mg/kg ss"), and that is exactly what extraction emits.
    // Matching unitRaw literally sent every such row down the "unrecognized unit" path, where the
    // value was used as-is *as a percentage* — 1.8 mg/kg arsenic became 1.8%, 18000x too high,
    // which tripped 8 HP categories on a genuinely clean concrete sample. The dry-basis fact is
    // already carried by expressedOnDryBasis, so the marker is stripped, not interpreted.
    const unit = result.unitRaw.replace(/\s*(TS|ts|tørrstoff|tørrvekt|ss|s\.s\.|dw|DW)\s*$/u, "").trim();

    if (result.isLeachateResult || isLeachateUnit(unit) || isLeachateName(result.rawAnalyteName)) {
      flags.push(`${result.rawAnalyteName}: leaching result ("${result.unitRaw}") excluded — an eluate concentration is not a total content and cannot be compared against HP thresholds`);
      continue;
    }

    let resultDryBasisPct: number;
    if (unit === "%") {
      resultDryBasisPct = rawValue;
    } else if (unit === "mg/kg") {
      resultDryBasisPct = rawValue / 10000;
    } else if (unit === "µg/kg") {
      resultDryBasisPct = rawValue / 10000000;
    } else {
      // Never guess a unit. Using an unknown one as-is is what caused both real false-positive
      // "farlig avfall" verdicts; excluding the row loses a substance, which is recoverable.
      flags.push(`${result.rawAnalyteName}: unrecognized unit "${result.unitRaw}" — row excluded from hazard classification rather than read as a percentage`);
      continue;
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

  return { results: normalized, flags };
}
