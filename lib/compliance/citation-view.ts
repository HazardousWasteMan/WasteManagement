import type { LegalParagraph } from "@/lib/compliance/types";

export interface LegalCitationView {
  paragraphId: string;
  label: string;
  sourceLink: string;
  verifiedAt: string;
  disputed: boolean;
}

// Real, sourced document titles for the ids this cache currently seeds. Extend as the seed
// corpus grows (spec §10 in the Phase 1 design) — never guess a title for an id not listed here,
// fall back to the raw documentId instead (see DOCUMENT_LABELS[...] ?? paragraph.documentId
// below).
const DOCUMENT_LABELS: Record<string, string> = {
  avfallsforskriften: "Avfallsforskriften",
};

// Shapes a cached LegalParagraph plus its current dispute state into exactly what the UI needs
// to render an inline citation — kept as a pure function so the UI-facing shape can be unit
// tested without a live Supabase paragraph store or corrections store.
export function buildLegalCitationView(paragraph: LegalParagraph, disputed: boolean): LegalCitationView {
  const docLabel = DOCUMENT_LABELS[paragraph.documentId] ?? paragraph.documentId;
  return {
    paragraphId: paragraph.id,
    label: `${docLabel} § ${paragraph.article}-${paragraph.paragraph}`,
    sourceLink: paragraph.sourceLink,
    verifiedAt: paragraph.lastVerifiedAt,
    disputed,
  };
}
