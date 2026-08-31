// Generates the demo seed the Data Lab tab loads on first open, so the Alta bundle is already
// analysed and visible without waiting minutes for a live run. Produced by analyseBundle — the
// same path a live upload takes — so the seed cannot drift from real behaviour.
//
// Live API, several minutes, a few dollars. Re-run only when the pipeline or the sample changes:
//   set -a && . ./.env.local && set +a && npx vitest run bk/build-seed.test.ts
import { test, expect } from "vitest";
import fs from "node:fs";
import { analyseBundle } from "@/lib/bk-skjema/analyse-bundle";
import { subReportLabel } from "@/lib/bk-skjema/segment";

const PDF = "public/samples/analyse-eurofins-betong.pdf";
const SEED = "public/data-lab-seed.json";
// Every sub-report in this bundle is airport concrete or ash/asphalt from demolition work.
const ORIGIN = "concrete, brick, tile, or ceramic waste";

test("build the Data Lab demo seed", async () => {
  const analysis = await analyseBundle(fs.readFileSync(PDF), "analyse-eurofins-betong.pdf", {
    originProcess: ORIGIN,
    onEvent: e => {
      if (e.phase === "segmented") console.log(`${e.subReports.length} sub-reports across ${e.pageCount} pages`);
      if (e.phase === "sample") console.log(`  ${e.index + 1}/${e.total} ${subReportLabel(e.sample.subReport)}`);
      if (e.phase === "failed-sample") console.log(`  FAILED ${e.sampleNo}: ${e.error}`);
    },
  });

  fs.writeFileSync(SEED, JSON.stringify({
    sourcePdf: "/samples/analyse-eurofins-betong.pdf",
    sourceLabel: "Totalanalyse betongprøver, Alta lufthavn (Eurofins)",
    originProcess: ORIGIN,
    ...analysis,
  }));

  const bytes = fs.statSync(SEED).size;
  console.log(`seed ${(bytes / 1024).toFixed(0)} KB · ${analysis.samples.length} samples · ${analysis.costCents}c`);

  expect(analysis.samples.length).toBeGreaterThanOrEqual(5);
  // Each sub-report must stand alone as one form.
  for (const s of analysis.samples) {
    expect(s.fields).toHaveLength(103);
    expect(s.metadata.externalReportNo, `${s.subReport.sampleNo} has no report number`).toBeTruthy();
  }
  // Distinct samples, not the same one repeated — the whole point of segmenting.
  const markings = analysis.samples.map(s => s.metadata.sampleMarking);
  expect(new Set(markings).size).toBe(analysis.samples.length);
  expect(bytes).toBeLessThan(3_000_000);
}, 900_000);
