import { classifySample, type ClassificationTrace } from "@/lib/hp-classification/classify-sample";
import type { Measurement } from "@/lib/hp-classification/measurement";
import type { AnalyteReference, SampleMetadata, SampleResult } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import compoundFormsRaw from "@/lib/data/element-compound-forms.json";
import { buildBkFields, type BkCitation, type BkSource } from "@/lib/bk-skjema/form-map";
import type { AnalysedSample } from "@/lib/bk-skjema/analyse-bundle";
import { PRODUCTION_VERSIONS } from "./versions";
import type { Assessment, JsonObject, SourceDocumentLink } from "./types";
import type { getProductionApplication } from "./server";
import { ProcessingPersistenceError } from "./processing-store";

type Application = Awaited<ReturnType<typeof getProductionApplication>>;
export const ASSESSMENT_EVIDENCE_SET_VERSION = 1;

export type AssessmentEvidenceSelection = {
  assessmentId: string;
  /** Caller must state the stream it reviewed; stale or accidental selections fail closed. */
  expectedWasteStreamId: string;
};

type EvidenceDocument = {sourceDocumentId:string;documentRef:string;pages:import("@/lib/bk-skjema/datalab").DatalabPage[];blocks:Record<string,import("@/lib/bk-skjema/datalab").DatalabBlock>};
type EvidenceSource = { assessment: Assessment; sample: AnalysedSample; documents: SourceDocumentLink[]; evidenceDocuments?:EvidenceDocument[] };

const roleContext: Record<Measurement["analyticalRole"], string | null> = {
  total_content: "total-content evidence retained from the persisted measurement boundary",
  leaching_batch: "batch leaching evidence retained from the persisted measurement boundary",
  leaching_column: "column leaching evidence retained from the persisted measurement boundary",
  physical_or_composition: null,
  unknown: null,
};

function sameMeasurement(a: Measurement, b: Measurement): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function uniqueMeasurements(sources: EvidenceSource[]): Measurement[] {
  const byId = new Map<string, Measurement>();
  for (const source of sources) for (const measurement of source.sample.classification.measurementBoundary.measurements) {
    const existing = byId.get(measurement.measurementId);
    if (existing && !sameMeasurement(existing, measurement)) throw new Error("Conflicting persisted measurement identity");
    if (!existing) byId.set(measurement.measurementId, structuredClone(measurement));
  }
  return [...byId.values()];
}

function rowsFromMeasurements(measurements: Measurement[]): SampleResult[] {
  return measurements.map((measurement, index) => ({
    measurementId: measurement.measurementId,
    resultId: `evidence-${index + 1}`,
    sampleId: measurement.sampleId,
    analyteId: measurement.mapping.analyteId,
    rawAnalyteName: measurement.rawLabel,
    rawValueText: measurement.rawValueText,
    resultValue: measurement.parsedValue,
    isBelowLoq: measurement.censoring === "<" || measurement.censoring === "<=" || measurement.censoring === "non-detect",
    loqValue: measurement.reportedLimit,
    unitRaw: measurement.rawUnit,
    expressedOnDryBasis: measurement.basis === "dry",
    concentrationBasis: measurement.basis,
    censoring: measurement.censoring,
    method: measurement.method,
    analyticalContext: measurement.roleReview.state === "established"
      ? [roleContext[measurement.analyticalRole], measurement.testContext].filter(Boolean).join(" | ") || null
      : measurement.testContext,
    source: structuredClone(measurement.source),
  }));
}

function oneOptionalNumber(name: string, values: (number | null | undefined)[]): number | null {
  const unique = [...new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)))];
  if (unique.length > 1) throw new Error(`Conflicting ${name} evidence requires review`);
  return unique[0] ?? null;
}

const citations = (measurement: Measurement): BkCitation[] => measurement.source.map(source => ({
  blockId: source.blockId ?? null, page: source.page ?? null, bbox: source.region ?? null, text: null,documentRef:source.documentRef,
}));

/** Pure recomputation boundary: HP receives only total-content rows through the unchanged gate;
 * leaching/composition evidence remains available to its separate inventory. */
