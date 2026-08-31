"use client";
import { useMemo, useState } from "react";
import { DocumentPane, type Highlight } from "@/components/data-lab/DocumentPane";
import { FieldsPane } from "@/components/data-lab/FieldsPane";
import { ExtractionProgress, type Phase } from "@/components/data-lab/ExtractionProgress";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
import type { BkField } from "@/lib/bk-skjema/form-map";
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

export default function DataLabPage() {
  const [file, setFile] = useState<File | null>(null);
  const [origin, setOrigin] = useState("");
  const [pageRange, setPageRange] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extraction | null>(null);
  const [selected, setSelected] = useState<BkField | null>(null);
  const [onlyFilled, setOnlyFilled] = useState(false);

  const coverage = useMemo(() => {
    if (!result) return null;
    const filled = result.fields.filter(f => f.value || f.check || f.select);
    return {
      total: result.fields.length,
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
      setResult({ ...result, ...json });
      setSelected(null);
    } finally {
      setBusy(null);
    }
  }

  async function downloadFilledForm() {
    if (!result) return;
    setBusy("Filling the BK-skjema.");
    try {
      const res = await fetch("/api/data-lab/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: result.fields }),
      });
      if (!res.ok) { setError("Could not fill the form"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bk-skjema-utfylt.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-forest/10 px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-forest">Data Lab</h1>
            <p className="mt-1 max-w-2xl text-sm text-forest/60">
              Put in a chemical analysis and get back the fields of the landfill basiskarakterisering form.
              Every value the document supplied is clickable — press it to see the exact text it came from.
            </p>
          </div>
          {result && (
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
            Choose a lab report to begin. Pick the origin/process too — it is the one thing a lab report
            never states, and the EAL code cannot be assigned without it.
          </p>
        </div>
      )}

      {result && coverage && (
        <>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 border-b border-forest/10 px-6 py-3 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-forest/50">From the document</dt>
              <dd className="font-mono text-forest">{coverage.fromDocument}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-forest/50">Classified</dt>
              <dd className="font-mono text-forest">{coverage.classified}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-forest/50">You fill in</dt>
              <dd className="font-mono text-forest">{coverage.youFill}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-forest/50">EAL</dt>
              <dd className="font-mono text-forest">{result.classification.eal.code ?? "not assigned"}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-forest/50">Hazardous</dt>
              <dd className="font-mono text-forest">{result.classification.hazard.isHazardous ? "yes" : "no"}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-forest/50">Datalab cost</dt>
              <dd className="font-mono text-forest">{(result.costCents / 100).toFixed(2)} USD</dd>
            </div>
          </dl>

          <div className="grid flex-1 grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-2">
            <div className="order-2 lg:order-1 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pr-2">
              {file && (
                <DocumentPane file={file} pages={result.pages} highlights={highlights} blocks={result.blocks} />
              )}
            </div>

            <div className="order-1 lg:order-2 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pl-2">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm text-forest/60">
                  {coverage.total} fields
                  {result.unmatchedAnalytes.length > 0 && (
                    <span className="text-forest/40"> · {result.unmatchedAnalytes.length} analytes without a hazard reference</span>
                  )}
                </p>
                <label className="flex items-center gap-2 text-xs text-forest/60">
                  <input
                    type="checkbox"
                    checked={onlyFilled}
                    onChange={e => setOnlyFilled(e.target.checked)}
                    className="accent-forest"
                  />
                  Only filled
                </label>
              </div>
              <FieldsPane
                fields={result.fields}
                selected={selected?.field ?? null}
                onSelect={setSelected}
                onlyFilled={onlyFilled}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
