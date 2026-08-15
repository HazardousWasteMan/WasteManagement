import hpThresholds from "../data/hp-thresholds.json";
import type { SampleMetadata } from "./types";

export interface NormalizedResultWithClp {
  substanceName: string;
  resultPct: number;
  hStatement: string;
  hazardClass: string;
  mFactorAcute: number | null;
  mFactorChronic: number | null;
}

export interface TestResult {
  testName: "flammability" | "skin_corrosion" | "skin_irritation";
  result: string;
  isPositive: boolean; // true if the test result indicates the hazard IS present
}

type HpOutcome = boolean | "not tested — assumed not applicable" | "requires case-specific assessment — not automatable from lab data alone" | "superseded by HP8";

export interface HazardClassification {
  resultsByHp: Record<string, HpOutcome>;
  // Real substance names that contributed to an HP being triggered (true), keyed by HP code.
  // Only present for HPs whose true outcome derives from substance-level result data (HP4, HP5,
  // HP6, HP7, HP8, HP10, HP11, HP13, HP14) — omitted entirely when an HP wasn't triggered, was
  // determined by a lab test rather than substance data, or is one of the case-specific/
  // not-automatable HPs (HP1-3, HP9, HP12, HP15), since there's nothing real to attribute.
  triggeringSubstancesByHp: Record<string, string[]>;
  isHazardous: boolean;
  triggeredHps: string[];
  confidenceFlags: string[];
}

function sumForHStatement(results: NormalizedResultWithClp[], hStatement: string): number {
  return results.filter(r => r.hStatement === hStatement).reduce((sum, r) => sum + r.resultPct, 0);
}

function thresholdFor(hpCode: string, hStatement: string, hazardClass?: string): number | null {
  const row = hazardClass
    ? hpThresholds.find(t => t.hpCode === hpCode && t.hStatement === hStatement && t.hazardClass === hazardClass)
    : hpThresholds.find(t => t.hpCode === hpCode && t.hStatement === hStatement);
  return row?.concentrationLimitPct ?? null;
}

