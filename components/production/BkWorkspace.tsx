"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FinalizationControls } from "./FinalizationControls";
import { FormPane } from "@/components/data-lab/FormPane";
import { DocumentPane } from "@/components/data-lab/DocumentPane";
import { LegalCitationBadge } from "@/components/data-lab/LegalCitationBadge";
import { BK_QUESTIONS, type BkQuestion, type BkAnswer, type BkAnswers } from "@/lib/bk-skjema/questions";
import { decisionForField, questionValues, fieldAttention, legalFieldsForDecision, type BkWorkspace as Workspace } from "@/lib/bk-skjema/workspace";
import { sourceHighlights } from "@/lib/bk-skjema/evidence";
import { effectiveEal } from "@/lib/hp-classification/eal";
import type { LoadedBkWorkspace } from "@/lib/production/bk-workspace";
import type { BkField } from "@/lib/bk-skjema/form-map";
import { HazardAssessmentPanel } from "./HazardAssessmentPanel";
import { ProductionStatus } from "./ProductionStatus";

type Props = Omit<LoadedBkWorkspace,"sample"> & { readOnly?: boolean; focusEal?: boolean };
const button = "rounded-xl bg-forest text-cream px-3 py-2 text-sm disabled:opacity-50";
const secondaryButton = "rounded-xl border border-forest/25 bg-white px-3 py-2 text-sm font-medium";
const input = "w-full rounded-lg border border-forest/20 bg-white p-2";
const labels = { complete: "Complete", derived: "Generated from assessment", needs_input: "Needs input", cannot_determine: "Cannot determine", not_applicable: "Not applicable" };
function decisionExplanation(status:keyof typeof labels) {
  if(status==="needs_input")return "Supply or confirm this information before finalization.";
  if(status==="cannot_determine")return "The available evidence does not support a reliable value.";
  if(status==="derived")return "Generated from the saved assessment evidence.";
  if(status==="not_applicable")return "This item does not apply to the current waste stream.";
  return "Supported by the saved information and evidence.";
}
export function UnsavedStatus({count}:{count:number}) {return count?<span role="status" className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Unsaved changes · {count}</span>:<span role="status" className="text-xs text-forest/55">All changes saved</span>;}

export function answerForQuestion(question:BkQuestion,workspace:Workspace):BkAnswer {
  const saved=workspace.answers[question.id];
  if(saved)return structuredClone(saved);
  if(question.kind==="choice") {
    const selected=question.options?.find(option=>option.controls.some(name=>{
      const field=workspace.fields.find(item=>item.field===name);
      return field?.check || (field?.select && option.exports?.[name]===field.select);
    }));
    return {value:selected?.value??"",detail:""};
  }
  if(question.kind==="multi_choice") {
    return {selected:question.options?.filter(option=>option.controls.some(name=>workspace.fields.find(item=>item.field===name)?.check)).map(option=>option.value)??[],detail:""};
  }
  return {values:questionValues(question,workspace.fields)};
}

/** Saving answers updates the workspace but leaves the user's evidence selection alone. */
export function selectionAfterSave(selected:string|null,next:Workspace) {
  return selected && next.fields.some(field=>field.field===selected) ? selected : null;
}

export function evidenceDocumentForField(field:BkField|undefined,sources:LoadedBkWorkspace["evidenceDocuments"]) {
  const reference=field?.citations?.find(citation=>citation.documentRef)?.documentRef;
  if(!reference)return null;
  return sources.find(source=>source.document.id===reference||`sha256:${source.document.sha256}`===reference)?.document.id??null;
}

