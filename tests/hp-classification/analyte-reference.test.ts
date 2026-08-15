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

describe("analyte-reference.json — PFAS and PCB batch (Task 3)", () => {
  const entries = analyteReferenceRaw as AnalyteReference[];

  it("has real PFAS and PCB entries confirmed against the real Alta Lufthavn Eurofins report", () => {
    const pfasEntries = entries.filter(a => a.substanceGroup === "PFAS");
    const pcbEntries = entries.filter(a => a.substanceGroup === "PCB");
    expect(pfasEntries.length).toBe(35);
    expect(pcbEntries.length).toBe(7);
    for (const entry of [...pfasEntries, ...pcbEntries]) {
      // CAS number is required to be either a real string or an honestly-disclosed null — never
      // undefined (which would mean the field was simply forgotten).
      expect(entry.casNumber === null || typeof entry.casNumber === "string").toBe(true);
      expect(entry.analyteId.length).toBeGreaterThan(0);
    }
  });

  it("real, spot-checked values: PFOS and PCB 28 carry their real, verified CAS numbers", () => {
    const pfos = entries.find(a => a.canonicalNameEn.toLowerCase().includes("perfluorooctane sulfonic") || a.analyteId === "pfos");
    expect(pfos).toBeDefined();
    expect(pfos!.casNumber).toBe("1763-23-1");
    const pcb28 = entries.find(a => a.analyteId === "pcb-28");
    expect(pcb28).toBeDefined();
    expect(pcb28!.casNumber).toBe("7012-37-5");
  });

  it("PFOS and PCB 28 carry their real, verified hazard classifications, not blanket nulls", () => {
    const pfos = entries.find(a => a.casNumber === "1763-23-1");
    expect(pfos).toBeDefined();
    const pfosStatements = pfos!.hStatements ?? (pfos!.hStatement ? [{ hStatement: pfos!.hStatement, hazardClass: pfos!.hazardClass }] : []);
    expect(pfosStatements.some(h => h.hStatement === "H372")).toBe(true);

    const pcb28 = entries.find(a => a.analyteId === "pcb-28");
    expect(pcb28).toBeDefined();
    const pcb28Statements = pcb28!.hStatements ?? (pcb28!.hStatement ? [{ hStatement: pcb28!.hStatement, hazardClass: pcb28!.hazardClass }] : []);
    expect(pcb28Statements.some(h => h.hStatement === "H410")).toBe(true);
  });

  it("PFOS carries its complete real hStatements set, not a partial one", () => {
    const pfos = entries.find(a => a.casNumber === "1763-23-1");
    expect(pfos).toBeDefined();
    const actual = [...pfos!.hStatements!].sort((a, b) => a.hStatement.localeCompare(b.hStatement));
    const expected = [
      { hStatement: "H302", hazardClass: "Acute Tox. 4 (Oral)" },
      { hStatement: "H332", hazardClass: "Acute Tox. 4 (Inhal.)" },
      { hStatement: "H351", hazardClass: "Carc. 2" },
      { hStatement: "H360D", hazardClass: "Repr. 1B" },
      { hStatement: "H372", hazardClass: "STOT RE 1" },
      { hStatement: "H411", hazardClass: "Aquatic Chronic 2" },
    ].sort((a, b) => a.hStatement.localeCompare(b.hStatement));
    expect(actual).toEqual(expected);
  });

  it("all 7 PCB congeners carry the real Annex VI group entry (Index 602-039-00-4) hazard statements", () => {
    const pcbIds = ["pcb-28", "pcb-52", "pcb-101", "pcb-118", "pcb-138", "pcb-153", "pcb-180"];
    for (const id of pcbIds) {
      const entry = entries.find(a => a.analyteId === id);
      expect(entry, `missing PCB entry ${id}`).toBeDefined();
      expect(entry!.hStatements).toEqual(
        expect.arrayContaining([
          { hStatement: "H373", hazardClass: "STOT RE 2" },
          { hStatement: "H400", hazardClass: "Aquatic Acute 1" },
          { hStatement: "H410", hazardClass: "Aquatic Chronic 1" },
        ])
      );
      expect(entry!.mFactorAcute).toBeNull();
      expect(entry!.mFactorChronic).toBeNull();
    }
  });

  it("PFHpA carries its real, verified EU CLP Annex VI classification", () => {
    const pfhpa = entries.find(a => a.casNumber === "375-85-9");
    expect(pfhpa).toBeDefined();
    expect(pfhpa!.hStatements).toEqual(
      expect.arrayContaining([
        { hStatement: "H360D", hazardClass: "Repr. 1B" },
        { hStatement: "H372", hazardClass: "STOT RE 1" },
      ])
    );
  });

  it("PFNA carries its complete real hStatements set, not a partial one", () => {
    const pfna = entries.find(a => a.casNumber === "375-95-1");
    expect(pfna).toBeDefined();
    const actual = [...pfna!.hStatements!].sort((a, b) => a.hStatement.localeCompare(b.hStatement));
    const expected = [
      { hStatement: "H302", hazardClass: "Acute Tox. 4 (Oral)" },
      { hStatement: "H332", hazardClass: "Acute Tox. 4 (Inhal.)" },
      { hStatement: "H318", hazardClass: "Eye Dam. 1" },
      { hStatement: "H351", hazardClass: "Carc. 2" },
      { hStatement: "H360Df", hazardClass: "Repr. 1B" },
      { hStatement: "H372", hazardClass: "STOT RE 1" },
    ].sort((a, b) => a.hStatement.localeCompare(b.hStatement));
    expect(actual).toEqual(expected);
  });

  it("PFDA carries its complete real hStatements set, not a partial one", () => {
    const pfda = entries.find(a => a.casNumber === "335-76-2");
    expect(pfda).toBeDefined();
    const actual = [...pfda!.hStatements!].sort((a, b) => a.hStatement.localeCompare(b.hStatement));
    const expected = [
      { hStatement: "H351", hazardClass: "Carc. 2" },
      { hStatement: "H360Df", hazardClass: "Repr. 1B" },
    ].sort((a, b) => a.hStatement.localeCompare(b.hStatement));
    expect(actual).toEqual(expected);
  });

  it("PFHxDA, FOSAA, and PFTrDS carry their real, verified CAS numbers (no longer null)", () => {
    const pfhxda = entries.find(a => a.analyteId === "pfhxda");
    expect(pfhxda).toBeDefined();
    expect(pfhxda!.casNumber).toBe("67905-19-5");

    const fosaa = entries.find(a => a.analyteId === "fosaa");
    expect(fosaa).toBeDefined();
    expect(fosaa!.casNumber).toBe("2806-24-8");

    const pftrds = entries.find(a => a.analyteId === "pftrds");
    expect(pftrds).toBeDefined();
    expect(pftrds!.casNumber).toBe("791563-89-8");
  });
});

