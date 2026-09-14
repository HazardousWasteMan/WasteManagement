import catalogueRaw from "../data/eal-koder-full.json";

export const EAL_MODEL_VERSION = "eal-structured-2026-09-10.1";
export type EalResolutionStatus = "resolved" | "ambiguous" | "insufficient_context" | "requires_human_review" | "not_applicable";
export type EalReviewState = "machine_resolved" | "review_required" | "human_resolved";
export type EalEntryType = "absolute_hazardous" | "absolute_non_hazardous" | "mirror_hazardous" | "mirror_non_hazardous" | "unknown";
export type EalEvidence = { value: string | null; source: "origin_process" | "sample_material" | "laboratory_statement" | "human_review"; reason: string };
export type EalCandidate = { code: string; description: string; hazardous: boolean; chapter: string; entryType: EalEntryType; materialMatch: "exact" | "related" | "none"; evidence: string[] };
export type EalHumanSelection = { selectedCode: string; reason: string; actor: string | null; timestamp: string | null; evidenceSnapshot: EalEvidence[] };

export interface EalAssignment {
  modelVersion: typeof EAL_MODEL_VERSION | "legacy";
  candidates: EalCandidate[];
  suggestedCode: string | null;
  selectedCode: string | null;
  resolutionStatus: EalResolutionStatus;
  reviewState: EalReviewState;
  reason: string;
  reasonNo: string;
  originEvidence: EalEvidence[];
  materialEvidence: EalEvidence[];
  machineSuggestion: { code: string | null; reason: string };
  humanSelection: EalHumanSelection | null;
  /** Compatibility projection; new decisions use selectedCode. */
  code: string | null;
  description: string | null;
  confidence: string;
  confidenceNo: string;
}

export type EffectiveEal = {
  code: string | null;
  status: "reviewed" | "machine_resolved" | "needs_review";
  label: string;
  assignment: EalAssignment | null;
};

/** UI/read-model projection only. It never selects a candidate or changes EAL evidence. */
export function effectiveEal(input: {
  decisions?: Array<EalAssignment | null | undefined>;
  persistedCode?: string | null;
}): EffectiveEal {
  const decisions = input.decisions?.filter((decision): decision is EalAssignment => Boolean(decision)) ?? [];
  const reviewed = decisions.find(decision =>
    decision.reviewState === "human_resolved" &&
    decision.resolutionStatus === "resolved" &&
    Boolean(decision.selectedCode && decision.humanSelection?.selectedCode)
  );
  if (reviewed?.selectedCode) return { code: reviewed.selectedCode, status: "reviewed", label: reviewed.selectedCode, assignment: reviewed };

  const machine = decisions.find(decision =>
    decision.reviewState === "machine_resolved" &&
    decision.resolutionStatus === "resolved" &&
    Boolean(decision.selectedCode)
  );
  if (machine?.selectedCode) return { code: machine.selectedCode, status: "machine_resolved", label: machine.selectedCode, assignment: machine };

  // A structured unresolved decision is authoritative. The persisted column is only a
  // compatibility projection for assessments that predate structured EAL evidence.
  if (!decisions.length && input.persistedCode) return { code: input.persistedCode, status: "machine_resolved", label: input.persistedCode, assignment: null };
  return { code: null, status: "needs_review", label: "Needs review", assignment: decisions[0] ?? null };
}

type CatalogueEntry = { nivaa: number; kode: string; beskrivelse: string; beskrivelseEn: string | null; farlig: boolean };
const catalogue = catalogueRaw as CatalogueEntry[];
const formatCode = (entry: Pick<CatalogueEntry,"kode"|"farlig">) => `${entry.kode.slice(0,2)} ${entry.kode.slice(2,4)} ${entry.kode.slice(4,6)}${entry.farlig ? "*" : ""}`;
const cleanCode = (value: string) => value.replace(/\s/g, "").toUpperCase();
const ignored = new Set(["and","the","other","waste","avfall","som","enn","det","fra","med"]);
const words = (value: string) => new Set(value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9æøå]+/g," ").split(/\s+/).filter(word=>word.length>2&&!ignored.has(word)));
const isMirrorDescription = (value: string) => /containing dangerous substances|other than those mentioned|inneholder farlige stoffer|annet enn det som er nevnt|annen enn den nevnt|andre enn dem nevnt/i.test(value);

