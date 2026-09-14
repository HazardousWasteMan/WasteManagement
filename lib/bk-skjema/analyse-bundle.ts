import { createHash } from "node:crypto";
import { convertDocument, extractStructured, buildBkPageSchema, type DatalabBlock, type DatalabPage, type ExtractResult } from "./datalab";
import { bkFromDatalab } from "./from-datalab";
import { detectSubReports, type SubReport } from "./segment";
import {
  boundedPageRanges, extractBoundedRanges, harmonizeSiblingAnalyticalContext,
  needsBoundedRecovery, reconcileStructuredChunks,
  type ExtractionFailure, type ExtractionState,
} from "./extraction-recovery";
import { buildBkFields, type BkField, type BkResultRow, type BkSource } from "./form-map";
import type { classifySample } from "../hp-classification/classify-sample";
import { HP_RULE_VERSION } from "../hp-classification/hp-outcome";
import type { LegalCitationView } from "../compliance/citation-view";

const MAX_CONCURRENT_EXTRACTS = 4;

export interface AnalysedSample {
  normalizationTrace?: import("../hp-classification/classify-sample").ClassificationTrace;
  subReport: SubReport;
  fields: BkField[];
  metadata: BkSource["metadata"];
  results: BkResultRow[];
  classification: ReturnType<typeof classifySample>;
  unmatchedAnalytes: string[];
  raw: Record<string, unknown>;
  costCents: number;
  extractionState: ExtractionState;
}

export interface BundleAnalysis {
  pageCount: number;
  pages: DatalabPage[];
  subReports: SubReport[];
  samples: AnalysedSample[];
  blocks: Record<string, DatalabBlock>;
  costCents: number;
  extractionState: ExtractionState;
  failures: ExtractionFailure[];
  reviewIssues: string[];
}

export type BundleEvent =
  | { phase: "converting" }
  | { phase: "segmented"; subReports: SubReport[]; pageCount: number; pages: DatalabPage[]; extractionState?: ExtractionState }
  | { phase: "sample"; index: number; total: number; sample: AnalysedSample }
  | { phase: "failed-sample"; index: number; total: number; sampleNo: string; error: string };

export function citedBlocks(samples: AnalysedSample[], blocks: Record<string, DatalabBlock>): Record<string, DatalabBlock> {
  const ids = new Set<string>();
  for (const s of samples) {
    for (const f of s.fields) for (const c of f.citations ?? []) if (c.blockId) ids.add(c.blockId);
    for (const r of s.results) for (const c of r.citations ?? []) if (c.blockId) ids.add(c.blockId);
  }
  const out: Record<string, DatalabBlock> = {};
  for (const id of ids) if (blocks[id]) out[id] = blocks[id];
  return out;
}

const bounds = (ranges: string[], fallback: number[]) => {
  const values = ranges.flatMap(range => range.split(/[-,]/).map(Number)).filter(Number.isFinite);
  return { first: values.length ? Math.min(...values) : fallback[0] ?? 0,
    last: values.length ? Math.max(...values) : fallback.at(-1) ?? 0 };
};

function toSample(
  data: Record<string, unknown>, extracted: Pick<ExtractResult, "costCents">, subReport: SubReport,
  state: ExtractionState, blocks: Record<string, DatalabBlock>, documentRef: string,
  originProcess: string | null, legalCitations: Record<string, LegalCitationView | null> | undefined,
  multiple: boolean,
): AnalysedSample {
  const result = bkFromDatalab(data, blocks, originProcess, legalCitations, {
    documentRef, sampleId: `${documentRef}/${subReport.sampleNo}/${subReport.firstPage}`,
    originSharedAcrossSamples: multiple,
  });
  if (state !== "complete" && result.classification.hazard.isHazardous === false) {
    const issue = { code: "incomplete_extraction", measurementIds: [],
      reason: "A partial extraction cannot establish a non-hazardous conclusion." };
    result.classification.hazard.isHazardous = null;
    const aggregate = result.classification.hazard.aggregate;
    result.classification.hazard.aggregate = { status: "indeterminate", ruleVersion: aggregate?.ruleVersion ?? HP_RULE_VERSION,
      issues: [...(aggregate?.issues ?? []), issue] };
    result.classification.hazard.confidenceFlags.push(issue.reason);
    (result.classification.hazard.confidenceFlagsNo ??= []).push("Ufullstendig ekstraksjon kan ikke dokumentere at avfallet er ikke-farlig.");
    result.source.isHazardous = null;
    result.source.hazardConfidenceFlags = result.classification.hazard.confidenceFlags;
    result.source.hazardConfidenceFlagsNo = result.classification.hazard.confidenceFlagsNo;
    result.fields = buildBkFields(result.source);
  }
  return { subReport, fields: result.fields, metadata: result.source.metadata, results: result.source.results,
    classification: result.classification, normalizationTrace: result.normalizationTrace,
    unmatchedAnalytes: result.unmatchedAnalytes, raw: data, costCents: extracted.costCents,
    extractionState: state };
}

