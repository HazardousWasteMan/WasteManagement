"use client";
import { useEffect, useState } from "react";

export type Phase = "converting" | "extracting" | "done" | "error";

/** The two steps are the two real Datalab calls, not a decorative sequence. */
const STEPS: { phase: Phase; label: string; detail: string }[] = [
  { phase: "converting", label: "Reading the pages", detail: "Turning the report into text blocks it can point back to" },
  { phase: "extracting", label: "Filling the form's fields", detail: "Matching values to the basiskarakterisering, with a source for each" },
];

export function ExtractionProgress({ phase, pageCount }: { phase: Phase; pageCount: number | null }) {
  const [elapsed, setElapsed] = useState(0);

  // The counter is the liveness signal that survives prefers-reduced-motion, where the spinner
  // does not animate. Something on screen must always be changing during a 30-75s wait.
  useEffect(() => {
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const activeIndex = STEPS.findIndex(s => s.phase === phase);

  return (
    <div className="border-b border-forest/10 bg-lime/20 px-6 py-4" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-forest">
          Reading the report
          {pageCount !== null && <span className="text-forest/60"> · {pageCount} page{pageCount === 1 ? "" : "s"}</span>}
        </p>
        <p className="font-mono text-xs text-forest/50" aria-label={`${elapsed} seconds elapsed`}>
          {elapsed}s
          <span className="ml-2 text-forest/35">usually 30–90s</span>
        </p>
      </div>

      <ol className="mt-3 flex flex-col gap-2">
        {STEPS.map((step, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "pending";
          return (
            <li key={step.phase} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                {state === "done" && (
                  <svg viewBox="0 0 16 16" className="h-4 w-4 text-forest">
                    <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {state === "active" && (
                  <span className="h-4 w-4 rounded-full border-2 border-forest/25 border-t-forest motion-safe:animate-spin" />
                )}
                {state === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-forest/25" />}
              </span>

              <span className="min-w-0">
                <span className={`text-sm ${state === "pending" ? "text-forest/35" : "text-forest"}`}>
                  {step.label}
                  {state === "active" && <span className="sr-only"> — in progress</span>}
                  {state === "done" && <span className="sr-only"> — finished</span>}
                </span>
                {state === "active" && <span className="block text-xs text-forest/55">{step.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
