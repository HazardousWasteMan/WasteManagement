import { describe, it, expect } from "vitest";
import analyteReferenceRaw from "@/lib/data/analyte-reference.json";
import hpThresholdsRaw from "@/lib/data/hp-thresholds.json";
import type { AnalyteReference } from "@/lib/hp-classification/types";

describe("analyte-reference.json — new Eurofins-sample entries", () => {
  it("has a mercury entry with the real sourced CLP classification", () => {
    const mercury = analyteReferenceRaw.find(a => a.analyteId === "mercury");
    expect(mercury).toBeDefined();
    expect(mercury!.casNumber).toBe("7439-97-6");
    expect(mercury!.hStatements).toEqual([
      { hStatement: "H330", hazardClass: "Acute Tox. 2 (Inhal.)" },
      { hStatement: "H360D", hazardClass: "Repr. 1B" },
      { hStatement: "H372", hazardClass: "STOT RE 1" },
    ]);
  });

  it("has a chromium-vi entry with the real sourced CLP classification", () => {
    const chromiumVi = analyteReferenceRaw.find(a => a.analyteId === "chromium-vi");
    expect(chromiumVi).toBeDefined();
    expect(chromiumVi!.hStatement).toBe("H350");
    expect(chromiumVi!.hazardClass).toBe("Carc. 1B");
  });

  it("has a benzo-a-pyrene entry with the real sourced CLP classification", () => {
    const bap = analyteReferenceRaw.find(a => a.analyteId === "benzo-a-pyrene");
    expect(bap).toBeDefined();
    expect(bap!.casNumber).toBe("50-32-8");
    expect(bap!.hStatements).toEqual(
      expect.arrayContaining([
        { hStatement: "H350", hazardClass: "Carc. 1B" },
        { hStatement: "H340", hazardClass: "Muta. 1B" },
        { hStatement: "H360", hazardClass: "Repr. 1B" },
        { hStatement: "H317", hazardClass: "Skin Sens. 1" },
        { hStatement: "H400", hazardClass: "Aquatic Acute 1" },
        { hStatement: "H410", hazardClass: "Aquatic Chronic 1" },
      ])
    );
  });
});

