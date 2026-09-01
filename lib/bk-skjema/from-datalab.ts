// Turns a Datalab extraction into (a) resolved citations the UI can highlight, (b) the
// classification engine's inputs, and (c) the 103 BK-skjema fields.
import { narrowCitation, type DatalabBlock } from "./datalab";
import type { BkCitation, BkField, BkResultRow, BkSource } from "./form-map";
import { buildBkFields } from "./form-map";
import { classifySample } from "../hp-classification/classify-sample";
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
  match: string | null = null
): BkCitation[] {
  const raw = container[`${field}_citations`];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string")
    .map(id => {
      const b = blocks[id];
      if (!b) return { blockId: id, page: null, text: null, bbox: null };
      const narrowed = narrowCitation(b, match);
      return { blockId: id, page: b.page, text: narrowed.text, bbox: narrowed.bbox };
    });
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "mg/kg TS", "% TS", "µg/kg tørrstoff" all mean the value is already on a dry-matter basis. */
const isDryBasis = (unit: string): boolean => /\b(ts|t[øo]rrstoff|t[øo]rrvekt|dw)\b/i.test(unit);

/**
 * The lab that issued the report, not the sub-labs it farmed individual analyses out to.
 *
 * Every Eurofins report ends with an "Utførende laboratorium/Underleverandør" table listing
 * Swedish sites, and extraction cited that table rather than the page-1 header on 5 of 6 real
 * reports — returning "Eurofins Food & Feed Testing Sweden (Lidköping)" for a report issued by
 * Eurofins Environment Testing Norway (Moss). The schema description now names the trap, but
 * this codebase has already learned once (FINDINGS.md part 4) that a description is not a
 * control. So the citation is checked: a value whose blocks are the subcontractor table is
 * dropped. A blank lab name is visibly missing; a wrong one is indistinguishable from a right one.
 */
const SUBCONTRACTOR_HEADING = /underleverand|utf[øo]rende\s+laboratorium|utg[åa]ende\s+laboratorium/i;
/**
 * Datalab splits the list into a SectionHeader ("Utførende laboratorium/ Underleverandør:", which
 * OCR also renders "Utgående…") and a ListGroup holding only the lab lines, so matching the
 * heading text alone misses the block a citation actually points at. What every line of that list
 * has and a report header never does is the analysis footnote marker the result rows carry —
 * "a)", "a)*", "b)". That, not the heading, is the reliable tell.
 */
const FOOTNOTE_PREFIXED = /^\s*[a-z]\)\*?\s+\S/i;

const isSubcontractorBlock = (block: DatalabBlock | undefined): boolean =>
  !!block && (SUBCONTRACTOR_HEADING.test(block.text) || FOOTNOTE_PREFIXED.test(block.text));

function issuingLabName(
  data: Record<string, unknown>,
  blocks: Record<string, DatalabBlock>
): { name: string | null; note?: string } {
  const name = str(data.laboratorium);
  if (!name) return { name: null };
  const cited = (Array.isArray(data.laboratorium_citations) ? data.laboratorium_citations : [])
    .filter((id): id is string => typeof id === "string");
  const allFromSubList = cited.length > 0 && cited.every(id => isSubcontractorBlock(blocks[id]));
  if (!allFromSubList) return { name };
  return {
    name: null,
    note: `"${name}" was read from the report's "Utførende laboratorium/Underleverandør" list — that is a subcontractor, not the issuing laboratory. Take the lab from the header on page 1.`,
  };
}

/**
 * "Referanse" in a Eurofins header is the customer's job/project reference ("PFAS-prosjektet
 * Alta", "Testforsøk, fase 1"), not a place. Extraction handed it back as hentested, label and
 * all. Neither report actually states a pickup site, so the right answer is nothing.
 */
function pickupLocation(data: Record<string, unknown>): string | null {
  const raw = str(data.hentested);
  if (!raw) return null;
  return /^referanse\b/i.test(raw) ? null : raw;
}

/**
 * Whether a result row is a leaching-test release rather than a total content in the sample.
 *
 * The schema asks the document (`er_utlekkingsresultat`), because on an ALS ristetest page the
 * row itself gives nothing away — bare element names, `mg/kg TS`, under a heading reading
 * "Totale elementer/metaller" — and only the section heading and the sample label say otherwise.
 * That answer is then floored, never ceilinged: a per-volume unit, an `L/S=` in the parameter
 * name, or a sample label that says this whole sub-report is a leaching test all force `true`
 * whatever the extractor said. The model can add knowledge here; it cannot take it away.
 */
const LEACHING_LABEL = /utlekking|ristetest|kolonnetest|eluat|l\s*\/\s*s\s*=/i;

