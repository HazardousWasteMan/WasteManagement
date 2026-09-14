// tests/compliance/corrections.test.ts
import { describe, it, expect } from "vitest";
import type { CorrectionStore, DisputeRecord } from "@/lib/compliance/corrections";

// In-memory double, reused by tests/compliance/dispute-route.test.ts (Task 5) as a test double
// for live Supabase — same role as store.test.ts's in-memory ParagraphStore in the Phase 1 plan.
export function createInMemoryCorrectionStore(seed: DisputeRecord[] = []): CorrectionStore {
  const rows = [...seed];
  return {
    async raise(args) {
      const record: DisputeRecord = {
        id: `dispute-${rows.length + 1}`,
        freezeId: args.freezeId,
        disputedParagraphId: args.disputedParagraphId,
        raisedBy: args.raisedBy,
        raisedAt: new Date().toISOString(),
        reason: args.reason,
        resolution: null,
        correctedParagraphId: null,
        resolvedBy: null,
        resolvedAt: null,
      };
      rows.push(record);
      return record;
    },
    async hasUnresolved(paragraphId) {
      return rows.some(r => r.disputedParagraphId === paragraphId && r.resolution === null);
    },
  };
}

describe("CorrectionStore interface (via in-memory implementation)", () => {
  it("raise() creates a record with resolution null and returns it", async () => {
    const store = createInMemoryCorrectionStore();
    const record = await store.raise({
      disputedParagraphId: "no-avfallsforskriften-11-4",
      freezeId: null,
      raisedBy: "Kari Nordmann",
      reason: "This waste stream doesn't match § 11-4's scope",
    });
    expect(record.resolution).toBeNull();
    expect(record.disputedParagraphId).toBe("no-avfallsforskriften-11-4");
    expect(record.freezeId).toBeNull();
  });

  it("hasUnresolved is true right after a dispute is raised", async () => {
    const store = createInMemoryCorrectionStore();
    await store.raise({
      disputedParagraphId: "no-avfallsforskriften-11-4",
      freezeId: null,
      raisedBy: "Kari Nordmann",
      reason: "reason",
    });
    expect(await store.hasUnresolved("no-avfallsforskriften-11-4")).toBe(true);
  });

  it("hasUnresolved is false for a paragraph with no disputes at all", async () => {
    const store = createInMemoryCorrectionStore();
    expect(await store.hasUnresolved("no-avfallsforskriften-11-4")).toBe(false);
  });

  it("hasUnresolved is false once every dispute on that paragraph is resolved", async () => {
    const resolved: DisputeRecord = {
      id: "dispute-1",
      freezeId: null,
      disputedParagraphId: "no-avfallsforskriften-11-4",
      raisedBy: "Kari Nordmann",
      raisedAt: new Date().toISOString(),
      reason: "reason",
      resolution: "upheld",
      correctedParagraphId: null,
      resolvedBy: "Ola Compliance",
      resolvedAt: new Date().toISOString(),
    };
    const store = createInMemoryCorrectionStore([resolved]);
    expect(await store.hasUnresolved("no-avfallsforskriften-11-4")).toBe(false);
  });

  it("a dispute can carry a real freezeId when one already exists for the citation", async () => {
    const store = createInMemoryCorrectionStore();
    const record = await store.raise({
      disputedParagraphId: "no-avfallsforskriften-11-4",
      freezeId: "freeze-abc-123",
      raisedBy: "Kari Nordmann",
      reason: "reason",
    });
    expect(record.freezeId).toBe("freeze-abc-123");
  });
});
