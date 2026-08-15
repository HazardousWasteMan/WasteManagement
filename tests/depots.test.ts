import { describe, it, expect } from "vitest";
import { DEPOTS, depotIsLit } from "@/lib/depots";

describe("depots (real farlig avfall mottak data)", () => {
  it("has all 27 facilities with Norwegian coordinates", () => {
    expect(DEPOTS.length).toBe(27);
    for (const d of DEPOTS) {
      expect(d.lat).toBeGreaterThan(57);
      expect(d.lat).toBeLessThan(72);
      expect(d.lng).toBeGreaterThan(4);
      expect(d.lng).toBeLessThan(32);
    }
  });

  it("every depot has an id, name and permit URL", () => {
    for (const d of DEPOTS) {
      expect(d.id.length).toBeGreaterThan(0);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.permitUrl).toContain("norskeutslipp.no");
    }
  });

  it("a majority of depots carry permitted avfallsstoffnr codes", () => {
    const withCodes = DEPOTS.filter(d => d.codes.length > 0);
    expect(withCodes.length).toBeGreaterThanOrEqual(14);
    for (const d of withCodes) {
      for (const c of d.codes) expect(c).toMatch(/^\d{4}$/);
    }
  });

  it("never lights receivers for ordinary waste", () => {
    for (const d of DEPOTS) {
      expect(depotIsLit(d, false)).toBe(false);
      expect(depotIsLit(d, false, "7011")).toBe(false);
    }
  });

  it("without a waste code, lights every receiver for hazardous waste", () => {
    for (const d of DEPOTS) {
      expect(depotIsLit(d, true)).toBe(true);
    }
  });

  it("with a waste code, lights only receivers whose permit covers it", () => {
    const covering = DEPOTS.filter(d => d.codes.includes("7011"));
    const notCovering = DEPOTS.filter(d => !d.codes.includes("7011"));
    expect(covering.length).toBeGreaterThan(0);
    expect(notCovering.length).toBeGreaterThan(0);
    for (const d of covering) expect(depotIsLit(d, true, "7011")).toBe(true);
    for (const d of notCovering) expect(depotIsLit(d, true, "7011")).toBe(false);
  });
});
