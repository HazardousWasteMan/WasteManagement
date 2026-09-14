import { describe, expect, it, vi } from "vitest";
import {
  boundedPageRanges, extractBoundedRanges, harmonizeSiblingAnalyticalContext,
  needsBoundedRecovery, reconcileStructuredChunks,
} from "@/lib/bk-skjema/extraction-recovery";
import { bkFromDatalab } from "@/lib/bk-skjema/from-datalab";

const extracted = (pageRange: string, data: Record<string, unknown>, costCents = 1) =>
  ({ pageRange, data, costCents, scoreAverage: null });
const row = (parameter: string, page: number, context?: string) => ({ parameter, analyte_id: "arsenic",
  verdi: 1, under_loq: false, enhet: "mg/kg TS", ...(context ? { analytical_context: context } : {}),
  verdi_citations: [`/page/${page}/Table/1`] });

describe("bounded recovery for uncertain scanned reports", () => {
  it("bounds a synthetic 41-page scanned document instead of one oversized request", () => {
    const pages = Array.from({ length: 41 }, (_, index) => index);
    const ranges = boundedPageRanges(pages);
    expect(needsBoundedRecovery(pages, {})).toBe(true);
    expect(ranges[0]).toBe("0-5");
    expect(ranges.at(-1)).toBe("35-40");
    expect(ranges.every(range => {
      const [start, end = start] = range.split("-").map(Number);
      return end - start + 1 <= 6;
    })).toBe(true);
  });

  it("reconciles repeated sample headers and continuation chunks into one explicit sample", () => {
    const groups = reconcileStructuredChunks([
      extracted("0-5", { provenummer: "SAMPLE-A", analyseresultater: [row("Arsen", 4)] }),
      extracted("5-10", { analyseresultater: [row("Bly", 6)] }),
      extracted("10-15", { provenummer: " sample-a ", analyseresultater: [row("Kadmium", 12)] }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ identity: "sample-a", requiresReview: false });
    expect(groups[0].data.analyseresultater).toHaveLength(3);
  });

  it("deduplicates only a source-cited row repeated by chunk overlap", () => {
    const duplicate = row("Arsen", 5);
    const groups = reconcileStructuredChunks([
      extracted("0-5", { provenummer: "A", analyseresultater: [duplicate] }),
      extracted("5-10", { provenummer: "A", analyseresultater: [duplicate, row("Bly", 7)] }),
    ]);
    expect(groups[0].data.analyseresultater).toHaveLength(2);
  });

  it("retries one timeout and records explicit partial failure without fabricating a negative", async () => {
    const calls = new Map<string, number>();
    const provider = vi.fn(async (range: string) => {
      calls.set(range, (calls.get(range) ?? 0) + 1);
      if (range === "0-5" && calls.get(range) === 1) throw new Error("job timed out");
      if (range === "5-10") throw new Error("provider unavailable");
      return { data: { provenummer: "A", analyseresultater: [row("Arsen", 2, "Total content")] }, costCents: 1, scoreAverage: null };
    });
    const result = await extractBoundedRanges(["0-5", "5-10"], provider);
    expect(provider).toHaveBeenCalledTimes(3);
    expect(result.chunks).toHaveLength(1);
    expect(result.failures).toEqual([{ pageRange: "5-10", attempts: 1, reason: "provider_error" }]);
  });

  it("keeps unidentified chunks separate when several explicit sample identities exist", () => {
    const groups = reconcileStructuredChunks([
      extracted("0-5", { provenummer: "A", analyseresultater: [row("Arsen", 2)] }),
      extracted("5-10", { analyseresultater: [row("Bly", 7)] }),
      extracted("10-15", { provenummer: "B", analyseresultater: [row("Kadmium", 12)] }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.every(group => group.requiresReview)).toBe(true);
  });
});

describe("sibling analytical-context consistency", () => {
  it("gives equivalent sibling tables the same role when one preserves explicit context", () => {
    const [a, b] = harmonizeSiblingAnalyticalContext([
      { totalinnhold_utfort: true, analyseresultater: [row("Arsen", 1, "Total content")] },
      { analyseresultater: [row("Arsen", 4)] },
    ]);
    const roles = [a, b].map((data, index) => bkFromDatalab(data, {}, null, undefined,
      { documentRef: "sha256:synthetic", sampleId: `sample-${index}` }).classification.measurementBoundary.measurements[0].analyticalRole);
    expect(roles).toEqual(["total_content", "total_content"]);
  });

  it("preserves separated mixed roles and leaves conflicting sibling evidence unresolved", () => {
    const [mixed, conflict] = harmonizeSiblingAnalyticalContext([
      { totalinnhold_utfort: true, analyseresultater: [row("Arsen", 1, "Total content"), row("Bly", 2, "Batch L/S 10")] },
      { totalinnhold_utfort: false, analyseresultater: [row("Arsen", 3), row("Bly", 4)] },
    ]);
    const mixedRoles = bkFromDatalab(mixed, {}, null).classification.measurementBoundary.measurements.map(m => m.analyticalRole);
    const conflictRoles = bkFromDatalab(conflict, {}, null).classification.measurementBoundary.measurements.map(m => m.analyticalRole);
    expect(mixedRoles).toEqual(["total_content", "leaching_batch"]);
    expect(conflictRoles).toEqual(["unknown", "unknown"]);
  });
});
