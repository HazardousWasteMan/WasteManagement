import { createClient } from "@supabase/supabase-js";

// Shared by every lib/compliance/*-store.ts factory -- corrections.ts, freeze.ts,
// and store.ts each used to inline this same env-read + validation + createClient
// call.
export function createComplianceSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  return createClient(url, key);
}
