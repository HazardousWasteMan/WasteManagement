// Second real report, and a different shape from the Alta bundle: this one has a text layer,
// four sub-reports, and is asphalt rather than concrete. Live API.
import { test, expect } from "vitest";
import fs from "node:fs";
import { analyseBundle } from "@/lib/bk-skjema/analyse-bundle";
import { subReportLabel } from "@/lib/bk-skjema/segment";

test("asphalt report: four sub-reports, one form each", async () => {
  const analysis = await analyseBundle(fs.readFileSync("bk/analyse-asfalt.pdf"), "asfalt.pdf", {
    originProcess: "bituminous mixtures, coal tar, or tar products",
    onEvent: e => {
      if (e.phase === "segmented") console.log(`${e.subReports.length} sub-reports / ${e.pageCount} pages`);
      if (e.phase === "sample") console.log(`  ${subReportLabel(e.sample.subReport)} · ${e.sample.results.length} rows`);
      if (e.phase === "failed-sample") console.log(`  FAILED ${e.sampleNo}: ${e.error}`);
    },
  });
  fs.writeFileSync("bk/asfalt-output.json", JSON.stringify(analysis, null, 1));

  for (const s of analysis.samples) {
    const m = s.metadata;
    console.log(`${s.subReport.sampleNo}  matrix=${m.matrixType}  form=${m.physicalForm ?? "—"}  forbehandling=${m.pretreatment ?? "—"}  eal=${s.classification.eal.code}  haz=${s.classification.hazard.isHazardous}`);
  }
  expect(analysis.samples.length).toBe(4);
  expect(new Set(analysis.samples.map(s => s.metadata.sampleMarking)).size).toBe(4);
}, 900_000);
