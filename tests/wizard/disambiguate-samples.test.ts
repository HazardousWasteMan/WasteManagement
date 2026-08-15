import { describe, it, expect } from "vitest";
import { disambiguateSamples } from "@/lib/wizard/disambiguate-samples";

describe("disambiguateSamples", () => {
  it("adds no suffix when every sampleIdentifier is unique", () => {
    const result = disambiguateSamples([
      { sampleIdentifier: "A-1", matrixType: "jord" },
      { sampleIdentifier: "A-2", matrixType: "vann" },
    ]);
    expect(result[0].displayLabel).toBe("A-1 — jord");
    expect(result[1].displayLabel).toBe("A-2 — vann");
  });

  it("appends a distinguishing (N) suffix when two samples share an identifier, without changing sampleIdentifier", () => {
    const result = disambiguateSamples([
      { sampleIdentifier: "nitrati", matrixType: null },
      { sampleIdentifier: "nitrati", matrixType: null },
    ]);
    expect(result[0].displayLabel).toBe("nitrati (1)");
    expect(result[1].displayLabel).toBe("nitrati (2)");
    expect(result[0].sampleIdentifier).toBe("nitrati");
    expect(result[1].sampleIdentifier).toBe("nitrati");
  });

  it("only disambiguates identifiers that actually repeat", () => {
    const result = disambiguateSamples([
      { sampleIdentifier: "nitrati", matrixType: null },
      { sampleIdentifier: "nitrati", matrixType: null },
      { sampleIdentifier: "unique-id", matrixType: "jord" },
    ]);
    expect(result[2].displayLabel).toBe("unique-id — jord");
  });

  it("returns an empty array for an empty input", () => {
    expect(disambiguateSamples([])).toEqual([]);
  });
});
