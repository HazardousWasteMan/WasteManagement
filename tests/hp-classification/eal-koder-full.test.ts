import { describe, it, expect } from "vitest";
import ealKoderFull from "@/lib/data/eal-koder-full.json";

interface EalEntry {
  nivaa: number;
  kode: string;
  beskrivelse: string;
  farlig: boolean;
  beskrivelseEn: string | null;
  missingEnglishTranslation?: boolean;
}

describe("eal-koder-full.json", () => {
  const entries = ealKoderFull as EalEntry[];

  it("has exactly 979 real, non-deprecated entries across all 3 levels", () => {
    expect(entries).toHaveLength(979);
  });

  it("covers all 20 real EAL chapters at nivaa 1", () => {
    const chapters = entries.filter(e => e.nivaa === 1).map(e => e.kode).sort();
    expect(chapters).toHaveLength(20);
    expect(chapters).toEqual([
      "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
      "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
    ]);
  });

  it("has 847 nivaa-3 entries and 112 nivaa-2 entries", () => {
    expect(entries.filter(e => e.nivaa === 3)).toHaveLength(847);
    expect(entries.filter(e => e.nivaa === 2)).toHaveLength(112);
  });

  it("contains no deprecated ('Utgått') entries", () => {
    for (const e of entries) {
      expect(e.beskrivelse.toLowerCase()).not.toContain("utgått");
    }
  });

  it("preserves the real chapter-1705 mirror pair (170503*/170504) the existing engine already relies on", () => {
    const hazardous = entries.find(e => e.kode === "170503");
    const nonHazardous = entries.find(e => e.kode === "170504");
    expect(hazardous).toMatchObject({ nivaa: 3, kode: "170503", beskrivelse: "Jord og stein som inneholder farlige stoffer", farlig: true });
    expect(nonHazardous?.farlig).toBe(false);
  });

  it("has real, non-empty descriptions for every entry", () => {
    for (const e of entries) {
      expect(e.beskrivelse.length).toBeGreaterThan(0);
    }
  });

  it("has 966 entries with a real English translation and 13 with an honest gap marker", () => {
    const translated = entries.filter(
      e => e.beskrivelseEn !== null && e.beskrivelseEn !== undefined && e.beskrivelseEn.trim().length > 0
    );
    const gaps = entries.filter(e => e.missingEnglishTranslation === true);
    expect(translated).toHaveLength(966);
    expect(gaps).toHaveLength(13);
  });

  it("every gap entry has beskrivelseEn: null and no fabricated translation", () => {
    const gaps = entries.filter(e => e.missingEnglishTranslation === true);
    for (const g of gaps) {
      expect(g.beskrivelseEn).toBeNull();
    }
  });

  it("no entry has an empty or whitespace-only beskrivelseEn (must be a real string or null)", () => {
    for (const e of entries) {
      if (e.beskrivelseEn !== null && e.beskrivelseEn !== undefined) {
        expect(e.beskrivelseEn.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("code 170101 has the real, verified English translation 'concrete'", () => {
    const entry = entries.find(e => e.kode === "170101");
    expect(entry?.beskrivelseEn).toBe("concrete");
  });

  it("code 010101 has the real, verified English translation", () => {
    const entry = entries.find(e => e.kode === "010101");
    expect(entry?.beskrivelseEn).toBe("wastes from mineral metalliferous excavation");
  });

  it("known source typos are corrected, not transcribed verbatim", () => {
    const nitricAcid = entries.find(e => e.kode === "060105");
    expect(nitricAcid?.beskrivelseEn).toContain("nitric acid");
    expect(nitricAcid?.beskrivelseEn).not.toContain("nitirc");

    const hydrofluoricAcid = entries.find(e => e.kode === "060103");
    expect(hydrofluoricAcid?.beskrivelseEn).toContain("hydrofluoric acid");
    expect(hydrofluoricAcid?.beskrivelseEn).not.toContain("hydroflouric");
  });

  it("chapter 1650 (Norway-specific oil-drilling extension) is a real, disclosed gap, not silently dropped", () => {
    const entry = entries.find(e => e.kode === "1650");
    expect(entry).toBeDefined();
    expect(entry?.missingEnglishTranslation).toBe(true);
    expect(entry?.beskrivelseEn).toBeNull();
    expect(entry?.beskrivelse).toBe("Ilandført avfall fra oljeboring/-produksjon");
  });
});
