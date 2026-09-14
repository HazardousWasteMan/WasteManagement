import { describe, expect, it } from "vitest";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import type { AnalyteReference, SampleMetadata, SampleResult } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import elementCompoundForms from "@/lib/data/element-compound-forms.json";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";

const metadata: SampleMetadata = {
  sampleId: "synthetic-limited", externalReportNo: "SYNTHETIC-LIMITED", labName: "Example laboratory",
  customerName: "Example organisation", sampleMarking: "TEST-LIMITED", matrixType: "soil",
  samplingDate: null, receiptDate: null, originProcess: null, producerName: "Example producer",
  physicalState: "solid", viscosity40cMm2s: null, ph: null, labClassificationGiven: false,
  labStatedEalCode: null, totalinnholdUtfort: false,
};

describe("synthetic limited-evidence regression", () => {
  it("does not certify a report without established bulk analytical context as non-hazardous", () => {
    const results: SampleResult[] = [{
      resultId: "synthetic-result", sampleId: metadata.sampleId, analyteId: "arsenic", rawAnalyteName: "Arsenic",
      resultValue: 1, unitRaw: "mg/kg TS", isBelowLoq: false, loqValue: null, expressedOnDryBasis: true, method: null,
    }];
    const { hazard, eal } = classifySample(
      metadata, results, [], analyteReferenceRaw as AnalyteReference[],
      elementCompoundForms as ElementCompoundForm[], {},
    );
    expect(hazard.triggeredHps).toEqual([]);
    expect(hazard.isHazardous).toBeNull();
    expect(hazard.aggregate?.status).toBe("indeterminate");
    expect(eal.code).toBeNull();
  });
});
