import { describe, it, expect } from "vitest";
import { buildLegalCitationView } from "@/lib/compliance/citation-view";
import type { LegalParagraph } from "@/lib/compliance/types";

const paragraph9_5: LegalParagraph = {
  id: "no-avfallsforskriften-9-5", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "9", paragraph: "5",
  text: "Deponier deles inn i følgende kategorier...", inForce: true,
  lastVerifiedAt: "2026-09-04T00:00:00.000Z", lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-5",
};

const paragraph9_6: LegalParagraph = {
  id: "no-avfallsforskriften-9-6", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "9", paragraph: "6",
  text: "Avfall som tillates deponert på de ulike deponikategoriene...", inForce: true,
  lastVerifiedAt: "2026-09-04T00:00:00.000Z", lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§9-6",
};

const vedlegg2: LegalParagraph = {
  id: "no-avfallsforskriften-11-vedlegg-2", source: "no", jurisdictionApplies: ["no"],
  documentId: "avfallsforskriften", article: "11", paragraph: "vedlegg-2",
  text: "Vedlegget skal benyttes for avfallstyper...", inForce: true,
  lastVerifiedAt: "2026-09-06T00:00:00.000Z", lastChangedAt: "2020-01-01T00:00:00.000Z",
  verificationStatus: "current", amendedBy: [], previousVersionId: null,
  humanSignedOff: false, sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/KAPITTEL_14-2",
};

describe("buildLegalCitationView", () => {
  it("builds one SingleCitation per paragraph, in the order given", () => {
    const view = buildLegalCitationView(
      [{ paragraph: paragraph9_5, primary: false }, { paragraph: paragraph9_6, primary: true }],
      {}
    );
    expect(view.citations).toHaveLength(2);
    expect(view.citations[0].label).toBe("Avfallsforskriften § 9-5");
    expect(view.citations[1].label).toBe("Avfallsforskriften § 9-6");
  });

  it("falls back to the raw documentId when it isn't in the known label map", () => {
    const unknownDoc: LegalParagraph = { ...paragraph9_5, documentId: "some-future-forskrift", article: "3", paragraph: "1" };
    const view = buildLegalCitationView([{ paragraph: unknownDoc, primary: true }], {});
    expect(view.citations[0].label).toBe("some-future-forskrift § 3-1");
  });

  it("passes through paragraphId, sourceLink, and verifiedAt unchanged per citation", () => {
    const view = buildLegalCitationView([{ paragraph: paragraph9_6, primary: true }], {});
    expect(view.citations[0].paragraphId).toBe("no-avfallsforskriften-9-6");
    expect(view.citations[0].sourceLink).toBe("https://lovdata.no/forskrift/2004-06-01-930/§9-6");
    expect(view.citations[0].verifiedAt).toBe("2026-09-04T00:00:00.000Z");
  });

  it("marks exactly the citation flagged primary, and no other, as primary", () => {
    const view = buildLegalCitationView(
      [{ paragraph: paragraph9_5, primary: false }, { paragraph: paragraph9_6, primary: true }],
      {}
    );
    expect(view.citations[0].primary).toBe(false);
    expect(view.citations[1].primary).toBe(true);
  });

  it("looks up disputed status per paragraph id from the provided map, defaulting to false", () => {
    const view = buildLegalCitationView(
      [{ paragraph: paragraph9_5, primary: false }, { paragraph: paragraph9_6, primary: true }],
      { "no-avfallsforskriften-9-6": true }
    );
    expect(view.citations[0].disputed).toBe(false);
    expect(view.citations[1].disputed).toBe(true);
  });

  it("a single-paragraph field (e.g. eal-legal-basis) is a one-element citations array", () => {
    const view = buildLegalCitationView([{ paragraph: paragraph9_5, primary: true }], {});
    expect(view.citations).toHaveLength(1);
    expect(view.citations[0].primary).toBe(true);
  });

  it("renders a vedlegg-shaped paragraph as 'Vedlegg <label>', not '§ 11-vedlegg-2'", () => {
    const view = buildLegalCitationView([{ paragraph: vedlegg2, primary: false }], {});
    expect(view.citations[0].label).toBe("Avfallsforskriften kap. 11 Vedlegg 2");
  });

  it("still renders an ordinary paragraph's label unchanged, regression coverage", () => {
    const view = buildLegalCitationView([{ paragraph: paragraph9_6, primary: true }], {});
    expect(view.citations[0].label).toBe("Avfallsforskriften § 9-6");
  });
});
