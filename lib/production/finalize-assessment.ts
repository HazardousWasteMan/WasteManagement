import { buildBkWorkspace } from "@/lib/bk-skjema/workspace";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { buildFormFreeze } from "@/lib/compliance/freeze";
import { fillBkPdf, BK_BLANK_FORM_PATH } from "@/lib/bk-skjema/fill-pdf";
import { BkQuestionError } from "@/lib/bk-skjema/questions";
import { loadBkWorkspace } from "./bk-workspace";
import { ProcessingPersistenceError } from "./processing-store";
import type { getProductionApplication } from "./server";
import type { LegalFreeze } from "./finalization-store";
import { FINALIZATION_VERSION } from "./versions";

type Application=Awaited<ReturnType<typeof getProductionApplication>>;
const hash=(bytes: string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

export async function finalizeAssessment(app: Application, projectId: string, assessmentId: string, input: {id:string;expectedRevision:number;acknowledgedGaps:string[]}) {
  const existing=await app.finalizations.get(projectId,assessmentId);
  if(existing){
    if(existing.id===input.id&&existing.bk_revision===input.expectedRevision&&JSON.stringify(existing.snapshot.acknowledgedGaps)===JSON.stringify(input.acknowledgedGaps))return existing.id;
    throw new ProcessingPersistenceError("Assessment already finalized","40001");
  }
  const loaded=await loadBkWorkspace(app,projectId,assessmentId);
  if(!loaded)throw new ProcessingPersistenceError("Assessment unavailable","23503");
  if(loaded.revision!==input.expectedRevision)throw new ProcessingPersistenceError("Draft changed","40001");
  if(loaded.eligibility.reasons.length)throw new BkQuestionError(loaded.eligibility.reasons.join(" "));
  if(JSON.stringify(loaded.eligibility.gaps.map(g=>g.id))!==JSON.stringify(input.acknowledgedGaps))throw new BkQuestionError("Explicitly acknowledge every unresolved evidence gap.");
  if(!loaded.document)throw new BkQuestionError("Persisted source evidence is required.");
  const c=loaded.classification;
  if(!c.hazard||![true,false,null].includes(c.hazard.isHazardous)||!Array.isArray(c.hazard.triggeredHps)||!c.eal||!(c.eal.code===null||/^\d{6}\*?$/.test(c.eal.code.replace(/ /g,""))))throw new BkQuestionError("Invalid saved classification state.");
  const legalFreezes: LegalFreeze[]=[];
  const seen=new Set<string>();
  for(const field of loaded.workspace.fields){
    const view=field.legalCitation;
    if(!view)continue;
    if(!field.legalCitationKey||!view.citations.length||view.citations.filter(c=>c.primary).length!==1)throw new BkQuestionError("Invalid legal evidence references.");
    for(const citation of view.citations){
      const key=`${field.legalCitationKey}:${citation.paragraphId}`;
      if(seen.has(key))continue;seen.add(key);
      const p=citation.paragraphSnapshot;
      if(!p||p.id!==citation.paragraphId||p.sourceLink!==citation.sourceLink||p.lastVerifiedAt!==citation.verifiedAt||!p.text||!Number.isFinite(Date.parse(p.lastVerifiedAt)))throw new BkQuestionError("Saved legal evidence lacks its original text/version. Reprocess to capture it; the current cache cannot replace historical evidence.");
      legalFreezes.push({...buildFormFreeze({caseId:assessmentId,fieldName:field.legalCitationKey,paragraph:p}),paragraph:structuredClone(p),contentSha256:hash(p.text),disputed:citation.disputed,primary:citation.primary});
    }
  }
  const blank=await fs.readFile(BK_BLANK_FORM_PATH);
  let generated: Awaited<ReturnType<typeof fillBkPdf>>;
  try { generated=await fillBkPdf(blank,loaded.workspace.fields,{fitText:true}); }
  catch { throw new BkQuestionError("BK generation failed. Check unsupported characters or field content. No artifact was finalized."); }
  if(generated.outcomes.some(o=>o.note?.startsWith("could not be set:")))throw new BkQuestionError("BK generation failed. No artifact was finalized.");
  // Read the generated form back; rendering success alone does not prove saved field values.
  const pdf=await PDFDocument.load(generated.pdf);
  for(const f of loaded.workspace.fields){
    if(f.value&&pdf.getForm().getTextField(f.field).getText()!==f.value)throw new BkQuestionError("Generated BK does not match saved values.");
  }
  pdf.setTitle("Finalized BK assessment");
  pdf.setSubject(`Assessment ${assessmentId}; BK revision ${input.expectedRevision}; finalization ${input.id}. Recorded with disclosed limitations, not disposal approval.`);
  return app.finalizations.finalize(projectId,assessmentId,{...input,pdf:await pdf.save(),legalFreezes,artifactVersion:{finalization:FINALIZATION_VERSION,bkMapping:loaded.workspace.mappingVersion!,templateSha256:hash(blank)}});
}

/** New analysis is chosen explicitly from this project. Reuse no human answers from the
 * previous material: fresh questions prevent stale producer/material/operational assumptions. */
export async function createAssessmentSuccessor(app: Application, projectId:string, assessmentId:string, input:{id:string;replacementAssessmentId?:string}) {
  if(!input.replacementAssessmentId)return app.finalizations.successor(projectId,assessmentId,input.id);
  if(input.replacementAssessmentId===assessmentId)throw new BkQuestionError("Choose a different processed assessment.");
  const [frozen,replacement]=await Promise.all([app.finalizations.get(projectId,assessmentId),loadBkWorkspace(app,projectId,input.replacementAssessmentId,0)]);
  if(!frozen||!replacement)throw new ProcessingPersistenceError("Replacement analysis unavailable","23503");
  if(replacement.workspace.context.streamId!==frozen.snapshot.assessment.waste_stream_id)throw new BkQuestionError("Replacement analysis must belong to this waste stream.");
  const blocking=replacement.eligibility.reasons.filter(reason=>reason!=="Complete the required user questions.");
  if(blocking.length)throw new BkQuestionError(`Replacement analysis is not usable yet. ${blocking.join(" ")}`);
  if(replacement.workspace.fields.some(f=>f.legalCitation?.citations.some(c=>!c.paragraphSnapshot)))throw new BkQuestionError("Replacement analysis needs its original legal evidence; reprocess it first.");
  const context={...frozen.snapshot.workspace.context,originProcess:replacement.sample.originProcess??replacement.workspace.context.originProcess};
  const workspace=buildBkWorkspace(replacement.sample,context);
  return app.finalizations.successor(projectId,assessmentId,input.id,{assessmentId:input.replacementAssessmentId,workspace});
}
