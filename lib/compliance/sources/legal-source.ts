// lib/compliance/sources/legal-source.ts
import type { Jurisdiction, LegalParagraph } from "@/lib/compliance/types";

export interface LegalSourceQuery {
  documentId: string;
  article: string;
  paragraph: string;
}

// Shared contract for a live legal-text source. This slice has one implementation
// (LovdataSource); a future EUR-Lex/CELLAR implementation (Phase 1, not this slice) implements
// the same interface so lib/compliance/search.ts's live-fallback stays source-agnostic.
export interface LegalSource {
  readonly source: Jurisdiction;
  fetchParagraph(query: LegalSourceQuery): Promise<LegalParagraph | null>;
}
