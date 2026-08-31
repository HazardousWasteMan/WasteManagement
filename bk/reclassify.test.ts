// Re-runs classification over the saved extraction from run-pipeline.test.ts — no API calls, so
// it is cheap to iterate on. Produces two verdicts:
//   asExtracted  — exactly what the pipeline yields with zero human input
//   withOrigin   — same, plus the one field extraction could not supply (originProcess)
import { test, expect } from "vitest";
import fs from "node:fs";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
import type { AnalyteReference, SampleMetadata, SampleResult } from "@/lib/hp-classification/types";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import compoundFormsRaw from "@/lib/data/element-compound-forms.json";

const HUMAN_ORIGIN = "concrete, brick, tile, or ceramic waste"; // the one input a human must pick

test("reclassify saved extraction", () => {
  const dump = JSON.parse(fs.readFileSync("bk/pipeline-output.json", "utf-8"));
  const e = dump.extraction;
  const results: SampleResult[] = e.results.map((r: SampleResult, i: number) => ({
    ...r, resultId: r.resultId ?? `r${i + 1}`, sampleId: "bk-test-1", method: null,
  }));
  const originLookup = Object.fromEntries(ORIGIN_OPTIONS.map(o => [o.value, o.chapter]));
  const compoundForms = compoundFormsRaw as Parameters<typeof classifySample>[4];
  const run = (originProcess: string | null) => classifySample(
    { sampleId: "bk-test-1", ...e.metadata, originProcess } as SampleMetadata,
    results, e.testResults, analyteReferenceRaw as AnalyteReference[], compoundForms, originLookup
  );

  const out = {
    asExtracted: run(e.metadata.originProcess ?? null),
    withOrigin: run(HUMAN_ORIGIN),
    humanOrigin: HUMAN_ORIGIN,
  };
  fs.writeFileSync("bk/classified.json", JSON.stringify(out, null, 2));

  // Gold standard: tests/hp-classification/eurofins-concrete-sample.test.ts asserts this sample
  // is non-hazardous and resolves to 17 01 01 with an AMBIGUOUS confidence. (The design doc
  // 2026-08-13-eurofins-concrete-fixture-design.md says 17 01 07 — the test is the authority.)
  expect(out.withOrigin.hazard.isHazardous).toBe(false);
  expect(out.withOrigin.hazard.triggeredHps).toEqual([]);
  expect(out.withOrigin.eal.code).toBe("17 01 01");
});
