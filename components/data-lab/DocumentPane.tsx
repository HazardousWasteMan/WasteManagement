"use client";
import { useEffect, useRef, useState } from "react";
import type { DatalabBlock, DatalabPage } from "@/lib/bk-skjema/datalab";

export interface Highlight {
  page: number;
  bbox: [number, number, number, number];
  blockId: string | null;
}

/**
 * Renders the analysed pages and draws the source region for whichever field is selected.
 *
 * Datalab's bboxes are in its own rendered-page pixel space; the Page block's bbox is the frame
 * they share. Normalizing to fractions of that frame and positioning in percentages means the
 * overlay stays aligned at any zoom or canvas resolution, without tracking canvas pixels.
 */
export function DocumentPane({
  file,
  pages,
  highlights,
  blocks,
}: {
  file: File;
  pages: DatalabPage[];
  highlights: Highlight[];
  blocks: Record<string, DatalabBlock>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const data = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;

        for (const p of pages) {
          const canvas = canvasRefs.current.get(p.page);
          if (!canvas) continue;
          // Datalab page indexes are 0-based and absolute in the source document; pdf.js is 1-based.
          const pdfPage = await doc.getPage(p.page + 1);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = pdfPage.getViewport({ scale: 1.6 * dpr });
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
        }
        setRendered(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not render the document");
      }
    })();
    return () => { cancelled = true; };
  }, [file, pages]);

  // Bring the newest highlight into view.
  const firstHighlight = highlights[0];
  useEffect(() => {
    if (!firstHighlight) return;
    pageRefs.current.get(firstHighlight.page)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [firstHighlight]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">The document could not be displayed.</p>
        <p className="mt-1 text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {!rendered && <p className="text-sm text-forest/50">Rendering pages…</p>}
      {pages.map(p => {
        const pageHighlights = highlights.filter(h => h.page === p.page);
        return (
          <div key={p.page} ref={el => { if (el) pageRefs.current.set(p.page, el); }} className="flex flex-col gap-1">
            <p className="font-mono text-[11px] uppercase tracking-wider text-forest/40">Page {p.page + 1}</p>
            <div className="relative overflow-hidden rounded-xl border border-forest/15 bg-white shadow-sm">
              <canvas
                ref={el => { if (el) canvasRefs.current.set(p.page, el); }}
                className="block w-full"
                aria-label={`Page ${p.page + 1} of the analysis report`}
              />
              {pageHighlights.map((h, i) => {
                const [x0, y0, x1, y1] = h.bbox;
                const style = {
                  left: `${(x0 / p.width) * 100}%`,
                  top: `${(y0 / p.height) * 100}%`,
                  width: `${((x1 - x0) / p.width) * 100}%`,
                  height: `${((y1 - y0) / p.height) * 100}%`,
                };
                return (
                  <div
                    key={`${h.blockId}-${i}`}
                    style={style}
                    className="pointer-events-none absolute rounded-[3px] bg-lime/25 ring-2 ring-lime shadow-[0_0_0_1px_rgba(13,43,31,0.35)] motion-safe:animate-[cite-in_240ms_ease-out]"
                    title={h.blockId ? blocks[h.blockId]?.text : undefined}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
