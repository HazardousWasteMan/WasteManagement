import { NextResponse } from "next/server";
import { createSupabaseCorrectionStore } from "@/lib/compliance/corrections";
import { RESOLVED_FIELD_KEYS } from "@/lib/compliance/resolve-legal-citations";

interface DisputeRequest {
  paragraphId?: unknown;
  citedFieldKey?: unknown;
  freezeId?: unknown;
  raisedBy?: unknown;
  reason?: unknown;
}

export async function POST(request: Request) {
  let body: DisputeRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { paragraphId, citedFieldKey, freezeId, raisedBy, reason } = body;
  if (typeof paragraphId !== "string" || !paragraphId) {
    return NextResponse.json({ error: "paragraphId is required" }, { status: 400 });
  }
  if (typeof citedFieldKey !== "string" || !citedFieldKey) {
    return NextResponse.json({ error: "citedFieldKey is required" }, { status: 400 });
  }
  if (!RESOLVED_FIELD_KEYS.includes(citedFieldKey)) {
    return NextResponse.json({ error: `citedFieldKey "${citedFieldKey}" is not a recognized field key` }, { status: 400 });
  }
  if (typeof raisedBy !== "string" || !raisedBy.trim()) {
    return NextResponse.json({ error: "raisedBy is required" }, { status: 400 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }
  if (freezeId !== null && freezeId !== undefined && typeof freezeId !== "string") {
    return NextResponse.json({ error: "freezeId must be a string or null" }, { status: 400 });
  }

  try {
    const store = createSupabaseCorrectionStore();
    const record = await store.raise({
      disputedParagraphId: paragraphId,
      citedFieldKey,
      freezeId: (freezeId as string | undefined) ?? null,
      raisedBy: raisedBy.trim(),
      reason: reason.trim(),
    });
    return NextResponse.json(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
