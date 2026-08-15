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
    expect(result.resultsByHp.HP7).toBe(false); // neither alone reaches 0.1%, and HP7 is never summed
  });

  it("triggers HP7 when a single substance alone reaches 0.1%", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "pentaossido di diarsenico", resultPct: 7.9, hStatement: "H350", hazardClass: "Carc. 1A", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP7).toBe(true);
    expect(result.triggeredHps).toContain("HP7");
  });

  it("HP5 Asp. Tox. 1 never triggers for a solid, regardless of concentration", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "high-h304", resultPct: 50, hStatement: "H304", hazardClass: "Asp. Tox. 1", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP5).toBe(false);
  });

  it("HP5 Asp. Tox. 1 never triggers for a powder either, same as solid, regardless of concentration", () => {
    const powderMetadata: SampleMetadata = { ...solidMetadata, physicalState: "powder" };
    const results: NormalizedResultWithClp[] = [
      { substanceName: "high-h304", resultPct: 50, hStatement: "H304", hazardClass: "Asp. Tox. 1", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, powderMetadata, []);
    expect(result.resultsByHp.HP5).toBe(false);
  });

  it("HP6 sums within Acute Tox 3 Oral category to reach the 5% threshold", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "composti-arsenico-altro", resultPct: 5.17, hStatement: "H301", hazardClass: "Acute Tox. 3 (Oral)", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "pentaossido-diarsenico", resultPct: 7.9, hStatement: "H301", hazardClass: "Acute Tox. 3 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP6).toBe(true);
  });

  it("HP9, HP12, HP15 always report the not-automatable literal string, never computed", () => {
    const result = classifyHazard([], solidMetadata, []);
    expect(result.resultsByHp.HP9).toBe("requires case-specific assessment — not automatable from lab data alone");
    expect(result.resultsByHp.HP12).toBe("requires case-specific assessment — not automatable from lab data alone");
    expect(result.resultsByHp.HP15).toBe("requires case-specific assessment — not automatable from lab data alone");
  });

  it("HP1, HP2, HP3 report not-tested when no test result row is provided", () => {
    const result = classifyHazard([], solidMetadata, []);
    expect(result.resultsByHp.HP1).toBe("not tested — assumed not applicable");
    expect(result.resultsByHp.HP3).toBe("not tested — assumed not applicable");
  });

  it("HP4 reports superseded by HP8 when HP8's concentration sum reaches its 5% threshold", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "triossido-diarsenico", resultPct: 6.82, hStatement: "H314", hazardClass: "Skin Corr. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP8).toBe(true);
    expect(result.resultsByHp.HP4).toBe("superseded by HP8");
  });

  it("HP6 evaluates H300 sub-categories against their own hazard-class threshold, not the first matching row", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "acute-tox-1-oral", resultPct: 0.15, hStatement: "H300", hazardClass: "Acute Tox. 1 (Oral)", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "acute-tox-2-oral", resultPct: 0.2, hStatement: "H300", hazardClass: "Acute Tox. 2 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    // Acute Tox. 1 (Oral) clears its own 0.1% threshold on its own, so HP6 triggers overall.
    expect(result.resultsByHp.HP6).toBe(true);
  });

  it("HP6 does not trigger for an Acute Tox. 2 (Oral) substance below its own 0.25% threshold, even though H300 also covers Acute Tox. 1 at 0.1%", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "acute-tox-2-oral-only", resultPct: 0.2, hStatement: "H300", hazardClass: "Acute Tox. 2 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP6).toBe(false);
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
    expect(result.resultsByHp.HP6).toBe(false);
    expect(result.confidenceFlags).toEqual([
      "HP6: substance 'mystery-substance' with hStatement H300/hazardClass 'Acute Tox. 2' has no matching threshold row — excluded from HP6 evaluation",
    ]);
  });

  it("HP6 does not flag a substance whose hStatement/hazardClass pair matches a threshold row", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "acute-tox-2-oral-only", resultPct: 0.2, hStatement: "H300", hazardClass: "Acute Tox. 2 (Oral)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.confidenceFlags).toEqual([]);
  });
});

