// lib/compliance/resolve-legal-citations.ts
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { CorrectionStore } from "@/lib/compliance/corrections";
import type { LegalCitationView } from "@/lib/compliance/citation-view";
import { buildLegalCitationView } from "@/lib/compliance/citation-view";
import { search } from "@/lib/compliance/search";
import type { LegalParagraph } from "@/lib/compliance/types";

interface ResolvedFieldLocation {
  documentId: string;
  article: string;
  paragraph: string;
  queryText: string;
  /** Exactly one location per field must set this true — the paragraph a dispute anchors on. */
  primary?: boolean;
}

interface ResolvedFieldConfig {
  key: string;
  locations: ResolvedFieldLocation[];
}

// Every field this codebase grounds. Extending this list is real, deliberate work (see each
// plan's Known follow-ups) — do not silently expand it without also updating BkField's callers
// in form-map.ts. A field with more than one location is resolved all-or-nothing (see
// resolveLegalCitations below) — never a partial citation set.
const RESOLVED_FIELDS: ResolvedFieldConfig[] = [
  {
    key: "eal-legal-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "11", paragraph: "4", queryText: "farlig avfall håndtering", primary: true },
    ],
  },
  {
    key: "deponi-category-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "9", paragraph: "5", queryText: "kategorier av deponier" },
      { documentId: "avfallsforskriften", article: "9", paragraph: "6", queryText: "avfall som tillates deponert på de ulike deponikategoriene", primary: true },
    ],
  },
  {
    key: "hazard-indeterminate-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "9", paragraph: "6", queryText: "avfall som tillates deponert på de ulike deponikategoriene", primary: true },
    ],
  },
  {
    key: "hp-methodology-basis",
    locations: [
      { documentId: "avfallsforskriften", article: "11", paragraph: "2", queryText: "definisjon av farlig avfall HP1-HP15 vedlegg", primary: true },
      { documentId: "avfallsforskriften", article: "11", paragraph: "vedlegg-2", queryText: "kriterier som gjør avfall til farlig avfall HP1-HP15" },
    ],
  },
];

// Single source of truth for every valid dispute-scoping key — Task 4's dispute API route
// validates a caller-supplied citedFieldKey against this list, so an unrecognized/mistyped key
// is rejected rather than silently stored as an orphaned, unmatchable dispute.
export const RESOLVED_FIELD_KEYS: string[] = RESOLVED_FIELDS.map(f => f.key);

// Resolves every field this codebase grounds into a real, live-verified citation, checking
// dispute state per paragraph. A multi-location field only produces a citation once EVERY one of
// its locations resolves — a partial set could look complete when it isn't, so it's null instead.
// A failure anywhere in the compliance layer (Supabase down, Voyage down, a genuine no_match)
// degrades that field to null rather than throwing — the surrounding extraction pipeline must
// never break because the compliance layer had a bad day.
export async function resolveLegalCitations(
  store: ParagraphStore,
  source: LegalSource,
  corrections: CorrectionStore
): Promise<Record<string, LegalCitationView | null>> {
  const result: Record<string, LegalCitationView | null> = {};
  for (const field of RESOLVED_FIELDS) {
    try {
      const resolved: { paragraph: LegalParagraph; primary: boolean }[] = [];
      for (const location of field.locations) {
        const grounded = await search(store, source, {
          queryText: location.queryText,
          documentId: location.documentId,
          article: location.article,
          paragraph: location.paragraph,
        });
        if (!grounded.paragraph) {
          resolved.length = 0; // all-or-nothing: one miss invalidates the whole field
          break;
        }
        resolved.push({ paragraph: grounded.paragraph, primary: location.primary === true });
      }
      if (resolved.length !== field.locations.length) {
        result[field.key] = null;
        continue;
      }
      const disputedByParagraphId: Record<string, boolean> = {};
      for (const { paragraph } of resolved) {
        disputedByParagraphId[paragraph.id] = await corrections.hasUnresolved(paragraph.id, field.key);
      }
      result[field.key] = buildLegalCitationView(resolved, disputedByParagraphId);
    } catch {
      // Never let a compliance-layer failure break the surrounding extraction pipeline.
      result[field.key] = null;
    }
  }
  return result;
}

/**
 * Same as resolveLegalCitations, but bounded: resolution is hoisted to run once, before the
 * stream/response starts, so a hung dependency (Voyage, Lovdata, Supabase — none of which have
 * their own timeout) would otherwise stall the entire request until the route's own maxDuration
 * kills it. Racing against a short timeout that degrades to {} keeps that risk localized to this
 * one call, matching resolveLegalCitations's own contract of degrading rather than throwing.
 */
export async function resolveLegalCitationsWithTimeout(
  store: ParagraphStore,
  source: LegalSource,
  corrections: CorrectionStore,
  timeoutMs = 5000
): Promise<Record<string, LegalCitationView | null>> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      resolveLegalCitations(store, source, corrections),
      new Promise<Record<string, LegalCitationView | null>>(resolve => {
        timer = setTimeout(() => resolve({}), timeoutMs);
      }),
    ]);
  } finally {
    // Clears the timer on the fast (real-result) path so it doesn't hold an event-loop
    // reference until it fires — harmless on serverless, but avoids a dangling timer on any
    // long-lived Node process.
    clearTimeout(timer!);
  }
}
