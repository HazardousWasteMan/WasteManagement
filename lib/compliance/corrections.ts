// lib/compliance/corrections.ts
import { createClient } from "@supabase/supabase-js";

export interface DisputeRecord {
  id: string;
  freezeId: string | null;
  disputedParagraphId: string;
  raisedBy: string;
  raisedAt: string;
  reason: string;
  resolution: "upheld" | "corrected" | null;
  correctedParagraphId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface CorrectionStore {
  raise(args: {
    disputedParagraphId: string;
    freezeId: string | null;
    raisedBy: string;
    reason: string;
  }): Promise<DisputeRecord>;
  hasUnresolved(paragraphId: string): Promise<boolean>;
}

interface Row {
  id: string;
  freeze_id: string | null;
  disputed_paragraph_id: string;
  raised_by: string;
  raised_at: string;
  reason: string;
  resolution: DisputeRecord["resolution"];
  corrected_paragraph_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

function rowToRecord(row: Row): DisputeRecord {
  return {
    id: row.id,
    freezeId: row.freeze_id,
    disputedParagraphId: row.disputed_paragraph_id,
    raisedBy: row.raised_by,
    raisedAt: row.raised_at,
    reason: row.reason,
    resolution: row.resolution,
    correctedParagraphId: row.corrected_paragraph_id,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
  };
}

export function createSupabaseCorrectionStore(): CorrectionStore {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  const client = createClient(url, key);

  return {
    async raise(args) {
      const { data, error } = await client
        .from("compliance_corrections")
        .insert({
          freeze_id: args.freezeId,
          disputed_paragraph_id: args.disputedParagraphId,
          raised_by: args.raisedBy,
          reason: args.reason,
        } as never)
        .select()
        .single();
      if (error) throw new Error(`raise dispute failed: ${error.message}`);
      return rowToRecord(data as Row);
    },

    async hasUnresolved(paragraphId) {
      const { data, error } = await client
        .from("compliance_corrections")
        .select("id")
        .eq("disputed_paragraph_id", paragraphId)
        .is("resolution", null)
        .limit(1);
      if (error) throw new Error(`hasUnresolved check failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}
