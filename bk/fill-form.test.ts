// Fills the BK-skjema from the *Anthropic* pipeline's output (bk/pipeline-output.json +
// bk/classified.json) and writes a per-field coverage report. Shares lib/bk-skjema with the
// Data Lab route, so both extraction backends are proven against the same field map.
import { test, expect } from "vitest";
import fs from "node:fs";
import { buildBkFields, type BkSource } from "@/lib/bk-skjema/form-map";
import { fillBkPdf, summarizeCoverage, BK_BLANK_FORM_PATH } from "@/lib/bk-skjema/fill-pdf";

test("fill the BK-skjema from the Anthropic extraction", async () => {
  const dump = JSON.parse(fs.readFileSync("bk/pipeline-output.json", "utf-8"));
  const cls = JSON.parse(fs.readFileSync("bk/classified.json", "utf-8"));
  const m = dump.extraction.metadata;

  const source: BkSource = {
    metadata: {
      externalReportNo: m.externalReportNo,
      labName: m.labName,
      customerName: m.customerName,
      producerName: m.producerName,
      sampleMarking: m.sampleMarking,
      matrixType: m.matrixType,
      samplingDate: m.samplingDate,
      receiptDate: m.receiptDate,
      physicalState: m.physicalState,
      pickupLocation: null,   // this pipeline has no field for it
      tocPct: null,           // not measured in this report
      glodetapPct: null,
    },
    results: dump.extraction.results,
    isHazardous: cls.withOrigin.hazard.isHazardous,
    hasDetectedHazardousSubstance: cls.withOrigin.hazard.hasDetectedHazardousSubstance ?? null,
    eal: cls.withOrigin.eal,
  };

  const fields = buildBkFields(source);
  const { pdf, outcomes } = await fillBkPdf(fs.readFileSync(BK_BLANK_FORM_PATH), fields);
  fs.writeFileSync("bk/bk-skjema-utfylt.pdf", pdf);

  const summary = summarizeCoverage(outcomes);
  fs.writeFileSync("bk/coverage-report.json", JSON.stringify({ summary, fields: outcomes }, null, 2));

  // Every one of the form's 103 fields must be accounted for, and nothing may silently fail to set.
  expect(summary.fieldsMapped).toBe(103);
  expect(outcomes.filter(o => o.note?.startsWith("could not be set"))).toEqual([]);
  // The engine's verdict must reach the form: non-hazardous -> ordinært, and the EAL digits.
  expect(outcomes.find(o => o.field === "Checkbox4")?.value).toBe(true);
  expect(outcomes.filter(o => o.label.startsWith("EAL-kode siffer")).map(o => o.value).join("")).toBe("170101");
  expect(summary.filled).toBeGreaterThan(0);
});
