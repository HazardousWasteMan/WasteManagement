export interface ElementCompoundForm {
  elementSymbol: string;
  compoundName: string;
  casNumber: string | null;
  molecularWeightCompound: number | null;
  atomsOfElement: number | null;
  atomicWeightElement: number | null;
  clpClassifications: { hStatement: string; hazardClass: string; mFactorAcute: number | null; mFactorChronic: number | null }[];
}

export interface CompoundResult {
  /** Candidate conversions are mutually exclusive, not measured species. */
  assumption: "alternative_species";
  scenarioId: string;
  compoundName: string;
  casNumber: string | null;
  resultPct: number;
  clpClassifications: { hStatement: string; hazardClass: string; mFactorAcute: number | null; mFactorChronic: number | null }[];
}

export function speciateElement(
  elementSymbol: string,
  elementPct: number,
  forms: ElementCompoundForm[]
): CompoundResult[] {
  return forms
    .filter(f => f.elementSymbol === elementSymbol)
    .map(f => {
      if (f.molecularWeightCompound === null || f.atomsOfElement === null || f.atomicWeightElement === null) {
        // generic residual category — no compound-form conversion, use raw element %
        return { assumption: "alternative_species", scenarioId: f.compoundName, compoundName: f.compoundName, casNumber: f.casNumber, resultPct: elementPct, clpClassifications: f.clpClassifications };
      }
      const elementMassFraction = (f.atomsOfElement * f.atomicWeightElement) / f.molecularWeightCompound;
      return {
        assumption: "alternative_species", scenarioId: f.compoundName,
        compoundName: f.compoundName,
        casNumber: f.casNumber,
        resultPct: elementPct / elementMassFraction,
        clpClassifications: f.clpClassifications,
      };
    });
}
