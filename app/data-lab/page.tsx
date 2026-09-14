"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sourceHighlights } from "@/lib/bk-skjema/evidence";
import { DocumentPane, type Highlight } from "@/components/data-lab/DocumentPane";
import { FieldsPane } from "@/components/data-lab/FieldsPane";
import { FormPane, isFilled } from "@/components/data-lab/FormPane";
import { SampleSwitcher } from "@/components/data-lab/SampleSwitcher";
import { ExtractionProgress, type Phase } from "@/components/data-lab/ExtractionProgress";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
import type { BkField, BkSrc } from "@/lib/bk-skjema/form-map";
import type { DatalabBlock, DatalabPage } from "@/lib/bk-skjema/datalab";
import type { SubReport } from "@/lib/bk-skjema/segment";
import type { AnalysedSample } from "@/lib/bk-skjema/analyse-bundle";

interface Bundle {
  sourceLabel: string;
  pages: DatalabPage[];
  pageCount: number;
  subReports: SubReport[];
  samples: AnalysedSample[];
  blocks: Record<string, DatalabBlock>;
  costCents: number;
}

const SRC_LABEL: Record<BkSrc, string> = {
  extracted: "From the document",
  derived: "Classified",
  human: "You fill in",
  receiver: "Landfill fills in",
  "n/a": "Not applicable",
};

const EMPTY_BUNDLE = (label: string): Bundle => ({
  sourceLabel: label, pages: [], pageCount: 0, subReports: [], samples: [], blocks: {}, costCents: 0,
});

