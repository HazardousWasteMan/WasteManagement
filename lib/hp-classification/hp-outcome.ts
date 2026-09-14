export const HP_RULE_VERSION = "hp-waste-2026-09-10.2";
export const HP_CODES = ["HP1","HP2","HP3","HP4","HP5","HP6","HP7","HP8","HP9","HP10","HP11","HP12","HP13","HP14","HP15"] as const;
export type HpCode = typeof HP_CODES[number];
export type HpStatus = "triggered" | "not_triggered" | "not_assessable" | "not_applicable" | "requires_manual_assessment";
export type HpIssue = { code: string; measurementIds: string[]; reason: string };
export type RuleCalculation = { rule: string; formula: string; thresholdPct: number; lower: number; upper: number; upperInclusive: boolean; scenarios: {measurementGroup: string; scenarioId: string; contribution: number}[]; cutoffPct: Record<string,number>; inputIds: string[] };
export type HpOutcome = { hp: HpCode; status: HpStatus; coverage: "screening_only" | "property_assessed"; reason: string; measurementIds: string[]; inputIds: string[]; ruleVersion: string; calculations: RuleCalculation[]; issues: HpIssue[]; conservativeAssumption: boolean; supersededBy?: HpCode };
export type AggregateHazard = { status: "hazardous" | "non_hazardous" | "indeterminate"; issues: HpIssue[]; ruleVersion: string };
/** All 15 properties need an explicit resolved assessment. A positive proof takes precedence;
 * exclusions still remain review blockers for production finalization. */
export function aggregateHp(outcomes: Partial<Record<HpCode,HpOutcome>>, issues: HpIssue[] = []): AggregateHazard {
  const unresolved = HP_CODES.filter(hp => !outcomes[hp] || (["not_triggered","not_applicable"].includes(outcomes[hp]?.status ?? "") && outcomes[hp]?.coverage !== "property_assessed") || !["triggered","not_triggered","not_applicable"].includes(outcomes[hp]!.status));
  const allIssues = [...issues, ...HP_CODES.flatMap(hp => outcomes[hp]?.issues ?? []), ...unresolved.map(hp => ({code:"unresolved_hp",measurementIds:[],reason:`${hp} lacks a resolved assessment`}))];
  const triggered = HP_CODES.some(hp => outcomes[hp]?.status === "triggered");
  return {status:triggered ? "hazardous" : unresolved.length || allIssues.length ? "indeterminate" : "non_hazardous", issues:allIssues,ruleVersion:HP_RULE_VERSION};
}
export type LegacyHpOutcome = boolean | string;
/** Read-only compatibility: legacy false is not proof of sufficient assessment. */
export function readHpOutcome(hp: string, value: HpOutcome | LegacyHpOutcome): HpOutcome {
  if (typeof value === "object") return value;
  return {hp:hp as HpCode,coverage:"screening_only",status:value===true?"triggered":"not_assessable",reason:"Legacy result: reprocess for versioned HP evidence",measurementIds:[],inputIds:[],ruleVersion:"legacy",calculations:[],issues:[{code:"legacy_hp_evidence",measurementIds:[],reason:"Historical result has no structured assessment evidence"}],conservativeAssumption:false};
}
/** Recognized CLP suffixes only; unknown suffixes must not accidentally match a rule. */
export function normalizeHStatement(raw: string): string | null {
  const code=raw.trim().replace(/\s+/g,"").toUpperCase();
  if (/^H360(?:F|D|FD|DF)?$/.test(code)) return "H360";
  if (/^H361(?:F|D|FD|DF)?$/.test(code)) return "H361";
  if (/^H350I?$/.test(code)) return "H350";
  return /^(?:H\d{3}|EUH\d{3})$/.test(code) ? code : null;
}
