// tests/compliance/store.test.ts
import { describe, it, expect } from "vitest";
import type { ParagraphStore } from "@/lib/compliance/store";
import type { LegalParagraph } from "@/lib/compliance/types";

// A minimal in-memory ParagraphStore, used here to prove the interface is implementable and
// reused by tests/compliance/search.test.ts (Task 6) as a test double for live Supabase.
export function createInMemoryParagraphStore(seed: LegalParagraph[] = []): ParagraphStore {
  const rows = [...seed];
  return {
    async findByLocation(documentId, article, paragraph) {
      return rows.find(r => r.documentId === documentId && r.article === article && r.paragraph === paragraph) ?? null;
    },
    async hybridSearch(_queryEmbedding, queryText, opts) {
      return rows
        .filter(r => !opts.jurisdiction || opts.jurisdiction.includes(r.source))
        .filter(r => r.text.toLowerCase().includes(queryText.toLowerCase()))
        .slice(0, opts.limit ?? 10);
    },
    async insert(paragraph, _embedding) {
      rows.push(paragraph);
    },
  };
}

describe("ParagraphStore interface (via in-memory implementation)", () => {
  const paragraph: LegalParagraph = {
    id: "no-avfallsforskriften-11-4",
    source: "no",
    jurisdictionApplies: ["no"],
    documentId: "avfallsforskriften",
    article: "11",
    paragraph: "4",
    text: "farlig avfall skal håndteres forsvarlig",
    inForce: true,
    lastVerifiedAt: "2026-09-03T00:00:00.000Z",
    lastChangedAt: "2020-01-01T00:00:00.000Z",
    verificationStatus: "current",
    amendedBy: [],
    previousVersionId: null,
    humanSignedOff: false,
    sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
  };

  it("findByLocation finds a seeded row by exact location", async () => {
    const store = createInMemoryParagraphStore([paragraph]);
    const found = await store.findByLocation("avfallsforskriften", "11", "4");
    expect(found?.id).toBe("no-avfallsforskriften-11-4");
  });

  it("findByLocation returns null when nothing matches", async () => {
    const store = createInMemoryParagraphStore([paragraph]);
    const found = await store.findByLocation("avfallsforskriften", "99", "9");
    expect(found).toBeNull();
  });

  it("insert makes a new row findable", async () => {
    const store = createInMemoryParagraphStore([]);
    await store.insert(paragraph, [0.1, 0.2, 0.3]);
    const found = await store.findByLocation("avfallsforskriften", "11", "4");
    expect(found?.id).toBe(paragraph.id);
  });
});