function QuestionFields({question,answer,onChange,disabled,changed}:{question:BkQuestion;answer:BkAnswer;onChange:(answer:BkAnswer)=>void;disabled:boolean;changed:boolean}) {
  if(question.kind==="measurement"||question.kind==="receiver")return null;
  const selectedOption=question.options?.find(option=>option.value===answer.value);
  const selectedOptions=question.options?.filter(option=>(answer.selected??(answer.value?[answer.value]:[])).includes(option.value))??[];
  function toggle(value:string) {
    const current=answer.selected??(answer.value?[answer.value]:[]);
    const option=question.options!.find(item=>item.value===value)!;
    const none=question.options!.find(item=>/^none$/i.test(item.label));
    const selected=/^none$/i.test(option.label) ? [value] : current.includes(value) ? current.filter(item=>item!==value) : [...current.filter(item=>item!==none?.value),value];
    onChange({selected,detail:answer.detail??""});
  }
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="sr-only">{question.title}</legend>
    {question.options?.map(option=><label key={option.value} className="flex gap-2 items-start text-sm">
      <input type={question.kind==="multi_choice"?"checkbox":"radio"} name={`question-${question.id}`} value={option.value} checked={question.kind==="multi_choice"?selectedOptions.some(item=>item.value===option.value):answer.value===option.value} onChange={()=>question.kind==="multi_choice"?toggle(option.value):onChange({...answer,value:option.value})} required={changed&&question.kind!=="multi_choice"} className="mt-1"/>
      {option.label}
    </label>)}
    {selectedOption&&/other/i.test(selectedOption.label)&&<label className="block text-sm">Details<textarea className={input} required={changed} value={answer.detail??""} onChange={event=>onChange({...answer,detail:event.target.value})} maxLength={250}/></label>}
    {question.kind==="multi_choice"&&selectedOptions.some(option=>/other/i.test(option.label))&&<label className="block text-sm">Details<textarea className={input} required={changed} value={answer.detail??""} onChange={event=>onChange({...answer,detail:event.target.value})} maxLength={250}/></label>}
    {question.parts?.map(part=><label key={part.key} className="block text-sm">{part.label}
      {part.max>300
        ? <textarea className={input} value={answer.values?.[part.key]??""} onChange={event=>onChange({...answer,values:{...answer.values,[part.key]:event.target.value}})} required={changed} maxLength={part.max}/>
        : <input className={input} value={answer.values?.[part.key]??""} onChange={event=>onChange({...answer,values:{...answer.values,[part.key]:event.target.value}})} required={changed} maxLength={part.max} pattern={part.pattern}/>
      }
    </label>)}
  </fieldset>;
}

function EalReviewEditor({workspace,onSave,disabled}:{workspace:Workspace;onSave:(code:string,reason:string)=>Promise<void>;disabled:boolean}) {
  const eal=workspace.ealDecision;
  const [code,setCode]=useState(eal.selectedCode??eal.suggestedCode??"");
  const [reason,setReason]=useState(eal.humanSelection?.reason??"");
  const [error,setError]=useState("");
  const suggestion=eal.candidates.find(candidate=>candidate.code===eal.suggestedCode);
  return <form id="eal-review" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4" onSubmit={async event=>{event.preventDefault();setError("");try{await onSave(code,reason);}catch(error){setError(error instanceof Error?error.message:"Could not save EAL review.");}}}>
    <fieldset disabled={disabled||!eal.candidates.length} className="space-y-3">
      <legend className="font-medium">Review EAL</legend>
      <p className="text-sm"><strong>Suggested:</strong> {suggestion?`${suggestion.code} · ${suggestion.description}`:"No single candidate is suggested"}</p>
      <p className="text-sm text-forest/70">{eal.reason}</p>
      {!!eal.originEvidence.length&&<ul className="list-disc pl-5 text-xs text-forest/70">{[...eal.originEvidence,...eal.materialEvidence].map((item,index)=><li key={`${item.source}-${index}`}>{item.value||"Missing evidence"}: {item.reason}</li>)}</ul>}
      {!!eal.candidates.length&&<details className="rounded-lg border border-forest/10 bg-white p-3"><summary className="cursor-pointer text-sm font-medium">Why these codes are candidates</summary><ul className="mt-2 space-y-2 text-sm">{eal.candidates.map(candidate=><li key={candidate.code}><strong>{candidate.code} · {candidate.description}</strong><br/><span className="text-forest/60">{candidate.materialMatch==="exact"?"Material description matches this entry.":candidate.materialMatch==="related"?"Material description is related to this entry.":"Included by the documented waste origin; material evidence is not specific enough to narrow it further."}</span></li>)}</ul></details>}
      <label className="block text-sm">Selected code<select className={input} required value={code} onChange={event=>setCode(event.target.value)}><option value="">Select a candidate</option>{eal.candidates.map(candidate=><option key={candidate.code} value={candidate.code}>{candidate.code} · {candidate.description}{candidate.code===eal.suggestedCode?" · suggested":""}</option>)}</select></label>
      <label className="block text-sm">Reason for selection<textarea className={input} required maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <button className={button} disabled={disabled||!eal.candidates.length}>{disabled?"Saving…":"Save reviewed EAL"}</button>
    </fieldset>
    {eal.humanSelection&&<p className="text-xs text-forest/70">Current reviewed selection: {eal.humanSelection.selectedCode} · {eal.humanSelection.reason}{eal.humanSelection.timestamp?` · ${eal.humanSelection.timestamp}`:""}</p>}
    {!eal.candidates.length&&<p className="text-sm">No candidates are available. Add valid origin/process evidence and reprocess the source document.</p>}
    {error&&<p role="alert" className="text-red-800 text-sm">{error}</p>}
  </form>;
}

