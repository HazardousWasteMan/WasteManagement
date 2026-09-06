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
  // Real regulatory gap, not a bug: ristetest/kolonnetest (leaching test) results are governed
  // by avfallsforskriften kap. 9 (landfill acceptance criteria — a different, delegated
  // question), never by kap. 11's HP1-15 hazard classification, which requires total-content
  // data. A document confirmed to carry ONLY leaching-test data cannot answer "is this
  // hazardous waste" — classifyHazard is never called in that case; isHazardous is null, never
  // a fabricated true/false. See docs/superpowers/specs/2026-09-05-leachate-hp-routing-design.md.
  const leachingOnly =
    (metadata.ristetestUtfort === true || metadata.kolonnetestUtfort === true) &&
    metadata.totalinnholdUtfort === false;

  if (leachingOnly) {
    const hazard: HazardClassification = {
      resultsByHp: {},
      triggeringSubstancesByHp: {},
      isHazardous: null,
      triggeredHps: [],
      confidenceFlags: [
        "HP1-15 hazard classification not performed: this sample has leaching-test " +
        "(ristetest/kolonnetest) data only, no total content data — leaching-test results are " +
        "landfill-acceptance-criteria data (avfallsforskriften kap. 9), a different regulatory " +
        "question from hazardous-waste classification (kap. 11), which requires total content. " +
        "Manual review required.",
      ],
    };
    const eal = assignEalCode(null, metadata.originProcess, metadata.labStatedEalCode, originToChapterLookup);
    return { hazard, eal, noDataWarning: false };
  }

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
