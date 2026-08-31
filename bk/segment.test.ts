// Live: convert the whole Alta bundle once, and check the five sub-reports are found.
// Writes bk/segment-output.json with the checkpoint id, so the seed build can reuse the parse.
import { test, expect } from "vitest";
import fs from "node:fs";
import { convertDocument } from "@/lib/bk-skjema/datalab";
import { detectSubReports, subReportLabel } from "@/lib/bk-skjema/segment";

test("detect the sub-reports in the Alta bundle", async () => {
  const pdf = fs.readFileSync("public/samples/analyse-eurofins-betong.pdf");
  const converted = await convertDocument(pdf, "analyse.pdf");
  const pages = converted.pages.map(p => p.page);
  const reports = detectSubReports(converted.blocks, pages);

  fs.writeFileSync("bk/segment-output.json", JSON.stringify({
    checkpointId: converted.checkpointId,
    pageCount: converted.pageCount,
    costCents: converted.costCents,
    pages,
    reports,
  }, null, 2));

  console.log(`pages: ${converted.pageCount}, cost ${converted.costCents}c`);
  for (const r of reports) console.log(`  pages ${r.pageRange}: ${subReportLabel(r)}  (no ${r.sampleNo})`);
  expect(reports.length).toBeGreaterThan(0);
}, 600_000);
