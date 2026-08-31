// Turns a Datalab extraction into (a) resolved citations the UI can highlight, (b) the
// classification engine's inputs, and (c) the 103 BK-skjema fields.
import type { DatalabBlock } from "./datalab";
import type { BkCitation, BkField, BkResultRow, BkSource } from "./form-map";
import { buildBkFields } from "./form-map";
import { classifySample } from "../hp-classification/classify-sample";
import { ORIGIN_OPTIONS } from "../hp-classification/origin-options";
import type { AnalyteReference, SampleMetadata, SampleResult } from "../hp-classification/types";
import type { ElementCompoundForm } from "../hp-classification/speciate";
import analyteReferenceRaw from "../data/analyte-reference.json";
import compoundFormsRaw from "../data/element-compound-forms.json";

/** Datalab writes citations as a "<field>_citations" sibling holding block ids. */
export function resolveCitations(
  container: Record<string, unknown>,
  field: string,
  blocks: Record<string, DatalabBlock>
): BkCitation[] {
  const raw = container[`${field}_citations`];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string")
    .map(id => {
      const b = blocks[id];
      return {
        blockId: id,
        page: b ? b.page : null,
        text: b ? b.text : null,
        bbox: b ? b.bbox : null,
      };
    });
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "mg/kg TS", "% TS", "µg/kg tørrstoff" all mean the value is already on a dry-matter basis. */
const isDryBasis = (unit: string): boolean => /\b(ts|t[øo]rrstoff|dw)\b/i.test(unit);

export interface DataLabBkResult {
  fields: BkField[];
  source: BkSource;
  classification: ReturnType<typeof classifySample>;
  /** Result rows Datalab could not tie to a known analyte — excluded from hazard classification. */
  unmatchedAnalytes: string[];
  /** Blocks keyed by id, so the UI can resolve any citation it is handed. */
  blocks: Record<string, DatalabBlock>;
}

/**
 * @param originProcess The one field no lab report contains. Without it assignEalCode halts, so
 *                      the UI collects it from the user and passes it back through.
 */
export function bkFromDatalab(
  data: Record<string, unknown>,
  blocks: Record<string, DatalabBlock>,
  originProcess: string | null
): DataLabBkResult {
  const analyteRef = analyteReferenceRaw as AnalyteReference[];
  const knownIds = new Set(analyteRef.map(a => a.analyteId));

  const rawRows = Array.isArray(data.analyseresultater) ? data.analyseresultater : [];
  const unmatchedAnalytes: string[] = [];

  const rows: BkResultRow[] = rawRows.map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const name = str(row.parameter) ?? `rad ${i + 1}`;
    const unit = str(row.enhet) ?? "";
    const belowLoq = row.under_loq === true;
    const loq = num(row.loq);
    // Datalab reports a below-LOQ result by putting the LOQ itself in `verdi`, so the measured
    // value is only meaningful when the row is not flagged below-LOQ.
    const value = belowLoq ? null : num(row.verdi);
    const candidate = str(row.analyte_id);
    const analyteId = candidate && knownIds.has(candidate) ? candidate : null;
    if (!analyteId) unmatchedAnalytes.push(name);

    return {
      rawAnalyteName: name,
      analyteId,
      resultValue: value,
      isBelowLoq: belowLoq,
      loqValue: loq,
      unitRaw: unit,
      citations: resolveCitations(row, "verdi", blocks),
    };
  });

  const physical = (str(data.fysisk_form) ?? "").toLowerCase();
  const physicalState: SampleMetadata["physicalState"] =
    /flyt|liquid/.test(physical) ? "liquid" : /pulver|powder/.test(physical) ? "powder" : "solid";

  const metadata: SampleMetadata = {
    sampleId: "data-lab-1",
    externalReportNo: str(data.rapportnummer) ?? "",
    labName: str(data.laboratorium) ?? "",
    customerName: str(data.oppdragsgiver) ?? "",
    sampleMarking: str(data.provemerking) ?? str(data.provenummer) ?? "",
    matrixType: str(data.matrise) ?? "",
    samplingDate: str(data.provetakingsdato),
    receiptDate: str(data.mottaksdato),
    originProcess,
    producerName: str(data.avfallsprodusent),
    physicalState,
    viscosity40cMm2s: null,
    ph: num(data.ph),
    labClassificationGiven: false,
    labStatedEalCode: null,
  };

  const sampleResults: SampleResult[] = rows.map((r, i) => ({
    resultId: `r${i + 1}`,
    sampleId: metadata.sampleId,
    analyteId: r.analyteId,
    rawAnalyteName: r.rawAnalyteName,
    resultValue: r.resultValue,
    isBelowLoq: r.isBelowLoq,
    loqValue: r.loqValue,
    unitRaw: r.unitRaw,
    expressedOnDryBasis: isDryBasis(r.unitRaw),
    method: null,
  }));

  const classification = classifySample(
    metadata,
    sampleResults,
    [], // Datalab's schema carries no HP1-3 physical test results; those stay "not tested"
    analyteRef,
    compoundFormsRaw as ElementCompoundForm[],
    Object.fromEntries(ORIGIN_OPTIONS.map(o => [o.value, o.chapter]))
  );

  const citationsFor = (field: string) => resolveCitations(data, field, blocks);
  const source: BkSource = {
    metadata: {
      externalReportNo: metadata.externalReportNo,
      labName: metadata.labName,
      customerName: metadata.customerName,
      producerName: metadata.producerName,
      sampleMarking: metadata.sampleMarking,
      matrixType: metadata.matrixType,
      samplingDate: metadata.samplingDate,
      receiptDate: metadata.receiptDate,
      physicalState: metadata.physicalState,
      pickupLocation: str(data.hentested),
      tocPct: num(data.toc_prosent),
      glodetapPct: num(data.glodetap_prosent),
    },
    results: rows,
    isHazardous: classification.hazard.isHazardous,
    eal: classification.eal,
    citations: {
      externalReportNo: citationsFor("rapportnummer"),
      labName: citationsFor("laboratorium"),
      customerName: citationsFor("oppdragsgiver"),
      producerName: citationsFor("avfallsprodusent"),
      sampleMarking: citationsFor("provemerking"),
      matrixType: citationsFor("matrise"),
      samplingDate: citationsFor("provetakingsdato"),
      receiptDate: citationsFor("mottaksdato"),
      pickupLocation: citationsFor("hentested"),
      tocPct: citationsFor("toc_prosent"),
      glodetapPct: citationsFor("glodetap_prosent"),
    },
  };

  const fields = buildBkFields(source);

  // Derived fields have no citation of their own, so point them at the rows that drove them:
  // clicking "Avfallstype: Ordinært avfall" should show the analyte table it was concluded from.
  const resultCitations = rows.flatMap(r => r.citations ?? []).filter(c => c.blockId);
  const dedupedResultCitations = [...new Map(resultCitations.map(c => [c.blockId, c])).values()].slice(0, 12);
  for (const f of fields) {
    if (f.src === "derived" && (!f.citations || f.citations.length === 0)) {
      f.citations = dedupedResultCitations;
    }
  }

  return { fields, source, classification, unmatchedAnalytes, blocks };
}
