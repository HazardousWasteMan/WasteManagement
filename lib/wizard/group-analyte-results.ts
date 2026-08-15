import analyteReferenceRaw from "@/lib/data/analyte-reference.json";

interface AnalyteReferenceEntry {
  analyteId: string;
  substanceGroup: string;
}

const analyteReference = analyteReferenceRaw as AnalyteReferenceEntry[];

export interface AnalyteResultRow {
  rawAnalyteName: string;
  analyteId: string | null;
  resultValue: number | null;
  unitRaw: string;
}

export interface AnalyteResultGroup {
  groupName: string;
  rows: AnalyteResultRow[];
}

const NOT_IN_REFERENCE_TABLE = "Not in reference table";

const SUBSTANCE_GROUP_LABELS: Record<string, string> = {
  metal: "Metals",
  PAH: "PAH",
  hydrocarbon: "Hydrocarbons",
  PFAS: "PFAS",
  PCB: "PCB",
  other: "Other",
};

// Groups analyte result rows by their matched AnalyteReference's substanceGroup, for a
// collapsible-section display instead of one long flat list on the wizard's review step. Rows
// with no match (analyteId is null) go into their own "Not in reference table" group rather than
// being guessed into a real category — mirrors this codebase's "never guess" discipline.
export function groupAnalyteResults(results: AnalyteResultRow[]): AnalyteResultGroup[] {
  const groups = new Map<string, AnalyteResultRow[]>();
  for (const row of results) {
    const ref = row.analyteId ? analyteReference.find(a => a.analyteId === row.analyteId) : undefined;
    const groupName = ref ? (SUBSTANCE_GROUP_LABELS[ref.substanceGroup] ?? ref.substanceGroup) : NOT_IN_REFERENCE_TABLE;
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName)!.push(row);
  }
  const entries = Array.from(groups.entries());
  entries.sort((a, b) => {
    if (a[0] === NOT_IN_REFERENCE_TABLE) return 1;
    if (b[0] === NOT_IN_REFERENCE_TABLE) return -1;
    return 0;
  });
  return entries.map(([groupName, rows]) => ({ groupName, rows }));
}
