import depotsRaw from "@/lib/data/depots.json";

export interface Depot {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kommune: string;
  fylke: string;
  codes: string[]; // permitted avfallsstoffnr from the facility's tillatelse
  maxYearlyTonnes: string | null;
  permitUrl: string;
  extractionStatus: string;
}

// Real farlig avfall mottak from avfallsdeklarering.no + norskeutslipp.no permits,
// built by scripts/fill_farlig_avfall_csv.py. Re-run it to refresh lib/data/depots.json.
export const DEPOTS: Depot[] = depotsRaw as Depot[];

// Every station in this dataset is a hazardous-waste receiver; ordinary waste
// goes to municipal facilities that are not part of this permit dataset.
// With a concrete avfallsstoffnr, only stations whose permit covers it light up.
export function depotIsLit(depot: Depot, analysisIsHazardous: boolean, avfallsstoffnr?: string | null): boolean {
  if (!analysisIsHazardous) return false;
  if (!avfallsstoffnr) return true;
  return depot.codes.includes(avfallsstoffnr);
}