export async function analyseBundle(
  pdf: Buffer,
  filename: string,
  opts: {
    originProcess?: string | null;
    pageRange?: string;
    onEvent?: (e: BundleEvent, evidence?: Pick<BundleAnalysis, "pages" | "blocks">) => void | Promise<void>;
    legalCitations?: Record<string, LegalCitationView | null>;
  } = {}
): Promise<BundleAnalysis> {
  const emit = opts.onEvent ?? (() => {});
  const originProcess = opts.originProcess ?? null;
  const documentRef = `sha256:${createHash("sha256").update(pdf).digest("hex")}`;
  await emit({ phase: "converting" });
  const converted = await convertDocument(pdf, filename, { pageRange: opts.pageRange });
  const pages = converted.pages.map(page => page.page);
  const detected = detectSubReports(converted.blocks, pages);
  const lowConfidence = detected.length === 0;
  const useRecovery = lowConfidence && needsBoundedRecovery(pages, converted.blocks);
  const schema = buildBkPageSchema();
  const samples: AnalysedSample[] = [];
  const failures: ExtractionFailure[] = [];
  const reviewIssues: string[] = [];

  if (useRecovery) {
    const ranges = boundedPageRanges(pages);
    const recovered = await extractBoundedRanges(ranges, pageRange => extractStructured(
      schema, converted.checkpointId ? { checkpointId: converted.checkpointId } : { pdf, filename }, { pageRange }
    ));
    failures.push(...recovered.failures);
    const groups = reconcileStructuredChunks(recovered.chunks);
    if (groups.some(group => group.requiresReview)) reviewIssues.push("Sample boundaries could not be established for every recovered page group.");
    if (failures.length) reviewIssues.push("One or more bounded extraction ranges failed; successful evidence is incomplete.");
    let subReports: SubReport[] = groups.map((group, index) => {
      const range = bounds(group.pageRanges, pages);
      return { sampleNo: group.identity ?? `unresolved-sample-${index + 1}`, marking: null, matrix: null,
        firstPage: range.first, lastPage: range.last, pageRange: group.pageRanges.join(",") };
    });
    if (!subReports.length) {
      const range = bounds(ranges, pages);
      subReports = [{ sampleNo: "unresolved-document", marking: null, matrix: null,
        firstPage: range.first, lastPage: range.last, pageRange: ranges.join(",") }];
    }
    const state: ExtractionState = !groups.length ? "failed" : failures.length ? "partial" :
      groups.some(group => group.requiresReview) ? "requires_review" : "complete";
    await emit({ phase: "segmented", subReports, pageCount: converted.pageCount, pages: converted.pages, extractionState: state });
    if (!groups.length) {
      await emit({ phase: "failed-sample", index: 0, total: 1, sampleNo: subReports[0].sampleNo,
        error: "Bounded extraction failed; no classification was created." });
    } else {
      const harmonized = harmonizeSiblingAnalyticalContext(groups.map(group => group.data));
      for (let index = 0; index < groups.length; index++) {
        const sampleState: ExtractionState = failures.length ? "partial" : groups[index].requiresReview ? "requires_review" : "complete";
        const sample = toSample(harmonized[index], groups[index], subReports[index], sampleState,
          converted.blocks, documentRef, originProcess, opts.legalCitations, groups.length > 1);
        samples.push(sample);
        await emit({ phase: "sample", index, total: groups.length, sample }, {
          pages: converted.pages, blocks: citedBlocks([sample], converted.blocks),
        });
      }
    }
    return { pageCount: converted.pageCount, pages: converted.pages, subReports, samples,
      blocks: citedBlocks(samples, converted.blocks),
      costCents: converted.costCents + recovered.chunks.reduce((sum, chunk) => sum + chunk.costCents, 0),
      extractionState: state, failures, reviewIssues };
  }

  const subReports = detected.length ? detected : [{ sampleNo: "unresolved-document", marking: null, matrix: null,
    firstPage: pages[0] ?? 0, lastPage: pages.at(-1) ?? 0,
    pageRange: opts.pageRange ?? `${pages[0] ?? 0}-${pages.at(-1) ?? 0}` }];
  if (lowConfidence) reviewIssues.push("Sample boundaries were not detected; the bounded short document requires review.");
  await emit({ phase: "segmented", subReports, pageCount: converted.pageCount, pages: converted.pages,
    extractionState: lowConfidence ? "requires_review" : "complete" });

  const extracted = new Map<number, ExtractResult>();
  const queue = subReports.map((subReport, index) => ({ subReport, index }));
  async function worker() {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      try {
        extracted.set(job.index, await extractStructured(schema,
          converted.checkpointId ? { checkpointId: converted.checkpointId } : { pdf, filename },
          { pageRange: job.subReport.pageRange }));
      } catch (error) {
        failures.push({ pageRange: job.subReport.pageRange, attempts: 1,
          reason: error instanceof Error && /timeout|timed out|did not finish within/i.test(error.message) ? "timeout" : "provider_error" });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_EXTRACTS, subReports.length) }, worker));
  const successfulIndexes = [...extracted.keys()].sort((a, b) => a - b);
  const harmonized = harmonizeSiblingAnalyticalContext(successfulIndexes.map(index => extracted.get(index)!.data));
  const harmonizedByIndex = new Map(successfulIndexes.map((index, position) => [index, harmonized[position]]));
  const completed: { index: number; sample: AnalysedSample }[] = [];
  for (let index = 0; index < subReports.length; index++) {
    const result = extracted.get(index);
    if (!result) continue;
    const sample = toSample(harmonizedByIndex.get(index)!, result, subReports[index],
      lowConfidence ? "requires_review" : "complete", converted.blocks, documentRef,
      originProcess, opts.legalCitations, subReports.length > 1);
    samples.push(sample);
    completed.push({ index, sample });
  }
  // Persistence callbacks are independent. Await all of them before surfacing one callback
  // failure so a database outage for one sample cannot abandon already extracted siblings.
  const emissions = await Promise.allSettled([
    ...completed.map(({ index, sample }) => (async () => {
      try {
        await emit({ phase: "sample", index, total: subReports.length, sample }, {
          pages: converted.pages, blocks: citedBlocks([sample], converted.blocks),
        });
      } catch {
        await emit({ phase: "failed-sample", index, total: subReports.length, sampleNo: subReports[index].sampleNo,
          error: "Sample extraction or persistence failed; no replacement classification was created." });
      }
    })()),
    ...subReports.flatMap((subReport, index) => extracted.has(index) ? [] : [emit({ phase: "failed-sample", index,
      total: subReports.length, sampleNo: subReport.sampleNo, error: "Sample extraction failed; no classification was created." })]),
  ]);
  const rejectedEmission = emissions.find(result => result.status === "rejected");
  if (rejectedEmission?.status === "rejected") throw rejectedEmission.reason;
  const state: ExtractionState = !samples.length ? "failed" : failures.length ? "partial" : lowConfidence ? "requires_review" : "complete";
  return { pageCount: converted.pageCount, pages: converted.pages, subReports, samples,
    blocks: citedBlocks(samples, converted.blocks),
    costCents: converted.costCents + [...extracted.values()].reduce((sum, result) => sum + result.costCents, 0),
    extractionState: state, failures, reviewIssues };
}
