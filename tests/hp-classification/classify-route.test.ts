import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/classify/route";

const baseMetadata = {
  sampleId: "t", externalReportNo: "t", labName: "t", customerName: "t", sampleMarking: "t",
  matrixType: "jord", samplingDate: null, receiptDate: null, originProcess: "a genuinely novel origin process",
  producerName: null, physicalState: "solid" as const, viscosity40cMm2s: null, ph: null,
  labClassificationGiven: false, labStatedEalCode: null,
};

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/classify", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/classify — customChapter validation", () => {
  it("accepts a real chapter outside the 7 curated ORIGIN_OPTIONS chapters (e.g. 05, petroleum refining)", async () => {
    const response = await POST(postRequest({ metadata: baseMetadata, results: [], customChapter: "05" }));
    expect(response.status).toBe(200);
  });

  it("still rejects a chapter code that isn't a real EAL chapter", async () => {
    const response = await POST(postRequest({ metadata: baseMetadata, results: [], customChapter: "99" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid chapter code");
  });

  it("accepts the 2-digit chapter code for a chapter ORIGIN_OPTIONS already curates at the sub-chapter level (e.g. 17)", async () => {
    // Verified empirically before writing this plan: the CURRENT code only ever validates
    // against ORIGIN_OPTIONS' 4-digit sub-chapter codes (e.g. "1701", "1705"), so a bare 2-digit
    // "17" is REJECTED today (400), even though chapter 17 is fully curated. This is the same
    // reach gap, just visible from a different angle: even a curated chapter is unreachable via
    // its own 2-digit code. After this task's fix, "17" is accepted because EAL_CHAPTERS has a
    // "17" entry.
    const response = await POST(postRequest({ metadata: baseMetadata, results: [], customChapter: "17" }));
    expect(response.status).toBe(200);
  });
});