describe("classifyHazard — HP14 M-factor cascade", () => {
  it("does not trigger HP14 when the M-factor-weighted Aquatic Chronic 1 sum is below 25%", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "low-toxicity", resultPct: 0.5, hStatement: "H410", hazardClass: "Aquatic Chronic 1", mFactorChronic: 1, mFactorAcute: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP14).toBe(false);
  });

  it("triggers HP14 via Aquatic Chronic 1 when the M-factor-weighted sum reaches 25%", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "high-m-factor", resultPct: 0.5, hStatement: "H410", hazardClass: "Aquatic Chronic 1", mFactorChronic: 100, mFactorAcute: null },
    ];
    // 0.5% * M-factor 100 = 50% >= 25%
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP14).toBe(true);
  });

  it("evaluates the cascade top-to-bottom, stopping at Aquatic Acute 1 if it alone reaches 25%", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "acute-1", resultPct: 0.3, hStatement: "H400", hazardClass: "Aquatic Acute 1", mFactorAcute: 100, mFactorChronic: null },
    ];
    // 0.3% * M-factor 100 = 30% >= 25% -> HP14 triggers via Aquatic Acute 1, cascade stops there
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP14).toBe(true);
  });

  it("treats a substance with no registered M-factor as M-factor 1 (baseline), never excluded from the sum", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "no-m-factor", resultPct: 10, hStatement: "H410", hazardClass: "Aquatic Chronic 1", mFactorChronic: null, mFactorAcute: null },
    ];
    // 10% * M-factor 1 (default) = 10% < 25% -> does not trigger
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP14).toBe(false);
  });

  it("Chronic 4 tier uses the RAW (unweighted) Chronic 1 sum, not the M-factor-weighted one", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "chronic1-with-mfactor", resultPct: 20, hStatement: "H410", hazardClass: "Aquatic Chronic 1", mFactorChronic: 1.2, mFactorAcute: null },
      { substanceName: "chronic4-substance", resultPct: 3, hStatement: "H413", hazardClass: "Aquatic Chronic 4", mFactorChronic: null, mFactorAcute: null },
    ];
    // M-weighted chronic1Sum = 20*1.2 = 24% (below 25%, Chronic 1/2/3 tiers don't fire)
    // Correct Chronic 4 raw sum: 20 (raw, not *1.2) + 3 = 23% < 25% -> should NOT trigger
    // Buggy version would compute 24 + 3 = 27% -> would incorrectly trigger
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP14).toBe(false);
  });
});

describe("classifyHazard — Eurofins concrete sample substances", () => {
  it("mercury at real EU CLP classification does not trigger HP6 when below its Acute Tox. 2 Inhalation threshold", () => {
    // Real report value: <0.0096 mg/kg TS (below LOQ) = 0.00000096% — far below the 0.5% HP6 Acute Tox. 2 Inhalation threshold
    const results: NormalizedResultWithClp[] = [
      { substanceName: "mercury", resultPct: 0.00000096, hStatement: "H330", hazardClass: "Acute Tox. 2 (Inhal.)", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP6).toBe(false);
  });

  it("chromium VI at real EU CLP classification does not trigger HP7 at the report's real low concentration", () => {
    // Real report value: 1.6 mg/kg TS = 0.00016% — far below the 0.1% HP7 Carc. 1B threshold
    const results: NormalizedResultWithClp[] = [
      { substanceName: "chromium-vi", resultPct: 0.00016, hStatement: "H350", hazardClass: "Carc. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP7).toBe(false);
  });

  it("benzo[a]pyrene at real EU CLP classification does not trigger HP7 at the report's real below-LOQ concentration", () => {
    // Real report value: <30 µg/kg TS = <0.03 mg/kg TS = 0.000003% — far below the 0.1% HP7 Carc. 1B threshold
    const results: NormalizedResultWithClp[] = [
      { substanceName: "benzo-a-pyrene", resultPct: 0.000003, hStatement: "H350", hazardClass: "Carc. 1B", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP7).toBe(false);
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
    expect(result.resultsByHp.HP4).toBe("superseded by HP8");
    expect(result.triggeringSubstancesByHp.HP4).toBeUndefined();
    expect(result.triggeringSubstancesByHp.HP8).toEqual(["triossido-diarsenico"]);
  });

  it("a test-driven HP8 (lab corrosion test, not substance data) gets no triggering list", () => {
    const result = classifyHazard([], solidMetadata, [
      { testName: "skin_corrosion", result: "positive", isPositive: true },
    ]);
    expect(result.resultsByHp.HP8).toBe(true);
    expect(result.triggeringSubstancesByHp.HP8).toBeUndefined();
  });

  it("untriggered and case-specific HPs have no key at all in triggeringSubstancesByHp", () => {
    const result = classifyHazard([], solidMetadata, []);
    expect(Object.keys(result.triggeringSubstancesByHp)).toEqual([]);
  });

  it("HP14 lists substances only from the specific cascade tier that fired, not every tier", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "chronic1-with-mfactor", resultPct: 20, hStatement: "H410", hazardClass: "Aquatic Chronic 1", mFactorChronic: 1.2, mFactorAcute: null },
      { substanceName: "chronic4-substance", resultPct: 3, hStatement: "H413", hazardClass: "Aquatic Chronic 4", mFactorChronic: null, mFactorAcute: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    // Same fixture as the existing "Chronic 4 tier uses the RAW sum" test — resolves to false.
    expect(result.resultsByHp.HP14).toBe(false);
    expect(result.triggeringSubstancesByHp.HP14).toBeUndefined();
  });

  it("HP5 unions substances across multiple independently-triggering conditions", () => {
    const results: NormalizedResultWithClp[] = [
      { substanceName: "h335-sub", resultPct: 25, hStatement: "H335", hazardClass: "STOT SE 3", mFactorAcute: null, mFactorChronic: null },
      { substanceName: "h370-sub", resultPct: 5, hStatement: "H370", hazardClass: "STOT SE 1", mFactorAcute: null, mFactorChronic: null },
    ];
    const result = classifyHazard(results, solidMetadata, []);
    expect(result.resultsByHp.HP5).toBe(true);
    expect(result.triggeringSubstancesByHp.HP5.sort()).toEqual(["h335-sub", "h370-sub"]);
  });
});
