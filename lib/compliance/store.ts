// lib/compliance/store.ts
import { createClient } from "@supabase/supabase-js";
import type { Jurisdiction, LegalParagraph } from "@/lib/compliance/types";

export interface ParagraphStore {
  findByLocation(documentId: string, article: string, paragraph: string): Promise<LegalParagraph | null>;
  hybridSearch(
    queryEmbedding: number[],
    queryText: string,
    opts: { jurisdiction?: Jurisdiction[]; limit?: number }
  ): Promise<LegalParagraph[]>;
  // embedding is a required second argument, not read off `paragraph` — legal_paragraphs.embedding
  // is NOT NULL (Task 1), so every caller must have already computed one via embedText.
  insert(paragraph: LegalParagraph, embedding: number[]): Promise<void>;
}

interface Row {
  id: string;
  source: Jurisdiction;
  jurisdiction_applies: string[];
  document_id: string;
  article: string;
  paragraph: string;
  text: string;
  in_force: boolean;
  last_verified_at: string;
  last_changed_at: string;
  verification_status: LegalParagraph["verificationStatus"];
  amended_by: string[];
  previous_version_id: string | null;
  human_signed_off: boolean;
  source_link: string;
}

function rowToParagraph(row: Row): LegalParagraph {
  return {
    id: row.id,
    source: row.source,
    jurisdictionApplies: row.jurisdiction_applies,
    documentId: row.document_id,
    article: row.article,
    paragraph: row.paragraph,
    text: row.text,
    inForce: row.in_force,
    lastVerifiedAt: row.last_verified_at,
    lastChangedAt: row.last_changed_at,
    verificationStatus: row.verification_status,
    amendedBy: row.amended_by,
    previousVersionId: row.previous_version_id,
    humanSignedOff: row.human_signed_off,
    sourceLink: row.source_link,
  };
}

function paragraphToRow(p: LegalParagraph, embedding: number[]): Row & { embedding: number[] } {
  return {
    id: p.id,
    source: p.source,
    jurisdiction_applies: p.jurisdictionApplies,
    document_id: p.documentId,
    article: p.article,
    paragraph: p.paragraph,
    text: p.text,
    in_force: p.inForce,
    last_verified_at: p.lastVerifiedAt,
    last_changed_at: p.lastChangedAt,
    verification_status: p.verificationStatus,
    amended_by: p.amendedBy,
    previous_version_id: p.previousVersionId,
    human_signed_off: p.humanSignedOff,
    source_link: p.sourceLink,
    embedding,
  };
}

export function createSupabaseParagraphStore(): ParagraphStore {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  const client = createClient(url, key);

  return {
    async findByLocation(documentId, article, paragraph) {
      const { data, error } = await client
        .from("legal_paragraphs")
        .select("*")
        .eq("document_id", documentId)
        .eq("article", article)
        .eq("paragraph", paragraph)
        .maybeSingle();
      if (error) throw new Error(`findByLocation failed: ${error.message}`);
      return data ? rowToParagraph(data as Row) : null;
    },

    async hybridSearch(_queryEmbedding, _queryText, _opts) {
      // Real cosine-distance ANN search needs a Postgres RPC function (`match_legal_paragraphs`)
      // — supabase-js has no native "<->" operator, and there is no such function in the
      // migrations yet:
      //   create function match_legal_paragraphs(query_embedding vector(1024), match_count int)
      //   returns setof legal_paragraphs language sql as $$
      //     select * from legal_paragraphs order by embedding <-> query_embedding limit match_count;
      //   $$;
      // A prior version of this method used `.order("embedding", ...)` as a placeholder, but
      // that is not a real ANN query — it silently returns rows in an arbitrary,
      // semantically-meaningless order. This module's whole design principle is "never
      // fabricate, never silently gap", so we throw instead of returning wrong-looking-right
      // results. Add the RPC function above in a follow-up migration and call it here via
      // client.rpc(...) before this method is used against real data.
      throw new Error(
        "hybridSearch is not yet implemented — requires a match_legal_paragraphs Postgres RPC " +
        "function for real cosine-distance ANN search (see docs/superpowers/plans/2026-09-03-" +
        "compliance-cache-phase1-slice.md, Known follow-ups #1). The current .order() approach " +
        "does not perform real vector search and was removed rather than left silently wrong."
      );
    },

    async insert(paragraph, embedding) {
      const { error } = await client.from("legal_paragraphs").insert(paragraphToRow(paragraph, embedding) as never);
      if (error) throw new Error(`insert failed: ${error.message}`);
    },
  };
}
