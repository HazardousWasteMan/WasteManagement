import { describe, it, expect } from "vitest";
import { buildSeedLocations } from "@/scripts/seed-lovdata";

describe("buildSeedLocations", () => {
  it("returns at least the § 11-4 hazardous-waste-handling location for Avfallsforskriften", () => {
    const locations = buildSeedLocations("avfallsforskriften");
    expect(locations).toContainEqual({ documentId: "avfallsforskriften", article: "11", paragraph: "4" });
  });

  it("also returns § 9-5 and § 9-6 for the landfill-category citation", () => {
    const locations = buildSeedLocations("avfallsforskriften");
    expect(locations).toContainEqual({ documentId: "avfallsforskriften", article: "9", paragraph: "5" });
    expect(locations).toContainEqual({ documentId: "avfallsforskriften", article: "9", paragraph: "6" });
  });

  it("every location has a non-empty article and paragraph", () => {
    const locations = buildSeedLocations("avfallsforskriften");
    for (const loc of locations) {
      expect(loc.article.length).toBeGreaterThan(0);
      expect(loc.paragraph.length).toBeGreaterThan(0);
    }
  });
});
