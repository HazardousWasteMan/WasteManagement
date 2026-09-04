// lib/compliance/resolve-legal-citations.ts
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { CorrectionStore } from "@/lib/compliance/corrections";
import type { LegalCitationView } from "@/lib/compliance/citation-view";
import { buildLegalCitationView } from "@/lib/compliance/citation-view";
import { search } from "@/lib/compliance/search";

// The one field this slice grounds. Extending this to more fields is real, deliberate future
// work (Known follow-ups) — do not silently expand this list without also updating BkField's
// callers in form-map.ts.
const RESOLVED_FIELDS: { key: string; documentId: string; article: string; paragraph: string; queryText: string }[] = [
  { key: "eal-legal-basis", documentId: "avfallsforskriften", article: "11", paragraph: "4", queryText: "farlig avfall håndtering" },
];

// Resolves every field this slice grounds into a real, live-verified citation, checking dispute
// state for each. A failure anywhere in the compliance layer (Supabase down, Voyage down, a
// genuine no_match) degrades that one field to null rather than throwing — the surrounding
// extraction pipeline must never break because the compliance layer had a bad day. Callers that
// want the field's plain, uncited note (Task 3's fallback in form-map.ts) get exactly that when
// a key is null here.
export async function resolveLegalCitations(
  store: ParagraphStore,
  source: LegalSource,
  corrections: CorrectionStore
): Promise<Record<string, LegalCitationView | null>> {
  const result: Record<string, LegalCitationView | null> = {};
  for (const field of RESOLVED_FIELDS) {
    try {
      const grounded = await search(store, source, {
        queryText: field.queryText,
        documentId: field.documentId,
        article: field.article,
        paragraph: field.paragraph,
      });
      if (!grounded.paragraph) {
        result[field.key] = null;
        continue;
      }
      const disputed = await corrections.hasUnresolved(grounded.paragraph.id);
      result[field.key] = buildLegalCitationView(grounded.paragraph, disputed);
    } catch {
      // Never let a compliance-layer failure break the surrounding extraction pipeline.
      result[field.key] = null;
    }
  }
  return result;
}
