// lib/compliance/search.ts
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { GroundedResult, Jurisdiction } from "@/lib/compliance/types";
import { embedText } from "@/lib/compliance/embeddings";

export interface SearchQuery {
  queryText: string;
  documentId: string;
  article: string;
  paragraph: string;
  jurisdiction?: Jurisdiction[];
  // How old (ms) a cache hit can be before it's tagged grounded_stale instead of grounded_high.
  // NOT enforced in this slice — no real max-age value has been confirmed yet (spec §11 is an
  // open decision). A grounded_stale result is returned as-is; no live re-fetch is triggered.
  staleAfterMs?: number;
}

// Looks up one specific paragraph location. Cache hit (fresh) -> grounded_high. Cache hit (past
// staleAfterMs) -> grounded_stale, NOT re-fetched (see staleAfterMs doc above — real enforcement
// is deferred to the weekly job, spec §11). Cache miss -> live fetch via `source`, write the
// result back to `store` (the actual growth mechanism this cache exists for), then return
// grounded_high. Live fetch also returning nothing -> no_match, explicit, never a silent empty
// field.
export async function search(
  store: ParagraphStore,
  source: LegalSource,
  query: SearchQuery
): Promise<GroundedResult> {
  const cached = await store.findByLocation(query.documentId, query.article, query.paragraph);
  if (cached) {
    if (query.staleAfterMs !== undefined) {
      const ageMs = Date.now() - new Date(cached.lastVerifiedAt).getTime();
      if (ageMs > query.staleAfterMs) {
        return { tier: "grounded_stale", paragraph: cached };
      }
    }
    return { tier: "grounded_high", paragraph: cached };
  }

  const live = await source.fetchParagraph({
    documentId: query.documentId,
    article: query.article,
    paragraph: query.paragraph,
  });
  if (!live) return { tier: "no_match", paragraph: null };

  // legal_paragraphs.embedding is NOT NULL (Task 1) — every new row must carry a real
  // embedding of its own text, not the query's, so later semantic search actually finds it.
  const liveEmbedding = await embedText(live.text);
  await store.insert(live, liveEmbedding);
  return { tier: "grounded_high", paragraph: live };
}
