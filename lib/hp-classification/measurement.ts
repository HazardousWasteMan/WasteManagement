import type { AnalyteReference, SampleMetadata, SampleResult } from "./types";

export type AnalyticalRole = "total_content" | "leaching_batch" | "leaching_column" | "physical_or_composition" | "unknown";
export type ConcentrationBasis = "dry" | "as_received" | "liquid_volume" | "unknown";
export type CensoringState = "<" | "<=" | "non-detect" | "detected" | "missing";
export type MeasurementSource = { reference: string; documentRef?: string; page?: number | null; region?: [number, number, number, number] | null; blockId?: string | null };
export interface Measurement {
  measurementId: string;
  sampleId: string;
  rawLabel: string;
  rawValueText: string | null;
  rawValueTextOrigin: "reported" | "reconstructed" | "missing";
  parsedValue: number | null;
  rawUnit: string;
  censoring: CensoringState;
  reportedLimit: number | null;
  source: MeasurementSource[];
  analyticalRole: AnalyticalRole;
  roleReview: { state: "established" | "needs_review"; evidence: string[] };
  basis: ConcentrationBasis;
  method: string | null;
  testContext: string | null;
  mapping: { state: "mapped" | "unmapped"; analyteId: string | null };
  hpEligibility: { eligible: boolean; reasons: string[] };
}
export interface MeasurementBoundary { version: "measurement-boundary-1"; measurements: Measurement[] }
const text = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const dry = /(?:\b(?:ts|dw|ss)\b|s\.s\.|t[øo]rrstoff|dry (?:matter|weight|basis)|sostanza secca)/i;
const wet = /(?:as[- ]received|wet (?:weight|basis)|v[åa]tvekt)/i;
const liquidUnit = /(?:\/\s*l\b|\bl\s*(?:[-−]1|⁻¹))/i;
const batch = /\b(?:batch|ristetest|shake test|shaking test|(?:ss-)?en\s*12457(?:-\d+)?)\b/i;
const column = /\b(?:column|kolonne(?:test)?|percolation|(?:cen\/ts\s*|(?:ss-)?en\s*)14405)\b/i;
const leach = /(?:leach|eluat|utlek|utvask|\bL\s*\/\s*S\b)/i;
const bulk = /(?:total[- _]content|totalinnhold|bulk concentration|total concentration|contenuto totale)/i;
const physical = /^(?:pH\b|TOC\b|DOC\b|TDS\b|dry matter\b|moisture\b|t[øo]rrstoff\b|gl[øo]detap\b|loss on ignition\b|total organic carbon\b|temperature\b)/i;

/** Unit aliases change dimensions only. They never establish analytical role. */
export function concentrationUnit(raw: string): { divisor: number } | null {
  const unit = raw.trim().replace(/\s*(?:t[øo]rrstoff|s\.s\.|ts|dw|ss)\s*$/i, "")
    .trim().replace(/μ/g, "µ").replace(/\s+/g, "").toLowerCase();
  if (unit === "%") return { divisor: 1 };
  if (unit === "mg/kg") return { divisor: 10000 };
  if (unit === "µg/kg" || unit === "ug/kg") return { divisor: 10000000 };
  return null;
}
function context(row: SampleResult) { return [text(row.rawAnalyteName), text(row.method), text(row.analyticalContext)].filter(Boolean).join(" | "); }

/** Same deterministic envelope/eligibility policy for both providers and direct callers.
 * Sample-level bulk evidence is allowed only without any leaching evidence in the sample.
 * No provider-supplied eligibility flag is trusted. Old absent evidence stays unknown. */
