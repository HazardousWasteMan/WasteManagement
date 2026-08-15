import { describe, it, expect } from "vitest";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import type { TestResult } from "@/lib/hp-classification/hazard";
import elementCompoundForms from "@/lib/data/element-compound-forms.json";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import fixture from "@/fixtures/eurofins-concrete-sample.json";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";

describe("Eurofins concrete sample regression test (Prøvenr. 439-2025-10080994, ENAT-BØF1-BO9OB1)", () => {
  it("reproduces the expected non-hazardous classification and real EAL code for a genuinely clean sample", () => {
    const metadata = fixture.metadata as SampleMetadata;
    const results = fixture.results.map(r => ({ ...r, sampleId: metadata.sampleId, method: null })) as SampleResult[];
    const analyteRef = analyteReferenceRaw as AnalyteReference[];
    const originLookup = Object.fromEntries(
      ORIGIN_OPTIONS.map(o => [o.value, o.chapter])
    );

    const { hazard, eal } = classifySample(
      metadata,
      results,
      fixture.testResults as TestResult[],
      analyteRef,
      elementCompoundForms as ElementCompoundForm[],
      originLookup
    );

    expect(hazard.triggeredHps).toEqual([]);
    expect(hazard.isHazardous).toBe(false);
    expect(eal.code).toBe("17 01 01");
    expect(eal.confidence).toBe(
      "AMBIGUOUS — multiple EAL codes match chapter/hazard status (170101, 170102, 170103, 170107), used first match — manual review recommended"
    );
  });
});
