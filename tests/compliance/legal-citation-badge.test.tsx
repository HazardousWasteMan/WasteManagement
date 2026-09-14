import { describe, it, expect } from "vitest";
import { canSubmitDispute } from "@/components/data-lab/LegalCitationBadge";

describe("canSubmitDispute", () => {
  it("is false when reason is empty", () => {
    expect(canSubmitDispute("", "Kari Nordmann")).toBe(false);
  });
  it("is false when raisedBy is empty", () => {
    expect(canSubmitDispute("This doesn't apply here", "")).toBe(false);
  });
  it("is false when both are whitespace-only", () => {
    expect(canSubmitDispute("   ", "   ")).toBe(false);
  });
  it("is true when both are non-empty", () => {
    expect(canSubmitDispute("This doesn't apply here", "Kari Nordmann")).toBe(true);
  });
});
