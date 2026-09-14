import { HP_RULE_VERSION } from "@/lib/hp-classification/hp-outcome";
import { BK_MAPPING_VERSION } from "@/lib/bk-skjema/questions";

/** Bump the relevant identifier whenever its implementation/reference data changes.
 * Captured at execution, never assigned retrospectively to historical assessments. */
export const PRODUCTION_VERSIONS = {
  classificationEngine: "production-hp-engine-2026-09-10.2",
  hpRules: HP_RULE_VERSION,
  ealLogic: "eal-structured-2026-09-10.1",
  bkMapping: BK_MAPPING_VERSION,
  normalization: "measurement-boundary-2026-09-10.1",
  measurementBoundary: "measurement-boundary-1",
} as const;
export const FINALIZATION_VERSION = "production-finalization-2";
