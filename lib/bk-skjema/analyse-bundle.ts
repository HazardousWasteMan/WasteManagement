// One bundled lab report in, one BK-skjema per chemical test out.
//
// Shared by the streaming API route and scripts/build-data-lab-seed.mjs so the demo seed is
// produced by exactly the same code path as a live upload — a seed built by a parallel
// implementation would drift from what users actually get.
import { convertDocument, extractStructured, buildBkPageSchema, type DatalabBlock, type DatalabPage } from "./datalab";
import { bkFromDatalab } from "./from-datalab";
import { detectSubReports, type SubReport } from "./segment";
import type { BkField, BkResultRow, BkSource } from "./form-map";
import type { classifySample } from "../hp-classification/classify-sample";
import type { LegalCitationView } from "../compliance/citation-view";

/** Datalab tolerates concurrent jobs; their own reference script uses four workers. */
const MAX_CONCURRENT_EXTRACTS = 4;

export interface AnalysedSample {
  subReport: SubReport;
  fields: BkField[];
  metadata: BkSource["metadata"];
  results: BkResultRow[];
  classification: ReturnType<typeof classifySample>;
  unmatchedAnalytes: string[];
  /** Datalab's raw filled schema, kept so the origin/process can be changed without re-extracting. */
  raw: Record<string, unknown>;
  costCents: number;
}

export interface BundleAnalysis {
  pageCount: number;
  pages: DatalabPage[];
  subReports: SubReport[];
  samples: AnalysedSample[];
  /** Only blocks some citation refers to — the full tree is far larger than the client needs. */
  blocks: Record<string, DatalabBlock>;
  costCents: number;
}

export type BundleEvent =
  | { phase: "converting" }
  | { phase: "segmented"; subReports: SubReport[]; pageCount: number; pages: DatalabPage[] }
  | { phase: "sample"; index: number; total: number; sample: AnalysedSample }
  | { phase: "failed-sample"; index: number; total: number; sampleNo: string; error: string };

/** Blocks referenced by any citation on any field, so the payload carries only what is used. */
export function citedBlocks(
  samples: AnalysedSample[],
  blocks: Record<string, DatalabBlock>
): Record<string, DatalabBlock> {
  const ids = new Set<string>();
  for (const s of samples) {
    for (const f of s.fields) for (const c of f.citations ?? []) if (c.blockId) ids.add(c.blockId);
    for (const r of s.results) for (const c of r.citations ?? []) if (c.blockId) ids.add(c.blockId);
  }
  const out: Record<string, DatalabBlock> = {};
  for (const id of ids) if (blocks[id]) out[id] = blocks[id];
  return out;
}

/**
 * Converts the document once (so the parse is paid for once), splits it into its sub-reports, then
 * extracts each in parallel. Sub-reports are emitted through `onEvent` as they land rather than
 * only at the end, so a caller can show the first form while the rest are still running.
 */
export async function analyseBundle(
  pdf: Buffer,
  filename: string,
  opts: {
    originProcess?: string | null;
    pageRange?: string;
    onEvent?: (e: BundleEvent) => void;
    /** Per-field resolved legal citations, resolved once by the caller before this runs and
     *  threaded into every sub-report's bkFromDatalab call — same citation for every sample. */
    legalCitations?: Record<string, LegalCitationView | null>;
  } = {}
): Promise<BundleAnalysis> {
  const emit = opts.onEvent ?? (() => {});
  const originProcess = opts.originProcess ?? null;
  const legalCitations = opts.legalCitations;

  emit({ phase: "converting" });
  const converted = await convertDocument(pdf, filename, { pageRange: opts.pageRange });
  const pages = converted.pages.map(p => p.page);

  let subReports = detectSubReports(converted.blocks, pages);
  if (subReports.length === 0) {
    // No recognisable per-sample headers: treat the whole range as a single report rather than
    // returning nothing, so an unfamiliar layout still produces one form.
    subReports = [{
      sampleNo: "hele dokumentet",
      marking: null,
      matrix: null,
      firstPage: pages[0] ?? 0,
      lastPage: pages[pages.length - 1] ?? 0,
      pageRange: opts.pageRange ?? `${pages[0] ?? 0}-${pages[pages.length - 1] ?? 0}`,
    }];
  }
  emit({ phase: "segmented", subReports, pageCount: converted.pageCount, pages: converted.pages });

  const schema = buildBkPageSchema();
  const samples: AnalysedSample[] = [];
  const queue = subReports.map((subReport, index) => ({ subReport, index }));

  async function worker() {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      const { subReport, index } = job;
      try {
        const extracted = await extractStructured(
          schema,
          converted.checkpointId ? { checkpointId: converted.checkpointId } : { pdf, filename },
          { pageRange: subReport.pageRange }
        );
        const result = bkFromDatalab(extracted.data, converted.blocks, originProcess, legalCitations);
        const sample: AnalysedSample = {
          subReport,
          fields: result.fields,
          metadata: result.source.metadata,
          results: result.source.results,
          classification: result.classification,
          unmatchedAnalytes: result.unmatchedAnalytes,
          raw: extracted.data,
          costCents: extracted.costCents,
        };
        samples.push(sample);
        emit({ phase: "sample", index, total: subReports.length, sample });
      } catch (err) {
        // One failing sub-report must not lose the others.
        emit({
          phase: "failed-sample",
          index,
          total: subReports.length,
          sampleNo: subReport.sampleNo,
          error: err instanceof Error ? err.message : "extraction failed",
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_EXTRACTS, subReports.length) }, worker)
  );

  // Emission order follows completion; the payload is ordered by position in the document.
  samples.sort((a, b) => a.subReport.firstPage - b.subReport.firstPage);

  return {
    pageCount: converted.pageCount,
    pages: converted.pages,
    subReports,
    samples,
    blocks: citedBlocks(samples, converted.blocks),
    costCents: converted.costCents + samples.reduce((sum, s) => sum + s.costCents, 0),
  };
}
