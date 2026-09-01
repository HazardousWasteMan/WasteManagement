// Runs the live Datalab extraction pipeline over every chemical report in ../big_test and dumps
// one JSON per document, so bk/big-test-score.mjs can score it against the hand-transcribed
// BK-skjema gold in bk/big-test-gold.json. Live API, a few minutes, ~$1.
//   set -a && . ./.env.local && set +a && npx vitest run bk/big-test.test.ts
import { test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyseBundle } from "@/lib/bk-skjema/analyse-bundle";
import { subReportLabel } from "@/lib/bk-skjema/segment";

const ROOT = "../big_test";
const OUT = "bk/big-test-out";

const DOCS: { id: string; file: string; origin: string | null }[] = [
  { id: "test_1-gravemasser", file: "test_1/Gravemasser Analyser G5.pdf", origin: "escavo terre e rocce" },
  { id: "test_1-gravemasser-toc", file: "test_1/Gravemasser TOC analyse G5.pdf", origin: "escavo terre e rocce" },
  { id: "test_2-filterkake-1A", file: "test_2/Filterkake analyse 2024.pdf", origin: "escavo terre e rocce" },
  { id: "test_2-filterkake-2A", file: "test_2/Filterkake Prøve 2A 2024.pdf", origin: "escavo terre e rocce" },
  { id: "test_2-filterkake-testfase1", file: "test_2/Filterkaker Testfase 1.pdf", origin: "escavo terre e rocce" },
  // Chapter 10 13 (cement/lime/plaster manufacture) is what the human form's EAL 10 13 14 sits
  // under. It only became selectable once ORIGIN_OPTIONS was generated from the whole catalogue.
  { id: "test_3-betongslam", file: "test_3/Veidekke prefab 3 av 3 2026-06-22.pdf", origin: "eal-1013" },
  { id: "test_4-asfalt", file: "test_4/EUNOMO-00520062_ENAT - Asfaltprøver mellomlager forurensede masser - 4 av 4 - 20260729 1311.pdf", origin: "bituminous mixtures, coal tar, or tar products" },
];

for (const doc of DOCS) {
  test(`analyse ${doc.id}`, async () => {
    const started = Date.now();
    const analysis = await analyseBundle(fs.readFileSync(path.join(ROOT, doc.file)), path.basename(doc.file), {
      originProcess: doc.origin,
      onEvent: e => {
        if (e.phase === "segmented") console.log(`[${doc.id}] ${e.subReports.length} sub-reports / ${e.pageCount} pages`);
        if (e.phase === "sample") console.log(`[${doc.id}]   ${e.index + 1}/${e.total} ${subReportLabel(e.sample.subReport)}`);
        if (e.phase === "failed-sample") console.log(`[${doc.id}]   FAILED ${e.sampleNo}: ${e.error}`);
      },
    });
    fs.writeFileSync(path.join(OUT, `${doc.id}.json`), JSON.stringify({
      id: doc.id, file: doc.file, origin: doc.origin,
      pageCount: analysis.pageCount, costCents: analysis.costCents, seconds: (Date.now() - started) / 1000,
      subReports: analysis.subReports,
      samples: analysis.samples.map(s => ({
        subReport: s.subReport,
        metadata: s.metadata,
        classification: s.classification,
        unmatchedAnalytes: s.unmatchedAnalytes,
        raw: s.raw,
        fields: s.fields.map(f => ({ field: f.field, label: f.label, src: f.src, value: f.value, check: f.check, select: f.select, note: f.note })),
        results: s.results,
      })),
    }, null, 2));
    console.log(`[${doc.id}] done ${analysis.samples.length} samples, ${analysis.costCents}c, ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }, 900_000);
}
