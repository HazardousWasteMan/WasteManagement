import { HP_RULE_VERSION } from "@/lib/hp-classification/hp-outcome";
import { EAL_MODEL_VERSION } from "@/lib/hp-classification/eal";
import type { BkWorkspace } from "@/lib/bk-skjema/workspace";
import type { Assessment } from "./types";
import { BK_QUESTIONS } from "@/lib/bk-skjema/questions";

/** Finalization records an evidenced decision, not disposal eligibility. All gaps must be
 * acknowledged by exact key; no checkbox changes a null classification into false. */
export function finalizationGaps(workspace: BkWorkspace) {
  const gaps = workspace.decisions.filter(d=>d.status==="cannot_determine").map(d=>({id:d.id,title:d.title}));
  if(!workspace.fields.some(f=>f.legalCitation?.citations.length))gaps.push({id:"legal-evidence",title:"Verified legal evidence unavailable"});
  return gaps.sort((a,b)=>a.id.localeCompare(b.id));
}
export function finalizationEligibility(assessment: Assessment, workspace: BkWorkspace, processingComplete: boolean) {
  const reasons: string[]=[];
  if(workspace.state!=="ready"||workspace.decisions.some(d=>d.status==="needs_input"))reasons.push("Complete the required user questions.");
  if(!processingComplete)reasons.push("Source processing must finish without failed or pending samples.");
  const s=assessment.decision_snapshot;
  if(s.extractionState && s.extractionState!=="complete")reasons.push("Source extraction is incomplete or requires review; it cannot support finalization.");
  if(!s.versions||!s.normalizationTrace||!workspace.mappingVersion)reasons.push("This analysis predates versioned provenance. Reprocess its source before finalizing.");
  const trace=s.normalizationTrace;
  if(trace&&typeof trace==="object"&&!Array.isArray(trace)&&Array.isArray(trace.normalized)&&trace.normalized.some(row=>row&&typeof row==="object"&&!Array.isArray(row)&&Array.isArray(row.confidenceFlags)&&row.confidenceFlags.some(flag=>typeof flag==="string"&&(/unrecognized unit|not on dry basis/.test(flag)))))reasons.push("Unsupported units or unconverted dry-basis values require review before finalization.");
  if (trace && typeof trace === "object" && !Array.isArray(trace)) {
    const boundary = trace.measurementBoundary;
    if (boundary && typeof boundary === "object" && !Array.isArray(boundary) && Array.isArray(boundary.measurements) && boundary.measurements.some(m => {
      if (!m || typeof m !== "object" || Array.isArray(m)) return false;
      const eligibility = m.hpEligibility;
      return eligibility && typeof eligibility === "object" && !Array.isArray(eligibility) && eligibility.eligible === false && !["leaching_batch", "leaching_column", "physical_or_composition"].includes(String(m.analyticalRole));
    })) reasons.push("Excluded or unresolved concentration evidence requires review before finalization.");
  }
  const classification=s.classification;
  if(classification&&typeof classification==="object"&&!Array.isArray(classification)&&classification.noDataWarning===true)reasons.push("No usable classification data was recorded. Reprocess with sufficient evidence.");
  const hazard = classification && typeof classification === "object" && !Array.isArray(classification) ? classification.hazard : null;
  const currentHazard = hazard && typeof hazard === "object" && !Array.isArray(hazard) ? hazard : null;
  const aggregate = currentHazard?.aggregate;
  const rawHpIssues = aggregate && typeof aggregate === "object" && !Array.isArray(aggregate) && Array.isArray(aggregate.issues) ? aggregate.issues : [];
  const hpIssues = rawHpIssues.map(issue=>({issue,disposition:aggregate && typeof aggregate === "object" && !Array.isArray(aggregate) && aggregate.status === "hazardous" ? "review" : "blocking"}));
  if(currentHazard?.outcomeVersion !== HP_RULE_VERSION || !aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) reasons.push("Reprocess legacy HP results before finalization; structured assessment evidence is required.");
  else if(aggregate.status === "indeterminate" || currentHazard.isHazardous === null) reasons.push("Indeterminate HP assessment blocks finalization; resolve the structured HP issues.");
  const eal=workspace.ealDecision;
  if(!eal||eal.modelVersion!==EAL_MODEL_VERSION) reasons.push("Reprocess legacy EAL evidence before finalization; a structured EAL decision is required.");
  else if(eal.resolutionStatus!=="resolved"||!eal.selectedCode) reasons.push("Resolve the EAL candidate decision before finalization.");
  else if(eal.reviewState==="human_resolved"&&(!eal.humanSelection?.reason.trim()||!eal.humanSelection.actor||!eal.humanSelection.timestamp||!Number.isFinite(Date.parse(eal.humanSelection.timestamp)))) reasons.push("A reviewed EAL selection requires its reason, actor and timestamp.");
  else if(!eal.candidates.some(candidate=>candidate.code.replace(/\s/g,"")===eal.selectedCode!.replace(/\s/g,""))) reasons.push("The selected EAL code is outside the saved candidate evidence.");
  const userQuestions=workspace.decisions.filter(d=>BK_QUESTIONS.some(q=>q.id===d.questionId&&q.kind!=="receiver"&&q.kind!=="measurement")&&d.status!=="not_applicable");
  return {reasons,hpIssues,gaps:finalizationGaps(workspace),questions:userQuestions.length,completed:userQuestions.filter(d=>d.status!=="needs_input").length};
}