export function classifyHazard(
  results: NormalizedResultWithClp[],
  metadata: SampleMetadata,
  testResults: TestResult[]
): HazardClassification {
  const resultsByHp: Record<string, HpOutcome> = {};
  const triggeringSubstancesByHp: Record<string, string[]> = {};
  const confidenceFlags: string[] = [];

  // Records the real, de-duplicated substance names that contributed to `hp` being triggered.
  // No-op when `substances` is empty — an HP with no contributing substances (test-based,
  // untriggered, or case-specific) gets no key at all, never an empty array.
  function setTriggering(hp: string, substances: NormalizedResultWithClp[]) {
    if (substances.length === 0) return;
    triggeringSubstancesByHp[hp] = Array.from(new Set(substances.map(r => r.substanceName)));
  }

  // HP1-HP3: test-only, never substance-attributable
  for (const hp of ["HP1", "HP2", "HP3"]) {
    const testName = hp === "HP3" ? "flammability" : null;
    const test = testName ? testResults.find(t => t.testName === testName) : undefined;
    resultsByHp[hp] = test ? test.isPositive : "not tested — assumed not applicable";
  }

  // HP4/HP8: test overrides calculation; HP8 supersedes HP4 on the corrosive overlap
  const corrosionTest = testResults.find(t => t.testName === "skin_corrosion");
  const irritationTest = testResults.find(t => t.testName === "skin_irritation");
  const h314Substances = results.filter(r => r.hStatement === "H314");

  let hp8Triggered: boolean;
  if (corrosionTest) {
    hp8Triggered = corrosionTest.isPositive; // test-based — no substance attribution
  } else {
    const h314Sum = sumForHStatement(results, "H314");
    const h314Threshold = thresholdFor("HP8", "H314") ?? 5;
    hp8Triggered = h314Sum >= h314Threshold;
    if (hp8Triggered) setTriggering("HP8", h314Substances);
  }
  resultsByHp.HP8 = hp8Triggered;

  if (hp8Triggered) {
    resultsByHp.HP4 = "superseded by HP8";
  } else if (irritationTest) {
    resultsByHp.HP4 = irritationTest.isPositive; // test-based — no substance attribution
  } else {
    const h314Sum = sumForHStatement(results, "H314");
    const h314Threshold = thresholdFor("HP4", "H314") ?? 1;
    const h315Substances = results.filter(r => r.hStatement === "H315");
    const h319Substances = results.filter(r => r.hStatement === "H319");
    const h315h319Sum = sumForHStatement(results, "H315") + sumForHStatement(results, "H319");
    const h315h319Threshold = thresholdFor("HP4", "H315") ?? 20;
    const h318Substances = results.filter(r => r.hStatement === "H318");
    const h318Sum = sumForHStatement(results, "H318");
    const h318Threshold = thresholdFor("HP4", "H318") ?? 10;
    resultsByHp.HP4 = h314Sum >= h314Threshold || h315h319Sum >= h315h319Threshold || h318Sum >= h318Threshold;
    if (resultsByHp.HP4 === true) {
      const contributing: NormalizedResultWithClp[] = [];
      if (h314Sum >= h314Threshold) contributing.push(...h314Substances);
      if (h315h319Sum >= h315h319Threshold) contributing.push(...h315Substances, ...h319Substances);
      if (h318Sum >= h318Threshold) contributing.push(...h318Substances);
      setTriggering("HP4", contributing);
    }
  }

  // HP5: Asp. Tox 1 carve-out + independent no-sum checks
  const asp1Applicable = metadata.physicalState === "liquid" && (metadata.viscosity40cMm2s ?? Infinity) <= 20.5;
  const h304Substances = results.filter(r => r.hStatement === "H304");
  const h304Sum = sumForHStatement(results, "H304");
  const h304Threshold = thresholdFor("HP5", "H304") ?? 10;
  const hp5AspTriggered = asp1Applicable && h304Sum >= h304Threshold;

  function hp5SubstancesFor(hStatement: string, defaultThreshold: number): NormalizedResultWithClp[] {
    const threshold = thresholdFor("HP5", hStatement) ?? defaultThreshold;
    return results.filter(r => r.hStatement === hStatement && r.resultPct >= threshold);
  }
  const hp5H335 = hp5SubstancesFor("H335", 20);
  const hp5H370 = hp5SubstancesFor("H370", 1);
  const hp5H371 = hp5SubstancesFor("H371", 10);
  const hp5H372 = hp5SubstancesFor("H372", 1);
  const hp5H373 = hp5SubstancesFor("H373", 10);
  resultsByHp.HP5 =
    hp5AspTriggered ||
    hp5H335.length > 0 ||
    hp5H370.length > 0 ||
    hp5H371.length > 0 ||
    hp5H372.length > 0 ||
    hp5H373.length > 0;
  if (resultsByHp.HP5) {
    const contributing: NormalizedResultWithClp[] = [];
    if (hp5AspTriggered) contributing.push(...h304Substances);
    contributing.push(...hp5H335, ...hp5H370, ...hp5H371, ...hp5H372, ...hp5H373);
    setTriggering("HP5", contributing);
  }

  // HP6: sum within category — the "category" is the specific hazard class (e.g. "Acute Tox. 2 (Oral)"),
  // not the H-statement alone, since multiple hazard classes can share one H-statement (H300 covers both
  // Acute Tox. 1 and Acute Tox. 2, at different thresholds).
  const hp6HStatements = new Set(hpThresholds.filter(t => t.hpCode === "HP6").map(t => t.hStatement));
  for (const r of results) {
    if (
      hp6HStatements.has(r.hStatement) &&
      !hpThresholds.some(t => t.hpCode === "HP6" && t.hStatement === r.hStatement && t.hazardClass === r.hazardClass)
    ) {
      confidenceFlags.push(
        `HP6: substance '${r.substanceName}' with hStatement ${r.hStatement}/hazardClass '${r.hazardClass}' has no matching threshold row — excluded from HP6 evaluation`
      );
    }
  }
  const hp6Categories = new Set(
    results
      .filter(r => hpThresholds.some(t => t.hpCode === "HP6" && t.hStatement === r.hStatement && t.hazardClass === r.hazardClass))
      .map(r => `${r.hStatement}::${r.hazardClass}`)
  );
  const hp6TriggeringCategories = Array.from(hp6Categories).filter(key => {
    const [hStatement, hazardClass] = key.split("::");
    const sum = results
      .filter(r => r.hStatement === hStatement && r.hazardClass === hazardClass)
      .reduce((s, r) => s + r.resultPct, 0);
    const threshold = thresholdFor("HP6", hStatement, hazardClass);
    return threshold !== null && sum >= threshold;
  });
  resultsByHp.HP6 = hp6TriggeringCategories.length > 0;
  if (resultsByHp.HP6) {
    const contributing: NormalizedResultWithClp[] = [];
    for (const key of hp6TriggeringCategories) {
      const [hStatement, hazardClass] = key.split("::");
      contributing.push(...results.filter(r => r.hStatement === hStatement && r.hazardClass === hazardClass));
    }
    setTriggering("HP6", contributing);
  }

  // HP7: individual substance, never summed
  const hp7Substances = results.filter(r => {
    if (r.hStatement !== "H350" && r.hStatement !== "H351") return false;
    const threshold = thresholdFor("HP7", r.hStatement);
    return threshold !== null && r.resultPct >= threshold;
  });
  resultsByHp.HP7 = hp7Substances.length > 0;
  setTriggering("HP7", hp7Substances);

  // HP9: case-specific
  resultsByHp.HP9 = "requires case-specific assessment — not automatable from lab data alone";

  // HP10: sum (H360 and H361 are separate sums)
  const h360Substances = results.filter(r => r.hStatement === "H360");
  const h360Sum = sumForHStatement(results, "H360");
  const h360Threshold = thresholdFor("HP10", "H360") ?? 0.3;
  const h361Substances = results.filter(r => r.hStatement === "H361");
  const h361Sum = sumForHStatement(results, "H361");
  const h361Threshold = thresholdFor("HP10", "H361") ?? 3;
  resultsByHp.HP10 = h360Sum >= h360Threshold || h361Sum >= h361Threshold;
  if (resultsByHp.HP10) {
    const contributing: NormalizedResultWithClp[] = [];
    if (h360Sum >= h360Threshold) contributing.push(...h360Substances);
    if (h361Sum >= h361Threshold) contributing.push(...h361Substances);
    setTriggering("HP10", contributing);
  }

  // HP11: individual substance, never summed
  const hp11Substances = results.filter(r => {
    if (r.hStatement !== "H340" && r.hStatement !== "H341") return false;
    const threshold = thresholdFor("HP11", r.hStatement);
    return threshold !== null && r.resultPct >= threshold;
  });
  resultsByHp.HP11 = hp11Substances.length > 0;
  setTriggering("HP11", hp11Substances);

  // HP12: case-specific
  resultsByHp.HP12 = "requires case-specific assessment — not automatable from lab data alone";

  // HP13: no-sum, independent per substance
  const hp13Substances = results.filter(r => {
    if (r.hStatement !== "H317" && r.hStatement !== "H334") return false;
    const threshold = thresholdFor("HP13", r.hStatement);
    return threshold !== null && r.resultPct >= threshold;
  });
  resultsByHp.HP13 = hp13Substances.length > 0;
  setTriggering("HP13", hp13Substances);

  // HP14: M-factor-weighted cascade (Aquatic Acute 1 -> Chronic 1 -> Chronic 2 -> Chronic 3 -> Chronic 4),
  // evaluated top-to-bottom, stopping at the first threshold met. A substance with no registered
  // M-factor defaults to M-factor 1 (the CLP baseline for a non-specially-potent substance), never excluded.
  function mWeightedSum(hStatement: string, mFactorKey: "mFactorAcute" | "mFactorChronic"): number {
    return results
      .filter(r => r.hStatement === hStatement)
      .reduce((sum, r) => sum + r.resultPct * (r[mFactorKey] ?? 1), 0);
  }

  const acute1Substances = results.filter(r => r.hStatement === "H400");
  const chronic1Substances = results.filter(r => r.hStatement === "H410");
  const chronic2Substances = results.filter(r => r.hStatement === "H411");
  const chronic3Substances = results.filter(r => r.hStatement === "H412");
  const chronic4Substances = results.filter(r => r.hStatement === "H413");

  const acute1Sum = mWeightedSum("H400", "mFactorAcute");
  const chronic1Sum = mWeightedSum("H410", "mFactorChronic");
  const chronic1RawSum = sumForHStatement(results, "H410");
  const chronic2RawSum = sumForHStatement(results, "H411");
  const chronic3RawSum = sumForHStatement(results, "H412");
  const chronic4RawSum = sumForHStatement(results, "H413");

  if (acute1Sum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", acute1Substances);
  } else if (chronic1Sum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", chronic1Substances);
  } else if (0.1 * chronic1Sum + chronic2RawSum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", [...chronic1Substances, ...chronic2Substances]);
  } else if (0.01 * chronic1Sum + 0.1 * chronic2RawSum + chronic3RawSum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", [...chronic1Substances, ...chronic2Substances, ...chronic3Substances]);
  } else if (chronic1RawSum + chronic2RawSum + chronic3RawSum + chronic4RawSum >= 25) {
    resultsByHp.HP14 = true;
    setTriggering("HP14", [...chronic1Substances, ...chronic2Substances, ...chronic3Substances, ...chronic4Substances]);
  } else {
    resultsByHp.HP14 = false;
  }

  // HP15: case-specific
  resultsByHp.HP15 = "requires case-specific assessment — not automatable from lab data alone";

  const triggeredHps = Object.entries(resultsByHp)
    .filter(([, v]) => v === true)
    .map(([hp]) => hp);

  return {
    resultsByHp,
    triggeringSubstancesByHp,
    isHazardous: triggeredHps.length > 0,
    triggeredHps,
    confidenceFlags,
  };
}
