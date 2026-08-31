// Fills the BK-skjema AcroForm from BkFields. Shared by the Data Lab route and bk/fill-form.test.ts.
import { PDFDocument } from "pdf-lib";
import type { BkField } from "./form-map";

export const BK_BLANK_FORM_PATH = "public/forms/bk-skjema-blank.pdf";

export interface FillOutcome {
  field: string;
  label: string;
  src: BkField["src"];
  filled: boolean;
  value: string | boolean | null;
  note: string | null;
}

export async function fillBkPdf(
  blank: Uint8Array | Buffer,
  fields: BkField[]
): Promise<{ pdf: Uint8Array; outcomes: FillOutcome[] }> {
  const doc = await PDFDocument.load(blank, { updateMetadata: false });
  const form = doc.getForm();
  const outcomes: FillOutcome[] = [];

  for (const f of fields) {
    let filled = false;
    // A missing field name would be a bug in form-map, but one bad entry should not abort the
    // whole document — record it and carry on.
    try {
      if (f.select !== undefined) {
        form.getRadioGroup(f.field).select(f.select);
        filled = true;
      } else if (f.check !== undefined) {
        const cb = form.getCheckBox(f.field);
        if (f.check) { cb.check(); filled = true; } else { cb.uncheck(); }
      } else if (f.value) {
        form.getTextField(f.field).setText(f.value);
        filled = true;
      }
    } catch (err) {
      outcomes.push({
        field: f.field, label: f.label, src: f.src, filled: false, value: null,
        note: `could not be set: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    outcomes.push({
      field: f.field, label: f.label, src: f.src, filled,
      value: f.select ?? f.check ?? f.value ?? null,
      note: f.note ?? null,
    });
  }

  form.updateFieldAppearances();
  return { pdf: await doc.save(), outcomes };
}

export function summarizeCoverage(outcomes: FillOutcome[]) {
  const bySrc = (src: BkField["src"]) => outcomes.filter(o => o.src === src);
  return {
    fieldsMapped: outcomes.length,
    filled: outcomes.filter(o => o.filled).length,
    fromExtraction: bySrc("extracted").filter(o => o.filled).length,
    fromClassificationEngine: bySrc("derived").filter(o => o.filled).length,
    needsHuman: bySrc("human").length,
    landfillFills: bySrc("receiver").length,
    notApplicable: bySrc("n/a").length,
  };
}
