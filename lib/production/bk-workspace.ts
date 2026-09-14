import { finalizationEligibility } from "./finalization-policy";
import type { getProductionApplication } from "./server";
import { buildBkWorkspace, type BkWorkspace, type BkContext } from "@/lib/bk-skjema/workspace";
import { BK_QUESTIONS, BkQuestionError, validateAnswer } from "@/lib/bk-skjema/questions";
import type { AnalysedSample } from "@/lib/bk-skjema/analyse-bundle";
import type { DatalabBlock, DatalabPage } from "@/lib/bk-skjema/datalab";
import { ProcessingPersistenceError } from "./processing-store";
import { reviewEalSelection } from "@/lib/hp-classification/eal";
type Application = Awaited<ReturnType<typeof getProductionApplication>>;

/** All assessment and source relationships are resolved under the application's scope. */
export async function loadBkWorkspace(app: Application, projectId: string, assessmentId: string, revision?: number) {
  let assessment = await app.processing.assessment(projectId, assessmentId);
  if (!assessment || !Array.isArray(assessment.bk_output?.fields)) return null;
  const [overview, saved, history, links, frozen, audit] = await Promise.all([app.processing.overview(projectId), revision === 0 ? Promise.resolve(null) : app.drafts.get(projectId,assessmentId,revision), app.drafts.history(projectId,assessmentId), app.drafts.links(projectId,assessmentId), app.finalizations.get(projectId,assessmentId), app.finalizations.audit(projectId,assessmentId)]);
  if (!overview || (revision !== undefined && revision > 0 && !saved)) return null;
  const finalization = frozen && (revision === undefined || revision === frozen.bk_revision) ? frozen : null;
  if(finalization) assessment = finalization.snapshot.assessment;
  const stream = finalization?.snapshot.stream ?? overview.streams.find(s => s.id === assessment.waste_stream_id);
  if (!stream) return null;
  type SavedEvidenceDocument={sourceDocumentId:string;documentRef:string;pages:DatalabPage[];blocks:Record<string,DatalabBlock>};
  const snapshot = assessment.decision_snapshot as unknown as AnalysedSample & {originProcess?:string|null;versions?: import("./types").JsonObject;processingRunId?: string;evidence?: {pages: DatalabPage[]; blocks: Record<string,DatalabBlock>};evidenceDocuments?:SavedEvidenceDocument[]; sourceDocumentId?: string; evidenceSet?: {processingRunIds?:string[]}};
  if (!snapshot.classification || !snapshot.metadata) return null;
  const sample: AnalysedSample & {originProcess?: string|null} = {...snapshot, fields: assessment.bk_output!.fields as unknown as AnalysedSample["fields"]};
  const context: BkContext = finalization?.snapshot.workspace.context ?? saved?.workspace.context ?? {projectId,projectName:overview.project.name,pickupLocation:overview.project.location,streamId:stream.id,originProcess:stream.origin_process};
  let workspace = finalization?.snapshot.workspace ?? saved?.workspace ?? buildBkWorkspace(sample,context);
  if(!workspace.ealDecision) workspace=buildBkWorkspace(sample,context,workspace.answers);
  // Metadata links, not a caller-provided document ID, authorize the evidence source.
  const sourceId = links.find(l => l.source_document_id === snapshot.sourceDocumentId)?.source_document_id ?? links[0]?.source_document_id;
  const sourceDocuments=finalization?.snapshot.sources.map(source=>source.document)??overview.documents;
  const document = sourceDocuments.find(d => d.id === sourceId) ?? null;
  const savedEvidence=snapshot.evidenceDocuments?.length?snapshot.evidenceDocuments:snapshot.evidence&&snapshot.sourceDocumentId?[{sourceDocumentId:snapshot.sourceDocumentId,documentRef:`sha256:${document?.sha256??""}`,pages:snapshot.evidence.pages,blocks:snapshot.evidence.blocks}]:[];
  const evidenceDocuments=[...new Map(links.flatMap(link=>{
    const linked=sourceDocuments.find(item=>item.id===link.source_document_id);if(!linked)return [];
    const evidence=savedEvidence.find(item=>item.sourceDocumentId===linked.id||item.documentRef===`sha256:${linked.sha256}`);
    return [[linked.id,{document:linked,pages:(evidence?.pages??[]).filter(page=>page.page>=(link.first_page??0)&&page.page<=(link.last_page??Infinity)),blocks:evidence?.blocks??{}}] as const];
  })).values()];
  const primaryEvidence=evidenceDocuments.find(item=>item.document.id===document?.id)??evidenceDocuments[0];
  const processingRunIds = snapshot.evidenceSet?.processingRunIds?.length ? snapshot.evidenceSet.processingRunIds : snapshot.processingRunId ? [snapshot.processingRunId] : [];
  const processingComplete = processingRunIds.length > 0 && processingRunIds.every(id=>overview.runs.some(r=>r.id===id&&r.status==="completed"));
  const eligibility = finalizationEligibility(assessment,workspace,processingComplete);
  return { assessmentId, projectId, projectName:workspace.context.projectName, streamName:stream.name, workspace, revision:finalization?.bk_revision ?? saved?.revision ?? 0, history,
    replacementChoices:overview.assessments.filter(a=>a.id!==assessmentId&&a.waste_stream_id===assessment.waste_stream_id).map(a=>({id:a.id,label:`Assessment from ${new Date(a.created_at).toLocaleDateString("en-GB")}`})),
    assessmentCreatedAt:assessment.created_at, assessmentVersion: assessment.version, previousAssessmentId:assessment.previous_assessment_id, audit, eligibility,
    finalization: finalization ? {id:finalization.id,finalizedAt:finalization.finalized_at,pdfSha256:finalization.pdf_sha256,legalFreezes:finalization.snapshot.legalFreezes,acknowledgedGaps:finalization.snapshot.acknowledgedGaps} : null,
    normalizationTrace:snapshot.normalizationTrace??null, versions:snapshot.versions??null,
    document:primaryEvidence?.document??document, pages:primaryEvidence?.pages??[], blocks:primaryEvidence?.blocks??{},evidenceDocuments, classification:snapshot.classification, results:snapshot.results ?? [], sample };
}
export type LoadedBkWorkspace = NonNullable<Awaited<ReturnType<typeof loadBkWorkspace>>>;