export function BkWorkspace({readOnly=false,focusEal=false,...initial}:Props) {
  const [workspace,setWorkspace] = useState(initial.workspace);
  const [revision,setRevision] = useState(initial.revision);
  const [eligibility,setEligibility]=useState(initial.eligibility);
  const ealControl=initial.workspace.decisions.find(decision=>decision.id==="eal")?.controls[0]??null;
  const [selected,setSelected] = useState<string|null>(focusEal?ealControl:initial.workspace.decisions.find(decision=>decision.status==="needs_input")?.controls[0]??null);
  const [formPdf,setFormPdf] = useState<{revision:number;blob:Blob}|null>(null);
  const [formErrorRevision,setFormErrorRevision] = useState<number|null>(null);
  const [activeDocumentId,setActiveDocumentId]=useState(initial.document?.id??initial.evidenceDocuments[0]?.document.id??null);
  const [sourcePdf,setSourcePdf] = useState<{documentId:string;blob:Blob}|null>(null);
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  const [dirtyIds,setDirtyIds] = useState<string[]>([]);
  const [draftAnswers,setDraftAnswers] = useState<BkAnswers>(()=>Object.fromEntries(BK_QUESTIONS.map(question=>[question.id,answerForQuestion(question,initial.workspace)])));
  const [ealReviewOpen,setEalReviewOpen]=useState(focusEal);
  const attempt = useRef<{payload:string;id:string}|null>(null);
  const base = `/api/production/projects/${initial.projectId}/assessments/${initial.assessmentId}`;
  const activeEvidence=initial.evidenceDocuments.find(item=>item.document.id===activeDocumentId)??initial.evidenceDocuments[0];
  const activeDocument=activeEvidence?.document??initial.document;
  const resolvedDocumentId=activeDocument?.id??null;
  const sourceUrl = activeDocument ? `/api/production/projects/${initial.projectId}/documents/${activeDocument.id}` : null;
  useEffect(()=>{
    if(!sourceUrl||!resolvedDocumentId)return;
    const controller = new AbortController();
    const documentId=resolvedDocumentId;
    fetch(sourceUrl,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error("Source document could not be loaded.");return response.blob();}).then(blob=>setSourcePdf({documentId,blob})).catch(error=>{if(!controller.signal.aborted)setError(error.message);});
    return ()=>controller.abort();
  },[sourceUrl,resolvedDocumentId]);
  useEffect(()=>{
    const controller = new AbortController();
    fetch(`${base}/bk?revision=${revision}`,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error("BK PDF could not be generated. Reload to retry.");return response.blob();}).then(blob=>setFormPdf({revision,blob})).catch(error=>{if(!controller.signal.aborted){setError(error.message);setFormErrorRevision(revision);}});
    return ()=>controller.abort();
  },[base,revision]);
  const field = workspace.fields.find(item=>item.field===selected);
  const decision = selected ? decisionForField(workspace,selected) : undefined;
  const activeDocumentRef=activeDocument?`sha256:${activeDocument.sha256}`:undefined;
  const highlights = useMemo(()=>sourceHighlights(field,activeDocumentRef),[field,activeDocumentRef]);
  const attention = useMemo(()=>fieldAttention(workspace),[workspace]);
  const legalFields = legalFieldsForDecision(workspace,decision);
  const needs = workspace.decisions.filter(item=>item.status==="needs_input");
  const effective=effectiveEal({decisions:[workspace.ealDecision],persistedCode:initial.classification.eal.code});
  const formLoading=formPdf?.revision!==revision&&formErrorRevision!==revision;
  const editableQuestions=BK_QUESTIONS.filter(item=>item.kind!=="measurement"&&item.kind!=="receiver"&&workspace.decisions.some(decision=>decision.questionId===item.id&&decision.status!=="not_applicable"));
  function selectEvidenceField(fieldName:string|null){
    setSelected(fieldName);
    const next=workspace.fields.find(item=>item.field===fieldName);
    const sourceId=evidenceDocumentForField(next,initial.evidenceDocuments);
    if(sourceId)setActiveDocumentId(sourceId);
  }
  function updateDraft(questionId:string,answer:BkAnswer){setDraftAnswers(previous=>({...previous,[questionId]:answer}));setDirtyIds(previous=>previous.includes(questionId)?previous:[...previous,questionId]);attempt.current=null;}
  function nextRequired() {const index=needs.findIndex(item=>item.id===decision?.id);const next=needs[(index+1)%needs.length];if(next)setSelected(next.controls[0]);}
  async function saveChanges(event:React.FormEvent) {
    event.preventDefault();
    if(!dirtyIds.length)return;
    const answers=Object.fromEntries(dirtyIds.map(id=>[id,draftAnswers[id]]));
    const payload=JSON.stringify({expectedRevision:revision,answers});
    if(attempt.current?.payload!==payload)attempt.current={payload,id:crypto.randomUUID()};
    setSaving(true);setError("");
    try {
      const response=await fetch(`${base}/draft`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...JSON.parse(payload),id:attempt.current.id})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not save changes.");
      setSelected(current=>selectionAfterSave(current,body.workspace));
      setWorkspace(body.workspace);setRevision(body.revision);if(body.eligibility)setEligibility(body.eligibility);setDraftAnswers(Object.fromEntries(BK_QUESTIONS.map(item=>[item.id,answerForQuestion(item,body.workspace)])));setDirtyIds([]);attempt.current=null;
    } catch(error) {setError(error instanceof Error?error.message:"Could not save changes.");}
    finally {setSaving(false);}
  }
  async function saveEal(selectedCode:string,reason:string) {
    const payload=JSON.stringify({expectedRevision:revision,selectedCode,reason});
    if(attempt.current?.payload!==payload)attempt.current={payload,id:crypto.randomUUID()};
    setSaving(true);setError("");
    try{
      const response=await fetch(`${base}/eal-review`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...JSON.parse(payload),id:attempt.current.id})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not save EAL review.");
      setSelected(current=>selectionAfterSave(current,body.workspace));setWorkspace(body.workspace);setRevision(body.revision);if(body.eligibility)setEligibility(body.eligibility);attempt.current=null;
    } finally {setSaving(false);}
  }
  async function dispute(field:BkField,reason:string,raisedBy:string) {
    const primary=field.legalCitation!.citations.find(citation=>citation.primary)??field.legalCitation!.citations[0];
    const response=await fetch("/api/compliance/disputes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({paragraphId:primary.paragraphId,citedFieldKey:field.legalCitationKey,freezeId:null,reason,raisedBy})});
    if(!response.ok)throw new Error("Dispute could not be saved");
  }
  const legalBasisAvailable=workspace.fields.some(item=>item.legalCitation);
  return <main className="mx-auto min-h-screen max-w-[1500px] space-y-7 px-4 py-6 text-forest sm:px-6 lg:px-8">
    <header className="space-y-5 border-b border-forest/10 pb-6"><Link href={`/production/projects/${initial.projectId}`} className="text-sm font-medium text-forest/60 hover:underline">← {initial.projectName}</Link><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-forest/50">Basiskarakterisering</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{initial.streamName}</h1></div><a href={`${base}/bk?revision=${revision}`} className={button}>{initial.finalization?"Download finalized BK":"Download draft BK"}</a></div>
      <ol className="grid gap-2 text-sm sm:grid-cols-4" aria-label="BK progress"><li className="rounded-xl bg-white px-3 py-2 ring-1 ring-forest/10"><strong>1</strong> Review information</li><li className="rounded-xl bg-white px-3 py-2 ring-1 ring-forest/10"><strong>2</strong> Complete questions</li><li className="rounded-xl bg-white px-3 py-2 ring-1 ring-forest/10"><strong>3</strong> Review EAL</li><li className="rounded-xl bg-white px-3 py-2 ring-1 ring-forest/10"><strong>4</strong> Preview and finalize</li></ol>
    </header>
    {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,.95fr)]">
      <div className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Assessment summary"><div className="rounded-2xl border border-forest/10 bg-white p-5"><p className="text-xs font-medium uppercase tracking-wide text-forest/50">BK status</p><div className="mt-2"><ProductionStatus tone={initial.finalization||workspace.state==="ready"?"success":"warning"}>{initial.finalization?"Finalized":readOnly?"Saved version":workspace.state==="ready"?"Ready to finalize":`Needs input · ${needs.length} remaining`}</ProductionStatus></div><p className="mt-3 text-sm text-forest/60">{initial.finalization?"This record is immutable.":workspace.summary.cannotDetermine?`${workspace.summary.cannotDetermine} items cannot be determined from current evidence.`:"Required information is available."}</p></div>
          <div className="rounded-2xl border border-forest/10 bg-white p-5"><p className="text-xs font-medium uppercase tracking-wide text-forest/50">EAL</p><p className="mt-1 text-xl font-semibold">{effective.label}</p><p className="mt-1 text-sm text-forest/60">{effective.status==="reviewed"?"Reviewed selection":effective.status==="machine_resolved"?"Resolved from the assessment evidence":"Several codes may apply"}</p>{!readOnly&&<button className="mt-3 text-sm font-semibold underline underline-offset-4" onClick={()=>{setSelected(ealControl);setEalReviewOpen(value=>!value)}}>{effective.status==="needs_review"?"Review EAL":"Review"}</button>}</div></section>
        {ealReviewOpen&&!readOnly&&<EalReviewEditor workspace={workspace} onSave={saveEal} disabled={saving}/>}
        <HazardAssessmentPanel hazard={initial.classification.hazard} measurements={initial.classification.measurementBoundary?.measurements??[]} hasGeneralLegalBasis={legalBasisAvailable}/>
        {!readOnly&&<form className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm" onSubmit={saveChanges}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Complete BK information</h2><p className="mt-1 text-sm text-forest/60">Review generated information and complete the remaining questions. You can edit several answers before saving.</p></div><UnsavedStatus count={dirtyIds.length}/></div>
          <div className="mt-5 space-y-3">{editableQuestions.map(item=>{const itemDecision=workspace.decisions.find(value=>value.questionId===item.id)!;return <details key={item.id} open={itemDecision.status==="needs_input"} className="rounded-xl border border-forest/10 px-4 py-3"><summary className="cursor-pointer font-medium">{item.title} <span className="text-xs font-normal text-forest/55">· {labels[itemDecision.status]}</span></summary><div className="mt-3"><p className="mb-3 text-xs text-forest/60">{decisionExplanation(itemDecision.status)}</p><QuestionFields question={item} answer={draftAnswers[item.id]??answerForQuestion(item,workspace)} onChange={answer=>updateDraft(item.id,answer)} disabled={saving} changed={dirtyIds.includes(item.id)}/></div></details>;})}</div>
          <div className="sticky bottom-3 mt-5 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-forest/10 bg-white/95 p-3 shadow-lg backdrop-blur"><button type="button" className={secondaryButton} onClick={nextRequired} disabled={!needs.length}>Next required</button><button className={button} disabled={saving||!dirtyIds.length}>{saving?"Saving changes…":"Save changes"}</button></div>
        </form>}
        <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">BK preview</h2><p className="mt-1 text-sm text-forest/60">Select a marked field to view its source evidence.</p></div>{formLoading&&<span role="status" className="text-xs text-forest/55">Updating preview…</span>}</div><div className="relative mt-5 min-h-72" aria-busy={formLoading}>{formPdf?<FormPane pdf={formPdf.blob} fields={workspace.fields} attention={attention} selected={selected} onSelect={item=>selectEvidenceField(item.field)}/>:<p role="status" className="text-sm text-forest/60">Preparing BK preview…</p>}</div></section>
        <FinalizationControls base={base} initial={initial} workspace={workspace} revision={revision} eligibility={eligibility} readOnly={readOnly} busy={saving}/>
      </div>
      <aside className="space-y-4 rounded-2xl border border-forest/10 bg-white p-4 shadow-sm xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto" aria-label="Source evidence">
        <div><p className="text-xs font-medium uppercase tracking-wide text-forest/45">Source document</p><h2 className="mt-1 text-lg font-semibold">{activeDocument?.filename??"Evidence"}</h2></div>
        {decision?<section className="rounded-xl bg-cream/70 p-4"><h3 className="font-semibold">{decision.title}</h3><p className="mt-1 text-sm font-medium">{decision.source==="receiver"?"Completed by receiving facility":labels[decision.status]}</p><p className="mt-2 text-sm text-forest/65">{decision.source==="receiver"?"This information is completed by the receiving facility.":decisionExplanation(decision.status)}</p>{decision.status==="cannot_determine"&&<p className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm">Current evidence is insufficient for a safe conclusion.</p>}{!!field?.citations?.length&&<div className="mt-3 text-sm"><h4 className="font-medium">Selected source</h4>{field.citations.map((citation,index)=><p key={index}>Page {citation.page===null?"unknown":citation.page+1}: {citation.text||"Source region referenced"}</p>)}</div>}{legalFields.length?<details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Legal basis</summary>{legalFields.map(item=><LegalCitationBadge key={`${item.legalCitationKey}:${revision}`} citation={item.legalCitation!} onDispute={(reason,name)=>dispute(item,reason,name)}/>)}</details>:null}</section>:<p className="text-sm text-forest/60">Select a BK field or decision to inspect its evidence.</p>}
        {sourcePdf&&sourcePdf.documentId===activeDocument?.id?<DocumentPane key={sourcePdf.documentId} file={sourcePdf.blob} pages={activeEvidence?.pages??[]} highlights={highlights} blocks={activeEvidence?.blocks??{}}/>:<div className="rounded-xl bg-cream/70 p-5 text-sm text-forest/60">{sourceUrl?"Loading source document…":"No source document is linked to this assessment."}</div>}
        <details className="border-t border-forest/10 pt-3"><summary className="cursor-pointer text-sm font-medium">Review all BK decisions</summary><div className="mt-3 space-y-1">{workspace.decisions.map(item=><button type="button" key={item.id} onClick={()=>selectEvidenceField(item.controls[0])} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-cream">{item.title} <span className="text-forest/50">· {item.source==="receiver"?"Receiving facility":labels[item.status]}</span></button>)}</div></details>
        {readOnly&&<Link className="text-sm font-medium underline" href={`/production/projects/${initial.projectId}/assessments/${initial.assessmentId}`}>Open current workspace</Link>}
      </aside>
    </div>
  </main>;
}
