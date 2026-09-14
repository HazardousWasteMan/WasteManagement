import { resolveLegalCitationsWithTimeout } from "@/lib/compliance/resolve-legal-citations";
import { LovdataSource } from "@/lib/compliance/sources/lovdata-source";
import { createSupabaseParagraphStore } from "@/lib/compliance/store";
import { createSupabaseCorrectionStore } from "@/lib/compliance/corrections";
import type { LegalCitationView } from "@/lib/compliance/citation-view";

/** Same bounded, once-per-bundle resolution for standalone Data Lab and project intake.
 * Legal-service outages retain existing fallback notes; no new compliance decision logic. */
export async function resolveBundleLegalCitations(): Promise<Record<string, LegalCitationView | null>> {
  try {
    return await resolveLegalCitationsWithTimeout(createSupabaseParagraphStore(), new LovdataSource(), createSupabaseCorrectionStore());
  } catch (error) {
    console.error("Legal citation resolution failed, keeping fallback notes:", error);
    return {};
  }
}