function leachateRow(row: Record<string, unknown>, name: string, unit: string, leachingSubReport: boolean): boolean {
  if (leachingSubReport) return true;
  if (/\/\s*l$/i.test(unit.trim().replace(/\s*(TS|ts|t[øo]rrstoff|t[øo]rrvekt|dw|DW)\s*$/u, "").trim())) return true;
  if (/\bl\s*\/\s*s\s*=/i.test(name)) return true;
  return row.er_utlekkingsresultat === true;
}

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

  // A sub-report that holds no total content at all, however its columns are headed. Two ways to
  // know: its own sample label says so, or — for a layout with no sample-label field, like ALS's
  // Excel support sheet, whose two column headings are the labels — the document answered
  // har_totalanalyse. Either is enough; neither can be overridden upward by the extractor.
  const leachingSubReport =
    LEACHING_LABEL.test([str(data.provemerking), str(data.provenummer), str(data.hentested)].filter(Boolean).join(" ")) ||
    data.har_totalanalyse === false;

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
      isLeachateResult: leachateRow(row, name, unit, leachingSubReport),
      resultValue: value,
      isBelowLoq: belowLoq,
      loqValue: loq,
      unitRaw: unit,
      // Narrow on the analyte name, not the value: a bare "1.8" occurs in many cells, while the
      // parameter name identifies exactly one row.
      citations: resolveCitations(row, "verdi", blocks, name),
    };
  });

  // fysisk_form now carries one of the form's six option strings; the coarse solid/liquid/powder
  // the hazard engine needs comes from fysisk_tilstand, defaulting to solid.
  const physical = ((str(data.fysisk_tilstand) ?? str(data.fysisk_form)) ?? "").toLowerCase();
  const physicalState: SampleMetadata["physicalState"] =
    /flyt|liquid/.test(physical) ? "liquid" : /pulver|powder/.test(physical) ? "powder" : "solid";

  const lab = issuingLabName(data, blocks);

  const metadata: SampleMetadata = {
    sampleId: "data-lab-1",
    externalReportNo: str(data.rapportnummer) ?? "",
    labName: lab.name ?? "",
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
    isLeachateResult: r.isLeachateResult,
  }));

  const classification = classifySample(
    metadata,
    sampleResults,
    [], // Datalab's schema carries no HP1-3 physical test results; those stay "not tested"
    analyteRef,
    compoundFormsRaw as ElementCompoundForm[],
    Object.fromEntries(ORIGIN_OPTIONS.map(o => [o.value, o.chapter]))
  );

  const citationsFor = (field: string, match: string | null = null) => resolveCitations(data, field, blocks, match);
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
      pickupLocation: pickupLocation(data),
      labNameNote: lab.note ?? null,
      physicalForm: str(data.fysisk_form),
      pretreatment: str(data.forbehandling),
      address: str(data.oppdragsgiver_adresse),
      postCode: str(data.oppdragsgiver_postnummer),
      postArea: str(data.oppdragsgiver_poststed),
      contactPerson: str(data.kontaktperson),
      contactEmail: str(data.kontaktperson_epost),
      contactPhone: str(data.kontaktperson_telefon),
      tocPct: num(data.toc_prosent),
      glodetapPct: num(data.glodetap_prosent),
    },
    results: rows,
    isHazardous: classification.hazard.isHazardous,
    // No usable total-content row means there is no verdict to state, only a gap to report.
    hazardAssessable: !classification.noDataWarning,
    eal: classification.eal,
    citations: {
      externalReportNo: citationsFor("rapportnummer", metadata.externalReportNo),
      labName: lab.name ? citationsFor("laboratorium", lab.name) : [],
      customerName: citationsFor("oppdragsgiver", metadata.customerName),
      producerName: citationsFor("avfallsprodusent", metadata.producerName),
      sampleMarking: citationsFor("provemerking", metadata.sampleMarking),
      matrixType: citationsFor("matrise", metadata.matrixType),
      samplingDate: citationsFor("provetakingsdato", metadata.samplingDate),
      receiptDate: citationsFor("mottaksdato", metadata.receiptDate),
      pickupLocation: citationsFor("hentested", pickupLocation(data)),
      physicalForm: citationsFor("fysisk_form", str(data.fysisk_form)),
      pretreatment: citationsFor("forbehandling", str(data.forbehandling)),
      address: citationsFor("oppdragsgiver_adresse", str(data.oppdragsgiver_adresse)),
      postCode: citationsFor("oppdragsgiver_postnummer", str(data.oppdragsgiver_postnummer)),
      postArea: citationsFor("oppdragsgiver_poststed", str(data.oppdragsgiver_poststed)),
      contactPerson: citationsFor("kontaktperson", str(data.kontaktperson)),
      contactEmail: citationsFor("kontaktperson_epost", str(data.kontaktperson_epost)),
      contactPhone: citationsFor("kontaktperson_telefon", str(data.kontaktperson_telefon)),
      tocPct: citationsFor("toc_prosent", num(data.toc_prosent)?.toString() ?? null),
      glodetapPct: citationsFor("glodetap_prosent", num(data.glodetap_prosent)?.toString() ?? null),
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
