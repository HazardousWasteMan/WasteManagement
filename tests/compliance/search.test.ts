// tests/compliance/search.test.ts
import { describe, it, expect, vi } from "vitest";
import { search } from "@/lib/compliance/search";
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalSource } from "@/lib/compliance/sources/legal-source";
import type { LegalParagraph } from "@/lib/compliance/types";

vi.mock("@/lib/compliance/embeddings", () => ({
  embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

function paragraph(overrides: Partial<LegalParagraph> = {}): LegalParagraph {
  return {
    id: "no-avfallsforskriften-11-4",
    source: "no",
    jurisdictionApplies: ["no"],
    documentId: "avfallsforskriften",
    article: "11",
    paragraph: "4",
    text: "farlig avfall skal håndteres forsvarlig",
    inForce: true,
    lastVerifiedAt: new Date().toISOString(),
    lastChangedAt: "2020-01-01T00:00:00.000Z",
    verificationStatus: "current",
    amendedBy: [],
    previousVersionId: null,
    humanSignedOff: false,
    sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
    ...overrides,
  };
}

function fakeStore(rows: LegalParagraph[]): ParagraphStore {
  const inserted: LegalParagraph[] = [];
  return {
    async findByLocation(documentId, article, para) {
      return rows.find(r => r.documentId === documentId && r.article === article && r.paragraph === para) ?? null;
    },
    async hybridSearch() {
      return rows;
    },
    async insert(p, embedding) {
      inserted.push(p);
      expect(embedding).toEqual([0.1, 0.2, 0.3]); // proves search() computed an embedding before insert
      rows.push(p);
    },
  };
}

describe("search", () => {
  it("returns grounded_high for a fresh hit", async () => {
    const store = fakeStore([paragraph()]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };

    const result = await search(store, source, {
      queryText: "farlig avfall",
      documentId: "avfallsforskriften",
      article: "11",
      paragraph: "4",
    });

    expect(result.tier).toBe("grounded_high");
    expect(result.paragraph?.id).toBe("no-avfallsforskriften-11-4");
    expect(source.fetchParagraph).not.toHaveBeenCalled();
  });

  it("returns grounded_stale for a hit past staleAfterMs, WITHOUT calling the live adapter", async () => {
    const stale = paragraph({ lastVerifiedAt: new Date(Date.now() - 1000 * 60 * 60).toISOString() });
    const store = fakeStore([stale]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn() };

    const result = await search(store, source, {
      queryText: "farlig avfall",
      documentId: "avfallsforskriften",
      article: "11",
      paragraph: "4",
      staleAfterMs: 1000 * 60, // 1 minute — the seeded row is older than this
    });

    expect(result.tier).toBe("grounded_stale");
    expect(result.paragraph?.id).toBe(stale.id);
    expect(source.fetchParagraph).not.toHaveBeenCalled(); // staleness is NOT enforced in this slice
  });

  it("on a genuine miss, calls the live adapter, writes the result to the store, and returns grounded_high", async () => {
    const store = fakeStore([]);
    const liveResult = paragraph({ id: "no-avfallsforskriften-11-4" });
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn().mockResolvedValue(liveResult) };

    const result = await search(store, source, {
      queryText: "farlig avfall",
      documentId: "avfallsforskriften",
      article: "11",
      paragraph: "4",
    });

    expect(source.fetchParagraph).toHaveBeenCalledWith({
      documentId: "avfallsforskriften",
      article: "11",
      paragraph: "4",
    });
    expect(result.tier).toBe("grounded_high");
    expect(result.paragraph?.id).toBe(liveResult.id);
    // proves the write-back half of the growth mechanism, not just the read
    const written = await store.findByLocation("avfallsforskriften", "11", "4");
    expect(written).not.toBeNull();
  });

  it("returns no_match when neither the cache nor the live adapter has the paragraph", async () => {
    const store = fakeStore([]);
    const source: LegalSource = { source: "no", fetchParagraph: vi.fn().mockResolvedValue(null) };

    const result = await search(store, source, {
      queryText: "nonexistent",
      documentId: "avfallsforskriften",
      article: "999",
      paragraph: "999",
    });

    expect(result.tier).toBe("no_match");
    expect(result.paragraph).toBeNull();
  });
});
