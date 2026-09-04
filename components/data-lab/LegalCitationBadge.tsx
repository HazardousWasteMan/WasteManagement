"use client";
import { useState } from "react";
import type { LegalCitationView } from "@/lib/compliance/citation-view";

export function canSubmitDispute(reason: string, raisedBy: string): boolean {
  return reason.trim().length > 0 && raisedBy.trim().length > 0;
}

/**
 * Inline, non-blocking legal citation display. Trust-by-default: the citation is shown and used
 * without any approval step. The only action available is disputing it — no role gating (this
 * app has no per-user identity yet; see the plan's Global Constraints) — which posts a dispute
 * and never edits any already-frozen record; it only ever adds a new one.
 */
export function LegalCitationBadge({
  citation,
  onDispute,
}: {
  citation: LegalCitationView;
  onDispute: (reason: string, raisedBy: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [raisedBy, setRaisedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justDisputed, setJustDisputed] = useState(false);

  const disputed = citation.disputed || justDisputed;

  async function submit() {
    if (!canSubmitDispute(reason, raisedBy)) return;
    setSubmitting(true);
    try {
      await onDispute(reason.trim(), raisedBy.trim());
      setJustDisputed(true);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-1 flex flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-1.5">
        {disputed && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800" title="This citation has an unresolved dispute">
            disputed
          </span>
        )}
        <a
          href={citation.sourceLink}
          target="_blank"
          rel="noreferrer"
          className="text-forest/60 underline decoration-dotted underline-offset-2 hover:text-forest"
        >
          {citation.label}
        </a>
        <span className="text-forest/35">verified {new Date(citation.verifiedAt).toLocaleDateString("no-NO")}</span>
        {!disputed && (
          <button type="button" onClick={() => setOpen(v => !v)} className="text-forest/40 underline decoration-dotted hover:text-forest/70">
            I disagree
          </button>
        )}
      </div>

      {open && (
        <div className="flex flex-col gap-1 rounded-lg border border-forest/15 bg-white/60 p-2">
          <input
            value={raisedBy}
            onChange={e => setRaisedBy(e.target.value)}
            placeholder="Your name"
            className="rounded border border-forest/20 px-1.5 py-1 text-[11px]"
          />
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why doesn't this citation apply here?"
            rows={2}
            className="rounded border border-forest/20 px-1.5 py-1 text-[11px]"
          />
          <button
            type="button"
            disabled={!canSubmitDispute(reason, raisedBy) || submitting}
            onClick={submit}
            className="self-start rounded bg-forest px-2 py-1 text-[11px] text-lime disabled:opacity-40"
          >
            {submitting ? "Submitting…" : "Submit dispute"}
          </button>
        </div>
      )}
    </div>
  );
}
