import { describe, it, expect } from "vitest";
import { ORIGIN_OPTIONS, withCustomOrigin, deriveOriginFromLabCode, suggestOriginProcess, EAL_CHAPTERS } from "@/lib/hp-classification/origin-options";
import ealKoderFull from "@/lib/data/eal-koder-full.json";

describe("ORIGIN_OPTIONS", () => {
  it("offers every nivaa-2 chapter in the real catalogue, not just the 7 curated ones", () => {
    // The curated list covered 7 of 20 chapters, so EAL 10 13 14 (concrete sludge, a real form in
    // big_test/test_3) was unreachable — no user choice mapped to chapter 10.
    const ealKoder = ealKoderFull as { nivaa: number; kode: string }[];
    const allChapters = ealKoder.filter(e => e.nivaa === 2).map(e => e.kode);
    expect(ORIGIN_OPTIONS).toHaveLength(allChapters.length);
    expect(new Set(ORIGIN_OPTIONS.map(o => o.chapter))).toEqual(new Set(allChapters));
    expect(ORIGIN_OPTIONS.some(o => o.chapter === "1013")).toBe(true);
  });

  it("keeps the 25 curated values verbatim and first — stored submissions carry those strings", () => {
    expect(ORIGIN_OPTIONS.slice(0, 25).map(o => o.value)).toEqual([
      "escavo terre e rocce", "concrete, brick, tile, or ceramic waste", "wood, glass, or plastic waste",
      "bituminous mixtures, coal tar, or tar products", "metal waste",
      "insulation material or asbestos-containing building material", "gypsum-based building material",
      "other construction/demolition waste", "hydraulic oil waste", "engine, gear, or lubricating oil waste",
      "transformer or heat-transfer oil waste", "bilge oil waste", "oil/water separator content",
      "liquid fuel waste (heating oil, diesel, petrol)", "other oil waste, not otherwise specified",
      "organic solvent, refrigerant, or propellant waste", "paint or varnish production/use/removal waste",
      "adhesive or sealant (incl. waterproofing) waste", "packaging waste (incl. separately collected)",
      "absorbents, filter materials, wiping cloths, or protective clothing",
      "electrical or electronic equipment waste (WEEE)", "gas in pressurized containers or discarded chemicals",
      "batteries and accumulators", "separately collected municipal waste fraction (excl. packaging)",
      "other municipal waste",
    ]);
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

  it("covers all 20 top-level chapters", () => {
    const chaptersCovered = new Set(ORIGIN_OPTIONS.map(o => o.chapter.slice(0, 2)));
    expect(chaptersCovered).toEqual(new Set(EAL_CHAPTERS.map(c => c.chapter)));
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

  it("now resolves a code outside the 25 curated chapters, since every real chapter is offered", () => {
    // Chapter 0101 (mineral extraction) has no curated entry, so this used to return null and the
    // lab's own classification was thrown away. It is a real chapter and now maps to one.
    expect(deriveOriginFromLabCode("01 01 01")).toBe("eal-0101");
  });

  it("still returns null for a chapter code that is not in the catalogue at all", () => {
    expect(deriveOriginFromLabCode("99 99 99")).toBeNull();
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

  it("prefers the lab code over Claude even for a generated chapter — the lab's own classification wins", () => {
    const result = suggestOriginProcess("01 01 01", "hydraulic oil waste");
    expect(result).toBe("eal-0101");
  });

  it("still falls back to Claude when the lab code names no real chapter", () => {
    expect(suggestOriginProcess("99 99 99", "hydraulic oil waste")).toBe("hydraulic oil waste");
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
