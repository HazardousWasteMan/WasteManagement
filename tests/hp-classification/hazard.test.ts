import { readHpOutcome } from "@/lib/hp-classification/hp-outcome";
import { describe, it, expect } from "vitest";
import { classifyHazard } from "@/lib/hp-classification/hazard";
import type { NormalizedResultWithClp } from "@/lib/hp-classification/hazard";
import type { SampleMetadata } from "@/lib/hp-classification/types";

const solidMetadata: SampleMetadata = {
  sampleId: "t", externalReportNo: "t", labName: "t", customerName: "t", sampleMarking: "t",
  matrixType: "jord", samplingDate: null, receiptDate: null, originProcess: "t", producerName: null,
  physicalState: "solid", viscosity40cMm2s: null, ph: 7.61, labClassificationGiven: false, labStatedEalCode: null,
};

describe("classifyHazard", () => {
  it("triggers HP7 for a single Carc. 1A substance at or above 0.1%, without summing other substances", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "substance-a", resultPct: 0.05, hStatement: "H350", hazardClass: "Carc. 1A", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "substance-b", resultPct: 0.06, hStatement: "H350", hazardClass: "Carc. 1A", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP7", result.resultsByHp.HP7).status).toBe("not_triggered"); // neither alone reaches 0.1%, and HP7 is never summed
  });

  it("triggers HP7 when a single substance alone reaches 0.1%", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "pentaossido di diarsenico", resultPct: 7.9, hStatement: "H350", hazardClass: "Carc. 1A", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP7", result.resultsByHp.HP7).status).toBe("triggered");
    expect(result.triggeredHps).toContain("HP7");
  });

  it("HP5 Asp. Tox. 1 never triggers for a solid, regardless of concentration", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "high-h304", resultPct: 50, hStatement: "H304", hazardClass: "Asp. Tox. 1", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP5", result.resultsByHp.HP5).status).toBe("not_triggered");
  });

  it("HP5 Asp. Tox. 1 never triggers for a powder either, same as solid, regardless of concentration", () => {
    const powderMetadata: SampleMetadata = { ...solidMetadata, physicalState: "powder" };
    const results: NormalizedResultWithClp[] = [
      { substanceName: "high-h304", resultPct: 50, hStatement: "H304", hazardClass: "Asp. Tox. 1", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, powderMetadata, []);
    expect(readHpOutcome("HP5", result.resultsByHp.HP5).status).toBe("not_triggered");
  });

  it("HP6 sums within Acute Tox 3 Oral category to reach the 5% threshold", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "composti-arsenico-altro", resultPct: 5.17, hStatement: "H301", hazardClass: "Acute Tox. 3 (Oral)", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "pentaossido-diarsenico", resultPct: 7.9, hStatement: "H301", hazardClass: "Acute Tox. 3 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP6", result.resultsByHp.HP6).status).toBe("triggered");
  });

  it("HP9, HP12, HP15 require evidence when no applicable inputs are present", () => {
    const result = classifyHazard([], solidMetadata, []);
    expect(readHpOutcome("HP9", result.resultsByHp.HP9).status).toBe("requires_manual_assessment");
    expect(readHpOutcome("HP12", result.resultsByHp.HP12).status).toBe("requires_manual_assessment");
    expect(readHpOutcome("HP15", result.resultsByHp.HP15).status).toBe("requires_manual_assessment");
  });

  it("HP1, HP2, HP3 report not-tested when no test result row is provided", () => {
    const result = classifyHazard([], solidMetadata, []);
    expect(readHpOutcome("HP1", result.resultsByHp.HP1).status).toBe("not_assessable");
    expect(readHpOutcome("HP3", result.resultsByHp.HP3).status).toBe("not_assessable");
  });

  it("HP4 reports superseded by HP8 when HP8's concentration sum reaches its 5% threshold", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "triossido-diarsenico", resultPct: 6.82, hStatement: "H314", hazardClass: "Skin Corr. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP8", result.resultsByHp.HP8).status).toBe("triggered");
    expect(readHpOutcome("HP4", result.resultsByHp.HP4).status).toBe("not_applicable");
  });

  it("HP6 evaluates H300 sub-categories against their own hazard-class threshold, not the first matching row", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "acute-tox-1-oral", resultPct: 0.15, hStatement: "H300", hazardClass: "Acute Tox. 1 (Oral)", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "acute-tox-2-oral", resultPct: 0.2, hStatement: "H300", hazardClass: "Acute Tox. 2 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    // Acute Tox. 1 (Oral) clears its own 0.1% threshold on its own, so HP6 triggers overall.
    expect(readHpOutcome("HP6", result.resultsByHp.HP6).status).toBe("triggered");
  });

  it("HP6 does not trigger for an Acute Tox. 2 (Oral) substance below its own 0.25% threshold, even though H300 also covers Acute Tox. 1 at 0.1%", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "acute-tox-2-oral-only", resultPct: 0.2, hStatement: "H300", hazardClass: "Acute Tox. 2 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP6", result.resultsByHp.HP6).status).toBe("not_triggered");
  });

  it("isHazardous is true when any HP resolves to boolean true", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "pentaossido di diarsenico", resultPct: 7.9, hStatement: "H350", hazardClass: "Carc. 1A", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.isHazardous).toBe(true);
  });

  it("HP6 flags (does not silently drop) a substance whose hStatement matches an HP6 row but whose hazardClass does not", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "mystery-substance", resultPct: 50, hStatement: "H300", hazardClass: "Acute Tox. 2", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    // Excluded from evaluation entirely — HP6 must not silently resolve to false without a trace.
    expect(readHpOutcome("HP6", result.resultsByHp.HP6).status).toBe("not_assessable");
    expect(result.resultsByHp.HP6.issues[0].code).toBe("unknown_acute_category");
  });

  it("HP6 does not flag a substance whose hStatement/hazardClass pair matches a threshold row", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "acute-tox-2-oral-only", resultPct: 0.2, hStatement: "H300", hazardClass: "Acute Tox. 2 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP6.issues).toEqual([]);
  });
});

