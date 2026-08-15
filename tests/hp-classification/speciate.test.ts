import { describe, it, expect } from "vitest";
import { speciateElement } from "@/lib/hp-classification/speciate";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";

const arsenicForms: ElementCompoundForm[] = [
  {
    elementSymbol: "As", compoundName: "Triossido di diarsenico", casNumber: "1327-53-3",
    molecularWeightCompound: 197.84, atomsOfElement: 2, atomicWeightElement: 74.92,
    clpClassifications: [{ hStatement: "H300", hazardClass: "Acute Tox. 2", mFactorAcute: null, mFactorChronic: null }],
  },
  {
    elementSymbol: "As", compoundName: "Pentaossido di diarsenico", casNumber: "1303-28-2",
    molecularWeightCompound: 229.84, atomsOfElement: 2, atomicWeightElement: 74.92,
    clpClassifications: [{ hStatement: "H301", hazardClass: "Acute Tox. 3", mFactorAcute: null, mFactorChronic: null }],
  },
  {
    elementSymbol: "As", compoundName: "Composti dell'arsenico, altrove", casNumber: null,
    molecularWeightCompound: null, atomsOfElement: null, atomicWeightElement: null,
    clpClassifications: [{ hStatement: "H301", hazardClass: "Acute Tox. 3", mFactorAcute: null, mFactorChronic: null }],
  },
];

describe("speciateElement", () => {
  it("expands arsenic at 5.17% into its three compound forms matching the real report's values", () => {
    const results = speciateElement("As", 5.17, arsenicForms);
    expect(results).toHaveLength(3);
    const trioxide = results.find(r => r.compoundName === "Triossido di diarsenico")!;
    expect(trioxide.resultPct).toBeCloseTo(6.83, 1); // report: 6.82%
    const pentoxide = results.find(r => r.compoundName === "Pentaossido di diarsenico")!;
    expect(pentoxide.resultPct).toBeCloseTo(7.93, 1); // report: 7.90%
    const generic = results.find(r => r.compoundName === "Composti dell'arsenico, altrove")!;
    expect(generic.resultPct).toBeCloseTo(5.17, 2); // no conversion — raw element %
  });

  it("returns an empty array for an element with no registered forms", () => {
    const results = speciateElement("Cd", 0.00337, []);
    expect(results).toEqual([]);
  });
});
