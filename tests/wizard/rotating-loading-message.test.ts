import { describe, it, expect } from "vitest";
import { LOADING_MESSAGES } from "@/components/wizard/RotatingLoadingMessage";

describe("LOADING_MESSAGES", () => {
  it("has exactly the 6 real, honest pipeline-stage messages in order", () => {
    expect(LOADING_MESSAGES).toEqual([
      "Reading the document…",
      "Extracting analyte results…",
      "Matching known substances…",
      "Checking for hazard-relevant data…",
      "Finalizing extracted data…",
      "Large reports can take a few minutes…",
    ]);
  });

  it("has no empty or duplicate messages", () => {
    for (const msg of LOADING_MESSAGES) {
      expect(msg.length).toBeGreaterThan(0);
    }
    expect(new Set(LOADING_MESSAGES).size).toBe(LOADING_MESSAGES.length);
  });
});
