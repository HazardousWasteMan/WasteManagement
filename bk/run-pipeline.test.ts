// Extraction test: run the real pipeline over the real Eurofins concrete report and dump the
// result, so bk/fill_form.py can fill the BK-skjema from it and we can score it against the
// hand-transcribed gold fixture. Not a regression test — it calls the live API. Run with:
//   pnpm vitest run bk/run-pipeline.test.ts --testTimeout=600000
import "@/lib/pdf-globals";
import { test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractSampleData, listSamples, hasUsableText } from "@/lib/hp-classification/extract";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
import type { AnalyteReference, SampleMetadata, SampleResult } from "@/lib/hp-classification/types";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import compoundFormsRaw from "@/lib/data/element-compound-forms.json";

GlobalWorkerOptions.workerSrc = path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");

const PDF = "public/samples/analyse-eurofins-betong.pdf";
const GOLD_SAMPLE = "439-2025-10080994"; // lab Prøvenr. of ENAT-BØF1-BO9OB1, the sub-report fixtures/eurofins-concrete-sample.json transcribes

test("extract + classify the Eurofins concrete report", async () => {
  const buffer = fs.readFileSync(PDF);
  const { text: pdfText } = await new PDFParse({ data: buffer }).getText();

  const detected = await listSamples(pdfText, buffer);
  const topLevel = detected.filter(s => s.parentSampleIdentifier === null);
  const target = topLevel.find(s => s.sampleIdentifier.includes(GOLD_SAMPLE)) ?? null;

  // Scope extraction to GOLD_SAMPLE directly rather than to whatever listSamples happened to
  // return: two runs over this same PDF produced two different sample lists (one keyed on lab
  // Prøvenr., one that offered the report number AR-25-MM-120316-01 as a "sample"), which
  // silently pointed extraction at the wrong sub-report. Sample *detection* is a separate
  // concern from extraction quality — recorded in detectedSamples, not used to pick the target.
  const data = await extractSampleData(
    pdfText, buffer, analyteReferenceRaw as AnalyteReference[], GOLD_SAMPLE
  );

  const metadata = { sampleId: "bk-test-1", ...data.metadata } as SampleMetadata;
  const results: SampleResult[] = data.results.map(r => ({ ...r, sampleId: "bk-test-1", method: null }));
  const originLookup = Object.fromEntries(ORIGIN_OPTIONS.map(o => [o.value, o.chapter]));
  const classification = classifySample(
    metadata, results, data.testResults,
    analyteReferenceRaw as AnalyteReference[],
    compoundFormsRaw as Parameters<typeof classifySample>[4],
    originLookup
  );

  fs.writeFileSync("bk/pipeline-output.json", JSON.stringify({
    sourcePdf: PDF,
    hasUsableText: hasUsableText(pdfText),
    sourceType: data.sourceType,
    detectedSamples: detected,
    targetSample: target ?? null,
    extraction: data,
    classification,
  }, null, 2));

  expect(data.results.length).toBeGreaterThan(0);
}, 900_000);
