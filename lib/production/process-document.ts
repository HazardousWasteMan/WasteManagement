import { PRODUCTION_VERSIONS } from "./versions";
import { createHash } from "node:crypto";
import { analyseBundle, type AnalysedSample } from "@/lib/bk-skjema/analyse-bundle";
import { resolveBundleLegalCitations } from "@/lib/bk-skjema/legal-citations";
import type { ProcessingStore } from "./processing-store";
import type { JsonObject } from "./types";
import type { ProcessingSample } from "./processing-types";

export const MAX_PROJECT_UPLOAD_BYTES = 25 * 1024 * 1024;
export class ProjectInputError extends Error {}

export function validatePdf(pdf: Buffer) {
  if (pdf.length > MAX_PROJECT_UPLOAD_BYTES) throw new ProjectInputError("PDF must be 25 MB or smaller");
  if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new ProjectInputError("Upload a PDF document");
}
/** JSON snapshot, not a live reference; strips undefined provider fields without changing values. */
function snapshot(value: unknown): JsonObject { return JSON.parse(JSON.stringify(value)) as JsonObject; }

export function sampleBkStatus(sample: AnalysedSample): NonNullable<ProcessingSample["bk_status"]> {
  if (sample.classification.hazard.isHazardous === null || !sample.classification.eal.code) return "needs_review";
  if (sample.fields.some(field => field.src === "human" && !field.value?.trim() && !field.check && !field.select)) return "needs_input";
  return "draft_ready";
}

/** Store bytes first; a conversion failure must still leave an identifiable uploaded source. */
export async function uploadProjectDocument(store: ProcessingStore, projectId: string, filename: string, pdf: Buffer) {
  validatePdf(pdf);
  return store.upload(projectId, filename, createHash("sha256").update(pdf).digest("hex"), pdf.toString("base64"));
}

/** Request-bound processing; per-sample commits survive later failures. Run IDs are retry
 * keys, not automatic content matching. A new explicit run creates new streams/assessments. */
export async function processProjectDocument(store: ProcessingStore, input: {
  projectId: string; documentId: string; runId: string; originProcess: string | null;
}, dependencies = { analyse: analyseBundle, citations: resolveBundleLegalCitations }) {
  const source = await store.readDocument(input.projectId, input.documentId);
  if (!source) throw new ProjectInputError("Document not found in this project");
  const { run, claimed } = await store.begin(input.projectId, input.documentId, input.runId, input.originProcess);
  if (!claimed) return run;
  try {
    const legalCitations = await dependencies.citations();
    const analysis = await dependencies.analyse(Buffer.from(source.base64, "base64"), source.document.filename, {
      originProcess: input.originProcess, legalCitations,
      onEvent: async (event, evidence) => {
        if (event.phase === "segmented") {
          await store.register(input.projectId, run.id, event.subReports.map(report => snapshot(report)));
        } else if (event.phase === "sample") {
          const sample = event.sample;
          await store.save(input.projectId, run.id, event.index, {
            snapshot: snapshot({ snapshotVersion: 1, pipeline: "analyseBundle", sourceDocumentId: source.document.id,
              sourceSha256: source.document.sha256, originProcess: input.originProcess,
              ...sample, versions: PRODUCTION_VERSIONS, processingRunId: run.id, evidence: evidence ?? null }),
            bk: snapshot({ fields: sample.fields, template: "bk-skjema-blank.pdf", mappingVersion: 1 }),
            compliance: sample.fields.filter(field => field.legalCitation).map(field => snapshot({ field: field.field, key: field.legalCitationKey, citation: field.legalCitation })),
            bkStatus: sampleBkStatus(sample), error: null,
          });
        } else if (event.phase === "failed-sample") {
          await store.save(input.projectId, run.id, event.index, {
            snapshot: null, bk: null, compliance: [], bkStatus: null,
            error: "Sample extraction or persistence failed. Reprocess the document to try again.",
          });
        }
      },
    });
    const incomplete = analysis.extractionState !== "complete";
    return await store.finish(input.projectId, run.id, incomplete
      ? "Document extraction is incomplete or its sample boundaries require review. Saved evidence is retained."
      : null);
  } catch {
    // Do not discard sibling assessments or expose raw provider errors/credentials.
    return store.finish(input.projectId, run.id, "Document processing was interrupted or failed. Saved samples are retained.");
  }
}
