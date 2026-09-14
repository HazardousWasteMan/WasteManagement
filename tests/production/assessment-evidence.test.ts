import { describe, expect, it } from "vitest";
import { bkFromDatalab } from "@/lib/bk-skjema/from-datalab";
import { assembleAssessmentEvidence } from "@/lib/production/assessment-evidence";
import { finalizationEligibility } from "@/lib/production/finalization-policy";
import { buildBkWorkspace } from "@/lib/bk-skjema/workspace";
import type { AnalysedSample } from "@/lib/bk-skjema/analyse-bundle";
import type { Assessment, SourceDocumentLink } from "@/lib/production/types";

const assessment = (id: string, stream: string): Assessment => ({ id, organisation_id: "org", project_id: "project",
  waste_stream_id: stream, version: 1, previous_assessment_id: null, assessed_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z", created_by: "user", eal_code: null, is_hazardous: null,
  decision_snapshot: {}, bk_output: null, compliance_evidence: [] });

function sample(id: string, raw: Record<string, unknown>): AnalysedSample {
  const result = bkFromDatalab(raw, {}, "escavo terre e rocce", undefined,
    { documentRef: `sha256:${id}`, sampleId: id });
  return { subReport: { sampleNo: id, marking: id, matrix: "synthetic", firstPage: 0, lastPage: 0, pageRange: "0" },
    fields: result.fields, metadata: result.source.metadata, results: result.source.results,
    classification: result.classification, normalizationTrace: result.normalizationTrace,
    unmatchedAnalytes: result.unmatchedAnalytes, raw, costCents: 0, extractionState: "complete" };
}

const link = (id: string): SourceDocumentLink => ({ source_document_id: id, segment_key: `${id}:0`, first_page: 0, last_page: 0 });

describe("explicit multi-document assessment evidence", () => {
  it("combines compatible roles while retaining cross-document measurement identity and provenance", () => {
    const bulk = sample("bulk", { totalinnhold_utfort: true, matrise: "soil", analyseresultater: [
      { parameter: "Arsen", analyte_id: "arsenic", verdi: 2, under_loq: false, enhet: "mg/kg TS", analytical_context: "Total content" },
    ] });
    const leach = sample("leach", { ristetest_utfort: true, matrise: "soil", toc_prosent: 1.2, analyseresultater: [
      { parameter: "Arsen", analyte_id: "arsenic", verdi: 0.2, under_loq: false, enhet: "mg/L", analytical_context: "Batch L/S 10" },
    ] });
    const sourceIds = [...bulk.classification.measurementBoundary.measurements,
      ...leach.classification.measurementBoundary.measurements].map(measurement => measurement.measurementId);
    const combined = assembleAssessmentEvidence([
      { assessment: assessment("a-bulk", "stream-a"), sample: bulk, documents: [link("doc-bulk")] },
      { assessment: assessment("a-leach", "stream-b"), sample: leach, documents: [link("doc-leach")] },
    ], { evidenceSetId: "combined", originProcess: "escavo terre e rocce" });
    const measurements = combined.classification.measurementBoundary.measurements;
    expect(measurements.map(measurement => measurement.measurementId)).toEqual(sourceIds);
    expect(measurements.filter(measurement => measurement.hpEligibility.eligible)).toHaveLength(1);
    expect(measurements.find(measurement => measurement.analyticalRole === "leaching_batch")?.source[0].documentRef).toBe("sha256:leach");
    expect(combined.metadata.tocPct).toBe(1.2);
  });

  it("rejects conflicting bulk sources instead of summing separate analyses", () => {
    const bulk = (id: string) => sample(id, { totalinnhold_utfort: true, analyseresultater: [
      { parameter: "Arsen", analyte_id: "arsenic", verdi: 2, under_loq: false, enhet: "mg/kg TS", analytical_context: "Total content" },
    ] });
    expect(() => assembleAssessmentEvidence([
      { assessment: assessment("a", "one"), sample: bulk("one"), documents: [link("one")] },
      { assessment: assessment("b", "two"), sample: bulk("two"), documents: [link("two")] },
    ], { evidenceSetId: "combined", originProcess: null })).toThrow(/Multiple bulk/);
  });

  it("rejects partial extraction and finalization independently blocks a partial snapshot", () => {
    const partial = sample("partial", { totalinnhold_utfort: true, analyseresultater: [
      { parameter: "Arsen", analyte_id: "arsenic", verdi: 2, under_loq: false, enhet: "mg/kg TS", analytical_context: "Total content" },
    ] });
    partial.extractionState = "partial";
    expect(() => assembleAssessmentEvidence([{ assessment: assessment("a", "one"), sample: partial,
      documents: [link("one")] }], { evidenceSetId: "combined", originProcess: null })).toThrow(/Incomplete extraction/);
    const a = assessment("a", "one");
    a.decision_snapshot = JSON.parse(JSON.stringify({ ...partial, versions: { measurementBoundary: "1" },
      extractionState: "partial" }));
    a.bk_output = JSON.parse(JSON.stringify({ fields: partial.fields }));
    const workspace = buildBkWorkspace(partial, { projectId: "project", projectName: "Synthetic",
      pickupLocation: "", streamId: "one", originProcess: null });
    expect(finalizationEligibility(a, workspace, true).reasons).toContain(
      "Source extraction is incomplete or requires review; it cannot support finalization."
    );
  });
});
