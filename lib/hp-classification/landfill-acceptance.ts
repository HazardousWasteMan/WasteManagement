import type { MeasurementBoundary } from "./measurement";

export type LandfillAcceptanceState = {
  status: "not_evaluated" | "evidence_available" | "requires_review" | "resolved";
  evidenceMeasurementIds: string[];
  reason: string;
};

/** Evidence inventory only. Step 3 deliberately does not evaluate acceptance criteria. */
export function inventoryLandfillAcceptance(boundary:MeasurementBoundary):LandfillAcceptanceState {
  const evidence=boundary.measurements.filter(measurement=>["leaching_batch","leaching_column","physical_or_composition"].includes(measurement.analyticalRole));
  return evidence.length?{
    status:"evidence_available",
    evidenceMeasurementIds:evidence.map(measurement=>measurement.measurementId),
    reason:"Potential landfill-acceptance evidence is present, but landfill acceptance has not been evaluated.",
  }:{status:"not_evaluated",evidenceMeasurementIds:[],reason:"Landfill acceptance has not been evaluated."};
}
