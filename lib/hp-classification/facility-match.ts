import facilityStoleheia from "../data/facility-stoleheia.json";
import facilityReturkraft from "../data/facility-returkraft.json";
import crosswalk from "../data/avfallsstoffnummer-eal-crosswalk.json";

export interface FacilityMatchInput {
  isHazardous: boolean;
  ealCode: string;
  matrixType: string | null;
}

export interface FacilityMatchResult {
  facilityId: "stoleheia" | "returkraft";
  eligible: boolean | "likely" | "insufficient data" | "requires crosswalk (not available for this code)";
  route: string;
  detail?: unknown;
  caveat?: string;
  reason?: string;
}

function checkStoleheia(input: FacilityMatchInput): FacilityMatchResult {
  if (input.isHazardous) {
    const fixedMatch = facilityStoleheia.fixedHazardousEalLines.find(line => line.ealCode === input.ealCode);
    if (fixedMatch) {
      return {
        facilityId: "stoleheia",
        eligible: true,
        route: "fixed hazardous EAL line",
        detail: fixedMatch,
      };
    }
    return {
      facilityId: "stoleheia",
      eligible: "likely",
      route: "generic hazardous bucket (avfallsforskriften vedlegg II pkt 2.3)",
      detail: facilityStoleheia.genericHazardousBucket,
      caveat:
        "Eligibility depends on the waste meeting the 'stable, non-reactive' criteria of vedlegg II pkt 2.3 — not verifiable from composition data alone.",
    };
  }

  return {
    facilityId: "stoleheia",
    eligible: "insufficient data",
    route: "ordinary/contaminated mass path (leachate-tier dependent)",
    reason:
      "No leaching/eluat test on this sample — deponi acceptance tier (A1/B1/C1) cannot be determined from composition data alone.",
  };
}

function checkReturkraft(input: FacilityMatchInput): FacilityMatchResult {
  const matrixLower = (input.matrixType ?? "").toLowerCase().trim();
  const isMineral = matrixLower.length > 0 && facilityReturkraft.mineralMatrixExclusion.some(m => matrixLower.includes(m));

  if (isMineral) {
    return {
      facilityId: "returkraft",
      eligible: false,
      route: "composition exclusion",
      reason: `Matrix '${input.matrixType}' is mineral/inorganic — doesn't combust, doesn't fit Returkraft's accepted-fraction profile regardless of hazard status.`,
    };
  }

  if (matrixLower.length === 0) {
    return {
      facilityId: "returkraft",
      eligible: "insufficient data",
      route: "composition exclusion",
      reason:
        "No matrix type recorded on this sample — cannot assess Returkraft's composition exclusion (mineral/inorganic waste doesn't fit this facility regardless of hazard status) without knowing the matrix.",
    };
  }

  const crosswalkMatch = crosswalk.find(entry => entry.ealCode === input.ealCode);
  if (crosswalkMatch) {
    return {
      facilityId: "returkraft",
      eligible: "insufficient data",
      route: "composition exclusion / avfallsstoffnummer crosswalk",
      detail: crosswalkMatch,
      reason: `Matrix '${input.matrixType}' does not match Returkraft's known Norwegian-language mineral exclusion vocabulary (${facilityReturkraft.mineralMatrixExclusion.join(", ")}), so the composition exclusion cannot be confidently ruled out for this description — an EAL crosswalk match alone (avfallsstoffnummer ${crosswalkMatch.avfallsstoffnummer}) is not sufficient to confirm eligibility without also confirming the matrix isn't mineral/inorganic under a different-language description.`,
      caveat: crosswalkMatch.isApproximate
        ? `The EAL-to-avfallsstoffnummer mapping (${crosswalkMatch.avfallsstoffnummer}) is itself also cited as approximate in the source permit — ${crosswalkMatch.sourceNote}`
        : undefined,
    };
  }

  return {
    facilityId: "returkraft",
    eligible: "requires crosswalk (not available for this code)",
    route: "avfallsstoffnummer crosswalk",
    reason: `No avfallsstoffnummer crosswalk entry found for EAL code '${input.ealCode}' — matching against Returkraft's accepted-fraction list requires this mapping, which is only available for a small set of permit-cited codes.`,
  };
}

export function matchFacilities(input: FacilityMatchInput): {
  stoleheia: FacilityMatchResult;
  returkraft: FacilityMatchResult;
} {
  return {
    stoleheia: checkStoleheia(input),
    returkraft: checkReturkraft(input),
  };
}
