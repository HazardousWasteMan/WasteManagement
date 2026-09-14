"use client";
import { useState } from "react";
import type { LegalCitationView } from "@/lib/compliance/citation-view";

export function canSubmitDispute(reason: string, raisedBy: string): boolean {
  return reason.trim().length > 0 && raisedBy.trim().length > 0;
}

/**
 * Inline, non-blocking legal citation display. Trust-by-default: the citation is shown and used
 * without any approval step. The only action available is disputing it — no role gating (this
 * app has no per-user identity yet) — which posts a dispute against the citation's `primary`
 * paragraph and never edits any already-frozen record; it only ever adds a new one.
 *
 * `variant="collapsed"` renders a compact, click-to-expand indicator carrying the SAME citation
 * content as `"full"` — never a degraded or hidden version, just compact. Used for fields where
 * more than one rendered outcome shares one citation (e.g. Checkbox1/2/3), so the reasoning isn't
 * printed three times over on the unchecked outcomes.
 */
export function LegalCitationBadge({
  citation,
  onDispute,
  variant = "full",
}: {
  citation: LegalCitationView;
  onDispute: (reason: string, raisedBy: string) => Promise<void>;
  variant?: "full" | "collapsed";
}) {
  const [expanded, setExpanded] = useState(variant === "full");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [raisedBy, setRaisedBy] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [justDisputed, setJustDisputed] = useState(false);

  const disputed = citation.citations.some(c => c.disputed) || justDisputed;
  const primaryLabel = citation.citations.find(c => c.primary)?.label ?? citation.citations[0]?.label ?? "";

  async function submit() {
    if (!canSubmitDispute(reason, raisedBy)) return;
    setSubmitting(true);
    setError("");
    try {
      await onDispute(reason.trim(), raisedBy.trim());
      setJustDisputed(true);
      setOpen(false);
    } catch {
      setError("The dispute could not be saved. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (variant === "collapsed" && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 text-[11px] text-forest/40 underline decoration-dotted underline-offset-2 hover:text-forest/70"
      >
        {disputed && <span className="mr-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">disputed</span>}
        same legal basis as &ldquo;{primaryLabel}&rdquo;
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-1 text-[11px]">
      {citation.citations.map(c => (
        <div key={c.paragraphId} className="flex items-center gap-1.5">
          {c.disputed && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800" title="This citation has an unresolved dispute">
              disputed
            </span>
          )}
          <a
            href={c.sourceLink}
            target="_blank"
            rel="noreferrer"
            className="text-forest/60 underline decoration-dotted underline-offset-2 hover:text-forest"
          >
            {c.label}
          </a>
          <span className="text-forest/35">verified {new Date(c.verifiedAt).toLocaleDateString("no-NO")}</span>
        </div>
      ))}
      {!disputed && (
        <button type="button" onClick={() => setOpen(v => !v)} className="self-start text-forest/40 underline decoration-dotted hover:text-forest/70">
          I disagree
        </button>
      )}

      {error && <p role="alert" className="text-red-800">{error}</p>}
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
