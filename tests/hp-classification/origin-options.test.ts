import { describe, it, expect } from "vitest";
import { ORIGIN_OPTIONS, withCustomOrigin, deriveOriginFromLabCode, suggestOriginProcess, EAL_CHAPTERS } from "@/lib/hp-classification/origin-options";
import ealKoderFull from "@/lib/data/eal-koder-full.json";

describe("ORIGIN_OPTIONS", () => {
  it("has exactly 25 real origin types across 7 chapters", () => {
    expect(ORIGIN_OPTIONS).toHaveLength(25);
  });

  it("every option has a non-empty value, label, and a 4-digit chapter code", () => {
    for (const option of ORIGIN_OPTIONS) {
      expect(option.value.length).toBeGreaterThan(0);
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.chapter).toMatch(/^\d{4}$/);
    }
  });

  it("includes excavated soil or rock mapped to chapter 1705, matching the existing regression fixture's origin", () => {
    const soilOption = ORIGIN_OPTIONS.find(o => o.chapter === "1705");
    expect(soilOption).toBeDefined();
    expect(soilOption!.value).toBe("escavo terre e rocce");
  });

  it("has no duplicate values or chapters", () => {
    const values = ORIGIN_OPTIONS.map(o => o.value);
    const chapters = ORIGIN_OPTIONS.map(o => o.chapter);
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(chapters).size).toBe(chapters.length);
  });

  it("every chapter code corresponds to a real nivaa:2 entry in eal-koder-full.json", () => {
    const ealKoder = ealKoderFull as { nivaa: number; kode: string }[];
    for (const option of ORIGIN_OPTIONS) {
      const found = ealKoder.some(e => e.nivaa === 2 && e.kode === option.chapter);
      expect(found, `chapter ${option.chapter} not found as a nivaa:2 code`).toBe(true);
    }
  });

  it("covers all 7 chapters the user identified as relevant: 08, 13, 14, 15, 16, 17, 20", () => {
    const chaptersCovered = new Set(ORIGIN_OPTIONS.map(o => o.chapter.slice(0, 2)));
    expect(chaptersCovered).toEqual(new Set(["08", "13", "14", "15", "16", "17", "20"]));
  });
});

describe("withCustomOrigin", () => {
  it("merges a custom origin/chapter pair into a copy of the base lookup", () => {
    const base = { "escavo terre e rocce": "1705" };
    const merged = withCustomOrigin(base, "demolished retaining wall", "1701");
    expect(merged).toEqual({ "escavo terre e rocce": "1705", "demolished retaining wall": "1701" });
  });

  it("does not mutate the base lookup object", () => {
    const base = { "escavo terre e rocce": "1705" };
    withCustomOrigin(base, "demolished retaining wall", "1701");
    expect(base).toEqual({ "escavo terre e rocce": "1705" });
  });

  it("returns the base lookup unchanged when no custom chapter is provided", () => {
    const base = { "escavo terre e rocce": "1705" };
    expect(withCustomOrigin(base, "demolished retaining wall", null)).toBe(base);
  });

  it("returns the base lookup unchanged when originProcess is null", () => {
    const base = { "escavo terre e rocce": "1705" };
    expect(withCustomOrigin(base, null, "1701")).toBe(base);
  });
});

describe("deriveOriginFromLabCode", () => {
  it("derives the real origin option for the Italian sample's real lab-stated EAL code", () => {
    expect(deriveOriginFromLabCode("17 05 03*")).toBe("escavo terre e rocce");
  });

  it("handles a code with no spaces or asterisk the same way", () => {
    expect(deriveOriginFromLabCode("170503")).toBe("escavo terre e rocce");
  });

  it("returns null for a well-formed code whose chapter isn't one of the 25 curated ones", () => {
    // Chapter 0101 (mineral extraction) is real but not among the 7 curated chapters.
    expect(deriveOriginFromLabCode("01 01 01")).toBeNull();
  });

  it("returns null when no lab code is given", () => {
    expect(deriveOriginFromLabCode(null)).toBeNull();
  });

  it("returns null for a malformed code with fewer than 4 digits", () => {
    expect(deriveOriginFromLabCode("1*")).toBeNull();
  });
});

describe("suggestOriginProcess", () => {
  it("prefers the lab-derived origin even when a different Claude suggestion is also present", () => {
    const result = suggestOriginProcess("17 05 03*", "hydraulic oil waste");
    expect(result).toBe("escavo terre e rocce");
  });

  it("falls back to Claude's suggestion when no lab code is present", () => {
    const result = suggestOriginProcess(null, "hydraulic oil waste");
    expect(result).toBe("hydraulic oil waste");
  });

  it("falls back to Claude's suggestion when the lab code's chapter isn't curated", () => {
    const result = suggestOriginProcess("01 01 01", "hydraulic oil waste");
    expect(result).toBe("hydraulic oil waste");
  });

  it("rejects a Claude suggestion that isn't a real ORIGIN_OPTIONS value, even with no lab code", () => {
    const result = suggestOriginProcess(null, "something Claude made up");
    expect(result).toBeNull();
  });

  it("returns null when neither source yields a value", () => {
    expect(suggestOriginProcess(null, null)).toBeNull();
  });
});

describe("EAL_CHAPTERS", () => {
  it("has exactly 20 entries with chapter codes 01 through 20 in order", () => {
    expect(EAL_CHAPTERS).toHaveLength(20);
    expect(EAL_CHAPTERS.map(c => c.chapter)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0"))
    );
  });

  it("every label matches the real eal-koder-full.json nivaa:1 beskrivelseEn for that chapter", () => {
    const ealKoder = ealKoderFull as { nivaa: number; kode: string; beskrivelseEn: string | null }[];
    for (const c of EAL_CHAPTERS) {
      const realEntry = ealKoder.find(e => e.nivaa === 1 && e.kode === c.chapter);
      expect(realEntry, `chapter ${c.chapter} not found as a nivaa:1 entry`).toBeDefined();
      expect(c.label).toBe(realEntry!.beskrivelseEn);
    }
  });

  it("covers every chapter ORIGIN_OPTIONS references, since the curated set must be a subset of the real catalogue", () => {
    const curatedChapters = new Set(ORIGIN_OPTIONS.map(o => o.chapter.slice(0, 2)));
    const fullChapters = new Set(EAL_CHAPTERS.map(c => c.chapter));
    for (const ch of curatedChapters) {
      expect(fullChapters.has(ch), `curated chapter ${ch} missing from EAL_CHAPTERS`).toBe(true);
    }
  });
});
