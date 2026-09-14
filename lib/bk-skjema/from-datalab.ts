// Turns a Datalab extraction into (a) resolved citations the UI can highlight, (b) the
// classification engine's inputs, and (c) the 103 BK-skjema fields.
import { narrowCitation, type DatalabBlock } from "./datalab";
import type { BkCitation, BkField, BkResultRow, BkSource } from "./form-map";
import type { LegalCitationView } from "../compliance/citation-view";
import { buildBkFields } from "./form-map";
import { classifySample, type ClassificationTrace } from "../hp-classification/classify-sample";
import { ORIGIN_OPTIONS } from "../hp-classification/origin-options";
import type { AnalyteReference, SampleMetadata, SampleResult } from "../hp-classification/types";
import type { ElementCompoundForm } from "../hp-classification/speciate";
import analyteReferenceRaw from "../data/analyte-reference.json";
import compoundFormsRaw from "../data/element-compound-forms.json";

/**
 * Datalab writes citations as a "<field>_citations" sibling holding block ids.
 *
 * @param match The extracted value (or, for a result row, the analyte name). Used to narrow the
 *              citation from the whole block to the cell or row that actually holds it — without
 *              it a table citation highlights the entire table.
 */
export function resolveCitations(
  container: Record<string, unknown>,
  field: string,
  blocks: Record<string, DatalabBlock>,
  match: string | null = null,
  documentRef?: string,
): BkCitation[] {
  const raw = container[`${field}_citations`];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string")
    .map(id => {
      const b = blocks[id];
      if (!b) return { blockId: id, page: null, text: null, bbox: null, documentRef };
      const narrowed = narrowCitation(b, match);
      return { blockId: id, page: b.page, text: narrowed.text, bbox: narrowed.bbox, documentRef };
    });
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** "mg/kg TS", "% TS", "µg/kg tørrstoff" all mean the value is already on a dry-matter basis. */
const isDryBasis = (unit: string): boolean => /\b(ts|t[øo]rrstoff|dw)\b/i.test(unit);

export interface DataLabBkResult {
  normalizationTrace?: ClassificationTrace;
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
 * @param legalCitations Per-field resolved legal citations (e.g. "eal-legal-basis"), resolved
 *                        once per request by the caller and threaded through so BkSource carries
 *                        it before buildBkFields runs — form-map.ts's own branch then produces
 *                        the citation-grounded note, with no post-hoc field mutation anywhere.
 */
export function bkFromDatalab(
  data: Record<string, unknown>,
  blocks: Record<string, DatalabBlock>,
  originProcess: string | null,
  legalCitations?: Record<string, LegalCitationView | null>,
  evidenceContext?: { documentRef: string; sampleId: string; originSharedAcrossSamples?: boolean },
): DataLabBkResult {
  const analyteRef = analyteReferenceRaw as AnalyteReference[];
  const knownIds = new Set(analyteRef.map(a => a.analyteId));

  const rawRows = Array.isArray(data.analyseresultater) ? data.analyseresultater : [];
  const unmatchedAnalytes: string[] = [];

  const rows: BkResultRow[] = rawRows.map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const name = typeof row.parameter === "string" ? row.parameter : `rad ${i + 1}`;
    const unit = typeof row.enhet === "string" ? row.enhet : "";
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
      // Narrow on the analyte name, not the value: a bare "1.8" occurs in many cells, while the
      // parameter name identifies exactly one row.
      citations: resolveCitations(row, "verdi", blocks, name, evidenceContext?.documentRef),
    };
  });

  const physical = (str(data.fysisk_form) ?? "").toLowerCase();
  const physicalState: SampleMetadata["physicalState"] =
    /flyt|liquid|liquido|væske/.test(physical) ? "liquid" :
    /pulver|powder|polvere/.test(physical) ? "powder" : "solid";

  const metadata: SampleMetadata = {
    sampleId: evidenceContext?.sampleId ?? `${str(data.rapportnummer) ?? "unresolved-report"}/${str(data.provenummer) ?? str(data.provemerking) ?? "unresolved-sample"}`,
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
    ristetestUtfort: bool(data.ristetest_utfort) ?? undefined,
    kolonnetestUtfort: bool(data.kolonnetest_utfort) ?? undefined,
    totalinnholdUtfort: bool(data.totalinnhold_utfort),
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
    rawValueText: typeof (rawRows[i] as Record<string, unknown>)?.raw_value_text === "string" ? (rawRows[i] as Record<string, unknown>).raw_value_text as string : null,
    analyticalContext: str((rawRows[i] as Record<string, unknown>)?.analytical_context),
    concentrationBasis: ["dry", "as_received", "liquid_volume", "unknown"].includes(String((rawRows[i] as Record<string, unknown>)?.concentration_basis)) ? (rawRows[i] as Record<string, unknown>).concentration_basis as SampleResult["concentrationBasis"] : undefined,
    method: str((rawRows[i] as Record<string, unknown>)?.method),
    source: (r.citations?.length ? r.citations : [{blockId: null, page: null, bbox: null}]).map(c => ({ reference: c.blockId ?? `${metadata.sampleId}/r${i+1}`, documentRef: evidenceContext?.documentRef, page: c.page, region: c.bbox, blockId: c.blockId })),
  }));

  let normalizationTrace: ClassificationTrace | undefined;
  const classification = classifySample(
    metadata,
    sampleResults,
    [], // Datalab's schema carries no HP1-3 physical test results; those stay "not tested"
    analyteRef,
    compoundFormsRaw as ElementCompoundForm[],
    Object.fromEntries(ORIGIN_OPTIONS.map(o => [o.value, o.chapter])),
    trace => { normalizationTrace = trace; }
  );
  if(evidenceContext?.originSharedAcrossSamples) classification.eal.originEvidence.push({value:originProcess,source:"origin_process",reason:"The origin/process value was supplied once for the document bundle and is not sample-specific evidence."});

  const classifiedRows = rows.map((row, index) => ({
    ...row,
    analyticalRole: classification.measurementBoundary.measurements[index]?.analyticalRole ?? "unknown" as const,
  }));

  const citationsFor = (field: string, match: string | null = null) => resolveCitations(data, field, blocks, match, evidenceContext?.documentRef);
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
      address: str(data.oppdragsgiver_adresse),
      postCode: str(data.oppdragsgiver_postnummer),
      postArea: str(data.oppdragsgiver_poststed),
      contactPerson: str(data.kontaktperson),
      contactEmail: str(data.kontaktperson_epost),
      contactPhone: str(data.kontaktperson_telefon),
      tocPct: num(data.toc_prosent),
      glodetapPct: num(data.glodetap_prosent),
    },
    results: classifiedRows,
    isHazardous: classification.hazard.isHazardous,
    hasDetectedHazardousSubstance: classification.hazard.hasDetectedHazardousSubstance ?? null,
    hazardConfidenceFlags: classification.hazard.confidenceFlags,
    hazardConfidenceFlagsNo: classification.hazard.confidenceFlagsNo,
    eal: classification.eal,
    landfillAcceptance: classification.landfillAcceptance,
    citations: {
      externalReportNo: citationsFor("rapportnummer", metadata.externalReportNo),
      labName: citationsFor("laboratorium", metadata.labName),
      customerName: citationsFor("oppdragsgiver", metadata.customerName),
      producerName: citationsFor("avfallsprodusent", metadata.producerName),
      sampleMarking: citationsFor("provemerking", metadata.sampleMarking),
      matrixType: citationsFor("matrise", metadata.matrixType),
      samplingDate: citationsFor("provetakingsdato", metadata.samplingDate),
      receiptDate: citationsFor("mottaksdato", metadata.receiptDate),
      pickupLocation: citationsFor("hentested", str(data.hentested)),
      address: citationsFor("oppdragsgiver_adresse", str(data.oppdragsgiver_adresse)),
      postCode: citationsFor("oppdragsgiver_postnummer", str(data.oppdragsgiver_postnummer)),
      postArea: citationsFor("oppdragsgiver_poststed", str(data.oppdragsgiver_poststed)),
      contactPerson: citationsFor("kontaktperson", str(data.kontaktperson)),
      contactEmail: citationsFor("kontaktperson_epost", str(data.kontaktperson_epost)),
      contactPhone: citationsFor("kontaktperson_telefon", str(data.kontaktperson_telefon)),
      tocPct: citationsFor("toc_prosent", num(data.toc_prosent)?.toString() ?? null),
      glodetapPct: citationsFor("glodetap_prosent", num(data.glodetap_prosent)?.toString() ?? null),
    },
    legalCitations,
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

  return { fields, source, classification, unmatchedAnalytes, blocks, normalizationTrace };
}
