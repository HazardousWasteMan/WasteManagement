"use client";
import { useRef } from "react";
import { subReportLabel, type SubReport } from "@/lib/bk-skjema/segment";

export interface SampleTab {
  subReport: SubReport;
  ealCode: string | null;
  isHazardous: boolean;
}

/**
 * One tab per chemical test in the uploaded bundle. A bundled Eurofins report holds several
 * independent sub-reports and each one is its own delivery, so each gets its own BK-skjema rather
 * than being merged into a single form.
 *
 * Standard ARIA tabs: arrow keys move between tabs while focus is in the tablist, which does not
 * collide with the arrow-key navigation inside the form pane.
 */
export function SampleSwitcher({
  tabs,
  active,
  onSelect,
  pending,
}: {
  tabs: SampleTab[];
  active: number;
  onSelect: (index: number) => void;
  /** Sub-reports still extracting, shown as placeholders so the count is honest while it runs. */
  pending: SubReport[];
}) {
  const refs = useRef<Map<number, HTMLButtonElement>>(new Map());

  function onKeyDown(e: React.KeyboardEvent) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = Math.min(tabs.length - 1, Math.max(0, active + delta));
    onSelect(next);
    refs.current.get(next)?.focus();
  }

  return (
    <div className="border-b border-forest/10 px-6 py-3">
      <div className="flex items-center gap-2">
        <p className="shrink-0 text-xs font-medium uppercase tracking-wide text-forest/50">
          {tabs.length + pending.length} tests in this report
        </p>
      </div>

      <div role="tablist" aria-label="Chemical tests in this report" onKeyDown={onKeyDown} className="mt-2 flex flex-wrap gap-2">
        {tabs.map((tab, i) => {
          const isActive = i === active;
          return (
            <button
              key={tab.subReport.sampleNo}
              ref={el => { if (el) refs.current.set(i, el); }}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelect(i)}
              className={`rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
                isActive ? "bg-forest text-cream" : "bg-white/70 text-forest hover:bg-white"
              }`}
            >
              <span className="block text-sm font-medium">{subReportLabel(tab.subReport)}</span>
              <span className={`mt-0.5 block font-mono text-[11px] ${isActive ? "text-lime" : "text-forest/50"}`}>
                {tab.subReport.firstPage === tab.subReport.lastPage
                  ? `p${tab.subReport.firstPage + 1}`
                  : `p${tab.subReport.firstPage + 1}–${tab.subReport.lastPage + 1}`}
                {" · "}
                {tab.isHazardous ? "farlig avfall" : tab.ealCode ?? "no EAL"}
              </span>
            </button>
          );
        })}

        {pending.map(sub => (
          <span
            key={sub.sampleNo}
            className="rounded-xl border border-dashed border-forest/25 px-3 py-2 text-left"
            aria-live="polite"
          >
            <span className="block text-sm text-forest/45">{subReportLabel(sub) || sub.sampleNo}</span>
            <span className="mt-0.5 block font-mono text-[11px] text-forest/35">extracting…</span>
          </span>
        ))}
      </div>
    </div>
  );
}
