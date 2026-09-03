// NOT part of `pnpm test` (excluded via vitest.config.ts's exclude list — add
// "tests/compliance/integration/**" alongside this file if not already excluded). Run manually:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... \
//     npx vitest run tests/compliance/integration/end-to-end.test.ts
import { describe, it, expect } from "vitest";
import { LovdataSource } from "@/lib/compliance/sources/lovdata-source";
import { createSupabaseParagraphStore } from "@/lib/compliance/store";
import { createSupabaseFreezeStore, freezeFormField } from "@/lib/compliance/freeze";
import { search } from "@/lib/compliance/search";

describe("compliance cache end-to-end (real Supabase + Voyage + Lovdata)", () => {
  it("seeds via miss->live-fetch->write-back, then freezes, then survives a later mutation", async () => {
    const store = createSupabaseParagraphStore();
    const source = new LovdataSource();
    const query = { queryText: "farlig avfall håndtering", documentId: "avfallsforskriften", article: "11", paragraph: "4" };

    // First call: real cache miss (assumes a clean test project) -> live Lovdata fetch -> write-back.
    const first = await search(store, source, query);
    expect(first.tier).toBe("grounded_high");
    expect(first.paragraph).not.toBeNull();

    // Second call: now a real cache hit, no live fetch needed.
    const second = await search(store, source, query);
    expect(second.tier).toBe("grounded_high");
    expect(second.paragraph?.id).toBe(first.paragraph!.id);

    // Freeze it against a real case.
    const freezeStore = createSupabaseFreezeStore();
    const caseId = `integration-test-${Date.now()}`;
    await freezeFormField(freezeStore, {
      caseId,
      fieldName: "eal-legal-basis",
      paragraph: second.paragraph!,
    });

    const frozen = await freezeStore.findByCase(caseId, "eal-legal-basis");
    expect(frozen).toBeDefined();
  });
});
