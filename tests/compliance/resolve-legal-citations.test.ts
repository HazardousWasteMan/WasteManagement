// tests/compliance/resolve-legal-citations.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveLegalCitations } from "@/lib/compliance/resolve-legal-citations";
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { CorrectionStore } from "@/lib/compliance/corrections";
import type { LegalParagraph } from "@/lib/compliance/types";

vi.mock("@/lib/compliance/embeddings", () => ({ embedText: vi.fn().mockResolvedValue([0.1]) }));

const paragraph: LegalParagraph = {
  id: "no-avfallsforskriften-11-4", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "11", paragraph: "4",
  text: "farlig avfall skal håndteres forsvarlig", inForce: true,
  lastVerifiedAt: new Date().toISOString(), lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
};

function fakeStore(rows: LegalParagraph[]): ParagraphStore {
  return {
    async findByLocation(d, a, p) { return rows.find(r => r.documentId === d && r.article === a && r.paragraph === p) ?? null; },
    async hybridSearch() { throw new Error("not used in this test"); },
    async insert() {},
  };
}

describe("resolveLegalCitations", () => {
  it("resolves eal-legal-basis to the seeded § 11-4 citation, not disputed, on a cache hit", async () => {
    const store = fakeStore([paragraph]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["eal-legal-basis"]?.citations[0]?.paragraphId).toBe("no-avfallsforskriften-11-4");
    expect(result["eal-legal-basis"]?.citations[0]?.disputed).toBe(false);
  });

  it("marks the citation disputed when CorrectionStore reports an unresolved dispute", async () => {
    const store = fakeStore([paragraph]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(true) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["eal-legal-basis"]?.citations[0]?.disputed).toBe(true);
  });

  it("returns eal-legal-basis: null, never throws, when the underlying search fails", async () => {
    const store: ParagraphStore = {
      async findByLocation() { throw new Error("supabase unreachable"); },
      async hybridSearch() { throw new Error("not used"); },
      async insert() {},
    };
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn() };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["eal-legal-basis"]).toBeNull();
  });
});
