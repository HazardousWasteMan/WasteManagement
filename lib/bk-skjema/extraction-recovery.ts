import type { ExtractResult } from "./datalab";

export type ExtractionState = "complete" | "partial" | "failed" | "requires_review";

export type ExtractionFailure = {
  pageRange: string;
  attempts: number;
  reason: "timeout" | "provider_error";
};

export type StructuredChunk = ExtractResult & { pageRange: string };

export const RECOVERY_PAGE_THRESHOLD = 8;
export const RECOVERY_CHUNK_SIZE = 6;
export const RECOVERY_CHUNK_OVERLAP = 1;

const pageRange = (start: number, end: number) => start === end ? String(start) : `${start}-${end}`;

/** Datalab page ranges are zero-based because its converted block ids are zero-based. */
export function boundedPageRanges(pages: number[], size = RECOVERY_CHUNK_SIZE, overlap = RECOVERY_CHUNK_OVERLAP): string[] {
  const ordered = [...new Set(pages)].sort((a, b) => a - b);
  if (!ordered.length) return [];
  if (size < 2 || overlap < 0 || overlap >= size) throw new Error("Invalid extraction chunk configuration");
  const ranges: string[] = [];
  let index = 0;
  while (index < ordered.length) {
    const endIndex = Math.min(index + size - 1, ordered.length - 1);
    ranges.push(pageRange(ordered[index], ordered[endIndex]));
    if (endIndex === ordered.length - 1) break;
    index = endIndex - overlap + 1;
  }
  return ranges;
}

/** Low text density is a general signal that OCR/image processing may make one request slow. */
export function needsBoundedRecovery(pages: number[], blocks: Record<string, { page: number; text: string }>): boolean {
  if (pages.length > RECOVERY_PAGE_THRESHOLD) return true;
  if (pages.length < 3) return false;
  const textByPage = new Map(pages.map(page => [page, 0]));
  for (const block of Object.values(blocks)) {
    if (textByPage.has(block.page)) textByPage.set(block.page, textByPage.get(block.page)! + block.text.trim().length);
  }
  return [...textByPage.values()].reduce((sum, length) => sum + length, 0) / pages.length < 200;
}

const stringValue = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function extractedSampleIdentity(data: Record<string, unknown>): string | null {
  const value = stringValue(data.provenummer) ?? stringValue(data.provemerking);
  return value ? normalize(value) : null;
}

function rowCitations(row: Record<string, unknown>): string[] {
  return Object.entries(row).filter(([key, value]) => key.endsWith("_citations") && Array.isArray(value))
    .flatMap(([, value]) => value as unknown[]).filter((value): value is string => typeof value === "string").sort();
}

function semanticRowKey(row: Record<string, unknown>): string {
  return JSON.stringify([row.parameter, row.raw_value_text, row.verdi, row.under_loq, row.loq, row.enhet,
    row.analyte_id, row.analytical_context, row.concentration_basis, row.method]);
}

function mergeData(chunks: StructuredChunk[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const rows: Record<string, unknown>[] = [];
  const cited = new Set<string>();
  for (const chunk of chunks) {
    for (const [key, value] of Object.entries(chunk.data)) {
      if (key === "analyseresultater" || value === null || value === undefined || value === "") continue;
      if (!(key in merged)) merged[key] = structuredClone(value);
    }
    for (const raw of Array.isArray(chunk.data.analyseresultater) ? chunk.data.analyseresultater : []) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const citations = rowCitations(row);
      // Only deduplicate when provider provenance proves that overlapping chunks cited the same
      // source row. Equal values without citations may be legitimate repeated measurements.
      const key = citations.length ? JSON.stringify([citations, semanticRowKey(row)]) : null;
      if (key && cited.has(key)) continue;
      if (key) cited.add(key);
      rows.push(structuredClone(row));
    }
  }
  merged.analyseresultater = rows;
  return merged;
}

export type ReconciledExtraction = {
  identity: string | null;
  pageRanges: string[];
  data: Record<string, unknown>;
  requiresReview: boolean;
  costCents: number;
};

/** Group only by explicit extracted identity. Unidentified continuation chunks may join when the
 * whole recovery run contains exactly one identity; otherwise they remain separate for review. */
