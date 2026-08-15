import { describe, it, expect } from "vitest";
import { assignEalCode } from "@/lib/hp-classification/eal";

const originLookup = { "escavo terre e rocce": "1705" };

describe("assignEalCode", () => {
  it("halts with a clear message when originProcess is null", () => {
    const result = assignEalCode(true, null, null, originLookup);
    expect(result.code).toBeNull();
    expect(result.confidence).toBe("HALT — missing origin/process metadata, cannot select EAL chapter");
  });

  it("assigns the hazardous mirror code (17 05 03*) for hazardous soil with no lab cross-check, flagging ambiguity since chapter 1705 hazardous has multiple candidates", () => {
    const result = assignEalCode(true, "escavo terre e rocce", null, originLookup);
    expect(result.code).toBe("17 05 03*");
    expect(result.confidence).toContain("AMBIGUOUS");
  });

  it("assigns the non-hazardous mirror code (17 05 04) for non-hazardous soil", () => {
    const result = assignEalCode(false, "escavo terre e rocce", null, originLookup);
    expect(result.code).toBe("17 05 04");
  });

  it("reports high confidence when the engine agrees with the lab's own stated code", () => {
    const result = assignEalCode(true, "escavo terre e rocce", "17 05 03*", originLookup);
    expect(result.confidence).toBe("high — engine agrees with lab's own classification");
  });

  it("reports a flag-for-review when the engine disagrees with the lab's own stated code", () => {
    const result = assignEalCode(false, "escavo terre e rocce", "17 05 03*", originLookup);
    expect(result.confidence).toBe("FLAG FOR REVIEW — engine disagrees with lab, do not auto-proceed");
  });

  it("halts when originProcess has no entry in the lookup table", () => {
    const result = assignEalCode(true, "unknown process", null, originLookup);
    expect(result.code).toBeNull();
    expect(result.confidence).toContain("no chapter mapping found");
  });

  it("flags ambiguity when multiple hazardous nivaa-3 candidates exist in the chapter and there is no lab code to cross-check", () => {
    // Chapter 1705 hazardous has three real candidates: 170503, 170505, 170507.
    const result = assignEalCode(true, "escavo terre e rocce", null, originLookup);
    expect(result.confidence).toContain("AMBIGUOUS");
    expect(result.confidence).toContain("170503");
    expect(result.confidence).toContain("170505");
    expect(result.confidence).toContain("170507");
    expect(result.confidence).toContain("manual review recommended");
  });

  it("prefers the lab-agreement message over the ambiguity note when both would apply", () => {
    const result = assignEalCode(true, "escavo terre e rocce", "17 05 03*", originLookup);
    expect(result.confidence).toBe("high — engine agrees with lab's own classification");
  });

  it("real quirk: chapter 1301 (hydraulic oil waste) is entirely hazardous in the real EAL catalogue — resolves for isHazardous=true, reports no match (not a guess) for isHazardous=false", () => {
    const lookup = { "hydraulic oil waste": "1301" };
    const hazardousResult = assignEalCode(true, "hydraulic oil waste", null, lookup);
    expect(hazardousResult.code).toBe("13 01 01*");
    expect(hazardousResult.confidence).toContain("AMBIGUOUS");

    const nonHazardousResult = assignEalCode(false, "hydraulic oil waste", null, lookup);
    expect(nonHazardousResult.code).toBeNull();
    expect(nonHazardousResult.confidence).toContain("no matching EAL code found in chapter 1301 for hazardous=false");
  });

  it("real quirk: chapter 2003 (other municipal waste) is entirely non-hazardous in the real EAL catalogue — resolves for isHazardous=false, reports no match (not a guess) for isHazardous=true", () => {
    const lookup = { "other municipal waste": "2003" };
    const nonHazardousResult = assignEalCode(false, "other municipal waste", null, lookup);
    expect(nonHazardousResult.code).toBe("20 03 01");
    expect(nonHazardousResult.confidence).toContain("AMBIGUOUS");

    const hazardousResult = assignEalCode(true, "other municipal waste", null, lookup);
    expect(hazardousResult.code).toBeNull();
    expect(hazardousResult.confidence).toContain("no matching EAL code found in chapter 2003 for hazardous=true");
  });

  it("chapter 1602 (WEEE) has real hazardous and non-hazardous mirror pairs, confirming the fuller data file didn't change existing mirror-pair behavior", () => {
    const lookup = { "electrical or electronic equipment waste (WEEE)": "1602" };
    const hazardousResult = assignEalCode(true, "electrical or electronic equipment waste (WEEE)", null, lookup);
    expect(hazardousResult.code).toBe("16 02 09*");

    const nonHazardousResult = assignEalCode(false, "electrical or electronic equipment waste (WEEE)", null, lookup);
    expect(nonHazardousResult.code).toBe("16 02 14");
  });

  it("returns the real English description for a well-known EAL code (170503, hazardous soil/rock)", () => {
    const result = assignEalCode(true, "escavo terre e rocce", null, originLookup);
    expect(result.description).toBe("soil and stones containing dangerous substances");
  });

  it("falls back to the Norwegian description for a code with no real English translation", () => {
    // Chapter 1650 (Norway-specific oil-drilling extension) has no real English source match —
    // this test uses a synthetic lookup pointing at that chapter to prove the fallback works,
    // since 1650 isn't one of this app's curated origin-process options. All 8 real leaf codes
    // under chapter 1650 are farlig=true (hazardous) with no non-hazardous mirror — verified
    // during planning by reading the real data — so this test must use isHazardous=true, or it
    // will hit the unrelated "no matching EAL code found" path instead of the fallback this
    // test is meant to exercise.
    const lookup = { "test-oil-drilling-origin": "1650" };
    const result = assignEalCode(true, "test-oil-drilling-origin", null, lookup);
    // The first hazardous chapter-1650 candidate (in file order) is 165071, which has no real
    // English translation (missingEnglishTranslation: true) — verified against the real data in
    // lib/data/eal-koder-full.json. Assert the exact real Norwegian beskrivelse to prove the
    // fallback genuinely returns the Norwegian text, not that some non-empty string was returned
    // (which would also pass if the English field were mistakenly used).
    expect(result.code).toBe("16 50 71*");
    expect(result.description).toBe(
      "Oljebasert borevæske (enhver borevæske som inneholder olje eller oljeemulsjon av mineralopprinnelse)"
    );
  });
});
