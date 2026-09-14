import type { HazardClassification } from "@/lib/hp-classification/hazard";

export function formatProductionDate(value:string) {
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"}).format(date);
}

export type EffectiveHazardStatus="hazardous"|"non_hazardous"|"indeterminate";
/** Legacy booleans are not proof that every HP property was assessed. */
export function effectiveHazardStatus(input:{hazard?:HazardClassification|null;persisted:boolean|null}):EffectiveHazardStatus {
  const aggregate=input.hazard?.aggregate;
  if(aggregate?.status==="hazardous"&&input.hazard?.isHazardous===true)return "hazardous";
  if(aggregate?.status==="non_hazardous"&&input.hazard?.isHazardous===false)return "non_hazardous";
  return "indeterminate";
}
