import { test, expect } from "vitest";
import { syntheticSample } from "@/tests/production/synthetic-fixtures";

test("a limited invented extraction remains indeterminate", () => {
  const classification=syntheticSample("indeterminate").classification;
  expect(classification.hazard.isHazardous).toBeNull();
  expect(classification.hazard.aggregate?.status).toBe("indeterminate");
  expect(classification.hazard.triggeredHps).toEqual([]);
  expect(classification.eal.code).toBeNull();
});