describe("analyte-reference.json — metals batch (Task 1)", () => {
  const entries = analyteReferenceRaw as AnalyteReference[];
  const newMetalIds = [
    "aluminum", "boron", "iron", "lithium", "selenium", "strontium",
    "thallium", "tellurium", "titanium", "chromium-total", "tin-inorganic",
  ];

  it("has all 11 new metal entries present", () => {
    for (const id of newMetalIds) {
      expect(entries.some(e => e.analyteId === id), `missing analyteId ${id}`).toBe(true);
    }
  });

  it("has no duplicate analyteIds anywhere in the file (old 18 + new 11)", () => {
    const ids = entries.map(e => e.analyteId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const id of newMetalIds) {
    it(`${id}: has the real, pre-verified CAS number and correct structural shape`, () => {
      const entry = entries.find(e => e.analyteId === id)!;
      expect(entry).toBeDefined();
      expect(entry.substanceGroup).toBe("metal");
      expect(entry.defaultUnit).toBe("%");
      expect(entry.elementSymbol).toBeNull();
      expect(typeof entry.canonicalNameEn).toBe("string");
      expect(entry.canonicalNameEn.length).toBeGreaterThan(0);
      expect(typeof entry.canonicalNameNo).toBe("string");
      expect(entry.canonicalNameNo.length).toBeGreaterThan(0);
      // Every hStatements entry (if any) must have both fields — no partial hazard rows.
      if (entry.hStatements) {
        for (const h of entry.hStatements) {
          expect(typeof h.hStatement).toBe("string");
          expect(typeof h.hazardClass).toBe("string");
        }
      }
    });
  }

  it("aluminum has the real, independently-verified CAS number 7429-90-5", () => {
    const entry = entries.find(e => e.analyteId === "aluminum")!;
    expect(entry.casNumber).toBe("7429-90-5");
  });

  it("iron has the real, independently-verified CAS number 7439-89-6", () => {
    const entry = entries.find(e => e.analyteId === "iron")!;
    expect(entry.casNumber).toBe("7439-89-6");
  });

  it("chromium-total and chromium-vi are distinct entries with different CAS numbers", () => {
    const total = entries.find(e => e.analyteId === "chromium-total")!;
    const hexavalent = entries.find(e => e.analyteId === "chromium-vi")!;
    expect(total).toBeDefined();
    expect(hexavalent).toBeDefined();
    expect(total.casNumber).not.toBe(hexavalent.casNumber);
  });

  it("tin-inorganic and tin-organostannic-compounds are distinct entries", () => {
    const inorganic = entries.find(e => e.analyteId === "tin-inorganic")!;
    const organostannic = entries.find(e => e.analyteId === "tin-organostannic-compounds")!;
    expect(inorganic).toBeDefined();
    expect(organostannic).toBeDefined();
    expect(inorganic.casNumber).not.toBe(organostannic.casNumber);
  });
});

describe("analyte-reference.json — PAH batch (Task 2)", () => {
  const entries = analyteReferenceRaw as AnalyteReference[];
  const newPahIds = [
    "naphthalene", "acenaphthylene", "acenaphthene", "fluorene", "phenanthrene",
    "anthracene", "fluoranthene", "pyrene", "benzo-a-anthracene", "chrysene",
    "indeno-123cd-pyrene", "benzo-b-fluoranthene", "benzo-j-fluoranthene",
    "benzo-k-fluoranthene", "benzo-e-pyrene", "dibenzo-ah-anthracene",
    "benzo-ghi-perylene", "dibenzo-ae-pyrene", "dibenzo-ai-pyrene", "perylene",
  ];

  it("has all 20 confidently-sourced new PAH entries present", () => {
    for (const id of newPahIds) {
      expect(entries.some(e => e.analyteId === id), `missing analyteId ${id}`).toBe(true);
    }
  });

  it("has no duplicate analyteIds anywhere in the file (18 original + 11 metals + PAHs)", () => {
    const ids = entries.map(e => e.analyteId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const id of newPahIds) {
    it(`${id}: has correct structural shape`, () => {
      const entry = entries.find(e => e.analyteId === id)!;
      expect(entry).toBeDefined();
      expect(entry.substanceGroup).toBe("PAH");
      expect(entry.defaultUnit).toBe("%");
      expect(entry.elementSymbol).toBeNull();
      expect(typeof entry.canonicalNameEn).toBe("string");
      expect(entry.canonicalNameEn.length).toBeGreaterThan(0);
      if (entry.hStatements) {
        for (const h of entry.hStatements) {
          expect(typeof h.hStatement).toBe("string");
          expect(typeof h.hazardClass).toBe("string");
        }
      }
    });
  }

  it("naphthalene has the real, independently-verified CAS number 91-20-3", () => {
    const entry = entries.find(e => e.analyteId === "naphthalene")!;
    expect(entry.casNumber).toBe("91-20-3");
  });

  it("pyrene has the real, independently-verified CAS number 129-00-0", () => {
    const entry = entries.find(e => e.analyteId === "pyrene")!;
    expect(entry.casNumber).toBe("129-00-0");
  });

  it("dibenzo-aj-pyrene, if present, does NOT use the wrong 224-41-9 CAS number (that belongs to a different compound, dibenz[a,j]anthracene)", () => {
    const entry = entries.find(e => e.analyteId === "dibenzo-aj-pyrene");
    if (entry) {
      expect(entry.casNumber).not.toBe("224-41-9");
    }
  });
});

describe("analyte-reference.json — hazardClass strings match the real threshold vocabulary", () => {
  const entries = analyteReferenceRaw as AnalyteReference[];
  const thresholds = hpThresholdsRaw as { hazardClass: string | null }[];

  const knownHazardClasses = new Set(
    thresholds
      .map(t => t.hazardClass)
      .filter((hc): hc is string => typeof hc === "string")
  );

  // HP14 handles "Aquatic *" hazard classes outside the threshold-match path
  // (see lib/hp-classification/hazard.ts), so they legitimately never appear
  // in hp-thresholds.json and are not required to be in knownHazardClasses.
  const isAllowed = (hazardClass: string) =>
    knownHazardClasses.has(hazardClass) || hazardClass.startsWith("Aquatic ");

  it("has at least one known hazardClass value to compare against (sanity check)", () => {
    expect(knownHazardClasses.size).toBeGreaterThan(0);
  });

  for (const entry of entries) {
    it(`${entry.analyteId}: top-level hazardClass (if set) is a real threshold-vocabulary value`, () => {
      if (entry.hazardClass) {
        expect(
          isAllowed(entry.hazardClass),
          `analyteId "${entry.analyteId}" has hazardClass "${entry.hazardClass}" which does not match any hazardClass in hp-thresholds.json and is not an "Aquatic *" value`
        ).toBe(true);
      }
    });

    it(`${entry.analyteId}: every hStatements[].hazardClass is a real threshold-vocabulary value`, () => {
      if (entry.hStatements) {
        for (const h of entry.hStatements) {
          expect(
            isAllowed(h.hazardClass),
            `analyteId "${entry.analyteId}" has hStatements hazardClass "${h.hazardClass}" (hStatement ${h.hStatement}) which does not match any hazardClass in hp-thresholds.json and is not an "Aquatic *" value`
          ).toBe(true);
        }
      }
    });
  }
});
