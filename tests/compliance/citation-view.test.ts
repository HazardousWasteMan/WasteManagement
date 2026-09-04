import { describe, it, expect } from "vitest";
import { buildLegalCitationView } from "@/lib/compliance/citation-view";
import type { LegalParagraph } from "@/lib/compliance/types";

const paragraph: LegalParagraph = {
  id: "no-avfallsforskriften-11-4",
  source: "no",
  jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften",
  article: "11",
  paragraph: "4",
  text: "farlig avfall skal håndteres forsvarlig",
  inForce: true,
  lastVerifiedAt: "2026-09-03T19:26:14.030Z",
  lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current",
  amendedBy: [],
  previousVersionId: null,
  humanSignedOff: false,
  sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
};

describe("buildLegalCitationView", () => {
  it("builds a human-readable label from a known document id", () => {
    const view = buildLegalCitationView(paragraph, false);
    expect(view.label).toBe("Avfallsforskriften § 11-4");
  });

  it("falls back to the raw documentId when it isn't in the known label map", () => {
    const unknownDoc: LegalParagraph = { ...paragraph, documentId: "some-future-forskrift", article: "3", paragraph: "1" };
    const view = buildLegalCitationView(unknownDoc, false);
    expect(view.label).toBe("some-future-forskrift § 3-1");
  });

  it("passes through paragraphId, sourceLink, and verifiedAt unchanged", () => {
    const view = buildLegalCitationView(paragraph, false);
    expect(view.paragraphId).toBe("no-avfallsforskriften-11-4");
    expect(view.sourceLink).toBe("https://lovdata.no/forskrift/2004-06-01-930/§11-4");
    expect(view.verifiedAt).toBe("2026-09-03T19:26:14.030Z");
  });

  it("carries the disputed flag through exactly as passed", () => {
    expect(buildLegalCitationView(paragraph, true).disputed).toBe(true);
    expect(buildLegalCitationView(paragraph, false).disputed).toBe(false);
  });
});
