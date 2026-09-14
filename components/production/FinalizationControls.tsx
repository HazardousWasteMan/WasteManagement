"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LoadedBkWorkspace } from "@/lib/production/bk-workspace";
import type { BkWorkspace } from "@/lib/bk-skjema/workspace";
import { BK_QUESTIONS } from "@/lib/bk-skjema/questions";
import { finalizationGaps } from "@/lib/production/finalization-policy";
import { formatProductionDate } from "@/lib/production/presentation";

const eventLabels:Record<string,string>={assessment_created:"Assessment created",classification_recorded:"Classification recorded",source_evidence_captured:"Source evidence saved",legal_evidence_captured:"Legal evidence saved",bk_revision_saved:"BK information saved",eal_reviewed:"EAL reviewed",assessment_finalized:"Assessment finalized",successor_created:"New assessment created"};

export function FinalizationControls({base,initial,workspace,revision,eligibility,readOnly,busy}:{base:string;initial:Omit<LoadedBkWorkspace,"sample">;workspace:BkWorkspace;revision:number;eligibility:LoadedBkWorkspace["eligibility"];readOnly:boolean;busy:boolean}) {
  const router=useRouter();
  const [acknowledged,setAcknowledged]=useState<string[]>([]);
  const [replacement,setReplacement]=useState("");
  const [working,setWorking]=useState(false);
  const [error,setError]=useState("");
  const request=useRef<{payload:string;id:string}|null>(null);
  const gaps=finalizationGaps(workspace);
  const reasons=eligibility.reasons.filter(r=>r!=="Complete the required user questions.");
  async function act(action:"finalize"|"successor") {
    const payload=JSON.stringify(action==="finalize"?{expectedRevision:revision,acknowledgedGaps:gaps.map(g=>g.id)}:replacement?{replacementAssessmentId:replacement}:{});
    if(request.current?.payload!==payload)request.current={payload,id:crypto.randomUUID()};
    setWorking(true);setError("");
    try{
      const response=await fetch(`${base}/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...JSON.parse(payload),id:request.current.id})});
      const body=await response.json();if(!response.ok)throw new Error(body.error??"Could not complete this action.");
      if(action==="successor")router.push(`/production/projects/${initial.projectId}/assessments/${body.assessmentId}`);
      else router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"Request failed. Retry using this page.");setWorking(false);}
  }
  return <section className="rounded-2xl border border-forest/10 bg-white p-5 space-y-3 text-sm shadow-sm" aria-label="Finalize assessment">
    {initial.finalization ? <>
      <p className="text-lg font-semibold">Finalized</p>
      <p>The BK document and supporting evidence are preserved. Changes require a new assessment.</p>
      <label className="block">Evidence for the new revision<select className="block w-full rounded border p-2" value={replacement} onChange={e=>setReplacement(e.target.value)} disabled={working}>
        <option value="">Keep the same analysis and answers</option>
        {initial.replacementChoices.map(choice=><option key={choice.id} value={choice.id}>{choice.label}</option>)}
      </select></label>
      {replacement&&<p>Use this processed analysis for the same waste stream. Human questions start fresh; the prior finalized evidence remains unchanged.</p>}
      <button className="font-medium underline disabled:opacity-50" disabled={working} onClick={()=>act("successor")}>Create a new assessment</button>
      <details><summary>Frozen evidence record</summary><p>The generated BK document, assessment evidence and source references are stored together.</p>
        {initial.finalization.legalFreezes.map(f=><details key={f.id}><summary>Legal source · {f.paragraph.article}/{f.paragraph.paragraph}</summary><p>Verified {formatProductionDate(f.lastVerifiedAtAtFreeze)} · Preserved {formatProductionDate(f.frozenAt)} · {f.disputed?"Disputed when preserved":"No dispute recorded when preserved"}</p><p className="whitespace-pre-wrap">{f.paragraphTextAtFreeze}</p></details>)}
        <p>Acknowledged gaps: {initial.finalization.acknowledgedGaps.join(", ")||"None"}</p>
      </details>
    </> : <>
      <p className="text-lg font-semibold">{workspace.state==="ready"?"Ready to finalize":"Complete the remaining information"}</p>
      {workspace.state==="ready"&&!readOnly&&<>
        <p>Required user questions complete. Receiver-only fields do not block finalization.</p>
        <p>Classification recorded · {gaps.some(g=>g.id==="legal-evidence")?"Legal evidence unavailable":"Saved legal references will be validated"}</p>
        {gaps.length>0&&<fieldset className="space-y-1"><legend>Acknowledge unresolved evidence ({gaps.length})</legend>{gaps.map(g=><label className="flex items-start gap-2" key={g.id}><input type="checkbox" checked={acknowledged.includes(g.id)} onChange={e=>setAcknowledged(current=>e.target.checked?[...current,g.id]:current.filter(id=>id!==g.id))}/>{g.title} remains unresolved. Finalization does not resolve this gap.</label>)}</fieldset>}
        {reasons.map(reason=><p key={reason}>{reason}</p>)}
        <button className="rounded-xl bg-forest text-cream px-3 py-2 disabled:opacity-50" disabled={busy||working||!!reasons.length||gaps.some(g=>!acknowledged.includes(g.id))} onClick={()=>act("finalize")}>{working?"Finalizing…":"Finalize BK"}</button>
      </>}
    </>}
    <p className="text-xs">This records the assessment, including limitations. It is not a signature or approval for disposal.</p>
    {error&&<p role="alert" className="text-red-800">{error}</p>}
    <details className="border-t border-forest/10 pt-3"><summary className="cursor-pointer font-medium">Assessment history</summary>
      <p>Created {formatProductionDate(initial.assessmentCreatedAt)}</p>
      {initial.previousAssessmentId&&<a className="underline" href={`/production/projects/${initial.projectId}/assessments/${initial.previousAssessmentId}`}>Previous assessment</a>}
      <ol>{initial.audit.map(event=><li key={event.id}>{formatProductionDate(event.occurred_at)} · {eventLabels[event.kind]??"Assessment activity"}{Array.isArray(event.detail.changedQuestions)&&<ul>{event.detail.changedQuestions.map(id=><li key={String(id)}>{BK_QUESTIONS.find(q=>q.id===id)?.title??"BK information"}</li>)}</ul>}</li>)}</ol>
      <p className="text-xs">Events identify the portal application account, not an individual employee.</p>
    </details>
  </section>;
}
