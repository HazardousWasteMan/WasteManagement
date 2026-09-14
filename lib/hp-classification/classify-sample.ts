import { prepareMeasurements, type MeasurementBoundary } from "./measurement";
import { normalizeSample } from "./normalize";
import { speciateElement, type ElementCompoundForm } from "./speciate";
import { classifyHazard, type NormalizedResultWithClp, type TestResult, type HazardClassification } from "./hazard";
import { assignEalCode, type EalAssignment } from "./eal";
import type { SampleMetadata, SampleResult, AnalyteReference } from "./types";
import { inventoryLandfillAcceptance } from "./landfill-acceptance";

/** Legacy diagnostic retained for callers; never used to establish role or HP eligibility. */
const LIQUID_UNIT_PATTERN = /\/\s*[lL]\b/;
const SOLID_UNIT_PATTERN = /\/\s*kg\b/i;

/** @deprecated Unit-count diagnostic only; units do not identify leaching. */
export function unitsIndicateLeachate(results: SampleResult[]): boolean {
  const solidAnalyteIds = new Set<string>();
  for (const r of results) {
    if (r.analyteId && SOLID_UNIT_PATTERN.test(r.unitRaw)) {
      solidAnalyteIds.add(r.analyteId);
    }
  }
  let liquidCount = 0;
  let solidCount = 0;
  for (const r of results) {
    if (LIQUID_UNIT_PATTERN.test(r.unitRaw)) {
      // A liquid-basis row for an analyte that ALSO has a real solid-basis (total-content) row
      // elsewhere in this sample is a mixed-report re-reporting, not evidence of a leachate-only
      // sample — that analyte's real classification data already exists in its solid-basis row.
      // Excluding it here is what stops a mixed total-content-plus-leaching-table report from
      // being miscounted into the leachate majority just because the leaching table has more rows.
      if (r.analyteId && solidAnalyteIds.has(r.analyteId)) continue;
      liquidCount++;
    } else if (SOLID_UNIT_PATTERN.test(r.unitRaw)) {
      solidCount++;
    }
  }
  const counted = liquidCount + solidCount;
  if (counted === 0) return false;
  return liquidCount / counted > 0.5;
}

export type ClassificationTrace = {
  mode: "total-content" | "indeterminate-basis";
  normalized: ReturnType<typeof normalizeSample>;
  hpInputs: NormalizedResultWithClp[];
  measurementBoundary?: MeasurementBoundary;
};

export function classifySample(
  metadata: SampleMetadata,
  results: SampleResult[],
  testResults: TestResult[],
  analyteRef: AnalyteReference[],
  compoundForms: ElementCompoundForm[],
  originToChapterLookup: Record<string, string>,
  recordTrace?: (trace: ClassificationTrace) => void
): { hazard: HazardClassification; eal: EalAssignment; noDataWarning: boolean; measurementBoundary: MeasurementBoundary; landfillAcceptance: ReturnType<typeof inventoryLandfillAcceptance> } {
  const measurementBoundary = prepareMeasurements(metadata, results, analyteRef);
  const resultsForClassification = results;
  const normalized = normalizeSample(metadata, resultsForClassification, analyteRef);
  const noDataWarning = normalized.length === 0;

  const withClp: NormalizedResultWithClp[] = [];
  // A measured element does not establish which hazardous compound was present.
  // Non-detects and hypothetical compound forms are never reported as confirmed detections.
  let hasUnresolvedSpecies = false;
  let hasAboveLoqHazardousSubstance = false;
  for (const n of normalized) {
    const ref = analyteRef.find(a => a.analyteId === n.analyteId);
    if (!ref) continue; // no reference entry — skip, never guess (should already be filtered by normalizeSample, defensive here too)

    if (ref.elementSymbol) {
      const compounds = speciateElement(ref.elementSymbol, n.resultDryBasisPct, compoundForms);
      for (const c of compounds) {
        for (const clp of c.clpClassifications) {
          withClp.push({
            measurementId: n.measurementId,
            alternativeGroup: n.measurementId, scenarioId: c.compoundName, assumedSpecies: true,
            substanceName: c.compoundName,
            resultPct: c.resultPct,
            hStatement: clp.hStatement,
            hazardClass: clp.hazardClass,
            mFactorAcute: clp.hStatement === "H400" ? clp.mFactorAcute : null,
            mFactorChronic: clp.hStatement === "H410" ? clp.mFactorChronic : null,
          });
          if (!n.isBelowLoq) hasUnresolvedSpecies = true;
        }
      }
    } else if (ref.hStatement && ref.hazardClass) {
      withClp.push({
        measurementId: n.measurementId,
        substanceName: ref.analyteId,
        resultPct: n.resultDryBasisPct,
        hStatement: ref.hStatement,
        hazardClass: ref.hazardClass,
        mFactorAcute: null,
        mFactorChronic: ref.mFactorChronic,
      });
      if (!n.isBelowLoq) hasAboveLoqHazardousSubstance = true;
    } else if (ref.hStatements) {
      for (const h of ref.hStatements) {
        withClp.push({
          measurementId: n.measurementId,
          substanceName: ref.analyteId,
          resultPct: n.resultDryBasisPct,
          hStatement: h.hStatement,
          hazardClass: h.hazardClass,
          mFactorAcute: null,
          mFactorChronic: ref.mFactorChronic,
        });
        if (!n.isBelowLoq) hasAboveLoqHazardousSubstance = true;
      }
    }
    // an AnalyteReference entry with none of elementSymbol/hStatement/hStatements set has no known
    // hazard classification — its normalized result is silently excluded from HP classification,
    // never guessed into a category.
  }

  for (const [index,input] of withClp.entries()) {
    input.inputId = `${input.measurementId}/${input.scenarioId ?? input.substanceName}/${input.hStatement}/${index}`;
    input.censoring = measurementBoundary.measurements.find(m=>m.measurementId===input.measurementId)?.censoring;
  }
  const issues = measurementBoundary.measurements.filter(m=>!m.hpEligibility.eligible && !["leaching_batch","leaching_column","physical_or_composition"].includes(m.analyticalRole)).map(m=>({code:"excluded_measurement",measurementIds:[m.measurementId],reason:m.hpEligibility.reasons.join(", ")}));
  for(const n of normalized) if(!withClp.some(i=>i.measurementId===n.measurementId)) issues.push({code:"missing_clp_mapping",measurementIds:[n.measurementId!],reason:"Reference entry has no usable species/CLP mapping"});
  const hazard = classifyHazard(withClp, metadata, testResults, {issues});
  const eal = assignEalCode(hazard.isHazardous, metadata.originProcess, metadata.labStatedEalCode, originToChapterLookup, metadata.matrixType);

  hazard.hasDetectedHazardousSubstance = hasAboveLoqHazardousSubstance ? true : hasUnresolvedSpecies || !normalized.length ? null : false;

  const excluded = measurementBoundary.measurements.filter(m => !m.hpEligibility.eligible);
  if (excluded.length) hazard.confidenceFlags.push(`${excluded.length} measurements excluded by measurement-boundary-1; see measurementBoundary for reasons.`);

  recordTrace?.(structuredClone({mode: normalized.length ? "total-content" as const : "indeterminate-basis" as const, normalized, hpInputs: withClp, measurementBoundary}));
  return { hazard, eal, noDataWarning, measurementBoundary, landfillAcceptance:inventoryLandfillAcceptance(measurementBoundary) };
}