export default function DataLabPage() {
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [active, setActive] = useState(0);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keyed by sample number rather than a single slot: switching tests then shows that test's form
  // immediately if it has already been filled, and the effect below never has to clear state.
  const [filledForms, setFilledForms] = useState<Record<string, Blob>>({});
  const [selected, setSelected] = useState<BkField | null>(null);
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [seedFailed, setSeedFailed] = useState(false);
  // What a person has typed into the fields the document cannot supply, keyed by
  // "<sample no>|<acroform field>" so each test keeps its own answers.
  const [edits, setEdits] = useState<Record<string, string | boolean>>({});

  const sample: AnalysedSample | null = bundle?.samples[active] ?? null;

  // The fields as they stand now: what was extracted or classified, overlaid with the person's
  // own entries. Everything downstream — the markers, the filled PDF, the counts — uses these.
  const fields: BkField[] = useMemo(() => {
    if (!sample) return [];
    const prefix = `${sample.subReport.sampleNo}|`;
    return sample.fields.map(f => {
      const edit = edits[prefix + f.field];
      if (edit === undefined) return f;
      return typeof edit === "boolean" ? { ...f, check: edit } : { ...f, value: edit || undefined };
    });
  }, [sample, edits]);

  const editKey = useMemo(() => {
    if (!sample) return "";
    const prefix = `${sample.subReport.sampleNo}|`;
    return Object.entries(edits).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `${k}=${v}`).sort().join(",");
  }, [sample, edits]);

  const filledPdf = sample ? filledForms[sample.subReport.sampleNo + "|" + editKey] ?? null : null;

  function applyEdit(field: BkField, value: string | boolean) {
    if (!sample) return;
    setEdits(prev => ({ ...prev, [`${sample.subReport.sampleNo}|${field.field}`]: value }));
  }

  // The Alta bundle ships pre-analysed, so the tab opens on a real result instead of an empty
  // dropzone — a live run of it takes minutes. Uploading replaces it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/data-lab-seed.json");
        if (!res.ok) throw new Error(String(res.status));
        const seed = await res.json();
        const doc = await fetch(seed.sourcePdf);
        if (!doc.ok) throw new Error("sample pdf missing");
        const blob = await doc.blob();
        if (cancelled) return;
        setPdf(blob);
        setOrigin(seed.originProcess ?? "");
        setBundle({
          sourceLabel: seed.sourceLabel,
          pages: seed.pages, pageCount: seed.pageCount, subReports: seed.subReports,
          samples: seed.samples, blocks: seed.blocks, costCents: seed.costCents,
        });
      } catch {
        if (!cancelled) setSeedFailed(true); // not an error state: the upload path still works
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fill the form for whichever test is showing.
  useEffect(() => {
    if (!sample) return;
    const cacheKey = sample.subReport.sampleNo + "|" + editKey;
    if (filledForms[cacheKey]) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/data-lab/fill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });
        if (!res.ok) { if (!cancelled) setError("Could not fill the form"); return; }
        const blob = await res.blob();
        if (!cancelled) setFilledForms(prev => ({ ...prev, [cacheKey]: blob }));
      } catch {
        if (!cancelled) setError("Could not fill the form");
      }
    })();
    return () => { cancelled = true; };
  }, [sample, fields, editKey, filledForms]);

  const highlights: Highlight[] = useMemo(() => sourceHighlights(selected), [selected]);

  // Only the pages belonging to the test on screen, so the right pane is that sub-report.
  const visiblePages = useMemo(() => {
    if (!bundle || !sample) return [];
    return bundle.pages.filter(
      p => p.page >= sample.subReport.firstPage && p.page <= sample.subReport.lastPage
    );
  }, [bundle, sample]);

  const coverage = useMemo(() => {
    if (!sample) return null;
    const filled = fields.filter(isFilled);
    return {
      total: fields.length,
      filled: filled.length,
      fromDocument: filled.filter(f => f.src === "extracted").length,
      classified: filled.filter(f => f.src === "derived").length,
      stillBlank: fields.filter(f => f.src === "human" && !isFilled(f)).length,
    };
  }, [sample, fields]);

  const runExtraction = useCallback(async (chosen: File, originProcess: string) => {
    setError(null);
    setBundle(null);
    setFilledForms({});
    setEdits({});
    setSelected(null);
    setActive(0);
    setPageCount(null);
    setPdf(chosen);
    setPhase("converting");

    const body = new FormData();
    body.append("file", chosen);
    if (originProcess) body.append("originProcess", originProcess);

    let next = EMPTY_BUNDLE(chosen.name);
    try {
      const res = await fetch("/api/data-lab", { method: "POST", body });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? `The request failed (${res.status}).`);
        setPhase(null);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) { setError("This browser could not read the response stream."); setPhase(null); return; }

      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(line); } catch { continue; }

          if (event.phase === "converting") setPhase("converting");
          else if (event.phase === "segmented") {
            setPhase("extracting");
            setPageCount(Number(event.pageCount));
            next = { ...next, subReports: event.subReports as SubReport[], pages: event.pages as DatalabPage[], pageCount: Number(event.pageCount) };
            setBundle({ ...next });
          } else if (event.phase === "sample") {
            // Show each form as it lands rather than waiting for the whole bundle.
            next = { ...next, samples: [...next.samples, event.sample as AnalysedSample]
              .sort((a, b) => a.subReport.firstPage - b.subReport.firstPage) };
            setBundle({ ...next });
          } else if (event.phase === "failed-sample") {
            setError(`One test could not be extracted (${event.sampleNo}): ${event.error}. The others are shown.`);
          } else if (event.phase === "done") {
            next = { ...next, blocks: event.blocks as Record<string, DatalabBlock>, costCents: Number(event.costCents) };
            setBundle({ ...next });
          } else if (event.phase === "error") {
            setError(String(event.error ?? "Extraction failed"));
          }
        }
      }
    } catch {
      setError("Could not reach the extraction service. Check your connection and try again.");
    } finally {
      setPhase(null);
    }
  }, []);

  async function changeOrigin(nextOrigin: string) {
    setOrigin(nextOrigin);
    if (!bundle || bundle.samples.length === 0) return;
    setBusy("Re-deriving every form for the new origin.");
    try {
      const updated = await Promise.all(bundle.samples.map(async s => {
        const res = await fetch("/api/data-lab/reclassify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw: s.raw, blocks: bundle.blocks, originProcess: nextOrigin || null, evidenceContext: { sampleId: s.classification.measurementBoundary?.measurements[0]?.sampleId, documentRef: s.classification.measurementBoundary?.measurements[0]?.source[0]?.documentRef } }),
        });
        if (!res.ok) return s;
        const json = await res.json();
        return { ...s, fields: json.fields, classification: json.classification, unmatchedAnalytes: json.unmatchedAnalytes };
      }));
      // Every form's fields changed, so the filled PDFs must be re-made.
      setFilledForms({});
      setBundle({ ...bundle, samples: updated });
      setSelected(null);
    } finally {
      setBusy(null);
    }
  }

  async function handleDispute(field: BkField, reason: string, raisedBy: string) {
    if (!field.legalCitation) return;
    if (!field.legalCitationKey) {
      setError("This citation has no associated field key — cannot raise a scoped dispute.");
      throw new Error("legalCitationKey missing");
    }
    const primary = field.legalCitation.citations.find(c => c.primary) ?? field.legalCitation.citations[0];
    if (!primary) return;
    let res: Response;
    try {
      res = await fetch("/api/compliance/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paragraphId: primary.paragraphId,
          citedFieldKey: field.legalCitationKey,
          freezeId: null, // this call site disputes at fill time, before any freeze exists
          raisedBy,
          reason,
        }),
      });
    } catch {
      const message = "Could not reach the compliance service. Check your connection and try again.";
      setError(message);
      throw new Error(message);
    }
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const message = json.error ?? `The request failed (${res.status}).`;
      setError(message);
      throw new Error(message);
    }
  }

  function downloadFilledForm() {
    if (!filledPdf || !sample) return;
    const url = URL.createObjectURL(filledPdf);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bk-skjema-${sample.subReport.sampleNo}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pendingSubReports = bundle
    ? bundle.subReports.filter(sub => !bundle.samples.some(s => s.subReport.sampleNo === sub.sampleNo))
    : [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-forest/10 px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-forest">Data Lab</h1>
            <p className="mt-1 max-w-2xl text-sm text-forest/60">
              A chemical analysis in, one filled basiskarakterisering form per test out. Every field
              the document supplied is marked — press it to jump to the text it came from.
            </p>
          </div>
          {filledPdf && sample && (
            <button
              type="button"
              onClick={downloadFilledForm}
              className="rounded-xl bg-forest px-4 py-2 text-sm font-medium text-lime transition-colors hover:bg-forest-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
            >
              Download this form
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
              if (chosen) runExtraction(chosen, origin);
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

        {bundle && !phase && (
          <p className="pb-2 text-xs text-forest/45">
            Showing {bundle.sourceLabel}
          </p>
        )}
      </div>

      {phase && <ExtractionProgress phase={phase} pageCount={pageCount} />}

      {busy && !phase && (
        <p className="border-b border-forest/10 bg-lime/20 px-6 py-3 text-sm text-forest" role="status">{busy}</p>
      )}

      {error && (
        <div className="m-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <p className="font-medium">That did not work.</p>
          <p className="mt-1 text-red-700">{error}</p>
        </div>
      )}

      {!bundle && !phase && (
        <div className="flex flex-1 items-center justify-center px-6 py-20">
          <p className="max-w-md text-center text-sm text-forest/50">
            {seedFailed
              ? "Choose a lab report to begin. Each chemical test in it becomes its own form."
              : "Loading the example report…"}
          </p>
        </div>
      )}

      {bundle && bundle.samples.length > 0 && sample && coverage && (
        <>
          <SampleSwitcher
            tabs={bundle.samples.map(s => ({
              subReport: s.subReport,
              ealCode: s.classification.eal.code,
              isHazardous: s.classification.hazard.isHazardous,
            }))}
            active={active}
            onSelect={i => { setActive(i); setSelected(null); }}
            pending={pendingSubReports}
          />

          <dl className="flex flex-wrap gap-x-8 gap-y-2 border-b border-forest/10 px-6 py-3 text-sm">
            {[
              ["Marked on the form", `${coverage.filled} of ${coverage.total}`],
              ["From the document", String(coverage.fromDocument)],
              ["Classified", String(coverage.classified)],
              ["Still blank", String(coverage.stillBlank)],
              ["EAL", sample.classification.eal.code ?? "not assigned"],
              ["Hazardous", sample.classification.hazard.isHazardous === null ? "indeterminate" : sample.classification.hazard.isHazardous ? "yes" : "no"],
              ["Datalab cost", `${(bundle.costCents / 100).toFixed(2)} USD`],
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
            <div className="lg:max-h-[calc(100vh-22rem)] lg:overflow-y-auto lg:pr-2">
              <h2 className="mb-2 text-sm font-semibold text-forest">Filled form</h2>
              {filledPdf
                ? <FormPane pdf={filledPdf} fields={fields} selected={selected?.field ?? null} onSelect={setSelected} />
                : <p className="text-sm text-forest/50">Filling the form…</p>}
            </div>

            <div className="lg:max-h-[calc(100vh-22rem)] lg:overflow-y-auto lg:pl-2">
              <h2 className="mb-2 text-sm font-semibold text-forest">Original report</h2>
              {pdf && <DocumentPane file={pdf} pages={visiblePages} highlights={highlights} blocks={bundle.blocks} />}
            </div>
          </div>

          <details className="border-t border-forest/10 px-6 py-4">
            <summary className="cursor-pointer text-sm font-medium text-forest">
              All {coverage.total} fields — {coverage.stillBlank} still blank, fill them in here
            </summary>
            <div className="mt-4">
              <label className="mb-3 flex items-center gap-2 text-xs text-forest/60">
                <input type="checkbox" checked={onlyFilled} onChange={e => setOnlyFilled(e.target.checked)} className="accent-forest" />
                Only filled
              </label>
              <FieldsPane
                fields={fields}
                selected={selected?.field ?? null}
                onSelect={setSelected}
                onlyFilled={onlyFilled}
                onEdit={applyEdit}
                onDispute={handleDispute}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
