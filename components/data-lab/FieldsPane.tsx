"use client";
import { useState } from "react";
import { BK_SECTIONS, bkSection, type BkField, type BkSrc } from "@/lib/bk-skjema/form-map";

const SRC_LABEL: Record<BkSrc, string> = {
  extracted: "From the document",
  derived: "Classified",
  human: "You fill in",
  receiver: "Landfill fills in",
  "n/a": "Not applicable",
};

const SRC_CHIP: Record<BkSrc, string> = {
  extracted: "bg-lime text-forest",
  derived: "bg-forest text-lime",
  human: "border border-forest/25 text-forest/60",
  receiver: "border border-forest/15 text-forest/40",
  "n/a": "border border-forest/10 text-forest/30",
};

function valueOf(f: BkField): string | null {
  if (f.value) return f.value;
  if (f.select) return f.select === "Radio1" ? "Nei / første valg" : f.select;
  if (f.check !== undefined) return f.check ? "Avkrysset" : null;
  return null;
}

/** A field a person is expected to complete, and that we can offer a control for. */
const isEditable = (f: BkField) =>
  (f.src === "human" || f.src === "receiver") && !f.select;

/**
 * Commits on blur rather than per keystroke: each commit re-fills a 10 MB PDF.
 * Remounted via `key` when the value changes from outside, so the draft resets without an effect.
 */
function TextEdit({ field, onEdit }: { field: BkField; onEdit: (v: string) => void }) {
  const [draft, setDraft] = useState(field.value ?? "");
  return (
    <input
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (draft !== (field.value ?? "")) onEdit(draft); }}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      placeholder="—"
      aria-label={field.label}
      className="w-full rounded-lg border border-forest/20 bg-white px-2 py-1 font-mono text-xs text-forest placeholder:text-forest/25 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-forest"
    />
  );
}

export function FieldsPane({
  fields,
  selected,
  onSelect,
  onlyFilled,
  onEdit,
}: {
  fields: BkField[];
  selected: string | null;
  onSelect: (field: BkField | null) => void;
  onlyFilled: boolean;
  /** Called when a person fills in or clears a field. */
  onEdit?: (field: BkField, value: string | boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {BK_SECTIONS.map(section => {
        const rows = fields
          .filter(f => bkSection(f.field) === section.index)
          .filter(f => (onlyFilled ? valueOf(f) !== null : true));
        if (rows.length === 0) return null;

        return (
          <section key={section.index} className="flex flex-col gap-2">
            <h3 className="sticky top-0 z-10 bg-cream/95 py-1 text-sm font-semibold text-forest backdrop-blur">
              {section.title}
              <span className="ml-2 font-mono text-[11px] font-normal text-forest/40">{rows.length}</span>
            </h3>

            <ul className="flex flex-col gap-1">
              {rows.map(f => {
                const value = valueOf(f);
                const citations = f.citations ?? [];
                const citable = citations.some(c => c.bbox);
                const isSelected = selected === f.field;
                const editable = Boolean(onEdit) && isEditable(f);
                const isCheckbox = f.field.startsWith("Checkbox");

                return (
                  <li
                    key={f.field}
                    className={`rounded-xl px-3 py-2 ${
                      isSelected ? "bg-forest text-cream" : citable ? "bg-white/70" : "bg-white/35"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      {citable ? (
                        <button
                          type="button"
                          onClick={() => onSelect(isSelected ? null : f)}
                          aria-expanded={isSelected}
                          className={`min-w-0 flex-1 truncate text-left text-sm underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
                            isSelected ? "text-cream" : "text-forest hover:text-forest-light"
                          }`}
                        >
                          {f.label}
                        </button>
                      ) : (
                        <span className={`min-w-0 flex-1 truncate text-sm ${isSelected ? "text-cream" : "text-forest"}`}>
                          {f.label}
                        </span>
                      )}
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          isSelected ? "bg-lime text-forest" : SRC_CHIP[f.src]
                        }`}
                      >
                        {SRC_LABEL[f.src]}
                      </span>
                    </div>

                    <div className="mt-1">
                      {editable && isCheckbox ? (
                        <label className="flex items-center gap-2 text-xs text-forest/70">
                          <input
                            type="checkbox"
                            checked={f.check === true}
                            onChange={e => onEdit!(f, e.target.checked)}
                            className="accent-forest"
                          />
                          Kryss av
                        </label>
                      ) : editable ? (
                        <TextEdit key={f.value ?? ""} field={f} onEdit={v => onEdit!(f, v)} />
                      ) : (
                        <p className={`font-mono text-xs ${isSelected ? "text-lime" : value ? "text-forest/70" : "text-forest/30"}`}>
                          {value ?? "blank"}
                        </p>
                      )}
                    </div>

                    {f.note && (
                      <p className={`mt-1 text-[11px] leading-snug ${isSelected ? "text-cream/70" : "text-forest/45"}`}>
                        {f.note}
                      </p>
                    )}

                    {isSelected && citations.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1 border-t border-cream/20 pt-2">
                        {citations.slice(0, 4).map(c => (
                          <p key={c.blockId} className="text-[11px] leading-snug text-cream/80">
                            <span className="font-mono text-cream/50">p{(c.page ?? 0) + 1}</span>{" "}
                            {c.text ? `“${c.text.slice(0, 180)}${c.text.length > 180 ? "…" : ""}”` : "source block had no text"}
                          </p>
                        ))}
                        {citations.length > 4 && (
                          <p className="text-[11px] text-cream/50">+{citations.length - 4} more source blocks</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
