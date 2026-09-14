import { describe, it, expect } from "vitest";
import type { LegalParagraph, GroundingTier, GroundedResult } from "@/lib/compliance/types";

describe("compliance types", () => {
  it("a LegalParagraph object satisfies the type with all required fields present", () => {
    const p: LegalParagraph = {
      id: "no-avfallsforskriften-11-4",
      source: "no",
      jurisdictionApplies: ["no"],
      documentId: "avfallsforskriften",
      article: "11",
      paragraph: "4",
      text: "example paragraph text",
      inForce: true,
      lastVerifiedAt: "2026-09-03T00:00:00.000Z",
      lastChangedAt: "2020-01-01T00:00:00.000Z",
      verificationStatus: "current",
      amendedBy: [],
      previousVersionId: null,
      humanSignedOff: false,
      sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
    };
    expect(p.source).toBe("no");
  });

  it("GroundingTier only allows the four defined tiers", () => {
    const tiers: GroundingTier[] = ["grounded_high", "grounded_stale", "derived", "no_match"];
    expect(tiers).toHaveLength(4);
  });

  it("a GroundedResult with tier no_match carries a null paragraph", () => {
    const result: GroundedResult = { tier: "no_match", paragraph: null };
    expect(result.paragraph).toBeNull();
  });
});
