// Splitting a bundled report into one BK-skjema per chemical test.
//
// A Eurofins bundle like the Alta lufthavn PDF holds several independent sub-reports, each with
// its own Prøvenr., matrix and analyte table. One BK-skjema describes one delivery, so extracting
// the whole file at once is not merely slow (measured 4.3 min for 15 pages) but wrong: the schema
// is single-sample, so five samples get merged into one form. Datalab's own guidance is the same —
// "use page ranges and document segmentation to improve speed and accuracy".
//
// Detection reads the already-converted block text, so it costs nothing extra: every sub-report
// repeats a "Prøvenr.: <id>" header row, and pages sharing an id belong to the same sub-report.
import type { DatalabBlock } from "./datalab";

export interface SubReport {
  /** The lab's own sample number, e.g. "439-2025-10080994". */
  sampleNo: string;
  /** The customer's marking, when the header states one. */
  marking: string | null;
  /** Matrix/material, e.g. "Betong". */
  matrix: string | null;
  /** 0-based, inclusive. */
  firstPage: number;
  lastPage: number;
  /** Datalab page_range syntax for this sub-report. */
  pageRange: string;
}

// OCR of these headers varies ("Prøvermerking:" turns up in the real report), so the labels are
// matched loosely rather than exactly.
const LABEL = {
  sampleNo: /^pr[øo]ve\s*nr/i,
  marking: /^pr[øo]ve.{0,3}merking/i,
  matrix: /^pr[øo]ve\s*type/i,
};

/** Reads "label: value" pairs out of a table row's cells. */
function pairsFromRow(cells: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < cells.length - 1; i++) {
    if (cells[i].trim().endsWith(":")) pairs.push([cells[i], cells[i + 1]]);
  }
  return pairs;
}

interface PageHeader { sampleNo?: string; marking?: string; matrix?: string }

function headerForPage(blocks: DatalabBlock[]): PageHeader {
  const header: PageHeader = {};
  for (const block of blocks) {
    for (const region of block.regions) {
      for (const [label, value] of pairsFromRow(region.cells)) {
        const v = value.trim();
        if (!v) continue;
        if (!header.sampleNo && LABEL.sampleNo.test(label)) header.sampleNo = v;
        else if (!header.marking && LABEL.marking.test(label)) header.marking = v;
        else if (!header.matrix && LABEL.matrix.test(label)) header.matrix = v;
      }
    }
  }
  return header;
}

/**
 * Groups the document's pages into sub-reports. Pages before the first header, and pages with no
 * header of their own, attach to the sub-report already in progress — continuation pages of an
 * analyte table carry no Prøvenr. of their own.
 */
export function detectSubReports(blocks: Record<string, DatalabBlock>, pages: number[]): SubReport[] {
  const byPage = new Map<number, DatalabBlock[]>();
  for (const block of Object.values(blocks)) {
    if (!byPage.has(block.page)) byPage.set(block.page, []);
    byPage.get(block.page)!.push(block);
  }

  const reports: SubReport[] = [];
  for (const page of [...pages].sort((a, b) => a - b)) {
    const header = headerForPage(byPage.get(page) ?? []);
    const current = reports[reports.length - 1];

    if (header.sampleNo && header.sampleNo !== current?.sampleNo) {
      reports.push({
        sampleNo: header.sampleNo,
        marking: header.marking ?? null,
        matrix: header.matrix ?? null,
        firstPage: page,
        lastPage: page,
        pageRange: String(page),
      });
      continue;
    }

    if (current) {
      current.lastPage = page;
      // A continuation page can still be where the marking or matrix first became legible.
      current.marking ??= header.marking ?? null;
      current.matrix ??= header.matrix ?? null;
    }
    // No sub-report open yet and no header on this page: a cover page, skip it.
  }

  for (const r of reports) {
    r.pageRange = r.firstPage === r.lastPage ? String(r.firstPage) : `${r.firstPage}-${r.lastPage}`;
  }
  return reports;
}

/** Short human label for the switcher, e.g. "Betong · ENAT-BØF1-BO9OB1". */
export function subReportLabel(r: SubReport): string {
  return [r.matrix, r.marking ?? r.sampleNo].filter(Boolean).join(" · ");
}