function entryType(entry: CatalogueEntry, siblings: CatalogueEntry[]): EalEntryType {
  if (isMirrorDescription(`${entry.beskrivelse} ${entry.beskrivelseEn ?? ""}`) && siblings.some(other=>other.farlig!==entry.farlig&&isMirrorDescription(`${other.beskrivelse} ${other.beskrivelseEn ?? ""}`))) return entry.farlig ? "mirror_hazardous" : "mirror_non_hazardous";
  return entry.farlig ? "absolute_hazardous" : "absolute_non_hazardous";
}
function materialMatch(entry: CatalogueEntry, material: string | null): EalCandidate["materialMatch"] {
  if (!material?.trim()) return "none";
  const materialWords=words(material); const descriptions=words(`${entry.beskrivelse} ${entry.beskrivelseEn ?? ""}`);
  const common=[...materialWords].filter(word=>descriptions.has(word));
  if (common.length===materialWords.size&&materialWords.size>0) return "exact";
  return common.length>0 ? "related" : "none";
}
function finish(base: Omit<EalAssignment,"code"|"description"|"confidence"|"confidenceNo">): EalAssignment {
  const chosen=base.selectedCode ? base.candidates.find(candidate=>cleanCode(candidate.code)===cleanCode(base.selectedCode!)) : null;
  return {...base,code:base.selectedCode,description:chosen?.description??null,confidence:base.reason,confidenceNo:base.reasonNo};
}

export function resolveEal(input: {hazardStatus:"hazardous"|"non_hazardous"|"indeterminate";originProcess:string|null;material:string|null;labStatedEalCode:string|null;originToChapterLookup:Record<string,string>;catalogue?:CatalogueEntry[]}): EalAssignment {
  const entries=input.catalogue??catalogue;
  const originEvidence:EalEvidence[]=[{value:input.originProcess,source:"origin_process",reason:input.originProcess?"Saved origin/process supplied by the assessment.":"Origin/process is missing."}];
  const materialEvidence:EalEvidence[]=[{value:input.material,source:"sample_material",reason:input.material?"Material reported for this sample.":"Sample-specific material is missing."}];
  if(!input.originProcess) return finish({modelVersion:EAL_MODEL_VERSION,candidates:[],suggestedCode:null,selectedCode:null,resolutionStatus:"insufficient_context",reviewState:"review_required",reason:"Missing origin/process; an EAL chapter cannot be selected.",reasonNo:"Mangler opprinnelse/prosess; EAL-kapittel kan ikke velges.",originEvidence,materialEvidence,machineSuggestion:{code:null,reason:"No origin/process."},humanSelection:null});
  const chapter=input.originToChapterLookup[input.originProcess];
  if(!chapter) return finish({modelVersion:EAL_MODEL_VERSION,candidates:[],suggestedCode:null,selectedCode:null,resolutionStatus:"insufficient_context",reviewState:"review_required",reason:`No EAL chapter mapping exists for origin/process “${input.originProcess}”.`,reasonNo:`Ingen EAL-kapittelmapping finnes for opprinnelse/prosess «${input.originProcess}».`,originEvidence,materialEvidence,machineSuggestion:{code:null,reason:"Origin/process has no chapter mapping."},humanSelection:null});
  const siblings=entries.filter(entry=>entry.nivaa===3&&entry.kode.startsWith(chapter));
  const candidates=siblings.map(entry=>({code:formatCode(entry),description:entry.beskrivelseEn??entry.beskrivelse,hazardous:entry.farlig,chapter,entryType:entryType(entry,siblings),materialMatch:materialMatch(entry,input.material),evidence:[`origin:${input.originProcess}`,...(input.material?[`material:${input.material}`]:[])]} satisfies EalCandidate)).sort((a,b)=>cleanCode(a.code).localeCompare(cleanCode(b.code)));
  if(!candidates.length) return finish({modelVersion:EAL_MODEL_VERSION,candidates:[],suggestedCode:null,selectedCode:null,resolutionStatus:"insufficient_context",reviewState:"review_required",reason:`No leaf EAL entries exist under chapter ${chapter}.`,reasonNo:`Ingen EAL-koder på laveste nivå finnes under kapittel ${chapter}.`,originEvidence,materialEvidence,machineSuggestion:{code:null,reason:"No candidates in mapped chapter."},humanSelection:null});

  const lab=input.labStatedEalCode ? candidates.find(candidate=>cleanCode(candidate.code)===cleanCode(input.labStatedEalCode!)) : null;
  const materialPool=candidates.filter(candidate=>candidate.materialMatch==="exact");
  const plausible=materialPool.length ? materialPool : input.material ? candidates.filter(candidate=>candidate.materialMatch==="related") : candidates;
  let suggested:EalCandidate|null=lab??null;
  let reason=lab?"The laboratory-stated code is retained as a machine suggestion within the origin chapter; human review is still required.":"";
  if(!suggested&&plausible.length===1) { suggested=plausible[0]; reason="Origin/process and sample material identify one plausible entry."; }
  const mirrorPool=plausible.filter(candidate=>candidate.entryType.startsWith("mirror_"));
  if(!suggested&&mirrorPool.length>=2&&input.hazardStatus!=="indeterminate") {
    const matching=mirrorPool.filter(candidate=>candidate.hazardous===(input.hazardStatus==="hazardous"));
    if(matching.length===1) { suggested=matching[0]; reason="The material-specific mirror pair is resolved using the reviewed HP aggregate."; }
  }
  const absolute=suggested&&suggested.entryType.startsWith("absolute_");
  const mirror=suggested&&suggested.entryType.startsWith("mirror_");
  const resolved=Boolean(!lab&&suggested&&((absolute&&plausible.length===1)||(mirror&&input.hazardStatus!=="indeterminate"&&mirrorPool.filter(candidate=>candidate.hazardous===(input.hazardStatus==="hazardous")).length===1)));
  const mirrorBlocked=Boolean(input.material&&input.hazardStatus==="indeterminate"&&mirrorPool.length);
  const status:EalResolutionStatus = resolved ? "resolved" : mirrorBlocked ? "requires_human_review" : plausible.length>1 ? "ambiguous" : "requires_human_review";
  if(!reason) reason=mirrorBlocked?"The material has mirror entries, but the HP aggregate is indeterminate.":plausible.length>1?"Several entries remain plausible; candidate order is not a decision.":"The available context does not support a final EAL selection.";
  return finish({modelVersion:EAL_MODEL_VERSION,candidates,suggestedCode:suggested?.code??null,selectedCode:resolved?suggested!.code:null,resolutionStatus:status,reviewState:resolved?"machine_resolved":"review_required",reason,reasonNo:status==="resolved"?"EAL-koden er løst fra dokumentert opprinnelse, materiale og relevant farestatus.":"EAL-koden krever gjennomgang; kandidatlisten er ikke en endelig tildeling.",originEvidence,materialEvidence,machineSuggestion:{code:suggested?.code??null,reason},humanSelection:null});
}

