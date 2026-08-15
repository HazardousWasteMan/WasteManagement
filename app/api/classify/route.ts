import { NextRequest, NextResponse } from "next/server";
import { classifySample } from "@/lib/hp-classification/classify-sample";
import type { SampleMetadata, SampleResult, AnalyteReference } from "@/lib/hp-classification/types";
import type { ElementCompoundForm } from "@/lib/hp-classification/speciate";
import type { TestResult } from "@/lib/hp-classification/hazard";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import elementCompoundForms from "@/lib/data/element-compound-forms.json";
import { ORIGIN_OPTIONS, withCustomOrigin, EAL_CHAPTERS } from "@/lib/hp-classification/origin-options";

const ORIGIN_TO_CHAPTER_LOOKUP: Record<string, string> = Object.fromEntries(
  ORIGIN_OPTIONS.map(o => [o.value, o.chapter])
);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { metadata, results, testResults, customChapter } = body as {
    metadata?: SampleMetadata;
    results?: SampleResult[];
    testResults?: TestResult[];
    customChapter?: string | null;
  };

  if (!metadata || !Array.isArray(results)) {
    return NextResponse.json({ error: "Missing sample metadata or results" }, { status: 400 });
  }
  if (!metadata.originProcess) {
    return NextResponse.json({ error: "originProcess is required before classification can run" }, { status: 400 });
  }
  for (const r of results) {
    if (!r || typeof r !== "object") {
      return NextResponse.json({ error: "Each result must be a non-null object" }, { status: 400 });
    }
    const row = r as unknown as Record<string, unknown>;
    if (typeof row.resultId !== "string") {
      return NextResponse.json({ error: "Each result requires a string resultId" }, { status: 400 });
    }
    if (typeof row.rawAnalyteName !== "string") {
      return NextResponse.json({ error: "Each result requires a string rawAnalyteName" }, { status: 400 });
    }
    if (typeof row.unitRaw !== "string") {
      return NextResponse.json({ error: "Each result requires a string unitRaw" }, { status: 400 });
    }
    if (typeof row.isBelowLoq !== "boolean") {
      return NextResponse.json({ error: "Each result requires a boolean isBelowLoq" }, { status: 400 });
    }
  }
  if (testResults !== undefined && !Array.isArray(testResults)) {
    return NextResponse.json({ error: "testResults must be an array when provided" }, { status: 400 });
  }

  if (customChapter !== undefined && customChapter !== null) {
    const isValidChapter = EAL_CHAPTERS.some(c => c.chapter === customChapter);
    if (!isValidChapter) {
      return NextResponse.json({ error: "Invalid chapter code" }, { status: 400 });
    }
  }

  try {
    const effectiveLookup = withCustomOrigin(ORIGIN_TO_CHAPTER_LOOKUP, metadata.originProcess, customChapter ?? null);

    const { hazard, eal, noDataWarning } = classifySample(
      metadata,
      results,
      testResults ?? [],
      analyteReferenceRaw as AnalyteReference[],
      elementCompoundForms as ElementCompoundForm[],
      effectiveLookup
    );

    return NextResponse.json({ hazard, eal, noDataWarning });
  } catch {
    return NextResponse.json({ error: "Classification failed due to an internal error" }, { status: 500 });
  }
}
