// Fills the BK-skjema AcroForm from BkFields. Shared by the Data Lab route and bk/fill-form.test.ts.
import { PDFDocument, defaultTextFieldAppearanceProvider, layoutMultilineText, layoutSinglelineText } from "pdf-lib";
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
  fields: BkField[],
  options: { fitText?: boolean } = {}
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
      } else if (f.field.startsWith("group")) {
        // Explicit unresolved radio groups must not inherit the blank template defaults.
        form.getRadioGroup(f.field).clear();
      } else if (f.check !== undefined) {
        const cb = form.getCheckBox(f.field);
        if (f.check) { cb.check(); filled = true; } else { cb.uncheck(); }
      } else if (f.value) {
        const textField = form.getTextField(f.field);
        textField.setText(f.value);
        if (options.fitText) {
          const rectangle = textField.acroField.getWidgets()[0].getRectangle();
          // Appearance streams use plain Tj operators (no kerning adjustments). Measure
          // individual glyph advances so line wrapping matches what PDF viewers draw.
          // Keep this metric adapter local: neither the shared font nor field text changes.
          const font = new Proxy(form.getDefaultFont(), {
            get(target, key, receiver) {
              if (key === "widthOfTextAtSize") return (text: string, size: number) =>
                Array.from(text).reduce((width, glyph) => width + target.widthOfTextAtSize(glyph, size), 0);
              return Reflect.get(target, key, receiver);
            },
          });
          const layout = textField.isMultiline() ? layoutMultilineText : layoutSinglelineText;
          const fitted = layout(f.value, { alignment: textField.getAlignment(), font, fontSize: 0,
            bounds: { x: 0, y: 0, width: rectangle.width - 6, height: rectangle.height - 6 } });
          textField.setFontSize(Math.min(10, fitted.fontSize));
          // This template carries widget-level /DA overrides. Keep them consistent with
          // the field, otherwise the appearance provider silently uses the old font size.
          for (const widget of textField.acroField.getWidgets()) widget.setDefaultAppearance(textField.acroField.getDefaultAppearance()!);
          textField.updateAppearances(font, defaultTextFieldAppearanceProvider);
        }
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
