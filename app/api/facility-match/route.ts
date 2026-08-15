import { NextRequest, NextResponse } from "next/server";
import { matchFacilities } from "@/lib/hp-classification/facility-match";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { isHazardous, ealCode, matrixType } = body as {
    isHazardous?: boolean;
    ealCode?: string;
    matrixType?: string | null;
  };

  if (typeof isHazardous !== "boolean") {
    return NextResponse.json({ error: "isHazardous must be a boolean" }, { status: 400 });
  }
  if (typeof ealCode !== "string" || ealCode.trim() === "") {
    return NextResponse.json({ error: "ealCode is required" }, { status: 400 });
  }
  if (matrixType !== undefined && matrixType !== null && typeof matrixType !== "string") {
    return NextResponse.json({ error: "matrixType must be a string or null when provided" }, { status: 400 });
  }

  try {
    const result = matchFacilities({ isHazardous, ealCode, matrixType: matrixType ?? null });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Facility matching failed due to an internal error" }, { status: 500 });
  }
}