export function assembleAssessmentEvidence(sources: EvidenceSource[], input: {
  evidenceSetId: string; originProcess: string | null;
}): AnalysedSample {
  if (!sources.length) throw new Error("At least one explicit evidence source is required");
  if (sources.some(source => source.sample.extractionState && source.sample.extractionState !== "complete")) {
    throw new Error("Incomplete extraction cannot be assembled into a certifiable evidence set");
  }
  const bulkSources = sources.filter(source => source.sample.classification.measurementBoundary.measurements.some(m => m.hpEligibility.eligible));
  if (bulkSources.length > 1) throw new Error("Multiple bulk concentration sources require manual reconciliation");
  const primary = bulkSources[0] ?? sources[0];
  const measurements = uniqueMeasurements(sources);
  const rows = rowsFromMeasurements(measurements);
  const p = primary.sample.metadata;
  const metadata: SampleMetadata = {
    sampleId: `assessment-evidence-set:${input.evidenceSetId}`,
    externalReportNo: p.externalReportNo ?? "",
    labName: p.labName ?? "",
    customerName: p.customerName ?? "",
    sampleMarking: p.sampleMarking ?? "",
    matrixType: p.matrixType ?? "",
    samplingDate: p.samplingDate ?? null,
    receiptDate: p.receiptDate ?? null,
    originProcess: input.originProcess,
    producerName: p.producerName ?? null,
    physicalState: p.physicalState === "liquid" || p.physicalState === "powder" ? p.physicalState : "solid",
    viscosity40cMm2s: null, ph: null, labClassificationGiven: false, labStatedEalCode: null,
  };
  let normalizationTrace: ClassificationTrace | undefined;
  const classification = classifySample(metadata, rows, [], analyteReferenceRaw as AnalyteReference[],
    compoundFormsRaw as ElementCompoundForm[], Object.fromEntries(ORIGIN_OPTIONS.map(option => [option.value, option.chapter])),
    trace => { normalizationTrace = trace; });
  const resultRows = classification.measurementBoundary.measurements.map(measurement => ({
    rawAnalyteName: measurement.rawLabel, analyteId: measurement.mapping.analyteId,
    resultValue: measurement.parsedValue, isBelowLoq: measurement.censoring !== "detected",
    loqValue: measurement.reportedLimit, unitRaw: measurement.rawUnit,
    analyticalRole: measurement.analyticalRole, citations: citations(measurement),
  }));
  const legalCitations = Object.fromEntries(primary.sample.fields.flatMap(field =>
    field.legalCitationKey && field.legalCitation ? [[field.legalCitationKey, field.legalCitation] as const] : []));
  const source: BkSource = {
    metadata: { ...p,
      tocPct: oneOptionalNumber("TOC", sources.map(source => source.sample.metadata.tocPct)),
      glodetapPct: oneOptionalNumber("loss-on-ignition", sources.map(source => source.sample.metadata.glodetapPct)) },
    results: resultRows, isHazardous: classification.hazard.isHazardous,
    hasDetectedHazardousSubstance: classification.hazard.hasDetectedHazardousSubstance ?? null,
    hazardConfidenceFlags: classification.hazard.confidenceFlags,
    hazardConfidenceFlagsNo: classification.hazard.confidenceFlagsNo,
    eal: classification.eal, landfillAcceptance: classification.landfillAcceptance, legalCitations,
  };
  return { subReport: structuredClone(primary.sample.subReport), fields: buildBkFields(source), metadata: source.metadata,
    results: resultRows, classification, normalizationTrace, extractionState: "complete",
    unmatchedAnalytes: [...new Set(sources.flatMap(item => item.sample.unmatchedAnalytes))],
    raw: { evidenceSetVersion: ASSESSMENT_EVIDENCE_SET_VERSION,
      sourceAssessmentIds: sources.map(source => source.assessment.id) }, costCents: 0 };
}

/** Explicit application service. Similar names never participate: every source assessment and
 * its currently persisted stream must be supplied and checked under the organisation scope. */
