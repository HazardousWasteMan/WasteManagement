import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { fillBkPdf } from "@/lib/bk-skjema/fill-pdf";
import type { BkField } from "@/lib/bk-skjema/form-map";

export const maxDuration = 60;

const MAX_TEXT_LEN = 4000;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { fields } = body as { fields?: unknown };
  if (!Array.isArray(fields) || fields.length === 0) {
    return NextResponse.json({ error: "fields must be a non-empty array" }, { status: 400 });
  }
  if (fields.length > 200) {
    return NextResponse.json({ error: "too many fields" }, { status: 400 });
  }
  for (const f of fields) {
    const row = (f ?? {}) as Record<string, unknown>;
    if (typeof row.field !== "string" || !/^(TextField|Checkbox|group)\w{0,12}$/.test(row.field)) {
      return NextResponse.json({ error: "each field requires a valid AcroForm field name" }, { status: 400 });
    }
    if (row.value !== undefined && (typeof row.value !== "string" || row.value.length > MAX_TEXT_LEN)) {
      return NextResponse.json({ error: `value for ${row.field} must be a string under ${MAX_TEXT_LEN} chars` }, { status: 400 });
    }
    if (row.check !== undefined && typeof row.check !== "boolean") {
      return NextResponse.json({ error: `check for ${row.field} must be a boolean` }, { status: 400 });
    }
    if (row.select !== undefined && (typeof row.select !== "string" || !/^Radio\d$/.test(row.select))) {
      return NextResponse.json({ error: `select for ${row.field} must look like "Radio1"` }, { status: 400 });
    }
  }

  try {
    // Literal path, not the BK_BLANK_FORM_PATH constant: build-time file tracing can only
    // follow a statically analyzable string, and without it the form is left out of the deploy.
    const blank = fs.readFileSync(path.join(process.cwd(), "public/forms/bk-skjema-blank.pdf"));
    const { pdf } = await fillBkPdf(blank, fields as BkField[]);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="bk-skjema-utfylt.pdf"',
      },
    });
  } catch (err) {
    console.error("BK-skjema fill failed:", err);
    return NextResponse.json({ error: "Could not fill the form" }, { status: 500 });
  }
}
