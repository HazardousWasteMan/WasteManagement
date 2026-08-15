import { describe, it, expect } from "vitest";
import {
  canCommitEntry,
  isClassificationTabEnabled,
  isFacilityMatchTabEnabled,
  isProjectTabEnabled,
  isReviewTabEnabled,
  isResponseStillCurrent,
  shouldStartNewCase,
} from "@/lib/wizard/case-flow";

describe("canCommitEntry", () => {
  it("allows commit when the entry has not been committed yet", () => {
    expect(canCommitEntry(false)).toBe(true);
  });
  it("blocks commit once the entry has already been committed", () => {
    expect(canCommitEntry(true)).toBe(false);
  });
});

describe("isClassificationTabEnabled", () => {
  it("is enabled when a classification result exists and has not been committed", () => {
    expect(isClassificationTabEnabled(true, false)).toBe(true);
  });
  it("is disabled when there is no classification result", () => {
    expect(isClassificationTabEnabled(false, false)).toBe(false);
  });
  it("is disabled once the entry has been committed, even with a classification result", () => {
    expect(isClassificationTabEnabled(true, true)).toBe(false);
  });
});

describe("isFacilityMatchTabEnabled", () => {
  it("is enabled when there is an active case and a current classification result", () => {
    expect(isFacilityMatchTabEnabled(true, true)).toBe(true);
  });
  it("is disabled without an active case", () => {
    expect(isFacilityMatchTabEnabled(false, true)).toBe(false);
  });
  it("is disabled mid-loop when classification result was reset but the case is still active", () => {
    expect(isFacilityMatchTabEnabled(true, false)).toBe(false);
  });
});

describe("isProjectTabEnabled", () => {
  it("is enabled when classified but no case exists yet", () => {
    expect(isProjectTabEnabled(true, false)).toBe(true);
  });
  it("is disabled without a classification result", () => {
    expect(isProjectTabEnabled(false, false)).toBe(false);
  });
  it("is disabled once a case already exists", () => {
    expect(isProjectTabEnabled(true, true)).toBe(false);
  });
});

describe("isReviewTabEnabled", () => {
  it("is enabled when extraction exists and has not been committed", () => {
    expect(isReviewTabEnabled(true, false)).toBe(true);
  });
  it("is disabled when there is no extraction", () => {
    expect(isReviewTabEnabled(false, false)).toBe(false);
  });
  it("is disabled once the entry has been committed, even with an extraction", () => {
    expect(isReviewTabEnabled(true, true)).toBe(false);
  });
});

describe("shouldStartNewCase", () => {
  it("is true for a genuinely new document upload (no sampleIdentifier)", () => {
    expect(shouldStartNewCase(null)).toBe(true);
  });
  it("is false when continuing the add-another-sample loop on the same document", () => {
    expect(shouldStartNewCase("SAMPLE-002")).toBe(false);
  });
});

describe("isResponseStillCurrent", () => {
  it("is true when the request's generation still matches the current generation", () => {
    expect(isResponseStillCurrent(1, 1)).toBe(true);
  });
  it("is false when a newer document has bumped the generation since the request was launched", () => {
    expect(isResponseStillCurrent(1, 2)).toBe(false);
  });
});