export async function createAssessmentEvidenceSet(app: Application, input: {
  projectId: string; targetWasteStreamId: string; assessmentId: string; assessedAt: string;
  sources: AssessmentEvidenceSelection[];
}) {
  if (!input.sources.length || new Set(input.sources.map(source => source.assessmentId)).size !== input.sources.length) {
    throw new Error("Evidence selections must be explicit and unique");
  }
  const streams = await app.store.listWasteStreams(input.projectId);
  const target = streams.find(stream => stream.id === input.targetWasteStreamId);
  if (!target) throw new ProcessingPersistenceError("Target waste stream unavailable", "23503");
  const overview = await app.processing.overview(input.projectId);
  if (!overview) throw new ProcessingPersistenceError("Project unavailable", "23503");
  const evidenceSources: EvidenceSource[] = [];
  for (const selection of input.sources) {
    const assessment = await app.store.getAssessment(input.projectId, selection.assessmentId);
    if (!assessment || assessment.project_id !== input.projectId) throw new ProcessingPersistenceError("Evidence assessment unavailable in this project", "23503");
    if (assessment.waste_stream_id !== selection.expectedWasteStreamId) throw new Error("Evidence selection waste stream changed or was not explicitly acknowledged");
    const snapshot = assessment.decision_snapshot as unknown as AnalysedSample & { sourceDocumentId?:string;processingRunId?: string; evidence?:{pages:EvidenceDocument["pages"];blocks:EvidenceDocument["blocks"]};evidenceDocuments?:EvidenceDocument[]; evidenceSet?: {processingRunIds?:string[]} };
    if (!snapshot.classification?.measurementBoundary || !Array.isArray(assessment.bk_output?.fields)) throw new Error("Evidence assessment lacks a reusable measurement boundary");
    const sourceRunIds = snapshot.evidenceSet?.processingRunIds?.length ? snapshot.evidenceSet.processingRunIds :
      snapshot.processingRunId ? [snapshot.processingRunId] : [];
    if (!sourceRunIds.length || sourceRunIds.some(id => overview.runs.find(candidate => candidate.id === id)?.status !== "completed")) {
      throw new Error("Incomplete or untraceable source processing cannot enter an evidence set");
    }
    snapshot.fields = assessment.bk_output!.fields as unknown as AnalysedSample["fields"];
    const assessmentDocuments=(await app.store.listAssessmentDocuments(input.projectId, assessment.id)).map(({ source_document_id, segment_key, first_page, last_page }) =>
      ({ source_document_id, segment_key, first_page, last_page }));
    const evidenceDocuments=snapshot.evidenceDocuments?.length?snapshot.evidenceDocuments:assessmentDocuments.flatMap(link=>{
      const document=overview.documents.find(item=>item.id===link.source_document_id);
      if(!document||!snapshot.evidence||snapshot.sourceDocumentId!==document.id)return [];
      return [{sourceDocumentId:document.id,documentRef:`sha256:${document.sha256}`,pages:snapshot.evidence.pages,blocks:snapshot.evidence.blocks}];
    });
    evidenceSources.push({ assessment, sample: snapshot, documents:assessmentDocuments,evidenceDocuments });
  }
  const sample = assembleAssessmentEvidence(evidenceSources, { evidenceSetId: input.assessmentId, originProcess: target.origin_process });
  const documents = [...new Map(evidenceSources.flatMap(source => source.documents).map(document =>
    [`${document.source_document_id}:${document.segment_key}:${document.first_page}:${document.last_page}`, document])).values()];
  const processingRunIds = [...new Set(evidenceSources.flatMap(source => {
    const snapshot = source.assessment.decision_snapshot as {processingRunId?:unknown;evidenceSet?:{processingRunIds?:unknown}};
    return Array.isArray(snapshot.evidenceSet?.processingRunIds) ? snapshot.evidenceSet.processingRunIds : [snapshot.processingRunId];
  }).filter((id): id is string => typeof id === "string"))];
  const evidenceDocuments=[...new Map(evidenceSources.flatMap(source=>source.evidenceDocuments??[]).map(item=>[item.sourceDocumentId,item])).values()];
  const decisionSnapshot = JSON.parse(JSON.stringify({ snapshotVersion: 2, pipeline: "assessmentEvidenceSet",
    evidenceSet: { version: ASSESSMENT_EVIDENCE_SET_VERSION,
      sourceAssessmentIds: input.sources.map(source => source.assessmentId), processingRunIds },evidenceDocuments,
    ...sample, extractionState: "complete", versions: PRODUCTION_VERSIONS })) as JsonObject;
  const bkOutput = JSON.parse(JSON.stringify({ fields: sample.fields,
    template: "bk-skjema-blank.pdf", mappingVersion: 1 })) as JsonObject;
  return app.store.createAssessment({ id: input.assessmentId, project_id: input.projectId,
    waste_stream_id: input.targetWasteStreamId, assessed_at: input.assessedAt,
    eal_code: sample.classification.eal.code, is_hazardous: sample.classification.hazard.isHazardous,
    decision_snapshot: decisionSnapshot, documents,
    bk_output: bkOutput,
    compliance_evidence: sample.fields.filter(field => field.legalCitation).map(field =>
      JSON.parse(JSON.stringify({ field: field.field, key: field.legalCitationKey, citation: field.legalCitation }))) });
}
