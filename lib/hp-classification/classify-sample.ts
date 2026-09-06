import { normalizeSample } from "./normalize";
import { speciateElement, type ElementCompoundForm } from "./speciate";
import { classifyHazard, type NormalizedResultWithClp, type TestResult, type HazardClassification } from "./hazard";
import { assignEalCode, type EalAssignment } from "./eal";
import type { SampleMetadata, SampleResult, AnalyteReference } from "./types";

const LIQUID_UNIT_PATTERN = /\/\s*[lL]\b/;
const SOLID_UNIT_PATTERN = /\/\s*kg\b/i;

// Deterministic fallback for the ristetest/kolonnetest keyword gate below: the extraction LLM's
// ristetest_utfort/kolonnetest_utfort flags are language-pattern judgments and can miss a report
// that is chemically a leachate/eluate sample (mg/l concentrations) but never uses the words the
// prompt looks for. This inspects the actual reported units instead — a real report reporting a
// clear majority of its results as liquid concentrations (a "/l" denominator) rather than solid
// total content (a "/kg" denominator) is a leachate sample regardless of what its prose says. A
// row whose unit matches neither pattern is excluded from both counts — absence of a recognized
// unit is not evidence either way. See docs/superpowers/specs/2026-09-06-hp-methodology-citation-and-unit-detection-design.md.
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
  const keywordFlaggedLeachingOnly =
    (metadata.ristetestUtfort === true || metadata.kolonnetestUtfort === true) &&
    metadata.totalinnholdUtfort === false;

  // Deterministic fallback (see unitsIndicateLeachate above): units win, always — even overriding
  // an explicit totalinnholdUtfort: true from the extraction LLM. See
  // docs/superpowers/specs/2026-09-06-hp-methodology-citation-and-unit-detection-design.md.
  const unitFlaggedLeachingOnly = unitsIndicateLeachate(results);

  const leachingOnly = keywordFlaggedLeachingOnly || unitFlaggedLeachingOnly;

  if (leachingOnly) {
    // Distinct, traceable message: when the unit check alone is why this sample gated (the
    // keyword flag did NOT independently agree), the flag text must say so explicitly — a future
    // reader must be able to tell, from confidenceFlags alone, why a sample with e.g.
    // totalinnholdUtfort: true still ended up isHazardous: null. When both signals agree, reuse
    // the plain keyword-gate message unchanged.
    const confidenceFlags = keywordFlaggedLeachingOnly
      ? [
          "HP1-15 hazard classification not performed: this sample has leaching-test " +
          "(ristetest/kolonnetest) data only, no total content data — leaching-test results are " +
          "landfill-acceptance-criteria data (avfallsforskriften kap. 9), a different regulatory " +
          "question from hazardous-waste classification (kap. 11), which requires total content. " +
          "Manual review required.",
        ]
      : metadata.totalinnholdUtfort === true
      ? [
          "HP1-15 hazard classification not performed: reported result units indicate a " +
          "liquid/eluate sample (a majority of results use a mg/l-class concentration unit), " +
          "overriding the extraction's own totalinnhold_utfort flag — regardless of what the " +
          "report's language claimed, leaching-test results are landfill-acceptance-criteria " +
          "data (avfallsforskriften kap. 9), a different regulatory question from hazardous-" +
          "waste classification (kap. 11), which requires total content. Manual review required.",
        ]
      : [
          "HP1-15 hazard classification not performed: reported result units indicate a " +
          "liquid/eluate sample (a majority of results use a mg/l-class concentration unit), " +
          "even though the extraction did not confirm total-content data was collected — " +
          "leaching-test results are landfill-acceptance-criteria data (avfallsforskriften kap. 9), " +
          "a different regulatory question from hazardous-waste classification (kap. 11), which " +
          "requires total content. Manual review required.",
        ];
    const confidenceFlagsNo = keywordFlaggedLeachingOnly
      ? [
          "HP1-15-klassifisering ikke utført: denne prøven har kun utlekkingstest-data " +
          "(ristetest/kolonnetest), ingen totalinnhold-data — utlekkingstest-resultater er " +
          "mottakskriterier-data for deponering (avfallsforskriften kap. 9), et annet " +
          "regelverksspørsmål enn farlig avfall-klassifisering (kap. 11), som krever totalinnhold. " +
          "Manuell gjennomgang kreves.",
        ]
      : metadata.totalinnholdUtfort === true
      ? [
          "HP1-15-klassifisering ikke utført: rapporterte resultatenheter indikerer en " +
          "væske-/eluatprøve (et flertall av resultatene bruker en mg/l-basert " +
          "konsentrasjonsenhet), som overstyrer ekstraksjonens eget totalinnhold_utfort-flagg — " +
          "uavhengig av hva rapportteksten hevdet, er utlekkingstest-resultater " +
          "mottakskriterier-data for deponering (avfallsforskriften kap. 9), et annet " +
          "regelverksspørsmål enn farlig avfall-klassifisering (kap. 11), som krever totalinnhold. " +
          "Manuell gjennomgang kreves.",
        ]
      : [
          "HP1-15-klassifisering ikke utført: rapporterte resultatenheter indikerer en " +
          "væske-/eluatprøve (et flertall av resultatene bruker en mg/l-basert " +
          "konsentrasjonsenhet), selv om ekstraksjonen ikke bekreftet at totalinnhold-data ble " +
          "innhentet — utlekkingstest-resultater er mottakskriterier-data for deponering " +
          "(avfallsforskriften kap. 9), et annet regelverksspørsmål enn farlig avfall-" +
          "klassifisering (kap. 11), som krever totalinnhold. Manuell gjennomgang kreves.",
        ];
    const hazard: HazardClassification = {
      resultsByHp: {},
      triggeringSubstancesByHp: {},
      isHazardous: null,
      triggeredHps: [],
      confidenceFlags,
      confidenceFlagsNo,
    };
    const eal = assignEalCode(null, metadata.originProcess, metadata.labStatedEalCode, originToChapterLookup);
    return { hazard, eal, noDataWarning: false };
  }

  // Liquid-basis rows (mg/l-class concentrations) are never a valid input to HP total-content
  // classification, which is defined on dry-basis % — regardless of whether unitsIndicateLeachate
  // gated this sample or not. A mixed report (the same analyte re-reported as both solid
  // total-content and liquid eluate) must classify off its real solid-basis row only; feeding the
  // liquid-basis row's raw number through normalizeSample would misread an eluate concentration
  // as a dry-basis percentage. See docs/superpowers/specs/2026-09-06-hp-methodology-citation-and-unit-detection-design.md.
  const resultsForClassification = results.filter(r => !LIQUID_UNIT_PATTERN.test(r.unitRaw));
  const normalized = normalizeSample(metadata, resultsForClassification, analyteRef);
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
