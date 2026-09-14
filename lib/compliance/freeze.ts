import { createClient } from "@supabase/supabase-js";
import type { FormFreeze, LegalParagraph } from "@/lib/compliance/types";

export interface FreezeStore {
  save(freeze: FormFreeze): Promise<void>;
  findByCase(caseId: string, fieldName: string): Promise<FormFreeze | null>;
}

// Writes an immutable copy of the paragraph's text/version/link AT THIS MOMENT — the fields below
// are copied by value into a new FormFreeze object, so a later mutation of the caller's
// `paragraph` reference (e.g. the cache being updated in place elsewhere) can never retroactively
// alter an already-frozen record. This is the one behavior spec §8 exists to guarantee.
export function buildFormFreeze(args: {caseId: string; fieldName: string; paragraph: LegalParagraph}, frozenAt = new Date().toISOString()): FormFreeze {
  return {
    id: crypto.randomUUID(), caseId: args.caseId, fieldName: args.fieldName,
    citedParagraphId: args.paragraph.id, paragraphTextAtFreeze: args.paragraph.text,
    lastVerifiedAtAtFreeze: args.paragraph.lastVerifiedAt, sourceLinkAtFreeze: args.paragraph.sourceLink, frozenAt,
  };
}

export async function freezeFormField(
  store: FreezeStore,
  args: { caseId: string; fieldName: string; paragraph: LegalParagraph }
): Promise<FormFreeze> {
  const freeze = buildFormFreeze(args);
  await store.save(freeze);
  return freeze;
}

export function createSupabaseFreezeStore(): FreezeStore {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  const client = createClient(url, key);

  return {
    async save(freeze) {
      const { error } = await client.from("compliance_form_freezes").insert({
        id: freeze.id,
        case_id: freeze.caseId,
        field_name: freeze.fieldName,
        cited_paragraph_id: freeze.citedParagraphId,
        paragraph_text_at_freeze: freeze.paragraphTextAtFreeze,
        last_verified_at_at_freeze: freeze.lastVerifiedAtAtFreeze,
        source_link_at_freeze: freeze.sourceLinkAtFreeze,
        frozen_at: freeze.frozenAt,
      } as never);
      if (error) throw new Error(`freeze save failed: ${error.message}`);
    },
    async findByCase(caseId, fieldName) {
      const { data, error } = await client
        .from("compliance_form_freezes")
        .select("*")
        .eq("case_id", caseId)
        .eq("field_name", fieldName)
        .maybeSingle();
      if (error) throw new Error(`freeze lookup failed: ${error.message}`);
      if (!data) return null;
      const row = data as {
        id: string; case_id: string; field_name: string; cited_paragraph_id: string;
        paragraph_text_at_freeze: string; last_verified_at_at_freeze: string;
        source_link_at_freeze: string; frozen_at: string;
      };
      return {
        id: row.id,
        caseId: row.case_id,
        fieldName: row.field_name,
        citedParagraphId: row.cited_paragraph_id,
        paragraphTextAtFreeze: row.paragraph_text_at_freeze,
        lastVerifiedAtAtFreeze: row.last_verified_at_at_freeze,
        sourceLinkAtFreeze: row.source_link_at_freeze,
        frozenAt: row.frozen_at,
      };
    },
  };
}
