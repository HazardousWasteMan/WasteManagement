import { describe, expect, it } from "vitest";
import { prepareMeasurements } from "@/lib/hp-classification/measurement";
import { normalizeSample } from "@/lib/hp-classification/normalize";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import { bkFromDatalab } from "@/lib/bk-skjema/from-datalab";
import { POST } from "@/app/api/classify/route";
import { NextRequest } from "next/server";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";
import refsJson from "@/lib/data/analyte-reference.json";
import { mergeExtractionResults } from "@/lib/hp-classification/pdf-batching";
import { finalizationEligibility } from "@/lib/production/finalization-policy";
import { buildBkWorkspace } from "@/lib/bk-skjema/workspace";
import type { Assessment } from "@/lib/production/types";
const refs = refsJson as AnalyteReference[];
const metadata: SampleMetadata = { sampleId: "synthetic-sample", externalReportNo: "invented-report", labName: "", customerName: "", sampleMarking: "", matrixType: "soil", samplingDate: null, receiptDate: null, originProcess: "escavo terre e rocce", producerName: null, physicalState: "solid", viscosity40cMm2s: null, ph: null, labClassificationGiven: false, labStatedEalCode: null };
const row = (patch: Partial<SampleResult> = {}): SampleResult => ({ resultId: "m1", sampleId: metadata.sampleId, analyteId: "arsenic", rawAnalyteName: "Arsenic", resultValue: 1, isBelowLoq: false, loqValue: null, unitRaw: "mg/kg TS", expressedOnDryBasis: false, method: null, analyticalContext: "Total content", ...patch });
const measure = (r: SampleResult, meta = metadata) => prepareMeasurements(meta, [r], refs).measurements[0];
describe("shared measurement-to-HP boundary (invented inputs only)", () => {
  it("admits explicit total-content mg/kg with a reported dry basis", () => {
    expect(measure(row()).hpEligibility).toEqual({ eligible: true, reasons: [] });
    expect(normalizeSample(metadata, [row()], refs)[0].resultDryBasisPct).toBe(0.0001);
  });
  it.each(["mg/kg TS", "mg/L"])("excludes batch L/S leaching in %s", unitRaw => {
    const m = measure(row({ unitRaw, analyticalContext: "Batch leaching L/S 10" }));
    expect(m.analyticalRole).toBe("leaching_batch"); expect(m.hpEligibility.eligible).toBe(false);
    expect(normalizeSample(metadata, [row({ unitRaw, analyticalContext: "Batch leaching L/S 10" })], refs)).toEqual([]);
  });
  it("retains column fractions and excludes them", () => {
    expect(measure(row({ analyticalContext: "Column percolation fraction 2 L/S 0.5" })).analyticalRole).toBe("leaching_column");
  });
  it.each([
    ["SS-EN 12457-2:2003", "leaching_batch"],
    ["EN 14405:2017", "leaching_column"],
    ["CEN/TS 14405", "leaching_column"],
  ] as const)("uses general leaching test standards as semantic role evidence: %s", (method, expected) => {
    const m = measure(row({ analyticalContext: null, method }));
    expect(m.analyticalRole).toBe(expected);
    expect(m.hpEligibility.eligible).toBe(false);
  });
  it("propagates one explicit test standard across sibling rows in the same test segment", () => {
    const boundary = prepareMeasurements(metadata, [
      row({ resultId: "m1", method: "SS-EN 12457-2", analyticalContext: "L/S=10" }),
      row({ resultId: "m2", method: null, analyticalContext: "Arsen L/S=10" }),
      row({ resultId: "m3", method: null, analyticalContext: "Antimony", rawAnalyteName: "Antimony" }),
    ], refs);
    expect(boundary.measurements.map(m => m.analyticalRole)).toEqual(["leaching_batch", "leaching_batch", "leaching_batch"]);
    expect(boundary.measurements.every(m => !m.hpEligibility.eligible)).toBe(true);
  });
  it("does not propagate a test role over explicit bulk rows in a mixed segment", () => {
    const boundary = prepareMeasurements(metadata, [
      row({ resultId: "m1", method: "EN 14405", analyticalContext: "Column fraction" }),
      row({ resultId: "m2", analyticalContext: "Total content" }),
    ], refs);
    expect(boundary.measurements.map(m => m.analyticalRole)).toEqual(["leaching_column", "total_content"]);
  });
  it("uses column-standard context plus solid matrix and liquid-volume units for sibling column rows", () => {
    const boundary = prepareMeasurements(metadata, [
      row({ resultId: "m1", unitRaw: "mg/L", method: "EN 14405", analyticalContext: "first fraction" }),
      row({ resultId: "m2", unitRaw: "mg/L", method: null, analyticalContext: "second fraction" }),
      row({ resultId: "m3", unitRaw: "mg/kg TS", analyticalContext: "Total content" }),
    ], refs);
    expect(boundary.measurements.map(m => m.analyticalRole)).toEqual(["leaching_column", "leaching_column", "total_content"]);
  });
  it("does not apply solid-matrix column context to genuine liquid waste", () => {
    const liquid = { ...metadata, physicalState: "liquid" as const };
    const boundary = prepareMeasurements(liquid, [
      row({ resultId: "m1", unitRaw: "mg/L", method: "EN 14405", analyticalContext: "column reference" }),
      row({ resultId: "m2", unitRaw: "mg/L", method: null, analyticalContext: null }),
    ], refs);
    expect(boundary.measurements[1].analyticalRole).toBe("unknown");
  });
  it("does not mistake genuine liquid total content for leaching", () => {
    const m = measure(row({ unitRaw: "mg/L" }), { ...metadata, physicalState: "liquid" });
    expect(m.analyticalRole).toBe("total_content"); expect(m.basis).toBe("liquid_volume");
    expect(m.hpEligibility.reasons).toContain("basis:liquid_volume");
  });
  it.each(["µg/kg TS", "ug/kg TS", "μg/kg TS"])("normalizes supported microgram alias %s equivalently", unitRaw => {
    expect(normalizeSample(metadata, [row({ unitRaw })], refs)[0].resultDryBasisPct).toBe(0.0000001);
  });
  it.each(["ppm", "mystery", "mg L⁻¹", ""])("never interprets unsupported unit %s as percent", unitRaw => {
    expect(normalizeSample(metadata, [row({ unitRaw })], refs)).toEqual([]);
    expect(measure(row({ unitRaw })).hpEligibility.reasons).toContain("unsupported_unit");
  });
  it("feeds only eligible measurements from a mixed report into HP", () => {
    const rows = [row(), row({ resultId: "m2", resultValue: 100000, analyticalContext: "Ristetest L/S 10" })];
    let trace: Parameters<NonNullable<Parameters<typeof classifySample>[6]>>[0] | undefined;
    const result = classifySample(metadata, rows, [], refs, [], {}, t => { trace = t; });
    expect(trace!.normalized).toHaveLength(1); expect(trace!.normalized[0].measurementId).toBe(result.measurementBoundary.measurements[0].measurementId);
    expect(result.measurementBoundary.measurements[1].hpEligibility.eligible).toBe(false);
  });
  it("retains unknown analytical role without inferring it from kg units or matrix", () => {
    const m = measure(row({ analyticalContext: null }));
    expect(m.analyticalRole).toBe("unknown"); expect(m.roleReview.state).toBe("needs_review"); expect(m.hpEligibility.reasons).toContain("role:unknown");
  });
  it("does not apply a sample bulk flag indiscriminately to a mixed report", () => {
    const b = prepareMeasurements({ ...metadata, totalinnholdUtfort: true }, [row({ analyticalContext: null }), row({ resultId: "m2", analyticalContext: "Column leaching" })], refs);
    expect(b.measurements[0].analyticalRole).toBe("unknown");
  });
  it("preserves raw value, limit, unit, method and source without mutating callers", () => {
    const original = row({ rawValueText: "≤0,05", isBelowLoq: true, resultValue: null, loqValue: 0.05, method: "Test method", source: [{ reference: "block-a", documentRef: "sha256:invented", page: 2, region: [1,2,3,4] }] });
    const copy = structuredClone(original); const m = measure(original);
    expect(m).toMatchObject({ rawValueText: "≤0,05", rawValueTextOrigin: "reported", parsedValue: null, censoring: "<=", reportedLimit: 0.05, rawUnit: "mg/kg TS", method: "Test method", source: copy.source });
    expect(m.measurementId).toBe(measure(copy).measurementId); expect(original).toEqual(copy);
  });
  it("distinguishes reconstructed values from reported text", () => {
    expect(measure(row()).rawValueTextOrigin).toBe("reconstructed");
    expect(measure(row({ resultValue: null, rawValueText: "1,25" })).parsedValue).toBe(1.25);
    expect(measure(row({ resultValue: null, rawValueText: "<0,05" })).reportedLimit).toBe(0.05);
  });
  it("accepts a structured numeric value when the preserved raw lexeme also carries its printed unit", () => {
    const m = measure(row({ resultValue: 1.25, rawValueText: "1.25 mg/kg TS" }));
    expect(m.parsedValue).toBe(1.25);
    expect(m.hpEligibility).toEqual({ eligible: true, reasons: [] });
  });
  it("accepts a structured censoring limit when the preserved raw lexeme carries its printed unit", () => {
    const m = measure(row({ resultValue: null, isBelowLoq: true, loqValue: 0.05, rawValueText: "<0.05 mg/kg TS" }));
    expect(m.reportedLimit).toBe(0.05);
    expect(m.hpEligibility).toEqual({ eligible: true, reasons: [] });
  });
  it("uses the exact printed censoring bound when a separate reported LOQ is rounded", () => {
    const m = measure(row({ resultValue: null, isBelowLoq: true, loqValue: 0.03, rawValueText: "<0.032" }));
    expect(m.reportedLimit).toBe(0.032);
    expect(m.hpEligibility).toEqual({ eligible: true, reasons: [] });
  });
  it.each(["dry matter", "TOC", "loss on ignition"])("retains but excludes composition/aggregate %s", rawAnalyteName => {
    expect(measure(row({ rawAnalyteName })).hpEligibility.reasons).toContain("role:physical_or_composition");
  });
  it("retains aggregate rows as unresolved rather than individual substances", () => {
    expect(measure(row({rawAnalyteName:"Sum PAH"})).analyticalRole).toBe("unknown");
  });
  it("preserves original whitespace and disambiguates repeated result IDs deterministically", () => {
    const r=row({rawValueText:" 1 ",unitRaw:" mg/kg TS ",rawAnalyteName:" Arsenic "});
    const a=prepareMeasurements(metadata,[r,r],refs);
    expect(a.measurements[0]).toMatchObject({rawValueText:" 1 ",rawUnit:" mg/kg TS ",rawLabel:" Arsenic "});
    expect(new Set(a.measurements.map(m=>m.measurementId)).size).toBe(2);
    expect(a).toEqual(prepareMeasurements(metadata,[r,r],refs));
  });
  it.each(["Total content not performed", "No totalinnhold measured"])("does not mistake negated test context for evidence: %s", analyticalContext => {
    expect(measure(row({analyticalContext}), {...metadata,totalinnholdUtfort:true}).hpEligibility.reasons).toContain("role:unknown");
  });
  it("excludes unknown, wet and conflicting concentration bases", () => {
    for (const r of [row({ unitRaw: "mg/kg" }), row({ unitRaw: "mg/kg", concentrationBasis: "as_received" }), row({ concentrationBasis: "as_received" })]) expect(measure(r).hpEligibility.eligible).toBe(false);
  });
  it("excludes conflicting role and numeric evidence", () => {
    expect(measure(row({ analyticalContext: "Total content / batch leaching" })).analyticalRole).toBe("unknown");
    expect(measure(row({ rawValueText: "2", resultValue: 1 })).hpEligibility.reasons).toContain("conflicting_numeric_evidence");
    expect(measure(row({ resultValue: -1 })).hpEligibility.eligible).toBe(false);
    expect(measure(row({ resultValue: null, isBelowLoq: true })).hpEligibility.eligible).toBe(false);
  });
  it("uses the identical gate through Datalab and the legacy classify HTTP route", async () => {
    const rows = [row(), row({ resultId: "m2", analyticalContext: "Batch L/S 10", resultValue: 100000 })];
    const data = bkFromDatalab({ provenummer: metadata.sampleId, analyseresultater: rows.map(r => ({ parameter: r.rawAnalyteName, analyte_id: r.analyteId, verdi: r.resultValue, enhet: r.unitRaw, analytical_context: r.analyticalContext, under_loq: false })) }, {}, metadata.originProcess);
    const response = await POST(new NextRequest("http://localhost/api/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metadata, results: rows }) }));
    expect(response.status).toBe(200); const legacy = await response.json();
    expect(legacy.measurementBoundary.measurements.map((m: {hpEligibility: unknown}) => m.hpEligibility)).toEqual(data.classification.measurementBoundary.measurements.map(m => m.hpEligibility));
    expect(Object.values(legacy.hazard.resultsByHp).map(o=>(o as {status:string}).status)).toEqual(Object.values(data.classification.hazard.resultsByHp).map(o=>typeof o === "object"?o.status:o));
  });
  it("keeps Datalab measurement identities and provenance when reclassifying origin", () => {
    const raw={analyseresultater:[{parameter:"Arsenic",analyte_id:"arsenic",verdi:1,enhet:"mg/kg TS",analytical_context:"Total content"}]};
    const source={documentRef:"sha256:synthetic",sampleId:"synthetic-sample"};
    const first=bkFromDatalab(raw,{},null,undefined,source);
    const next=bkFromDatalab(raw,{},metadata.originProcess,undefined,source);
    expect(next.classification.measurementBoundary).toEqual(first.classification.measurementBoundary);
  });
  it("never reports an assumed elemental species as a confirmed hazardous compound detection", () => {
    const data=bkFromDatalab({totalinnhold_utfort:true,analyseresultater:[{parameter:"Arsenic",analyte_id:"arsenic",verdi:100000,enhet:"mg/kg TS",under_loq:false}]},{},metadata.originProcess);
    expect(data.classification.hazard.hasDetectedHazardousSubstance).toBeNull();
    expect(data.classification.hazard.isHazardous).toBeNull();
    expect(data.normalizationTrace?.hpInputs.every(r=>r.assumedSpecies&&r.alternativeGroup)).toBe(true);
  });
  it("does not collapse distinct censoring limits during legacy batch merging", () => {
    const fragment = (limit: number) => ({ metadata, results: [row({ resultValue: null, isBelowLoq: true, loqValue: limit })], testResults: [], unmatchedAnalytes: [], suggestedOriginProcess: null, sourceType: "document" as const });
    expect(mergeExtractionResults([fragment(1), fragment(100)]).results).toHaveLength(2);
  });
  it("does not lose blocking review issues when invalid rows are excluded before normalization", () => {
    const result = bkFromDatalab({ totalinnhold_utfort: true, analyseresultater: [{ parameter:"Arsenic", analyte_id:"arsenic", verdi:1, enhet:"mg/kg TS" }, { parameter:"Arsenic", analyte_id:"arsenic", verdi:1, enhet:"ppm" }] }, {}, metadata.originProcess);
    const sample = { fields: result.fields, metadata: result.source.metadata, classification: result.classification };
    const workspace = buildBkWorkspace(sample, { projectId:"p",projectName:"p",pickupLocation:"",streamId:"s",originProcess:null });
    const a = { decision_snapshot: { versions:{}, normalizationTrace:result.normalizationTrace, classification:result.classification } } as unknown as Assessment;
    expect(finalizationEligibility(a, workspace, true).reasons).toContain("Excluded or unresolved concentration evidence requires review before finalization.");
  });
});