export function reconcileStructuredChunks(chunks: StructuredChunk[]): ReconciledExtraction[] {
  if (!chunks.length) return [];
  const identities = [...new Set(chunks.map(chunk => extractedSampleIdentity(chunk.data)).filter((id): id is string => !!id))];
  if (identities.length <= 1) {
    return [{ identity: identities[0] ?? null, pageRanges: chunks.map(chunk => chunk.pageRange), data: mergeData(chunks),
      requiresReview: identities.length === 0, costCents: chunks.reduce((sum, chunk) => sum + chunk.costCents, 0) }];
  }
  const groups = new Map<string, StructuredChunk[]>();
  for (const chunk of chunks) {
    const identity = extractedSampleIdentity(chunk.data);
    const key = identity ?? `unresolved:${chunk.pageRange}`;
    groups.set(key, [...(groups.get(key) ?? []), chunk]);
  }
  // These identities came from independent recovery calls after structural segmentation failed.
  // Multiple values may be real samples or unrelated report/reference numbers; none is promoted
  // to a trusted boundary until a reviewer confirms it.
  return [...groups.entries()].map(([key, group]) => ({ identity: key.startsWith("unresolved:") ? null : key,
    pageRanges: group.map(chunk => chunk.pageRange), data: mergeData(group), requiresReview: true,
    costCents: group.reduce((sum, chunk) => sum + chunk.costCents, 0) }));
}

export function isExtractionTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout|timed out|did not finish within/i.test(error.message);
}

export async function extractBoundedRanges(
  ranges: string[],
  extract: (pageRange: string) => Promise<ExtractResult>,
): Promise<{ chunks: StructuredChunk[]; failures: ExtractionFailure[] }> {
  const chunks: StructuredChunk[] = [];
  const failures: ExtractionFailure[] = [];
  // Bounded requests run sequentially during uncertain segmentation. This avoids multiplying
  // expensive OCR work and makes partial progress deterministic.
  for (const range of ranges) {
    let attempts = 0;
    for (;;) {
      attempts++;
      try {
        chunks.push({ ...(await extract(range)), pageRange: range });
        break;
      } catch (error) {
        const timeout = isExtractionTimeout(error);
        if (timeout && attempts === 1) continue;
        failures.push({ pageRange: range, attempts, reason: timeout ? "timeout" : "provider_error" });
        break;
      }
    }
  }
  return { chunks, failures };
}

const rowStructure = (data: Record<string, unknown>) => (Array.isArray(data.analyseresultater) ? data.analyseresultater : [])
  .map(raw => {
    const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return [normalize(stringValue(row.parameter) ?? ""), normalize(stringValue(row.enhet) ?? "")];
  });

/** Fill only missing context among exact sibling table structures. Explicit disagreement is kept. */
export function harmonizeSiblingAnalyticalContext(inputs: Record<string, unknown>[]): Record<string, unknown>[] {
  const outputs = inputs.map(input => structuredClone(input));
  const groups = new Map<string, number[]>();
  outputs.forEach((data, index) => {
    const signature = JSON.stringify(rowStructure(data));
    groups.set(signature, [...(groups.get(signature) ?? []), index]);
  });
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const sampleContextConflict = ["totalinnhold_utfort", "ristetest_utfort", "kolonnetest_utfort"].some(key =>
      new Set(indexes.map(index => outputs[index][key]).filter(value => typeof value === "boolean")).size > 1);
    const rowCount = rowStructure(outputs[indexes[0]]).length;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const rows = indexes.map(index => (outputs[index].analyseresultater as Record<string, unknown>[])[rowIndex]);
      const contexts = [...new Map(rows.map(row => stringValue(row.analytical_context)).filter((v): v is string => !!v).map(v => [normalize(v), v])).values()];
      if (!sampleContextConflict && contexts.length === 1) for (const row of rows) if (!stringValue(row.analytical_context)) row.analytical_context = contexts[0];
    }
    for (const key of ["totalinnhold_utfort", "ristetest_utfort", "kolonnetest_utfort"] as const) {
      const explicit = [...new Set(indexes.map(index => outputs[index][key]).filter((v): v is boolean => typeof v === "boolean"))];
      if (explicit.length === 1) for (const index of indexes) if (typeof outputs[index][key] !== "boolean") outputs[index][key] = explicit[0];
    }
  }
  return outputs;
}
