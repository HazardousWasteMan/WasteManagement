import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/compliance/disputes/route";
import * as corrections from "@/lib/compliance/corrections";

function req(body: unknown) {
  return new Request("http://localhost/api/compliance/disputes", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/compliance/disputes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns 400 when a required field is missing", async () => {
    const res = await POST(req({ paragraphId: "no-avfallsforskriften-11-4" }) as never);
    expect(res.status).toBe(400);
  });

  it("raises a dispute and returns it as JSON on success", async () => {
    vi.spyOn(corrections, "createSupabaseCorrectionStore").mockReturnValue({
      raise: vi.fn().mockResolvedValue({
        id: "dispute-1", freezeId: null, disputedParagraphId: "no-avfallsforskriften-11-4",
        raisedBy: "Kari Nordmann", raisedAt: "2026-09-04T00:00:00.000Z",
        reason: "doesn't apply", resolution: null, correctedParagraphId: null,
        resolvedBy: null, resolvedAt: null,
      }),
      hasUnresolved: vi.fn(),
    });

    const res = await POST(req({
      paragraphId: "no-avfallsforskriften-11-4", freezeId: null,
      raisedBy: "Kari Nordmann", reason: "doesn't apply",
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("dispute-1");
    expect(body.disputedParagraphId).toBe("no-avfallsforskriften-11-4");
  });

  it("returns 500 with a clear error when the store throws, never a fabricated success", async () => {
    vi.spyOn(corrections, "createSupabaseCorrectionStore").mockReturnValue({
      raise: vi.fn().mockRejectedValue(new Error("db unreachable")),
      hasUnresolved: vi.fn(),
    });

    const res = await POST(req({
      paragraphId: "no-avfallsforskriften-11-4", freezeId: null,
      raisedBy: "Kari Nordmann", reason: "doesn't apply",
    }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("db unreachable");
  });
});