export function prepareMeasurements(metadata: SampleMetadata, rows: SampleResult[], refs: AnalyteReference[]): MeasurementBoundary {
  const rowContexts = rows.map(context);
  const hasBatchContext = rowContexts.some(ctx => batch.test(ctx));
  const hasColumnContext = rowContexts.some(ctx => column.test(ctx));
  const hasBulkContext = rowContexts.some(ctx => bulk.test(ctx));
  const hasLeaching = metadata.ristetestUtfort === true || metadata.kolonnetestUtfort === true || rowContexts.some(ctx => batch.test(ctx) || column.test(ctx) || leach.test(ctx));
  const identities = new Map<string, number>();
  const measurements = rows.map((row, index): Measurement => {
    const ctx = context(row);
    const rawUnit = typeof row.unitRaw === "string" ? row.unitRaw : "";
    let role: AnalyticalRole = "unknown";
    const evidence: string[] = [];
    const isBatch = batch.test(ctx), isColumn = column.test(ctx), isLeach = leach.test(ctx), isBulk = bulk.test(ctx);
    const negatedTest = /(?:\bno\b|\bnot\b|\bwithout\b|\bikke\b|\bingen\b|\buten\b).{0,30}(?:total[- _]content|totalinnhold|bulk concentration|batch|ristetest|column|kolonne)|(?:total[- _]content|totalinnhold|bulk concentration|batch|ristetest|column|kolonne).{0,30}(?:not performed|ikke utført|not measured|absent)/i.test(ctx);
    if (negatedTest) evidence.push("negated test context requires review");
    else if (/^sum(?:ma)?\b/i.test(text(row.rawAnalyteName))) evidence.push("aggregate measurement requires mapping review");
    else if (physical.test(text(row.rawAnalyteName))) { role = "physical_or_composition"; evidence.push("physical/composition label"); }
    else if ((isBulk && (isBatch || isColumn || isLeach)) || (isBatch && isColumn)) evidence.push("conflicting row/test context");
    else if (isColumn) { role = "leaching_column"; evidence.push("column test context"); }
    else if (isBatch) { role = "leaching_batch"; evidence.push("batch test context"); }
    else if (hasColumnContext && !hasBatchContext && metadata.physicalState !== "liquid" && liquidUnit.test(rawUnit)) {
      role = "leaching_column";
      evidence.push("column test context in a solid-sample segment with liquid-volume result");
    }
    else if (isLeach && hasBatchContext !== hasColumnContext) {
      role = hasBatchContext ? "leaching_batch" : "leaching_column";
      evidence.push(`${hasBatchContext ? "batch" : "column"} test context from the same sample segment`);
    }
    else if (isLeach) evidence.push("leaching context; test type unresolved");
    else if (isBulk) { role = "total_content"; evidence.push("explicit row/table total-content context"); }
    else if (!hasBulkContext && metadata.totalinnholdUtfort !== true && metadata.physicalState !== "liquid" && hasBatchContext !== hasColumnContext) {
      role = hasBatchContext ? "leaching_batch" : "leaching_column";
      evidence.push(`${hasBatchContext ? "batch" : "column"} test context from the same sample segment`);
    }
    else if (metadata.totalinnholdUtfort === true && !hasLeaching) { role = "total_content"; evidence.push("explicit total-content sample; no leaching context"); }
    else if (metadata.totalinnholdUtfort === false && metadata.ristetestUtfort === true && metadata.kolonnetestUtfort !== true) { role = "leaching_batch"; evidence.push("explicit batch-only sample"); }
    else if (metadata.totalinnholdUtfort === false && metadata.kolonnetestUtfort === true && metadata.ristetestUtfort !== true) { role = "leaching_column"; evidence.push("explicit column-only sample"); }
    else evidence.push("insufficient analytical-role evidence");
    const basisEvidence = [row.concentrationBasis === "dry" || row.expressedOnDryBasis === true || dry.test(rawUnit) || dry.test(text(row.analyticalContext)),
      row.concentrationBasis === "as_received" || wet.test(rawUnit) || wet.test(text(row.analyticalContext)),
      row.concentrationBasis === "liquid_volume" || liquidUnit.test(rawUnit)];
    const basis: ConcentrationBasis = basisEvidence.filter(Boolean).length !== 1 ? "unknown" : basisEvidence[0] ? "dry" : basisEvidence[1] ? "as_received" : "liquid_volume";
    const reportedText = text(row.rawValueText);
    let limit = finite(row.loqValue) ? row.loqValue : null;
    let censoring: CensoringState = /^\s*(?:<=|≤)/.test(reportedText) ? "<=" : /^\s*</.test(reportedText) ? "<" : /^(?:nd|n\.d\.|non[- ]detect(?:ed)?|not detected)$/i.test(reportedText) || row.isBelowLoq === true ? "non-detect" : finite(row.resultValue) ? "detected" : "missing";
    if (["<", "<=", "non-detect", "detected", "missing"].includes(row.censoring ?? "") && !reportedText) censoring = row.censoring!;
    const lexeme = reportedText.replace(/^(?:<=|≤|<)\s*/, "").trim();
    const printedNumber = /^[+]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?$/i.test(lexeme) ? Number(lexeme.replace(",", ".")) : null;
    let parsedValue = censoring === "detected" ? (finite(row.resultValue) ? row.resultValue : printedNumber) : null;
    // For a censored result, the threshold printed with the result is the operative upper bound.
    // A separate LOQ column can be rounded differently (for example <0.032 beside LOQ 0.03).
    // Keep the exact raw text as provenance and use its bound rather than rejecting the row.
    if ((censoring === "<" || censoring === "<=") && finite(printedNumber)) limit = printedNumber;
    if (censoring === "missing" && finite(printedNumber)) { censoring = "detected"; parsedValue = printedNumber; }
    const mapped = typeof row.analyteId === "string" && refs.some(r => r.analyteId === row.analyteId);
    const reasons: string[] = [];
    if (role !== "total_content") reasons.push(`role:${role}`);
    if (!concentrationUnit(rawUnit)) reasons.push("unsupported_unit");
    // Preserve the existing formula's dry input contract; conversion policy is a later step.
    if (basis !== "dry") reasons.push(`basis:${basis}`);
    if (!mapped) reasons.push("unmapped_analyte");
    if (censoring === "missing" || (censoring === "detected" ? parsedValue === null : limit === null)) reasons.push("missing_or_invalid_value_or_limit");
    if ((reportedText && /^(?:-|[+]?Infinity|NaN)/i.test(reportedText)) || (row.resultValue != null && !finite(row.resultValue)) || (row.loqValue != null && !finite(row.loqValue))) reasons.push("invalid_numeric_value");
    if (finite(printedNumber) && censoring === "detected" && finite(row.resultValue) && row.resultValue !== printedNumber) reasons.push("conflicting_numeric_evidence");
    // The provider may preserve the printed unit or uncertainty in rawValueText while also
    // returning a validated numeric value/LOQ in the structured fields. The raw lexeme remains
    // evidence; it is a blocker only when no usable structured or locally parsed number exists.
    if (reportedText && printedNumber === null && censoring !== "non-detect" && parsedValue === null && limit === null) reasons.push("unparsed_raw_value");
    if (row.isBelowLoq === true && censoring === "detected") reasons.push("conflicting_censoring");
    const sampleId = text(row.sampleId) || text(metadata.sampleId) || "unresolved-sample";
    const reference = `${sampleId}/${text(row.resultId) || `row-${index + 1}`}`;
    const source = Array.isArray(row.source) ? structuredClone(row.source) : [];
    const suppliedId = text(row.measurementId);
    const baseId = suppliedId || JSON.stringify([source[0]?.documentRef ?? metadata.externalReportNo ?? "", sampleId, text(row.resultId) || `row-${index + 1}`]);
    const occurrence = identities.get(baseId) ?? 0;
    if (suppliedId && occurrence) throw new Error("Duplicate persisted measurement ID in assessment evidence set");
    identities.set(baseId, occurrence + 1);
    const measurementId = occurrence ? `${baseId}#${occurrence + 1}` : baseId;
    return { measurementId, sampleId, rawLabel: typeof row.rawAnalyteName === "string" ? row.rawAnalyteName : "", rawValueText: (reportedText ? row.rawValueText! : null) || (row.resultValue != null ? String(row.resultValue) : limit !== null ? `<${limit}` : null),
      rawValueTextOrigin: reportedText ? "reported" : row.resultValue != null || limit !== null ? "reconstructed" : "missing", parsedValue, rawUnit, censoring, reportedLimit: limit,
      source: source.length ? source : [{ reference }], analyticalRole: role, roleReview: { state: role === "unknown" ? "needs_review" : "established", evidence }, basis,
      method: text(row.method) || null, testContext: text(row.analyticalContext) || null, mapping: { state: mapped ? "mapped" : "unmapped", analyteId: mapped ? row.analyteId : null }, hpEligibility: { eligible: reasons.length === 0, reasons } };
  });
  return { version: "measurement-boundary-1", measurements };
}
