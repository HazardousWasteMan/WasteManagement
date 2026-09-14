import { NextRequest, NextResponse } from "next/server";
import { bkFromDatalab } from "@/lib/bk-skjema/from-datalab";
import type { DatalabBlock } from "@/lib/bk-skjema/datalab";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
import { resolveLegalCitationsWithTimeout } from "@/lib/compliance/resolve-legal-citations";
import { LovdataSource } from "@/lib/compliance/sources/lovdata-source";
import { createSupabaseParagraphStore } from "@/lib/compliance/store";
import { createSupabaseCorrectionStore } from "@/lib/compliance/corrections";

// Origin/process is the one field no lab report contains, and it gates the EAL code. Re-deriving
// the form from the extraction we already paid for means the user can change it for free.
const VALID_ORIGINS = new Set(ORIGIN_OPTIONS.map(o => o.value));

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { raw, blocks, originProcess } = body as {
    raw?: unknown; blocks?: unknown; originProcess?: unknown;
  };
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "raw extraction data is required" }, { status: 400 });
  }
  if (!blocks || typeof blocks !== "object") {
    return NextResponse.json({ error: "blocks are required" }, { status: 400 });
  }
  if (originProcess != null && (typeof originProcess !== "string" || !VALID_ORIGINS.has(originProcess))) {
    return NextResponse.json({ error: "Unknown originProcess" }, { status: 400 });
  }

  // Same hoisted-once pattern as app/api/data-lab/route.ts: reclassify replaces s.fields wholesale,
  // so without re-resolving here Checkbox10's citation/note would silently revert to the plain
  // fallback. Defensive on top of resolveLegalCitationsWithTimeout's own try/catch and bounded
  // timeout — a compliance-layer outage or hang must never break reclassification.
  let legalCitations: Record<string, import("@/lib/compliance/citation-view").LegalCitationView | null> = {};
  try {
    legalCitations = await resolveLegalCitationsWithTimeout(
      createSupabaseParagraphStore(),
      new LovdataSource(),
      createSupabaseCorrectionStore()
    );
  } catch (err) {
    console.error("Legal citation resolution failed, keeping fallback notes:", err);
  }

  const result = bkFromDatalab(
    raw as Record<string, unknown>,
    blocks as Record<string, DatalabBlock>,
    (originProcess as string | null) ?? null,
    legalCitations
  );
  return NextResponse.json({
    fields: result.fields,
    classification: result.classification,
    unmatchedAnalytes: result.unmatchedAnalytes,
  });
}
