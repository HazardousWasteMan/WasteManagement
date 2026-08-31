"use client";
import { useEffect, useMemo, useState } from "react";
import { DocumentPane, type Highlight } from "@/components/data-lab/DocumentPane";
import { FieldsPane } from "@/components/data-lab/FieldsPane";
import { FormPane, isFilled } from "@/components/data-lab/FormPane";
import { ExtractionProgress, type Phase } from "@/components/data-lab/ExtractionProgress";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
import type { BkField, BkSrc } from "@/lib/bk-skjema/form-map";
import type { DatalabBlock, DatalabPage } from "@/lib/bk-skjema/datalab";

interface Extraction {
  fields: BkField[];
  pages: DatalabPage[];
  blocks: Record<string, DatalabBlock>;
  raw: Record<string, unknown>;
  metadata: Record<string, unknown>;
  results: unknown[];
  classification: { hazard: { isHazardous: boolean }; eal: { code: string | null; confidence: string } };
  unmatchedAnalytes: string[];
  costCents: number;
}

const SRC_LABEL: Record<BkSrc, string> = {
  extracted: "From the document",
  derived: "Classified",
  human: "You fill in",
  receiver: "Landfill fills in",
  "n/a": "Not applicable",
};

export default function DataLabPage() {
  const [file, setFile] = useState<File | null>(null);
  const [origin, setOrigin] = useState("");
  const [pageRange, setPageRange] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extraction | null>(null);
  const [filledPdf, setFilledPdf] = useState<Blob | null>(null);
  const [selected, setSelected] = useState<BkField | null>(null);
  const [onlyFilled, setOnlyFilled] = useState(false);

  // The filled form is the left-hand pane, so it is fetched as soon as there are fields to fill it
  // with — and again whenever they change, e.g. after picking a different origin/process.
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/data-lab/fill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: result.fields }),
        });
        if (!res.ok) { if (!cancelled) setError("Could not fill the form"); return; }
        const blob = await res.blob();
        if (!cancelled) setFilledPdf(blob);
      } catch {
        if (!cancelled) setError("Could not fill the form");
      }
    })();
    return () => { cancelled = true; };
  }, [result]);

  const coverage = useMemo(() => {
    if (!result) return null;
    const filled = result.fields.filter(isFilled);
    return {
      total: result.fields.length,
      filled: filled.length,
      fromDocument: filled.filter(f => f.src === "extracted").length,
      classified: filled.filter(f => f.src === "derived").length,
      youFill: result.fields.filter(f => f.src === "human").length,
    };
  }, [result]);

  const highlights: Highlight[] = useMemo(() => {
    if (!selected?.citations) return [];
    return selected.citations
      .filter(c => c.bbox && c.page !== null)
      .map(c => ({ page: c.page!, bbox: c.bbox!, blockId: c.blockId }));
  }, [selected]);

  async function runExtraction(chosen: File) {
    setError(null);
    setResult(null);
    setFilledPdf(null);
    setSelected(null);
    setPageCount(null);
    setPhase("converting");

    const body = new FormData();
    body.append("file", chosen);
    if (origin) body.append("originProcess", origin);
    if (pageRange.trim()) body.append("pageRange", pageRange.trim());

    try {
      const res = await fetch("/api/data-lab", { method: "POST", body });
      // Validation failures happen before the stream opens, so they still arrive as real statuses.
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `The request failed (${res.status}).`);
        setPhase(null);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setError("This browser could not read the response stream.");
        setPhase(null);
        return;
      }

      // NDJSON: one progress event per line, with the finished payload as the last one.
      const decoder = new TextDecoder();
      let buffer = "";
      let sawResult = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: { phase?: string; pageCount?: number; error?: string; result?: Extraction };
          try {
            event = JSON.parse(line);
          } catch {
            continue; // a partial or malformed line must not abort a run that is still going
          }
          if (event.phase === "converting") setPhase("converting");
          else if (event.phase === "extracting") {
            setPhase("extracting");
            setPageCount(event.pageCount ?? null);
          } else if (event.phase === "done" && event.result) {
            setResult(event.result);
            sawResult = true;
          } else if (event.phase === "error") {
            setError(event.error ?? "Extraction failed");
          }
        }
      }
      if (!sawResult) {
        setError(prev => prev ?? "The extraction ended without returning a result.");
      }
    } catch {
      setError("Could not reach the extraction service. Check your connection and try again.");
    } finally {
      setPhase(null);
    }
  }

  async function changeOrigin(next: string) {
    setOrigin(next);
    if (!result) return;
    setBusy("Re-deriving the form for the new origin.");
    try {
      const res = await fetch("/api/data-lab/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw: result.raw, blocks: result.blocks, originProcess: next || null }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not re-derive the form"); return; }
      // The fields changed, so the rendered form is stale until the refetch lands.
      setFilledPdf(null);
      setResult({ ...result, ...json });
      setSelected(null);
    } finally {
      setBusy(null);
    }
  }

  function downloadFilledForm() {
    if (!filledPdf) return;
    const url = URL.createObjectURL(filledPdf);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bk-skjema-utfylt.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-forest/10 px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-forest">Data Lab</h1>
            <p className="mt-1 max-w-2xl text-sm text-forest/60">
              Put in a chemical analysis and get back the filled basiskarakterisering form. Every
              field the document supplied is marked — press it to jump to the text it came from.
            </p>
          </div>
          {filledPdf && (
            <button
              type="button"
              onClick={downloadFilledForm}
              className="rounded-xl bg-forest px-4 py-2 text-sm font-medium text-lime transition-colors hover:bg-forest-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
            >
              Download filled form
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-4 border-b border-forest/10 px-6 py-4">
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-forest/50">
          Analysis report
          <input
            type="file"
            accept="application/pdf"
            onChange={e => {
              const chosen = e.target.files?.[0];
              if (chosen) { setFile(chosen); runExtraction(chosen); }
            }}
            className="w-64 cursor-pointer rounded-xl border border-forest/20 bg-white/70 px-3 py-2 text-sm font-normal normal-case tracking-normal text-forest file:mr-3 file:rounded-lg file:border-0 file:bg-forest file:px-3 file:py-1 file:text-lime"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-forest/50">
          Origin / process
          <select
            value={origin}
            onChange={e => changeOrigin(e.target.value)}
            className="w-72 rounded-xl border border-forest/20 bg-white/70 px-3 py-2 text-sm font-normal normal-case tracking-normal text-forest"
          >
            <option value="">Not set — no EAL code will be assigned</option>
            {ORIGIN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-forest/50">
          Pages (optional)
          <input
            value={pageRange}
            onChange={e => setPageRange(e.target.value)}
            placeholder="e.g. 2-4"
            title="Leave blank to read the whole document. On reports that bundle several samples a range is both faster and more accurate."
            className="w-32 rounded-xl border border-forest/20 bg-white/70 px-3 py-2 text-sm font-normal normal-case tracking-normal text-forest placeholder:text-forest/30"
          />
        </label>

        {file && !busy && !phase && (
          <button
            type="button"
            onClick={() => runExtraction(file)}
            className="rounded-xl border border-forest/25 px-3 py-2 text-sm text-forest transition-colors hover:bg-white"
          >
            Run again
          </button>
        )}
      </div>

      {phase && <ExtractionProgress phase={phase} pageCount={pageCount} />}

      {busy && !phase && (
        <p className="border-b border-forest/10 bg-lime/20 px-6 py-3 text-sm text-forest" role="status">
          {busy}
        </p>
      )}

      {error && (
        <div className="m-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <p className="font-medium">That did not work.</p>
          <p className="mt-1 text-red-700">{error}</p>
        </div>
      )}

      {!result && !busy && !phase && !error && (
        <div className="flex flex-1 items-center justify-center px-6 py-20">
          <p className="max-w-md text-center text-sm text-forest/50">
            Choose a lab report to begin. Pick the origin/process too — it is the one thing a lab
            report never states, and the EAL code cannot be assigned without it.
            <br /><br />
            If the report bundles several samples, set a page range for the one you want. One form
            describes one delivery, and reading every page at once both takes minutes and mixes the
            samples together.
          </p>
        </div>
      )}

      {result && coverage && (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 border-b border-forest/10 px-6 py-3 text-sm">
            {[
              ["Marked on the form", `${coverage.filled} of ${coverage.total}`],
              ["From the document", String(coverage.fromDocument)],
              ["Classified", String(coverage.classified)],
              ["You fill in", String(coverage.youFill)],
              ["EAL", result.classification.eal.code ?? "not assigned"],
              ["Hazardous", result.classification.hazard.isHazardous ? "yes" : "no"],
              ["Datalab cost", `${(result.costCents / 100).toFixed(2)} USD`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-2">
                <dt className="text-forest/50">{label}</dt>
                <dd className="font-mono text-forest">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="min-h-[4.5rem] border-b border-forest/10 bg-white/50 px-6 py-3">
            {selected ? (
              <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-forest">{selected.label}</p>
                  <p className="font-mono text-xs text-forest/70">
                    {selected.value || (selected.check ? "Avkrysset" : selected.select) || "blank"}
                  </p>
                </div>
                <span className="rounded-full bg-forest px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-lime">
                  {SRC_LABEL[selected.src]}
                </span>
                <div className="min-w-0 flex-1">
                  {(selected.citations ?? []).length > 0 ? (
                    (selected.citations ?? []).slice(0, 2).map(c => (
                      <p key={c.blockId} className="truncate text-xs text-forest/60">
                        <span className="font-mono text-forest/40">p{(c.page ?? 0) + 1}</span>{" "}
                        {c.text ? `“${c.text.slice(0, 160)}${c.text.length > 160 ? "…" : ""}”` : "source block had no text"}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-forest/45">
                      {selected.note ?? "No source in the document — this value was not read from it."}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-forest/45">
                Press a green marker on the form, or use the arrow keys, to see where its value came from.
              </p>
            )}
          </div>

          <div className="grid flex-1 grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-2">
            <div className="lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto lg:pr-2">
              <h2 className="mb-2 text-sm font-semibold text-forest">Filled form</h2>
              {filledPdf
                ? <FormPane pdf={filledPdf} fields={result.fields} selected={selected?.field ?? null} onSelect={setSelected} />
                : <p className="text-sm text-forest/50">Filling the form…</p>}
            </div>

            <div className="lg:max-h-[calc(100vh-18rem)] lg:overflow-y-auto lg:pl-2">
              <h2 className="mb-2 text-sm font-semibold text-forest">Original report</h2>
              {file && (
                <DocumentPane file={file} pages={result.pages} highlights={highlights} blocks={result.blocks} />
              )}
            </div>
          </div>

          <details className="border-t border-forest/10 px-6 py-4">
            <summary className="cursor-pointer text-sm font-medium text-forest">
              All {coverage.total} fields, including the {coverage.youFill} you must fill in yourself
            </summary>
            <div className="mt-4">
              <label className="mb-3 flex items-center gap-2 text-xs text-forest/60">
                <input type="checkbox" checked={onlyFilled} onChange={e => setOnlyFilled(e.target.checked)} className="accent-forest" />
                Only filled
              </label>
              <FieldsPane
                fields={result.fields}
                selected={selected?.field ?? null}
                onSelect={setSelected}
                onlyFilled={onlyFilled}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
