// tests/compliance/resolve-legal-citations.test.ts
import { describe, it, expect, vi } from "vitest";
import { resolveLegalCitations } from "@/lib/compliance/resolve-legal-citations";
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { CorrectionStore } from "@/lib/compliance/corrections";
import type { LegalParagraph } from "@/lib/compliance/types";

vi.mock("@/lib/compliance/embeddings", () => ({ embedText: vi.fn().mockResolvedValue([0.1]) }));

const p11_4: LegalParagraph = {
  id: "no-avfallsforskriften-11-4", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "11", paragraph: "4",
  text: "farlig avfall skal håndteres forsvarlig", inForce: true,
  lastVerifiedAt: new Date().toISOString(), lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
};
const p9_5: LegalParagraph = { ...p11_4, id: "no-avfallsforskriften-9-5", article: "9", paragraph: "5", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-5" };
const p9_6: LegalParagraph = { ...p11_4, id: "no-avfallsforskriften-9-6", article: "9", paragraph: "6", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-6" };
const p11_2: LegalParagraph = { ...p11_4, id: "no-avfallsforskriften-11-2", article: "11", paragraph: "2", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-2" };
const pVedlegg2: LegalParagraph = { ...p11_4, id: "no-avfallsforskriften-11-vedlegg-2", article: "11", paragraph: "vedlegg-2", sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/KAPITTEL_14-2" };

function fakeStore(rows: LegalParagraph[]): ParagraphStore {
  return {
    async findByLocation(d, a, p) { return rows.find(r => r.documentId === d && r.article === a && r.paragraph === p) ?? null; },
    async hybridSearch() { throw new Error("not used in this test"); },
    async insert() {},
  };
}

describe("resolveLegalCitations", () => {
  it("resolves eal-legal-basis (single location) to a one-element citations array", async () => {
    const store = fakeStore([p11_4]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["eal-legal-basis"]?.citations).toHaveLength(1);
    expect(result["eal-legal-basis"]?.citations[0].paragraphId).toBe("no-avfallsforskriften-11-4");
    expect(result["eal-legal-basis"]?.citations[0].primary).toBe(true);
  });

  it("resolves deponi-category-basis (two locations) to a two-element citations array, § 9-6 primary", async () => {
    const store = fakeStore([p11_4, p9_5, p9_6]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["deponi-category-basis"]?.citations).toHaveLength(2);
    const primary = result["deponi-category-basis"]?.citations.find(c => c.primary);
    expect(primary?.paragraphId).toBe("no-avfallsforskriften-9-6");
  });

  it("is all-or-nothing: if one of a multi-location field's paragraphs is missing, the whole field is null", async () => {
    // Only § 9-5 present, § 9-6 missing.
    const store = fakeStore([p11_4, p9_5]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn().mockResolvedValue(null) };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["deponi-category-basis"]).toBeNull();
  });

  it("checks dispute status independently per (paragraph, field key) within a multi-location field", async () => {
    const store = fakeStore([p11_4, p9_5, p9_6]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = {
      raise: vi.fn(),
      hasUnresolved: vi.fn().mockImplementation(
        async (paragraphId: string, fieldKey: string) =>
          paragraphId === "no-avfallsforskriften-9-6" && fieldKey === "deponi-category-basis"
      ),
    };

    const result = await resolveLegalCitations(store, source, corrections);
    const citations = result["deponi-category-basis"]?.citations ?? [];
    expect(citations.find(c => c.paragraphId === "no-avfallsforskriften-9-5")?.disputed).toBe(false);
    expect(citations.find(c => c.paragraphId === "no-avfallsforskriften-9-6")?.disputed).toBe(true);
  });

  it("the SAME paragraph disputed under one field key does not affect its citation under a DIFFERENT field key", async () => {
    const store = fakeStore([p9_6]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = {
      raise: vi.fn(),
      // § 9-6 is disputed as "deponi-category-basis" ONLY — its "hazard-indeterminate-basis" use
      // (a different RESOLVED_FIELDS key reusing the same paragraph) must show disputed: false.
      hasUnresolved: vi.fn().mockImplementation(
        async (paragraphId: string, fieldKey: string) =>
          paragraphId === "no-avfallsforskriften-9-6" && fieldKey === "deponi-category-basis"
      ),
    };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hazard-indeterminate-basis"]?.citations[0]?.disputed).toBe(false);
  });

  it("exports RESOLVED_FIELD_KEYS matching every real RESOLVED_FIELDS entry, as the single source of truth", async () => {
    const { RESOLVED_FIELD_KEYS } = await import("@/lib/compliance/resolve-legal-citations");
    expect(RESOLVED_FIELD_KEYS).toEqual(
      expect.arrayContaining(["eal-legal-basis", "deponi-category-basis", "hazard-indeterminate-basis", "hp-methodology-basis"])
    );
    expect(RESOLVED_FIELD_KEYS).toHaveLength(4);
  });

  it("resolves hazard-indeterminate-basis to § 9-6 alone (reusing the already-seeded paragraph, no new location)", async () => {
    const store = fakeStore([p9_6]); // only § 9-6 needed — no § 9-5 for this field
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hazard-indeterminate-basis"]?.citations).toHaveLength(1);
    expect(result["hazard-indeterminate-basis"]?.citations[0].paragraphId).toBe("no-avfallsforskriften-9-6");
    expect(result["hazard-indeterminate-basis"]?.citations[0].primary).toBe(true);
  });

  it("resolves hp-methodology-basis (§ 11-2 + Vedlegg 2) to a two-element citations array, § 11-2 primary", async () => {
    const store = fakeStore([p11_2, pVedlegg2]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hp-methodology-basis"]?.citations).toHaveLength(2);
    const primary = result["hp-methodology-basis"]?.citations.find(c => c.primary);
    expect(primary?.paragraphId).toBe("no-avfallsforskriften-11-2");
  });

  it("hp-methodology-basis is null when only one of § 11-2 / Vedlegg 2 is cached (all-or-nothing)", async () => {
    const store = fakeStore([p11_2]); // Vedlegg 2 missing
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn().mockResolvedValue(null) };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hp-methodology-basis"]).toBeNull();
  });

  it("hp-methodology-basis is null when § 11-2 is not cached", async () => {
    const store = fakeStore([]); // empty — § 11-2 absent
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn().mockResolvedValue(null) };
    const corrections: CorrectionStore = { raise: vi.fn(), hasUnresolved: vi.fn().mockResolvedValue(false) };

    const result = await resolveLegalCitations(store, source, corrections);
    expect(result["hp-methodology-basis"]).toBeNull();
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
    expect(result["deponi-category-basis"]).toBeNull();
  });
});