export function reviewEalSelection(machine:EalAssignment,input:{selectedCode:string;reason:string;evidence?:EalEvidence[]}):EalAssignment {
  if(machine.modelVersion!==EAL_MODEL_VERSION)throw new Error("Legacy EAL evidence must be reprocessed before review.");
  const candidate=machine.candidates.find(item=>cleanCode(item.code)===cleanCode(input.selectedCode));
  if(!candidate)throw new Error("Select a code from the saved candidate set.");
  const reason=input.reason.trim();
  if(!reason)throw new Error("Record a reason for the reviewed EAL selection.");
  return finish({...machine,selectedCode:candidate.code,resolutionStatus:"resolved",reviewState:"human_resolved",reason:`Human-reviewed selection: ${reason}`,reasonNo:`Menneskelig gjennomgått valg: ${reason}`,humanSelection:{selectedCode:candidate.code,reason,actor:null,timestamp:null,evidenceSnapshot:structuredClone(input.evidence??[...machine.originEvidence,...machine.materialEvidence])}});
}

export function readEalAssignment(value:unknown):EalAssignment {
  if(value&&typeof value==="object"&&!Array.isArray(value)&&(value as EalAssignment).modelVersion===EAL_MODEL_VERSION)return structuredClone(value as EalAssignment);
  const legacy=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const code=typeof legacy.code==="string"?legacy.code:null;
  const description=typeof legacy.description==="string"?legacy.description:null;
  const confidence=typeof legacy.confidence==="string"?legacy.confidence:"Legacy EAL snapshot";
  const candidate: EalCandidate[] = code?[{code,description:description??"Legacy description unavailable",hazardous:code.endsWith("*"),chapter:cleanCode(code).slice(0,4),entryType:"unknown",materialMatch:"none",evidence:["legacy_snapshot"]}]:[];
  return {modelVersion:"legacy",candidates:candidate,suggestedCode:code,selectedCode:code,resolutionStatus:"requires_human_review",reviewState:"review_required",reason:confidence,reasonNo:typeof legacy.confidenceNo==="string"?legacy.confidenceNo:"Eldre EAL-resultat krever ny behandling.",originEvidence:[],materialEvidence:[],machineSuggestion:{code,reason:confidence},humanSelection:null,code,description,confidence,confidenceNo:typeof legacy.confidenceNo==="string"?legacy.confidenceNo:"Eldre EAL-resultat krever ny behandling."};
}

/** Compatibility entry point shared by both extraction paths. */
export function assignEalCode(isHazardous:boolean|null,originProcess:string|null,labStatedEalCode:string|null,originToChapterLookup:Record<string,string>,material:string|null=null):EalAssignment {
  return resolveEal({hazardStatus:isHazardous===null?"indeterminate":isHazardous?"hazardous":"non_hazardous",originProcess,material,labStatedEalCode,originToChapterLookup});
}
