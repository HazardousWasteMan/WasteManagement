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
  originToChapterLookup: Record<string, string>,
  /** What the waste is, in the document's own words — ranks candidates inside the chosen chapter. */
  descriptionHint: string | null = null
): { hazard: HazardClassification; eal: EalAssignment; noDataWarning: boolean } {
  const { results: normalized, flags: normalizeFlags } = normalizeSample(metadata, results, analyteRef);
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
  // Rows normalizeSample refused to interpret (leaching results, unknown units) are the single
  // biggest source of a wrong verdict, so they travel with it instead of dying in normalize.
  hazard.confidenceFlags.push(...new Set(normalizeFlags));
  // With no usable total-content row there is no hazard verdict, and without one the mirror-code
  // pair cannot be chosen between. Asserting the non-hazardous half would be a guess dressed as a
  // classification — and on big_test/test_1, whose documents are leaching data end to end, that
  // guess called hazardous waste clean. See bk/BIG-TEST-FINDINGS.md finding 9.
  const eal = noDataWarning
    ? {
        code: null,
        description: null,
        confidence: "HALT — no usable total-content analysis in the document, so hazard status is unknown and no EAL code can be selected",
      }
    : assignEalCode(
        hazard.isHazardous, metadata.originProcess, metadata.labStatedEalCode, originToChapterLookup,
        descriptionHint ?? metadata.matrixType
      );

  return { hazard, eal, noDataWarning };
}