export async function answerBkQuestions(app: Application, projectId: string, assessmentId: string, input: {id: string; expectedRevision: number; answers: Record<string, unknown>}) {
  if(await app.finalizations.get(projectId,assessmentId))throw new ProcessingPersistenceError("Assessment finalized; create a successor", "40001");
  const loaded = await loadBkWorkspace(app,projectId,assessmentId);
  if (!loaded) throw new ProcessingPersistenceError("Assessment unavailable", "23503");
  const entries = Object.entries(input.answers);
  if (!entries.length || entries.length > BK_QUESTIONS.length) throw new BkQuestionError("Provide at least one valid draft answer.");
  let base = loaded.workspace;
  if (loaded.revision !== input.expectedRevision) {
    const existing = await app.drafts.get(projectId,assessmentId,input.expectedRevision+1);
    if (existing?.id !== input.id) throw new ProcessingPersistenceError("Draft changed; reload before saving", "40001");
    const predecessor = input.expectedRevision ? await app.drafts.get(projectId,assessmentId,input.expectedRevision) : null;
    base = predecessor?.workspace ?? buildBkWorkspace(loaded.sample,existing.workspace.context);
  }
  const answers = {...base.answers};
  for (const [questionId, rawAnswer] of entries) {
    const decision = base.decisions.find(d => d.questionId === questionId);
    if (!decision || decision.status === "not_applicable" || !BK_QUESTIONS.some(q => q.id === questionId)) throw new BkQuestionError("This question does not apply to the current draft.");
    answers[questionId] = validateAnswer(questionId,rawAnswer);
  }
  const workspace: BkWorkspace = buildBkWorkspace(loaded.sample,base.context,answers,base.ealDecision);
  return app.drafts.save(projectId,assessmentId,input.id,input.expectedRevision,workspace);
}

export async function answerBkQuestion(app: Application, projectId: string, assessmentId: string, input: {id: string; expectedRevision: number; questionId: string; answer: unknown}) {
  return answerBkQuestions(app,projectId,assessmentId,{id:input.id,expectedRevision:input.expectedRevision,answers:{[input.questionId]:input.answer}});
}

export async function reviewAssessmentEal(app: Application,projectId:string,assessmentId:string,input:{id:string;expectedRevision:number;selectedCode:string;reason:string}) {
  const loaded=await loadBkWorkspace(app,projectId,assessmentId);
  if(!loaded)throw new ProcessingPersistenceError("Assessment unavailable","23503");
  if(await app.finalizations.get(projectId,assessmentId))throw new ProcessingPersistenceError("Assessment finalized; create a successor","40001");
  if(loaded.revision!==input.expectedRevision)throw new ProcessingPersistenceError("Draft changed; reload before saving","40001");
  const reviewed=reviewEalSelection(loaded.workspace.ealDecision,input);
  const workspace=buildBkWorkspace(loaded.sample,loaded.workspace.context,loaded.workspace.answers,reviewed);
  return app.drafts.reviewEal(projectId,assessmentId,input.id,input.expectedRevision,workspace);
}
