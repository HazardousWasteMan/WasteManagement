import { describe, it, expect } from "vitest";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import type { TestResult } from "@/lib/hp-classification/hazard";
import elementCompoundForms from "@/lib/data/element-compound-forms.json";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import fixture from "@/fixtures/italian-sample.json";

const originLookup = { "escavo terre e rocce": "1705" };

describe("Italian sample regression test (Rapporto di Prova EV-21-039071-288752)", () => {
  it("reproduces the lab's own stated HP triggers and EAL code", () => {
    const metadata = fixture.metadata as SampleMetadata;
    const results = fixture.results.map(r => ({ ...r, sampleId: metadata.sampleId, method: null })) as SampleResult[];
    const analyteRef = analyteReferenceRaw as AnalyteReference[];

    const { hazard, eal } = classifySample(
      metadata,
      results,
      fixture.testResults as TestResult[],
      analyteRef,
      elementCompoundForms as ElementCompoundForm[],
      originLookup
    );

    expect(hazard.triggeredHps.sort()).toEqual(["HP10", "HP14", "HP6", "HP7"]);
    expect(hazard.isHazardous).toBe(true);
    expect(eal.code).toBe("17 05 03*");
    expect(eal.confidence).toBe("high — engine agrees with lab's own classification");
  });
});