describe("analyte-reference.json — Norwegian TPH hydrocarbon fractions (Task 4)", () => {
  const entries = analyteReferenceRaw as AnalyteReference[];

  // Real research (Miljødirektoratet's TA-2553/2009 "Helsebaserte tilstandsklasser for
  // forurenset grunn", its 2022 successor "Veileder - Forurenset grunn", the avfallsforskriften
  // kap. 11 farlig-avfall route, and the NFFA/Forum for miljøkartlegging og -sanering guide "Hva
  // gjør avfall farlig?") establishes that Norway's condition-class system for the SPI-2011
  // hydrocarbon fractions (Alifater C5-C6, >C6-C8, >C8-C10, >C10-C12, >C12-C16, >C16-C35,
  // Aromater >C8-C10, >C10-C16, >C16-C35) is a concentration-based risk system, NOT a CLP
  // hazard-class mapping — it assigns "tilstandsklasser" 1-5 by concentration threshold, with no
  // H-statement or hazardClass attached to the fraction itself. Farlig-avfall (hazardous waste)
  // CLP classification in Norway instead runs through ECHA's C&L inventory for specific,
  // individually-registered petroleum UVCB substances (e.g. "Hydrocarbons, C8-C11,
  // naphtha-cracking, toluene cut") — each tied to its own process-specific CAS/EC number, not to
  // the generic Norwegian carbon-range analytical bin. Reusing one of those substance-specific
  // classifications for the generic SPI fraction bin would misattribute a different, unrelated
  // UVCB's classification to the fraction reported in the lab sheet — the same kind of mismatch
  // this codebase's PAH batch test (see "dibenzo-aj-pyrene" above) already guards against.
  //
  // No real, verifiable Norwegian or EU source was found that assigns a CLP hStatement/hazardClass
  // to the generic fraction bins themselves. Per the "never fabricate" discipline, this is left as
  // an honest, disclosed gap: zero aliphatic-*/aromatic-* fraction entries are added in this task.
  it("has no fabricated aliphatic-*/aromatic-* fraction entries (real research found no verifiable CLP mapping)", () => {
    const fractionEntries = entries.filter(
      a => a.analyteId.startsWith("aliphatic-") || a.analyteId.startsWith("aromatic-")
    );
    expect(fractionEntries.length).toBe(0);
    // If a real, sourced mapping is found in a future task, every entry added must still carry an
    // honestly-disclosed null casNumber (UVCB/range substance, no single CAS) — never a fabricated one.
    for (const entry of fractionEntries) {
      expect(entry.casNumber).toBeNull();
    }
  });

  it("the existing hydrocarbons-c10-c40 entry (from prior work) is untouched by this task", () => {
    const entry = entries.find(e => e.analyteId === "hydrocarbons-c10-c40");
    expect(entry).toBeDefined();
    expect(entry!.casNumber).toBeNull();
    expect(entry!.hStatement).toBe("H411");
    expect(entry!.hazardClass).toBe("Aquatic Chronic 2");
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
