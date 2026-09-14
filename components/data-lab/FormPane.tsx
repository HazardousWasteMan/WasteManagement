"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BkField } from "@/lib/bk-skjema/form-map";
import geometry from "@/lib/data/bk-skjema-field-geometry.json";

export type FieldAttention = { status: "complete" | "derived" | "needs_input" | "cannot_determine" | "not_applicable"; label: string };

interface Widget { field: string; export: string | null; page: number; x: number; y: number; w: number; h: number }

const WIDGETS = geometry.widgets as Widget[];
const PAGES = geometry.pages as { page: number; width: number; height: number }[];

export function isFilled(f: BkField): boolean {
  return Boolean(f.value || f.check || f.select);
}

/** Radio groups share a field name across one widget per option, so match on the chosen export. */
function widgetFor(f: BkField): Widget | undefined {
  const rows = WIDGETS.filter(w => w.field === f.field);
  if (f.select) return rows.find(w => w.export === f.select) ?? rows[0];
  return rows[0];
}

/**
 * The filled BK-skjema itself, with a marker around every field that got a value. This is the
 * deliverable, so it leads; clicking a marker sends the other pane to the source the value came
 * from. Markers are real buttons in reading order, with a roving tabindex, so the whole form is
 * walkable with the arrow keys.
 */
export function FormPane({
  pdf,
  fields,
  selected,
  onSelect,
  attention,
}: {
  pdf: Blob;
  fields: BkField[];
  selected: string | null;
  onSelect: (field: BkField) => void;
  attention?: Record<string, FieldAttention>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Reading order: page, then row, then column — so arrow keys walk the form the way it is read.
  const markers = useMemo(() => {
    return fields
      .filter(f => isFilled(f) || attention?.[f.field]?.status === "needs_input" || attention?.[f.field]?.status === "cannot_determine")
      .map(f => ({ field: f, widget: widgetFor(f) }))
      .filter((m): m is { field: BkField; widget: Widget } => Boolean(m.widget))
      .sort((a, b) =>
        a.widget.page - b.widget.page ||
        Math.round(a.widget.y / 6) - Math.round(b.widget.y / 6) ||
        a.widget.x - b.widget.x
      );
  }, [fields, attention]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await pdf.arrayBuffer()) }).promise;
        if (cancelled) return;
        for (const p of PAGES) {
          const canvas = canvasRefs.current.get(p.page);
          if (!canvas) continue;
          const page = await doc.getPage(p.page + 1);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: 1.5 * dpr });
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
        }
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not render the filled form");
      }
    })();
    return () => { cancelled = true; };
  }, [pdf]);

  const move = useCallback((delta: number) => {
    if (markers.length === 0) return;
    const current = markers.findIndex(m => m.field.field === selected);
    const next = current === -1
      ? (delta > 0 ? 0 : markers.length - 1)
      : Math.min(markers.length - 1, Math.max(0, current + delta));
    const target = markers[next];
    onSelect(target.field);
    buttonRefs.current.get(target.field.field)?.focus();
  }, [markers, selected, onSelect]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!markers.length) return;
    const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (e.key in keys) { e.preventDefault(); move(keys[e.key]); return; }
    if (e.key === "Home") { e.preventDefault(); onSelect(markers[0].field); buttonRefs.current.get(markers[0].field.field)?.focus(); }
    if (e.key === "End") { e.preventDefault(); const last = markers[markers.length - 1]; onSelect(last.field); buttonRefs.current.get(last.field.field)?.focus(); }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">The filled form could not be displayed.</p>
        <p className="mt-1 text-red-700">{error}</p>
      </div>
    );
  }

  const activeIndex = Math.max(0, markers.findIndex(m => m.field.field === selected));

  return (
    // Key handling sits on the wrapper because the markers use a roving tabindex: focus is always
    // on one of the child buttons, so their keydown events bubble to here.
    <div className="flex flex-col gap-4" onKeyDown={onKeyDown} role="group" aria-label="Filled basiskarakterisering form">
      <p className="text-xs text-forest/50">
        {attention ? "Green: completed · dashed amber: needs you · slate: cannot determine. Select a marker to open Evidence." : `${markers.length} filled fields · click a marker, or use the arrow keys, to see where the value came from`}
      </p>
      {!ready && <p className="text-sm text-forest/50">Rendering the filled form…</p>}

      {PAGES.map(p => (
        <div key={p.page} className="flex flex-col gap-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-forest/40">Skjema side {p.page + 1}</p>
          <div className="relative overflow-hidden rounded-xl border border-forest/15 bg-white shadow-sm" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
            <canvas
              ref={el => { if (el) canvasRefs.current.set(p.page, el); }}
              className="block w-full"
              aria-label={`Filled form page ${p.page + 1}`}
            />
            {markers.map((m, i) => {
              if (m.widget.page !== p.page) return null;
              const isSelected = m.field.field === selected;
              const hasSource = (m.field.citations ?? []).some(c => c.bbox);
              const task = attention?.[m.field.field];
              return (
                <button
                  key={m.field.field}
                  ref={el => { if (el) buttonRefs.current.set(m.field.field, el); }}
                  type="button"
                  tabIndex={i === activeIndex ? 0 : -1}
                  onClick={() => onSelect(m.field)}
                  aria-label={task ? `${task.label}: ${task.status.replaceAll("_", " ")}` : `${m.field.label}${hasSource ? ", show source in the report" : ", no source to show"}`}
                  data-field={m.field.field}
                  data-status={task?.status}
                  aria-pressed={isSelected}
                  style={{
                    left: `${(m.widget.x / p.width) * 100}%`,
                    top: `${(m.widget.y / p.height) * 100}%`,
                    width: `${(m.widget.w / p.width) * 100}%`,
                    height: `${(m.widget.h / p.height) * 100}%`,
                  }}
                  className={`absolute rounded-[3px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
                    task?.status === "needs_input"
                      ? `border-2 border-dashed border-amber-600 bg-amber-100/20 ${isSelected ? "ring-2 ring-forest" : ""}`
                      : task?.status === "cannot_determine"
                        ? `border-2 border-slate-500 bg-slate-200/30 ${isSelected ? "ring-2 ring-forest" : ""}`
                      : isSelected
                      ? "bg-lime/45 ring-2 ring-forest"
                      : hasSource
                        ? "bg-lime/15 ring-2 ring-lime hover:bg-lime/35"
                        : "ring-2 ring-lime/40"
                  }`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
