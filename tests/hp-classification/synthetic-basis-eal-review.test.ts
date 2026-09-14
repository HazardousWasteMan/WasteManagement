import { describe, expect, it } from "vitest";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import type { AnalyteReference, SampleMetadata, SampleResult } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import elementCompoundForms from "@/lib/data/element-compound-forms.json";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";

const metadata: SampleMetadata = {
  sampleId: "synthetic-basis", externalReportNo: "SYNTHETIC-BASIS", labName: "Example laboratory",
  customerName: "Example organisation", sampleMarking: "TEST-BASIS", matrixType: "soil and stones",
  samplingDate: null, receiptDate: null, originProcess: "synthetic excavation", producerName: "Example producer",
  physicalState: "solid", viscosity40cMm2s: null, ph: null, labClassificationGiven: true,
  labStatedEalCode: "17 05 03*", totalinnholdUtfort: true,
};

describe("synthetic basis and EAL-review regression", () => {
  it("excludes unknown-basis concentration and retains the laboratory code only as a review suggestion", () => {
    const results: SampleResult[] = [{
      resultId: "synthetic-result", sampleId: metadata.sampleId, analyteId: "arsenic", rawAnalyteName: "Arsenic",
      resultValue: 500, unitRaw: "mg/kg", isBelowLoq: false, loqValue: null, expressedOnDryBasis: false, method: null,
    }];
    const { hazard, eal, measurementBoundary } = classifySample(
      metadata, results, [], analyteReferenceRaw as AnalyteReference[],
      elementCompoundForms as ElementCompoundForm[], { "synthetic excavation": "1705" },
    );
    expect(measurementBoundary.measurements[0].hpEligibility.reasons).toContain("basis:unknown");
    expect(hazard.isHazardous).toBeNull();
    expect(eal.code).toBeNull();
    expect(eal.suggestedCode).toBe("17 05 03*");
    expect(eal.resolutionStatus).toBe("requires_human_review");
  });
});
