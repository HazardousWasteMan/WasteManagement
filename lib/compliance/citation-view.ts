import type { LegalParagraph } from "@/lib/compliance/types";

export interface SingleCitation {
  paragraphId: string;
  label: string;
  sourceLink: string;
  verifiedAt: string;
  disputed: boolean;
  /** The paragraph a dispute against this field anchors on — exactly one per LegalCitationView. */
  primary: boolean;
}

export interface LegalCitationView {
  citations: SingleCitation[];
}

// Real, sourced document titles for the ids this cache currently seeds. Extend as the seed
// corpus grows — never guess a title for an id not listed here, fall back to the raw documentId
// instead (see DOCUMENT_LABELS[...] ?? paragraph.documentId below).
const DOCUMENT_LABELS: Record<string, string> = {
  avfallsforskriften: "Avfallsforskriften",
};

function buildSingleCitation(paragraph: LegalParagraph, primary: boolean, disputed: boolean): SingleCitation {
  const docLabel = DOCUMENT_LABELS[paragraph.documentId] ?? paragraph.documentId;
  const label = paragraph.paragraph.startsWith("vedlegg-")
    ? `${docLabel} Vedlegg ${paragraph.paragraph.slice("vedlegg-".length)}`
    : `${docLabel} § ${paragraph.article}-${paragraph.paragraph}`;
  return {
    paragraphId: paragraph.id,
    label,
    sourceLink: paragraph.sourceLink,
    verifiedAt: paragraph.lastVerifiedAt,
    disputed,
    primary,
  };
}

// Shapes one or more cached LegalParagraphs plus their current dispute state into exactly what
// the UI needs to render an inline citation — kept as a pure function so the UI-facing shape can
// be unit tested without a live Supabase paragraph store or corrections store. A field grounded
// by a single paragraph (e.g. Checkbox10/"eal-legal-basis") passes a one-element array; a field
// grounded by more than one (e.g. Checkbox1/2/3/"deponi-category-basis", § 9-5 + § 9-6) passes
// all of them, in display order, with exactly one flagged primary.
export function buildLegalCitationView(
  paragraphs: { paragraph: LegalParagraph; primary: boolean }[],
  disputedByParagraphId: Record<string, boolean>
): LegalCitationView {
  return {
    citations: paragraphs.map(({ paragraph, primary }) =>
      buildSingleCitation(paragraph, primary, disputedByParagraphId[paragraph.id] ?? false)
    ),
  };
}
