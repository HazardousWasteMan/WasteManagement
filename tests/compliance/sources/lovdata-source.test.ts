import { describe, it, expect, vi, beforeEach } from "vitest";
import { LovdataSource } from "@/lib/compliance/sources/lovdata-source";
import * as archive from "@/lib/compliance/sources/lovdata-archive";

describe("LovdataSource", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has source 'no'", () => {
    const src = new LovdataSource();
    expect(src.source).toBe("no");
  });

  it("returns a normalized LegalParagraph when the archive contains the requested paragraph", async () => {
    vi.spyOn(archive, "getParagraphFromArchive").mockResolvedValue({
      text: "Avfallsforskriften § 11-4 example paragraph text.",
      lastChangedAt: "2020-01-01T00:00:00.000Z",
      sourceLink: "https://lovdata.no/forskrift/2004-06-01-930/§11-4",
    });

    const src = new LovdataSource();
    const result = await src.fetchParagraph({
      documentId: "avfallsforskriften",
      article: "11",
      paragraph: "4",
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("no");
    expect(result!.documentId).toBe("avfallsforskriften");
    expect(result!.article).toBe("11");
    expect(result!.paragraph).toBe("4");
    expect(result!.text).toContain("example paragraph text");
    expect(result!.jurisdictionApplies).toEqual(["no"]);
    expect(result!.verificationStatus).toBe("current");
    expect(result!.id).toBe("no-avfallsforskriften-11-4");
  });

  it("returns null when the archive has no matching paragraph, never a fabricated result", async () => {
    vi.spyOn(archive, "getParagraphFromArchive").mockResolvedValue(null);

    const src = new LovdataSource();
    const result = await src.fetchParagraph({
      documentId: "avfallsforskriften",
      article: "999",
      paragraph: "999",
    });

    expect(result).toBeNull();
  });
});
