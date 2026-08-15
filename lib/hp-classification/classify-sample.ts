import { normalizeSample } from "./normalize";
import { speciateElement, type ElementCompoundForm } from "./speciate";
import { classifyHazard, type NormalizedResultWithClp, type TestResult, type HazardClassification } from "./hazard";
import { assignEalCode, type EalAssignment } from "./eal";
import type { SampleMetadata, SampleResult, AnalyteReference } from "./types";

export function classifySample(
  metadata: SampleMetadata,
  results: SampleResult[],
  testResults: TestResult[],
  analyteRef: AnalyteReference[],
  compoundForms: ElementCompoundForm[],
  originToChapterLookup: Record<string, string>
): { hazard: HazardClassification; eal: EalAssignment; noDataWarning: boolean } {
  const normalized = normalizeSample(metadata, results, analyteRef);
  const noDataWarning = normalized.length === 0;

  const withClp: NormalizedResultWithClp[] = [];
  for (const n of normalized) {
    const ref = analyteRef.find(a => a.analyteId === n.analyteId);
    if (!ref) continue; // no reference entry — skip, never guess (should already be filtered by normalizeSample, defensive here too)

    if (ref.elementSymbol) {
      const compounds = speciateElement(ref.elementSymbol, n.resultDryBasisPct, compoundForms);
      for (const c of compounds) {
        for (const clp of c.clpClassifications) {
          withClp.push({
            substanceName: c.compoundName,
            resultPct: c.resultPct,
            hStatement: clp.hStatement,
            hazardClass: clp.hazardClass,
            mFactorAcute: clp.hStatement === "H400" ? clp.mFactorAcute : null,
            mFactorChronic: clp.hStatement === "H410" ? clp.mFactorChronic : null,
          });
        }
      }
    } else if (ref.hStatement && ref.hazardClass) {
      withClp.push({
        substanceName: ref.analyteId,
        resultPct: n.resultDryBasisPct,
        hStatement: ref.hStatement,
        hazardClass: ref.hazardClass,
        mFactorAcute: null,
        mFactorChronic: ref.mFactorChronic,
      });
    } else if (ref.hStatements) {
      for (const h of ref.hStatements) {
        withClp.push({
          substanceName: ref.analyteId,
          resultPct: n.resultDryBasisPct,
          hStatement: h.hStatement,
          hazardClass: h.hazardClass,
          mFactorAcute: null,
          mFactorChronic: ref.mFactorChronic,
        });
      }
    }
    // an AnalyteReference entry with none of elementSymbol/hStatement/hStatements set has no known
    // hazard classification — its normalized result is silently excluded from HP classification,
    // never guessed into a category.
  }

  const hazard = classifyHazard(withClp, metadata, testResults);
  const eal = assignEalCode(hazard.isHazardous, metadata.originProcess, metadata.labStatedEalCode, originToChapterLookup);

  return { hazard, eal, noDataWarning };
}