// HP14 independently derived equation/cutoff cases now live in hp-rules-v2.test.ts.

describe("classifyHazard — synthetic low-concentration substances", () => {
  it("mercury does not trigger HP6 when below its Acute Tox. 2 Inhalation threshold", () => {
    // Real report value: <0.0096 mg/kg TS (below LOQ) = 0.00000096% — far below the 0.5% HP6 Acute Tox. 2 Inhalation threshold
    const results: NormalizedResultWithClp[] = [
      { substanceName: "mercury", resultPct: 0.00000096, hStatement: "H330", hazardClass: "Acute Tox. 2 (Inhal.)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP6", result.resultsByHp.HP6).status).toBe("not_triggered");
  });

  it("chromium VI does not trigger HP7 at a synthetic low concentration", () => {
    // Real report value: 1.6 mg/kg TS = 0.00016% — far below the 0.1% HP7 Carc. 1B threshold
    const results: NormalizedResultWithClp[] = [
      { substanceName: "chromium-vi", resultPct: 0.00016, hStatement: "H350", hazardClass: "Carc. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP7", result.resultsByHp.HP7).status).toBe("not_triggered");
  });

  it("benzo[a]pyrene does not trigger HP7 at a synthetic below-LOQ concentration", () => {
    // Real report value: <30 µg/kg TS = <0.03 mg/kg TS = 0.000003% — far below the 0.1% HP7 Carc. 1B threshold
    const results: NormalizedResultWithClp[] = [
      { substanceName: "benzo-a-pyrene", resultPct: 0.000003, hStatement: "H350", hazardClass: "Carc. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP7", result.resultsByHp.HP7).status).toBe("not_triggered");
  });
});

describe("classifyHazard — triggeringSubstancesByHp", () => {
  it("HP7 lists the exact substance that triggered it", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "pentaossido di diarsenico", resultPct: 7.9, hStatement: "H350", hazardClass: "Carc. 1A", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.triggeringSubstancesByHp.HP7).toEqual(["pentaossido di diarsenico"]);
  });

  it("HP6 lists both substances in the winning category, de-duplicated", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "composti-arsenico-altro", resultPct: 5.17, hStatement: "H301", hazardClass: "Acute Tox. 3 (Oral)", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "pentaossido-diarsenico", resultPct: 7.9, hStatement: "H301", hazardClass: "Acute Tox. 3 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.triggeringSubstancesByHp.HP6.sort()).toEqual(["composti-arsenico-altro", "pentaossido-diarsenico"]);
  });

  it("an HP4 superseded by HP8 gets no triggering list of its own, but HP8 gets one", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "triossido-diarsenico", resultPct: 6.82, hStatement: "H314", hazardClass: "Skin Corr. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP4", result.resultsByHp.HP4).status).toBe("not_applicable");
    expect(result.triggeringSubstancesByHp.HP4).toBeUndefined();
    expect(result.triggeringSubstancesByHp.HP8).toEqual(["triossido-diarsenico"]);
  });

  it("a test-driven HP8 (lab corrosion test, not substance data) gets no triggering list", () => {
    const result = classifyHazard([], solidMetadata, [
      { testName: "skin_corrosion", result: "positive", isPositive: true },
    ]);
    expect(readHpOutcome("HP8", result.resultsByHp.HP8).status).toBe("triggered");
    expect(result.triggeringSubstancesByHp.HP8).toBeUndefined();
  });

  it("untriggered and case-specific HPs have no key at all in triggeringSubstancesByHp", () => {
    const result = classifyHazard([], solidMetadata, []);
    expect(Object.keys(result.triggeringSubstancesByHp)).toEqual([]);
  });

  it("HP14 attribution follows the actual triggered waste equation", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "chronic1-with-mfactor", resultPct: 20, hStatement: "H410", hazardClass: "Aquatic Chronic 1", mFactorChronic: 1.2, mFactorAcute: null },
      { substanceName: "chronic4-substance", resultPct: 3, hStatement: "H413", hazardClass: "Aquatic Chronic 4", mFactorChronic: null, mFactorAcute: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    // Same fixture as the existing "Chronic 4 tier uses the RAW sum" test — resolves to false.
    expect(readHpOutcome("HP14", result.resultsByHp.HP14).status).toBe("triggered");
    expect(result.triggeringSubstancesByHp.HP14).toEqual(["chronic1-with-mfactor"]);
  });

  it("HP5 unions substances across multiple independently-triggering conditions", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "h335-sub", resultPct: 25, hStatement: "H335", hazardClass: "STOT SE 3", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "h370-sub", resultPct: 5, hStatement: "H370", hazardClass: "STOT SE 1", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(readHpOutcome("HP5", result.resultsByHp.HP5).status).toBe("triggered");
    expect(result.triggeringSubstancesByHp.HP5.sort()).toEqual(["h335-sub", "h370-sub"]);
  });
});
