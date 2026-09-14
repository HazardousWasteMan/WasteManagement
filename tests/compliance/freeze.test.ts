import { describe, it, expect } from "vitest";
import { freezeFormField, type FreezeStore } from "@/lib/compliance/freeze";
import type { FormFreeze, LegalParagraph } from "@/lib/compliance/types";

function createInMemoryFreezeStore(): FreezeStore {
  const rows: FormFreeze[] = [];
  return {
    async save(freeze) {
      rows.push(freeze);
    },
    async findByCase(caseId, fieldName) {
      return rows.find(r => r.caseId === caseId && r.fieldName === fieldName) ?? null;
    },
  };
}

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

describe("freezeFormField", () => {
  it("saves an immutable freeze record carrying the paragraph's text/version/link at freeze time", async () => {
    const store = createInMemoryFreezeStore();
    const freeze = await freezeFormField(store, { caseId: "case-1", fieldName: "eal-legal-basis", paragraph });

    expect(freeze.caseId).toBe("case-1");
    expect(freeze.citedParagraphId).toBe(paragraph.id);
    expect(freeze.paragraphTextAtFreeze).toBe(paragraph.text);
    expect(freeze.lastVerifiedAtAtFreeze).toBe(paragraph.lastVerifiedAt);
    expect(freeze.sourceLinkAtFreeze).toBe(paragraph.sourceLink);
  });

  it("PROVES freeze integrity: a later mutation to the source paragraph object does not change an already-saved freeze", async () => {
    const store = createInMemoryFreezeStore();
    const mutableParagraph: LegalParagraph = { ...paragraph };
    await freezeFormField(store, { caseId: "case-2", fieldName: "eal-legal-basis", paragraph: mutableParagraph });

    // Simulate the cache being updated later (spec §5: content actually changed).
    mutableParagraph.text = "UPDATED TEXT — should never appear in the frozen record";
    mutableParagraph.lastVerifiedAt = "2099-01-01T00:00:00.000Z";

    const frozen = await store.findByCase("case-2", "eal-legal-basis");
    expect(frozen?.paragraphTextAtFreeze).toBe("farlig avfall skal håndteres forsvarlig");
    expect(frozen?.lastVerifiedAtAtFreeze).toBe("2026-09-03T00:00:00.000Z");
  });
});
