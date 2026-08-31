"use client";
import { BK_SECTIONS, bkSection, type BkField, type BkSrc } from "@/lib/bk-skjema/form-map";

const SRC_LABEL: Record<BkSrc, string> = {
  extracted: "From document",
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

export function FieldsPane({
  fields,
  selected,
  onSelect,
  onlyFilled,
}: {
  fields: BkField[];
  selected: string | null;
  onSelect: (field: BkField | null) => void;
  onlyFilled: boolean;
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
                const clickable = citations.some(c => c.bbox);
                const isSelected = selected === f.field;

                return (
                  <li key={f.field}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => onSelect(isSelected ? null : f)}
                      aria-expanded={isSelected}
                      className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? "bg-forest text-cream"
                          : clickable
                            ? "bg-white/70 hover:bg-white focus-visible:bg-white"
                            : "bg-white/35"
                      } ${clickable ? "cursor-pointer" : "cursor-default"} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`text-sm ${isSelected ? "text-cream" : "text-forest"}`}>{f.label}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                            isSelected ? "bg-lime text-forest" : SRC_CHIP[f.src]
                          }`}
                        >
                          {SRC_LABEL[f.src]}
                        </span>
                      </div>

                      <p className={`mt-0.5 font-mono text-xs ${isSelected ? "text-lime" : value ? "text-forest/70" : "text-forest/30"}`}>
                        {value ?? "blank"}
                      </p>

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
                    </button>
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
