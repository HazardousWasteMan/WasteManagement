import { finalizeAssessment, createAssessmentSuccessor } from "@/lib/production/finalize-assessment";
import { syntheticSample, syntheticPdf, SYNTHETIC_ANSWERS } from "./synthetic-fixtures";
import { buildLegalCitationView } from "@/lib/compliance/citation-view";
import type { LegalParagraph } from "@/lib/compliance/types";
import { createFinalizationStore } from "@/lib/production/finalization-store";
import { createBkDraftStore } from "@/lib/production/bk-draft-store";
import { answerBkQuestion, loadBkWorkspace, reviewAssessmentEal } from "@/lib/production/bk-workspace";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createCleanLocalDatabase, seedLocalOrganisation } from "@/scripts/production/local-database";
import { createProcessingStore } from "@/lib/production/processing-store";
import { createProductionStore } from "@/lib/production/store";
import { processProjectDocument, uploadProjectDocument } from "@/lib/production/process-document";
import { createAssessmentEvidenceSet } from "@/lib/production/assessment-evidence";
import { analyseBundle, type BundleAnalysis, type BundleEvent } from "@/lib/bk-skjema/analyse-bundle";
import { convertDocument, extractStructured, type DatalabBlock } from "@/lib/bk-skjema/datalab";
import type { ProductionDatabase } from "@/lib/production/types";
import { PDFDocument } from "pdf-lib";
import { renderToStaticMarkup } from "react-dom/server";
import ProjectPage from "@/app/production/projects/[projectId]/page";
vi.mock("next/navigation", async importOriginal => ({ ...await importOriginal<typeof import("next/navigation")>(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/bk-skjema/datalab", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/bk-skjema/datalab")>(), convertDocument: vi.fn(), extractStructured: vi.fn() }));
vi.mock("@/lib/bk-skjema/legal-citations", () => ({ resolveBundleLegalCitations: async () => ({}) }));
vi.mock("@/lib/production/server", () => ({ getProductionApplication: vi.fn() }));
import { getProductionApplication } from "@/lib/production/server";
import { POST as uploadRoute } from "@/app/api/production/projects/[projectId]/documents/route";
import { GET as downloadRoute } from "@/app/api/production/projects/[projectId]/documents/[documentId]/route";
import { GET as bkRoute } from "@/app/api/production/projects/[projectId]/assessments/[assessmentId]/bk/route";
import { POST as createRoute } from "@/app/api/production/projects/route";
import { POST as standaloneRoute } from "@/app/api/data-lab/route";
import { NextRequest } from "next/server";

function syntheticBundle(matrices=["Soil","Sediment","Concrete"]): BundleAnalysis & {originProcess:string} {
  const pages=matrices.map((_,page)=>({page,width:595,height:842}));
  const subReports=matrices.map((matrix,index)=>({sampleNo:`SYN-${index+1}`,marking:`Invented ${matrix} ${index+1}`,matrix,firstPage:index,lastPage:index,pageRange:String(index)}));
  const samples=subReports.map((subReport,index)=>{
    const sample=syntheticSample(index===1?"indeterminate":"hazardous",undefined,`invented-${index+1}`);
    return {...sample,subReport,metadata:{...sample.metadata,sampleMarking:subReport.marking,matrixType:subReport.matrix},raw:{...(sample.raw as Record<string,unknown>),provenummer:subReport.sampleNo,provemerking:subReport.marking,matrise:subReport.matrix}};
  });
  return {pageCount:pages.length,pages,subReports,samples,blocks:{},costCents:0,extractionState:"complete",failures:[],reviewIssues:[],originProcess:"escavo terre e rocce"};
}
const seed=syntheticBundle();
let pdf:Buffer;
let local: Awaited<ReturnType<typeof createCleanLocalDatabase>>;
let customer: Awaited<ReturnType<typeof seedLocalOrganisation>>;
let other: Awaited<ReturnType<typeof seedLocalOrganisation>>;
let projectId: string;
let siblingId: string;
let otherProjectId: string;
let store: ReturnType<typeof createProcessingStore>;
let drafts: ReturnType<typeof createBkDraftStore>;
let finalizations: ReturnType<typeof createFinalizationStore>;
let domain: ReturnType<typeof createProductionStore>;
const requests: URL[] = [];

// PostgREST/Auth transport is simulated; all production adapters, SQL, constraints and RLS
// execute against the entire unchanged migration chain in a fresh offline PostgreSQL DB.
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input)); requests.push(url);
  const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  try {
    if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").at(-1)!;
      if (!/^production_[a-z_]+$/.test(name)) throw new Error("Unexpected RPC");
      const args = JSON.parse(init!.body as string) as Record<string, unknown>;
      const keys = Object.keys(args);
      if (!keys.every(key => /^p_[a-z0-9_]+$/.test(key))) throw new Error("Unexpected argument");
      const sqlArgs = keys.map((key, index) => `${key} => $${index + 1}`).join(",");
      const values = Object.values(args).map(value => value !== null && typeof value === "object" ? JSON.stringify(value) : value);
      const { rows } = await local.db.query<{ result: unknown }>(`select ${name === "production_register_samples" ? "" : "to_jsonb("}public.${name}(${sqlArgs})${name === "production_register_samples" ? "" : ")"} as result`, values);
      return respond(rows[0].result);
    }
    const table = url.pathname.split("/").at(-1)!;
    if (!["production_finalizations", "production_audit_events", "production_bk_revisions", "assessment_source_documents", "projects", "source_documents", "production_processing_runs", "production_processing_samples", "waste_streams", "assessments"].includes(table)) throw new Error(`Unexpected table ${table}`);
    if (init?.method === "POST" && table === "projects") {
      const body = JSON.parse(init.body as string);
      const { rows } = await local.db.query("insert into projects(organisation_id,name,location) values ($1,$2,$3) returning *", [body.organisation_id, body.name, body.location ?? ""]);
      return respond(rows[0], 201);
    }
    const clauses: string[] = []; const values: string[] = [];
    for (const [key, value] of url.searchParams) {
      if (["organisation_id", "project_id", "assessment_id", "revision", "id"].includes(key)) { values.push(value.slice(3)); clauses.push(`${key}=$${values.length}`); }
    }
    // Require the adapter to enforce both tenant and project scope even for a member of
    // both organisations; RLS alone cannot guarantee route-level project separation.
    expect(url.searchParams.get("organisation_id")).toBe(`eq.${customer.organisationId}`);
    if (table !== "projects") expect(url.searchParams.has("project_id")).toBe(true);
    const order = table === "production_bk_revisions" ? " order by revision desc" : "";
    const limit = url.searchParams.get("limit") === "1" ? " limit 1" : "";
    const select = table === "production_finalizations" ? "id,organisation_id,project_id,assessment_id,bk_revision,snapshot,snapshot_sha256,pdf_sha256,finalized_at,created_by" : "*";
    const { rows } = await local.db.query(`select ${select} from ${table} where ${clauses.join(" and ")}${order}${limit}`, values);
    const single = new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object");
    return respond(single ? rows[0] ?? null : rows);
  } catch (error) {
    return respond({ message: error instanceof Error ? error.message : "Failure", code: (error as { code?: string }).code }, 400);
  }
};

function pipelineFixture(bundle = seed, failIndex = -1) {
  const blocks: Record<string, DatalabBlock> = { ...bundle.blocks };
  // Invented table headers exercise the real segmenter without replaying provider/customer data.
  for (const report of bundle.subReports) {
    const id = `/page/${report.firstPage}/Table/fixture-header`;
    blocks[id] = { id, page: report.firstPage, blockType: "Table", bbox: [0, 0, 100, 100], text: "", regions: [
      { kind: "row", cells: ["Prøvenr.:", report.sampleNo, "Prøvemerking:", report.marking ?? "", "Prøvetype:", report.matrix ?? ""], text: "", bbox: [0, 0, 100, 100] },
    ] };
  }
  vi.mocked(convertDocument).mockResolvedValue({ checkpointId: "fixture", blocks, pages: bundle.pages, pageCount: bundle.pageCount, costCents: 0 });
  vi.mocked(extractStructured).mockImplementation(async (_schema, _input, options) => {
    const index = bundle.subReports.findIndex(report => report.pageRange === options?.pageRange);
    if (index === failIndex) throw new Error("Simulated extraction failure");
    if (index < 0) throw new Error(`Unexpected range ${options?.pageRange}`);
    return { data: bundle.samples[index].raw, costCents: 0, scoreAverage: null };
  });
}
async function process(runId = crypto.randomUUID(), originProcess: string | null = seed.originProcess) {
  const document = await uploadProjectDocument(store, projectId, "analysis-report.pdf", pdf);
  const run = await processProjectDocument(store, { projectId, documentId: document.id, runId, originProcess });
  return { document, run };
}
async function count(table: string, id = projectId) {
  return (await local.db.query<{ count: number }>(`select count(*)::integer as count from ${table} where project_id=$1`, [id])).rows[0].count;
}

async function app() { return getProductionApplication(); }
async function persistSyntheticSample(sample: ReturnType<typeof syntheticSample>) {
  const document=await uploadProjectDocument(store,projectId,"invented-analysis.pdf",await syntheticPdf(1,crypto.randomUUID()));
  const run=await processProjectDocument(store,{projectId,documentId:document.id,runId:crypto.randomUUID(),originProcess:"escavo terre e rocce"},{citations:async()=>({}),analyse:async(_pdf,_filename,options)=>{
    await options!.onEvent!({phase:"segmented",subReports:[sample.subReport],pageCount:1,pages:[{page:0,width:595,height:842}],extractionState:"complete"});
    await options!.onEvent!({phase:"sample",index:0,total:1,sample},{pages:[{page:0,width:595,height:842}],blocks:{}});
    return {pageCount:1,pages:[],subReports:[sample.subReport],samples:[sample],blocks:{},costCents:0,extractionState:"complete",failures:[],reviewIssues:[]};
  }});
  const overview=(await store.overview(projectId))!;
  return {assessmentId:overview.samples.find(s=>s.run_id===run.id)!.assessment_id!,document};
}
async function syntheticProcess(kind: "ordinary"|"hazardous"|"indeterminate"|"unsupported"|"wet-basis"|"mixed-invalid"="hazardous", legal?: ReturnType<typeof buildLegalCitationView>, legacySnapshot=false,legacyEal=false) {
  const sample=syntheticSample(kind,legal?{"hp-methodology":legal,"eal-legal-basis":legal,"deponi-category-basis":legal}:undefined);
  if(legacySnapshot) {
    delete sample.classification.hazard.outcomeVersion;delete sample.classification.hazard.aggregate;
    sample.classification.hazard.resultsByHp={HP7:true,HP9:"requires case-specific assessment"};
  }
  if(legacyEal) sample.classification.eal={code:"17 05 03*",description:"Legacy soil entry",confidence:"legacy result",confidenceNo:"eldre resultat"} as unknown as typeof sample.classification.eal;
  return {...await persistSyntheticSample(sample),sample};
}
async function makeReady(id:string) {
  let loaded=(await loadBkWorkspace(await app(),projectId,id))!;
  for(let n=0;n<25;n++){
    const next=loaded.workspace.decisions.find(d=>d.status==="needs_input");if(!next)break;
    const answer=SYNTHETIC_ANSWERS[next.questionId as keyof typeof SYNTHETIC_ANSWERS];
    if(!answer)throw new Error(`No synthetic answer for ${next.questionId}`);
    await answerBkQuestion(await app(),projectId,id,{id:crypto.randomUUID(),expectedRevision:loaded.revision,questionId:next.questionId!,answer});
    loaded=(await loadBkWorkspace(await app(),projectId,id))!;
  }
  if(loaded.workspace.ealDecision.resolutionStatus!=="resolved"){
    const selectedCode=loaded.workspace.ealDecision.suggestedCode??loaded.workspace.ealDecision.candidates[0]?.code;
    if(!selectedCode)throw new Error("Synthetic fixture has no EAL candidate to review");
    await reviewAssessmentEal(await app(),projectId,id,{id:crypto.randomUUID(),expectedRevision:loaded.revision,selectedCode,reason:"Synthetic test review based on the saved origin and material evidence."});
    loaded=(await loadBkWorkspace(await app(),projectId,id))!;
  }
  expect(loaded.workspace.state).toBe("ready");return loaded;
}
async function finalizeReady(id:string) {
  const loaded=await makeReady(id);
  const input={id:crypto.randomUUID(),expectedRevision:loaded.revision,acknowledgedGaps:loaded.eligibility.gaps.map(g=>g.id)};
  await finalizeAssessment(await app(),projectId,id,input);return input;
}

describe("Phase 2 project upload, shared pipeline and persistence", () => {
  beforeAll(async () => {
    pdf=await syntheticPdf(seed.pageCount,"multi-sample-structure");
    local = await createCleanLocalDatabase();
    customer = await seedLocalOrganisation(local.db, "First customer");
    other = await seedLocalOrganisation(local.db, "Other customer");
    otherProjectId = (await local.db.query<{ id: string }>("insert into projects(organisation_id,name) values ($1,'Other customer site') returning id", [other.organisationId])).rows[0].id;
    await local.db.query("select set_config('request.jwt.claim.sub',$1,false)", [customer.userId]);
    await local.db.exec("set role authenticated");
    const client = createClient<ProductionDatabase>("http://127.0.0.1:54321", "test", { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
    store = createProcessingStore(client, customer.organisationId);
    domain = createProductionStore(client, customer.organisationId);
    drafts = createBkDraftStore(client, customer.organisationId);
    finalizations = createFinalizationStore(client, customer.organisationId);
  }, 30000);
  afterAll(async () => { await local?.db.close(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.clearAllMocks(); requests.length = 0;
    projectId = (await domain.createProject({ name: "Analysis site", location: "" })).id;
    siblingId = (await domain.createProject({ name: "Sibling site", location: "" })).id;
    vi.mocked(getProductionApplication).mockResolvedValue({ organisation: { id: customer.organisationId, name: "First customer" }, store: domain, drafts, finalizations, processing: store });
    pipelineFixture();
  });

  it("creates projects via context, ignoring arbitrary organisation input", async () => {
    const response = await createRoute(new Request("http://localhost/api/production/projects", { method: "POST", body: JSON.stringify({ name: "Created in UI", organisation_id: other.organisationId }) }));
    expect(response.status).toBe(201);
    expect((await response.json()).project.organisation_id).toBe(customer.organisationId);
    expect(getProductionApplication).toHaveBeenCalledWith();
  });

  it("uploads a generated PDF through the route, stores it once and saves all synthetic samples through the existing pipeline", async () => {
    const form = new FormData(); form.set("file", new File([new Uint8Array(pdf)], "synthetic-multi-sample.pdf", { type: "application/pdf" })); form.set("runId", crypto.randomUUID()); form.set("originProcess", seed.originProcess);
    const response = await uploadRoute(new Request("http://localhost/api/production/projects/upload", { method: "POST", body: form }), { params: Promise.resolve({ projectId }) });
    expect(response.status).toBe(200);
    const { document, run } = await response.json();
    expect(run.status).toBe("completed");
    expect(document).toMatchObject({ organisation_id: customer.organisationId, project_id: projectId, filename: "synthetic-multi-sample.pdf" });
    expect(document.created_at).toBeTruthy();
    expect(await count("production_document_files")).toBe(1);
    expect(await count("source_documents")).toBe(1);
    expect(await count("waste_streams")).toBe(3);
    expect(await count("assessments")).toBe(3);
    const links = (await local.db.query<{ source_document_id: string }>("select * from assessment_source_documents where project_id=$1", [projectId])).rows;
    expect(links).toHaveLength(3); expect(new Set(links.map(row => row.source_document_id))).toEqual(new Set([document.id]));
    expect(convertDocument).toHaveBeenCalledTimes(1); expect(extractStructured).toHaveBeenCalledTimes(3);
    const overview = (await store.overview(projectId))!;
    expect(overview.samples.every(sample => sample.status === "succeeded")).toBe(true);
    const assessment = (await store.assessment(projectId, overview.samples[0].assessment_id!))!;
    expect(assessment.decision_snapshot).toMatchObject({ pipeline: "analyseBundle", sourceDocumentId: document.id, snapshotVersion: 1 });
    expect(assessment.decision_snapshot.evidence).toHaveProperty("blocks");
    const download = await downloadRoute(new Request("http://localhost"), { params: Promise.resolve({ projectId, documentId: document.id }) });
    expect(Buffer.from(await download.arrayBuffer())).toEqual(pdf);
    const bk = await bkRoute(new Request("http://localhost"), { params: Promise.resolve({ projectId, assessmentId: assessment.id }) });
    expect(bk.status).toBe(200);
    const formPdf = await PDFDocument.load(await bk.arrayBuffer());
    expect(formPdf.getForm().getFields().length).toBeGreaterThan(20);
  }, 15000);

  it("supports sediment, soil and concrete as three independently classified streams sharing one PDF", async () => {
    const conceptual = syntheticBundle(["Sediment", "Soil", "Concrete"]);
    pipelineFixture(conceptual);
    await process();
    const overview = (await store.overview(projectId))!;
    expect(overview.streams.map(stream => stream.name).sort()).toEqual(["Invented Concrete 3", "Invented Sediment 1", "Invented Soil 2"]);
    expect(overview.assessments).toHaveLength(3); expect(overview.documents).toHaveLength(1);
  });

  it("retains successful siblings and records failed extraction without a fabricated assessment", async () => {
    pipelineFixture(seed, 1);
    const { run } = await process();
    expect(run.status).toBe("partial");
    const overview = (await store.overview(projectId))!;
    expect(overview.assessments).toHaveLength(2); expect(overview.streams).toHaveLength(2);
    expect(overview.samples.find(sample => sample.sample_index === 1)).toMatchObject({ status: "failed", assessment_id: null, bk_status: null, source_metadata: { sampleNo: seed.subReports[1].sampleNo } });
  });

  it("persists bounded recovery as partial and blocks finalization when one page group fails", async () => {
    const pages=Array.from({length:12},(_,page)=>({page,width:595,height:842}));
    vi.mocked(convertDocument).mockResolvedValue({checkpointId:"synthetic-long-scan",blocks:{},pages,pageCount:12,costCents:0});
    vi.mocked(extractStructured).mockImplementation(async(_schema,_source,options)=>{
      if(options?.pageRange==="5-10")throw new Error("Synthetic provider failure");
      return {data:{provenummer:"RECOVERY-A",matrise:"soil",totalinnhold_utfort:true,analyseresultater:[{
        parameter:options?.pageRange==="0-5"?"Arsen":"Bly",analyte_id:options?.pageRange==="0-5"?"arsenic":"lead",
        verdi:1,enhet:"mg/kg TS",under_loq:false,analytical_context:"Total content",
      }]},costCents:1,scoreAverage:null};
    });
    const {run}=await process();
    expect(run.status).toBe("partial");
    const overview=(await store.overview(projectId))!;
    const saved=overview.samples.find(sample=>sample.run_id===run.id)!;
    expect(saved.status).toBe("succeeded");
    const assessment=(await store.assessment(projectId,saved.assessment_id!))!;
    expect(assessment.decision_snapshot.extractionState).toBe("partial");
    const boundary=(assessment.decision_snapshot as {classification:{measurementBoundary:{measurements:{measurementId:string}[]}}}).classification.measurementBoundary;
    expect(new Set(boundary.measurements.map(measurement=>measurement.measurementId)).size).toBe(boundary.measurements.length);
    const loaded=(await loadBkWorkspace(await app(),projectId,assessment.id))!;
    expect(loaded.eligibility.reasons).toContain("Source extraction is incomplete or requires review; it cannot support finalization.");
  });

  it("deduplicates content and repeated attempt IDs, while explicit reprocessing preserves all historical snapshots", async () => {
    const { run, document } = await process();
    const old = (await local.db.query("select * from assessments where project_id=$1 order by id", [projectId])).rows;
    await process(run.id);
    expect(convertDocument).toHaveBeenCalledTimes(1);
    expect(await count("assessments")).toBe(3);
    expect((await uploadProjectDocument(store, projectId, "renamed.pdf", pdf)).id).toBe(document.id);
    await process(crypto.randomUUID(), null);
    expect(await count("assessments")).toBe(6); expect(await count("waste_streams")).toBe(6);
    expect(await count("source_documents")).toBe(1); expect(await count("production_document_files")).toBe(1);
    for (const assessment of old) expect(await store.assessment(projectId, (assessment as { id: string }).id)).toEqual(JSON.parse(JSON.stringify(assessment)));
  });

  it("denies cross-project document/assessment access and cross-organisation writes, including direct RPC calls", async () => {
    const { document } = await process();
    const assessmentId = (await store.overview(projectId))!.assessments[0].id;
    expect(await store.readDocument(siblingId, document.id)).toBeNull();
    expect(await store.assessment(siblingId, assessmentId)).toBeNull();
    expect((await bkRoute(new Request("http://localhost"), { params: Promise.resolve({ projectId: siblingId, assessmentId }) })).status).toBe(404);
    expect((await downloadRoute(new Request("http://localhost"), { params: Promise.resolve({ projectId: siblingId, documentId: document.id }) })).status).toBe(404);
    await expect(store.begin(siblingId, document.id, crypto.randomUUID(), null)).rejects.toThrow(/not found/);
    expect(await store.overview(otherProjectId)).toBeNull();
    await expect(uploadProjectDocument(store, otherProjectId, "bad.pdf", pdf)).rejects.toThrow(/not found/);
    await expect(local.db.query("select production_upload_document($1,$2,'bad.pdf','bad','')", [other.organisationId, otherProjectId])).rejects.toThrow(/access denied/);
    await local.db.exec("reset role");
    await local.db.query("select set_config('request.jwt.claim.sub',$1,false)", [other.userId]);
    await local.db.exec("set role authenticated");
    expect((await local.db.query("select * from production_document_files where source_document_id=$1", [document.id])).rows).toEqual([]);
    expect((await local.db.query("select * from production_processing_samples where project_id=$1", [projectId])).rows).toEqual([]);
    await local.db.exec("reset role");
    await local.db.query("select set_config('request.jwt.claim.sub',$1,false)", [customer.userId]);
    await local.db.exec("set role authenticated");
  });

  it("retains the upload when conversion fails and does not create a misleading classification", async () => {
    vi.mocked(convertDocument).mockRejectedValue(new Error("provider unavailable"));
    const { run } = await process();
    expect(run.status).toBe("failed"); expect(await count("source_documents")).toBe(1);
    expect(await count("assessments")).toBe(0); expect(await count("waste_streams")).toBe(0);
  });

  it("rejects invalid PDFs and mismatched hashes atomically", async () => {
    await expect(uploadProjectDocument(store, projectId, "bad.pdf", Buffer.from("not a PDF"))).rejects.toThrow(/PDF/);
    await expect(store.upload(projectId, "bad.pdf", "bad-hash", pdf.toString("base64"))).rejects.toThrow(/Invalid PDF/);
    expect(await count("source_documents")).toBe(0);
  });

  it("allows one active attempt, rejects reused IDs with changed inputs, and recovers an expired lease without rewriting history", async () => {
    const document = await uploadProjectDocument(store, projectId, "analysis.pdf", pdf);
    const id = crypto.randomUUID();
    await store.begin(projectId, document.id, id, null);
    await store.register(projectId, id, [{ sampleNo: "interrupted sample" }]);
    await expect(store.begin(projectId, document.id, crypto.randomUUID(), null)).rejects.toThrow(/already processing/);
    await expect(store.begin(projectId, document.id, id, seed.originProcess)).rejects.toThrow(/conflicts/);
    await local.db.exec("reset role");
    await local.db.query("update production_processing_runs set lease_expires_at=now()-interval '1 second' where id=$1", [id]);
    await local.db.exec("set role authenticated");
    const { run } = await process();
    expect(run.status).toBe("completed");
    const overview = (await store.overview(projectId))!;
    expect(overview.samples.find(sample => sample.run_id === id)).toMatchObject({ status: "failed", assessment_id: null });
    await expect(store.register(projectId, id, [{}])).rejects.toThrow(/not active/);
  });

  it("commits a sample atomically and rejects a later replacement or direct snapshot mutation", async () => {
    const document = await uploadProjectDocument(store, projectId, "analysis.pdf", pdf);
    const runId = crypto.randomUUID();
    await store.begin(projectId, document.id, runId, null);
    await store.register(projectId, runId, [{ sampleNo: "A", marking: "Sediment", firstPage: 0, lastPage: 1 }]);
    const result = { snapshot: { classification: { eal: { code: "17 05 04" }, hazard: { isHazardous: false } } }, bk: { fields: [] }, compliance: [], bkStatus: "needs_input" as const, error: null };
    // Invalid status fails after stream/assessment creation within the RPC. Everything
    // rolls back, leaving the detected sample pending and no orphan production records.
    await expect(store.save(projectId, runId, 0, { ...result, bkStatus: "invalid" as "needs_input" })).rejects.toThrow();
    expect(await count("waste_streams")).toBe(0); expect(await count("assessments")).toBe(0);
    const saved = await store.save(projectId, runId, 0, result);
    expect((await store.save(projectId, runId, 0, result)).assessment_id).toBe(saved.assessment_id);
    await expect(store.save(projectId, runId, 0, { ...result, snapshot: { classification: { eal: { code: "17 05 03*" }, hazard: { isHazardous: true } } } })).rejects.toThrow(/cannot be replaced/);
    expect(await count("assessments")).toBe(1);
    await expect(local.db.query("update assessments set is_hazardous=true where id=$1", [saved.assessment_id])).rejects.toThrow();
    expect((await store.assessment(projectId, saved.assessment_id!))!.is_hazardous).toBe(false);
    await store.finish(projectId, runId, null);
  });

  it("shows failed samples, source identity, successful assessments and draft BK links on the project page", async () => {
    pipelineFixture(seed, 1); await process();
    const html = renderToStaticMarkup(await ProjectPage({ params: Promise.resolve({ projectId }) }));
    expect(html).toContain("Analysis site"); expect(html).toContain("analysis-report.pdf");
    expect(html).toContain("partially complete"); expect(html).toContain("extraction or persistence failed");
    expect(html).toContain(seed.subReports[1].marking);
    expect(html).toMatch(/Continue BK|Review EAL/); expect(html).toContain("Reprocess document");
    expect(html).toContain("earlier results remain unchanged");
  });

  it("rejects foreign-origin writes before persistence", async () => {
    const response = await createRoute(new Request("http://localhost/api/production/projects", { method: "POST", headers: { origin: "https://foreign.test" }, body: JSON.stringify({ name: "forged" }) }));
    expect(response.status).toBe(400); expect(getProductionApplication).not.toHaveBeenCalled();
  });

  it("saves BK answers as immutable revisions, preserves the assessment and scopes downloads", async () => {
    await process();
    const app = await getProductionApplication();
    const assessmentId = (await store.overview(projectId))!.assessments[0].id;
    const oldAssessment = await store.assessment(projectId,assessmentId);
    const initial = (await loadBkWorkspace(app,projectId,assessmentId))!;
    expect(initial.revision).toBe(0);
    expect(initial.document?.filename).toBe("analysis-report.pdf");
    const request = {id:crypto.randomUUID(),expectedRevision:0,questionId:"smell",answer:{values:{description:"No noticeable smell"}}};
    const first = await answerBkQuestion(app,projectId,assessmentId,request);
    expect(first.revision).toBe(1);
    expect(first.workspace.fields.find(f=>f.field==="TextField40")?.value).toBe("No noticeable smell");
    expect((await answerBkQuestion(app,projectId,assessmentId,request)).revision).toBe(1);
    await expect(answerBkQuestion(app,projectId,assessmentId,{...request,answer:{values:{description:"Different"}}})).rejects.toThrow(/conflict/);
    await expect(answerBkQuestion(app,projectId,assessmentId,{...request,id:crypto.randomUUID()})).rejects.toThrow(/reload/);
    const second=await answerBkQuestion(app,projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:1,questionId:"smell",answer:{values:{description:"Earthy"}}});
    expect(second.revision).toBe(2);
    expect((await drafts.get(projectId,assessmentId,1))!.workspace.fields.find(f=>f.field==="TextField40")?.value).toBe("No noticeable smell");
    expect(await store.assessment(projectId,assessmentId)).toEqual(oldAssessment);
    await expect(local.db.query("update production_bk_revisions set state='ready' where id=$1",[first.id])).rejects.toThrow();
    expect(await drafts.get(siblingId,assessmentId)).toBeNull();
    const response=await bkRoute(new Request("http://localhost/bk?revision=1"),{params:Promise.resolve({projectId,assessmentId})});
    expect(response.status).toBe(200);
    const document=await PDFDocument.load(await response.arrayBuffer());
    expect(document.getForm().getTextField("TextField40").getText()).toBe("No noticeable smell");
    expect((await bkRoute(new Request("http://localhost/bk?revision=1"),{params:Promise.resolve({projectId:siblingId,assessmentId})})).status).toBe(404);
    await expect(local.db.query("select production_save_bk_revision($1,$2,$3,$4,0,'{}','{}')",[other.organisationId,otherProjectId,assessmentId,crypto.randomUUID()])).rejects.toThrow(/access denied/);
  });

  it("persists reviewed EAL selection without replacing the machine suggestion or assessment snapshot",async()=>{
    const {assessmentId}=await syntheticProcess("hazardous");
    const before=await store.assessment(projectId,assessmentId);
    const loaded=(await loadBkWorkspace(await app(),projectId,assessmentId))!;
    const machine=loaded.workspace.ealDecision.machineSuggestion;
    const selectedCode=loaded.workspace.ealDecision.candidates.at(-1)!.code;
    const saved=await reviewAssessmentEal(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:0,selectedCode,reason:"Synthetic site records support this candidate."});
    expect(saved.created_by).toBe(customer.userId);expect(saved.created_at).toBeTruthy();
    expect(saved.workspace.ealDecision).toMatchObject({selectedCode,reviewState:"human_resolved",resolutionStatus:"resolved",machineSuggestion:machine,humanSelection:{reason:"Synthetic site records support this candidate."}});
    expect(saved.workspace.ealDecision.humanSelection?.actor).toBe(customer.userId);
    expect(Date.parse(saved.workspace.ealDecision.humanSelection?.timestamp??"")).not.toBeNaN();
    expect(saved.workspace.ealDecision.humanSelection?.evidenceSnapshot.length).toBeGreaterThan(0);
    expect((await finalizations.audit(projectId,assessmentId)).some(event=>event.kind==="eal_reviewed"&&event.detail.selectedCode===selectedCode)).toBe(true);
    expect(await store.assessment(projectId,assessmentId)).toEqual(before);
  });

  it("rejects a direct reviewed-EAL write without a reason",async()=>{
    const {assessmentId}=await syntheticProcess("hazardous");
    const loaded=(await loadBkWorkspace(await app(),projectId,assessmentId))!;
    const selectedCode=loaded.workspace.ealDecision.candidates[0].code;
    const forged=structuredClone(loaded.workspace);
    forged.ealDecision={...forged.ealDecision,selectedCode,resolutionStatus:"resolved",reviewState:"human_resolved",humanSelection:{selectedCode,reason:"",actor:null,timestamp:null,evidenceSnapshot:[]}};
    await expect(local.db.query("select public.production_review_eal($1,$2,$3,$4,0,$5)",[customer.organisationId,projectId,assessmentId,crypto.randomUUID(),JSON.stringify(forged)])).rejects.toThrow(/Invalid reviewed EAL/);
  });

  it("rejects submitted machine EAL evidence that differs from the persisted candidate set",async()=>{
    const {assessmentId}=await syntheticProcess("hazardous");
    const loaded=(await loadBkWorkspace(await app(),projectId,assessmentId))!;
    const forged=structuredClone(loaded.workspace);
    const fake={...forged.ealDecision.candidates[0],code:"99 99 99*",description:"Invented forged candidate"};
    forged.ealDecision={...forged.ealDecision,candidates:[fake],suggestedCode:fake.code,selectedCode:fake.code,resolutionStatus:"resolved",reviewState:"human_resolved",
      machineSuggestion:{code:fake.code,reason:"Forged suggestion"},humanSelection:{selectedCode:fake.code,reason:"Forged review",actor:null,timestamp:null,evidenceSnapshot:[]}};
    await expect(local.db.query("select public.production_review_eal($1,$2,$3,$4,0,$5)",[customer.organisationId,projectId,assessmentId,crypto.randomUUID(),JSON.stringify(forged)])).rejects.toThrow(/persisted evidence/);

    const alteredDraft=structuredClone(loaded.workspace);
    alteredDraft.ealDecision=forged.ealDecision;
    await expect(local.db.query("select public.production_save_bk_revision($1,$2,$3,$4,0,$5,$6)",[customer.organisationId,projectId,assessmentId,crypto.randomUUID(),JSON.stringify(alteredDraft.answers),JSON.stringify(alteredDraft)])).rejects.toThrow(/altered machine EAL/);
  });

  it("rejects forged machine evidence and artifact bytes from an ordinary organisation member",async()=>{
    const {assessmentId}=await syntheticProcess("hazardous");
    const ready=await makeReady(assessmentId);
    const assessment=(await store.assessment(projectId,assessmentId))!;
    const links=await domain.listAssessmentDocuments(projectId,assessmentId);
    const forged=structuredClone(ready.workspace);
    forged.ealDecision.candidates=[];
    forged.fields.find(field=>field.field==="Checkbox4")!.check=false;
    const ordinaryUser=crypto.randomUUID();
    await local.db.exec("reset role");
    await local.db.query("insert into auth.users(id) values($1)",[ordinaryUser]);
    await local.db.query("insert into organisation_members(organisation_id,user_id) values($1,$2)",[customer.organisationId,ordinaryUser]);
    await local.db.query("select set_config('request.jwt.claim.sub',$1,false)",[ordinaryUser]);
    await local.db.exec("set role authenticated");
    try {
      await expect(local.db.query("select public.production_save_bk_revision($1,$2,$3,$4,$5,$6,$7)",[customer.organisationId,projectId,assessmentId,crypto.randomUUID(),ready.revision,JSON.stringify(forged.answers),JSON.stringify(forged)])).rejects.toThrow(/backend required|altered machine EAL/);
      await expect(local.db.query("select public.production_review_eal($1,$2,$3,$4,$5,$6)",[customer.organisationId,projectId,assessmentId,crypto.randomUUID(),ready.revision,JSON.stringify(forged)])).rejects.toThrow(/backend required|Invalid reviewed EAL|persisted evidence/);
      await expect(local.db.query("select public.production_create_assessment($1,$2,$3,$4,now(),$5,$6,$7,$8,$9,$10)",[customer.organisationId,projectId,assessment.waste_stream_id,crypto.randomUUID(),assessment.eal_code,assessment.is_hazardous,JSON.stringify({...assessment.decision_snapshot,classification:{forged:true}}),JSON.stringify(links),JSON.stringify(assessment.bk_output),JSON.stringify(assessment.compliance_evidence)])).rejects.toThrow(/backend required/);
      const arbitrary=Buffer.from("%PDF-arbitrary-untrusted-bytes").toString("base64");
      await expect(local.db.query("select public.production_finalize_assessment($1,$2,$3,$4,$5,$6,$7,$8,$9)",[customer.organisationId,projectId,assessmentId,crypto.randomUUID(),ready.revision,arbitrary,JSON.stringify([]),JSON.stringify(ready.eligibility.gaps.map(g=>g.id)),JSON.stringify({test:"untrusted"})])).rejects.toThrow(/backend required/);
    } finally {
      await local.db.exec("reset role");
      await local.db.query("select set_config('request.jwt.claim.sub',$1,false)",[customer.userId]);
      await local.db.exec("set role authenticated");
    }
  });

  it("keeps standalone Data Lab NDJSON behavior using the same synthetic multi-sample pipeline", async () => {
    vi.stubEnv("DATALAB_API_KEY", "test-only");
    const form = new FormData(); form.set("file", new File([new Uint8Array(pdf)], "analysis.pdf"));
    const response = await standaloneRoute(new NextRequest("http://localhost/api/data-lab", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    expect(events[0].phase).toBe("converting");
    expect(events.filter(event => event.phase === "sample")).toHaveLength(3);
    expect(events.at(-1).phase).toBe("done");
    expect(await count("source_documents")).toBe(0);
  });

  it("awaits sibling persistence before rejecting an event sink failure", async () => {
    const events: BundleEvent[] = [];
    await expect(analyseBundle(pdf, "analysis.pdf", { onEvent: async event => {
      if (event.phase === "sample" && event.index === 0) throw new Error("database failure");
      if (event.phase === "failed-sample") throw new Error("failure recording unavailable");
      await new Promise(resolve => setTimeout(resolve, 5)); events.push(event);
    } })).rejects.toThrow(/recording unavailable/);
    expect(events.filter(event => event.phase === "sample")).toHaveLength(2);
  });
  it.each(["ordinary","hazardous","indeterminate"] as const)("finalizes a synthetic %s assessment without changing tri-state, raw or normalized values",async kind=>{
    const {assessmentId,sample}=await syntheticProcess(kind);
    expect(sample.classification.hazard.isHazardous).toBe(kind==="hazardous"?true:null);
    const ready=await makeReady(assessmentId);
    if(kind!=="hazardous") {
      expect(ready.eligibility.reasons).toContain("Indeterminate HP assessment blocks finalization; resolve the structured HP issues.");
      await expect(finalizeAssessment(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:ready.revision,acknowledgedGaps:ready.eligibility.gaps.map(g=>g.id)})).rejects.toThrow(/Indeterminate HP/);
      // Direct RPC cannot bypass the application policy either.
      await expect(finalizations.finalize(projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:ready.revision,pdf:await syntheticPdf(),legalFreezes:[],acknowledgedGaps:ready.eligibility.gaps.map(g=>g.id),artifactVersion:{test:"synthetic"}})).rejects.toThrow(/HP assessment|Classification basis/);
      expect(await finalizations.get(projectId,assessmentId)).toBeNull();return;
    }
    expect(ready.eligibility.reasons).toEqual([]);
    expect(ready.eligibility.gaps.some(g=>g.id==="toc")).toBe(true);
    const input={id:crypto.randomUUID(),expectedRevision:ready.revision,acknowledgedGaps:ready.eligibility.gaps.map(g=>g.id)};
    await expect(finalizeAssessment(await app(),projectId,assessmentId,{...input,acknowledgedGaps:[]})).rejects.toThrow(/acknowledge/);
    await finalizeAssessment(await app(),projectId,assessmentId,input);
    await expect(finalizeAssessment(await app(),projectId,assessmentId,input)).resolves.toBe(input.id);
    const frozen=(await finalizations.get(projectId,assessmentId))!;
    expect(frozen.snapshot.assessment.is_hazardous).toBe(sample.classification.hazard.isHazardous);
    expect(frozen.snapshot.assessment.decision_snapshot.normalizationTrace).toEqual(sample.normalizationTrace);
    expect(frozen.snapshot.assessment.decision_snapshot.raw).toEqual(sample.raw);
    expect(frozen.snapshot.processingRuns).toHaveLength(1);
    expect(frozen.snapshot.processingRun).not.toBeNull();
    const response=await bkRoute(new Request("http://localhost"),{params:Promise.resolve({projectId,assessmentId})});
    const assessmentReader=vi.spyOn(store,"assessment").mockRejectedValueOnce(new Error("Current model unavailable"));
    expect((await bkRoute(new Request("http://localhost"),{params:Promise.resolve({projectId,assessmentId})})).status).toBe(200);
    expect(assessmentReader).not.toHaveBeenCalled();assessmentReader.mockRestore();
    expect(response.status).toBe(200);expect(response.headers.get("Content-Disposition")).toContain("finalized");
    expect(Buffer.from(await response.arrayBuffer()).toString("base64")).toBe((await finalizations.pdf(projectId,assessmentId))!.replaceAll(/\s/g,""));
    expect((await loadBkWorkspace(await app(),projectId,assessmentId))!.finalization?.id).toBe(input.id);
  });

  it("rejects incomplete drafts and interrupted processing before any finalization is persisted",async()=>{
    const {assessmentId}=await syntheticProcess();
    await expect(finalizeAssessment(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:0,acknowledgedGaps:[]})).rejects.toThrow(/required user questions/);
    const loaded=await makeReady(assessmentId);
    const assessment=(await store.assessment(projectId,assessmentId))!;
    const partialSnapshotId=crypto.randomUUID();
    await domain.createAssessment({id:partialSnapshotId,project_id:projectId,waste_stream_id:assessment.waste_stream_id,assessed_at:"2026-09-10T12:00:00Z",eal_code:assessment.eal_code,is_hazardous:assessment.is_hazardous,
      decision_snapshot:{...assessment.decision_snapshot,extractionState:"partial"},documents:await domain.listAssessmentDocuments(projectId,assessmentId),bk_output:assessment.bk_output,compliance_evidence:assessment.compliance_evidence});
    const partialReady=await makeReady(partialSnapshotId);
    await expect(finalizations.finalize(projectId,partialSnapshotId,{id:crypto.randomUUID(),expectedRevision:partialReady.revision,pdf:await syntheticPdf(),legalFreezes:[],acknowledgedGaps:partialReady.eligibility.gaps.map(g=>g.id),artifactVersion:{test:"synthetic"}})).rejects.toThrow(/Complete source extraction/);
    expect(await finalizations.get(projectId,partialSnapshotId)).toBeNull();
    await local.db.exec("reset role");
    await local.db.query("update production_processing_runs set status='partial' where project_id=$1",[projectId]);
    await local.db.exec("set role authenticated");
    await expect(finalizeAssessment(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:loaded.revision,acknowledgedGaps:loaded.eligibility.gaps.map(g=>g.id)})).rejects.toThrow(/without failed/);
    expect(await finalizations.get(projectId,assessmentId)).toBeNull();
  });

  it("freezes every original legal location, unaffected by later cache mutations or classification runs",async()=>{
    const paragraph:LegalParagraph={id:crypto.randomUUID(),source:"no",jurisdictionApplies:["no"],documentId:"synthetic-test-law",article:"1",paragraph:"1",text:"Invented test provision. Not legal advice or real legislation.",inForce:true,lastVerifiedAt:"2026-09-01T00:00:00Z",lastChangedAt:"2026-08-01T00:00:00Z",verificationStatus:"current",amendedBy:[],previousVersionId:null,humanSignedOff:false,sourceLink:"https://example.test/law#1"};
    const second={...paragraph,id:crypto.randomUUID(),paragraph:"2",sourceLink:"https://example.test/law#2"};
    const view=buildLegalCitationView([{paragraph,primary:true},{paragraph:second,primary:false}],{[second.id]:true});
    const {assessmentId}=await syntheticProcess("hazardous",view);
    await finalizeReady(assessmentId);
    const before=(await finalizations.get(projectId,assessmentId))!;
    expect(new Set(before.snapshot.legalFreezes.map(f=>f.citedParagraphId)).size).toBe(2);
    expect(before.snapshot.legalFreezes.find(f=>f.citedParagraphId===second.id)?.disputed).toBe(true);
    paragraph.text="Changed cache text";second.lastVerifiedAt="2026-10-01T00:00:00Z";
    buildLegalCitationView([{paragraph,primary:true}],{});
    syntheticSample("hazardous");
    expect(await finalizations.get(projectId,assessmentId)).toEqual(before);
  });

  it("locks finalized answers and artifact bytes, and creates an editable linked successor",async()=>{
    const {assessmentId}=await syntheticProcess();const input=await finalizeReady(assessmentId);
    const frozen=(await finalizations.get(projectId,assessmentId))!;const bytes=await finalizations.pdf(projectId,assessmentId);
    await expect(answerBkQuestion(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:input.expectedRevision,questionId:"smell",answer:{values:{description:"Changed"}}})).rejects.toThrow(/finalized/);
    await expect(reviewAssessmentEal(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:input.expectedRevision,selectedCode:frozen.snapshot.workspace.ealDecision.selectedCode!,reason:"Changed"})).rejects.toThrow(/finalized/);
    await expect(drafts.save(projectId,assessmentId,crypto.randomUUID(),input.expectedRevision,frozen.snapshot.workspace)).rejects.toThrow(/finalized/);
    await expect(local.db.query("update production_finalizations set snapshot='{}' where assessment_id=$1",[assessmentId])).rejects.toThrow();
    await expect(local.db.query("delete from production_audit_events where assessment_id=$1",[assessmentId])).rejects.toThrow();
    await local.db.exec("reset role");
    await expect(local.db.query("update production_finalizations set snapshot='{}' where assessment_id=$1",[assessmentId])).rejects.toThrow(/append-only/);
    await expect(local.db.query("delete from production_audit_events where assessment_id=$1",[assessmentId])).rejects.toThrow(/append-only/);
    await local.db.query("update projects set name='Later site',location='Later pickup' where id=$1",[projectId]);
    await local.db.exec("set role authenticated");
    expect((await loadBkWorkspace(await app(),projectId,assessmentId))!.projectName).toBe(frozen.snapshot.workspace.context.projectName);
    expect(await finalizations.pdf(projectId,assessmentId)).toBe(bytes);
    const next=crypto.randomUUID();expect(await finalizations.successor(projectId,assessmentId,next)).toBe(next);
    expect(await finalizations.successor(projectId,assessmentId,next)).toBe(next);
    const draft=(await loadBkWorkspace(await app(),projectId,next))!;
    expect(draft.finalization).toBeNull();expect(draft.previousAssessmentId).toBe(assessmentId);
    await answerBkQuestion(await app(),projectId,next,{id:crypto.randomUUID(),expectedRevision:draft.revision,questionId:"smell",answer:{values:{description:"Revised description"}}});
    expect(await finalizations.get(projectId,assessmentId)).toEqual(frozen);
    expect(await finalizations.pdf(projectId,assessmentId)).toBe(bytes);
    expect((await finalizations.audit(projectId,next)).map(e=>e.kind)).toContain("successor_created");
  });

  it("isolates final artifacts, sources, legal snapshots and audit history by organisation and project",async()=>{
    const {assessmentId}=await syntheticProcess();await finalizeReady(assessmentId);
    expect(await finalizations.get(siblingId,assessmentId)).toBeNull();expect(await finalizations.pdf(siblingId,assessmentId)).toBeNull();expect(await finalizations.audit(siblingId,assessmentId)).toEqual([]);
    await local.db.exec("reset role");await local.db.query("select set_config('request.jwt.claim.sub',$1,false)",[other.userId]);await local.db.exec("set role authenticated");
    try{
      expect((await local.db.query("select id,snapshot from production_finalizations where assessment_id=$1",[assessmentId])).rows).toEqual([]);
      expect((await local.db.query("select * from production_audit_events where assessment_id=$1",[assessmentId])).rows).toEqual([]);
      expect((await local.db.query("select * from assessment_source_documents where assessment_id=$1",[assessmentId])).rows).toEqual([]);
      expect((await local.db.query<{pdf:string|null}>("select public.production_read_finalized_pdf($1,$2,$3) as pdf",[customer.organisationId,projectId,assessmentId])).rows[0].pdf).toBeNull();
      await expect(local.db.query("select public.production_create_successor($1,$2,$3,$4)",[customer.organisationId,projectId,assessmentId,crypto.randomUUID()])).rejects.toThrow(/access denied/);
    }finally{await local.db.exec("reset role");await local.db.query("select set_config('request.jwt.claim.sub',$1,false)",[customer.userId]);await local.db.exec("set role authenticated");}
  });

  it.each(["unsupported","wet-basis"] as const)("blocks finalization of %s normalization rather than silently approving a known basis gap",async kind=>{
    const {assessmentId}=await syntheticProcess(kind);const loaded=await makeReady(assessmentId);
    await expect(finalizeAssessment(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:loaded.revision,acknowledgedGaps:loaded.eligibility.gaps.map(g=>g.id)})).rejects.toThrow(/Excluded or unresolved/);
    expect(await finalizations.get(projectId,assessmentId)).toBeNull();
  });
  it("blocks excluded mixed-report evidence through the database RPC as well as the application",async()=>{
    const {assessmentId,sample}=await syntheticProcess("mixed-invalid");
    expect(sample.classification.noDataWarning).toBe(false);
    expect(sample.normalizationTrace!.normalized).toHaveLength(1);
    const ready=await makeReady(assessmentId);
    expect(ready.eligibility.reasons).toContain("Excluded or unresolved concentration evidence requires review before finalization.");
    await expect(finalizations.finalize(projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:ready.revision,pdf:await syntheticPdf(),legalFreezes:[],acknowledgedGaps:ready.eligibility.gaps.map(g=>g.id),artifactVersion:{test:"synthetic"}})).rejects.toThrow(/Excluded or unresolved|HP assessment/);
    expect(await finalizations.get(projectId,assessmentId)).toBeNull();
  });
  it("reads an immutable legacy assessment but requires reprocessing before new finalization",async()=>{
    const {assessmentId}=await syntheticProcess("hazardous",undefined,true);
    const before=(await local.db.query("select decision_snapshot from assessments where id=$1",[assessmentId])).rows[0];
    const loaded=await makeReady(assessmentId);
    expect(loaded.classification.hazard.resultsByHp.HP7).toBe(true);
    expect(loaded.eligibility.reasons.some(r=>r.includes("legacy HP"))).toBe(true);
    await expect(finalizations.finalize(projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:loaded.revision,pdf:await syntheticPdf(),legalFreezes:[],acknowledgedGaps:loaded.eligibility.gaps.map(g=>g.id),artifactVersion:{test:"synthetic"}})).rejects.toThrow(/legacy HP/);
    expect((await local.db.query("select decision_snapshot from assessments where id=$1",[assessmentId])).rows[0]).toEqual(before);
  });
  it("reads legacy EAL snapshots but does not let them bypass modern finalization",async()=>{
    const {assessmentId}=await syntheticProcess("hazardous",undefined,false,true);
    const loaded=(await loadBkWorkspace(await app(),projectId,assessmentId))!;
    expect(loaded.workspace.ealDecision).toMatchObject({modelVersion:"legacy",code:"17 05 03*",resolutionStatus:"requires_human_review"});
    expect(loaded.eligibility.reasons.some(reason=>reason.includes("legacy EAL"))).toBe(true);
    await expect(finalizeAssessment(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:0,acknowledgedGaps:loaded.eligibility.gaps.map(g=>g.id)})).rejects.toThrow(/legacy EAL/);
  });
  it("rejects stale finalization after another answer is saved",async()=>{
    const {assessmentId}=await syntheticProcess();const loaded=await makeReady(assessmentId);
    await answerBkQuestion(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:loaded.revision,questionId:"smell",answer:{values:{description:"New observation"}}});
    await expect(finalizeAssessment(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:loaded.revision,acknowledgedGaps:loaded.eligibility.gaps.map(g=>g.id)})).rejects.toThrow(/changed/);
    expect(await finalizations.get(projectId,assessmentId)).toBeNull();
  });
  it("rejects PDF generation failure without publishing a finalized record",async()=>{
    const {assessmentId}=await syntheticProcess();const loaded=await makeReady(assessmentId);
    await answerBkQuestion(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:loaded.revision,questionId:"smell",answer:{values:{description:"Unsupported glyph 🧪"}}});
    const current=(await loadBkWorkspace(await app(),projectId,assessmentId))!;
    await expect(finalizeAssessment(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:current.revision,acknowledgedGaps:current.eligibility.gaps.map(g=>g.id)})).rejects.toThrow(/BK generation failed/);
    expect(await finalizations.get(projectId,assessmentId)).toBeNull();
  });
  it("refuses legacy citation summaries without their original legal text/version",async()=>{
    const {assessmentId}=await syntheticProcess("hazardous",{citations:[{paragraphId:crypto.randomUUID(),label:"Invented citation summary",sourceLink:"https://example.test/law",verifiedAt:"2026-09-01T00:00:00Z",disputed:false,primary:true}]});
    const current=await makeReady(assessmentId);
    await expect(finalizeAssessment(await app(),projectId,assessmentId,{id:crypto.randomUUID(),expectedRevision:current.revision,acknowledgedGaps:current.eligibility.gaps.map(g=>g.id)})).rejects.toThrow(/original text\/version/);
    expect(await finalizations.get(projectId,assessmentId)).toBeNull();
  });

  it("creates a same-stream successor with the frozen evidence and immutable earlier artifact",async()=>{
    const parent=(await syntheticProcess("hazardous")).assessmentId;await finalizeReady(parent);
    const original=(await finalizations.get(projectId,parent))!;const originalPdf=await finalizations.pdf(projectId,parent);
    const id=crypto.randomUUID();const input={id};
    expect(await createAssessmentSuccessor(await app(),projectId,parent,input)).toBe(id);
    expect(await createAssessmentSuccessor(await app(),projectId,parent,input)).toBe(id);
    const next=(await loadBkWorkspace(await app(),projectId,id))!;
    expect(next.previousAssessmentId).toBe(parent);expect(next.assessmentVersion).toBe(2);
    expect(next.workspace.context.streamId).toBe(original.snapshot.assessment.waste_stream_id);
    expect(next.workspace.answers).toEqual(original.snapshot.workspace.answers);expect(next.workspace.state).toBe("ready");
    expect(next.classification.hazard.isHazardous).toBe(true);
    expect(next.document!.id).toBe(original.snapshot.sources[0].document.id);
    await finalizeReady(id);
    expect(await finalizations.get(projectId,parent)).toEqual(original);
    expect(await finalizations.pdf(projectId,parent)).toBe(originalPdf);
    expect((await finalizations.get(projectId,id))!.snapshot.assessment.decision_snapshot).toEqual(original.snapshot.assessment.decision_snapshot);
  });
  it("creates an explicit multi-document successor and rejects accidental cross-project evidence",async()=>{
    const parent=(await syntheticProcess("hazardous")).assessmentId;
    await finalizeReady(parent);
    const frozen=structuredClone((await finalizations.get(projectId,parent))!);
    const leaching=await persistSyntheticSample(syntheticSample("indeterminate",undefined,"leaching-supplement"));
    const overview=(await store.overview(projectId))!;
    const parentAssessment=(await store.assessment(projectId,parent))!;
    const leachingAssessment=(await store.assessment(projectId,leaching.assessmentId))!;
    const combinedId=crypto.randomUUID();
    const combined=await createAssessmentEvidenceSet(await app(),{
      projectId,targetWasteStreamId:parentAssessment.waste_stream_id,assessmentId:combinedId,
      assessedAt:"2026-09-10T12:00:00Z",sources:[
        {assessmentId:parent,expectedWasteStreamId:parentAssessment.waste_stream_id},
        {assessmentId:leaching.assessmentId,expectedWasteStreamId:leachingAssessment.waste_stream_id},
      ],
    });
    expect(combined).toMatchObject({id:combinedId,waste_stream_id:parentAssessment.waste_stream_id,
      previous_assessment_id:parent,version:2});
    expect(await (await app()).store.listAssessmentDocuments(projectId,combinedId)).toHaveLength(2);
    const boundary=(combined.decision_snapshot as {classification:{measurementBoundary:{measurements:{measurementId:string;source:{documentRef?:string}[]}[]}}}).classification.measurementBoundary;
    expect(new Set(boundary.measurements.map(measurement=>measurement.measurementId)).size).toBe(boundary.measurements.length);
    expect(new Set(boundary.measurements.flatMap(measurement=>measurement.source.map(source=>source.documentRef))).size).toBe(2);
    await finalizeReady(combinedId);
    const combinedFreeze=(await finalizations.get(projectId,combinedId))!;
    expect(combinedFreeze.snapshot.processingRuns).toHaveLength(2);
    expect(combinedFreeze.snapshot.processingRun).toBeNull();
    expect(combinedFreeze.snapshot.sources).toHaveLength(2);
    const successorId=crypto.randomUUID();
    await createAssessmentSuccessor(await app(),projectId,combinedId,{id:successorId});
    const successor=(await loadBkWorkspace(await app(),projectId,successorId))!;
    const successorAssessment=(await store.assessment(projectId,successorId))!;
    expect((successorAssessment.decision_snapshot.evidenceSet as {processingRunIds:string[]}).processingRunIds).toHaveLength(2);
    expect(successor.evidenceDocuments).toHaveLength(2);
    expect(await finalizations.get(projectId,parent)).toEqual(frozen);

    const originalProject=projectId; projectId=siblingId;
    const foreign=(await syntheticProcess("indeterminate")).assessmentId;
    const foreignAssessment=(await store.assessment(projectId,foreign))!;
    projectId=originalProject;
    await expect(createAssessmentEvidenceSet(await app(),{projectId,targetWasteStreamId:parentAssessment.waste_stream_id,
      assessmentId:crypto.randomUUID(),assessedAt:"2026-09-10T12:01:00Z",
      sources:[{assessmentId:foreign,expectedWasteStreamId:foreignAssessment.waste_stream_id}]})).rejects.toThrow(/unavailable in this project/);
    expect(overview.project.id).toBe(projectId);
  });
  it("finalizes a three-document evidence set and preserves every processing run",async()=>{
    const parent=(await syntheticProcess("hazardous")).assessmentId;
    const supplementA=await persistSyntheticSample(syntheticSample("indeterminate",undefined,"supplement-a"));
    const supplementB=await persistSyntheticSample(syntheticSample("indeterminate",undefined,"supplement-b"));
    const parentAssessment=(await store.assessment(projectId,parent))!;
    const a=(await store.assessment(projectId,supplementA.assessmentId))!;
    const b=(await store.assessment(projectId,supplementB.assessmentId))!;
    const combinedId=crypto.randomUUID();
    await createAssessmentEvidenceSet(await app(),{projectId,targetWasteStreamId:parentAssessment.waste_stream_id,assessmentId:combinedId,assessedAt:"2026-09-10T13:00:00Z",sources:[
      {assessmentId:parent,expectedWasteStreamId:parentAssessment.waste_stream_id},
      {assessmentId:a.id,expectedWasteStreamId:a.waste_stream_id},
      {assessmentId:b.id,expectedWasteStreamId:b.waste_stream_id},
    ]});
    await finalizeReady(combinedId);
    const frozen=(await finalizations.get(projectId,combinedId))!;
    expect(frozen.snapshot.processingRuns).toHaveLength(3);
    expect(new Set(frozen.snapshot.processingRuns.map(run=>run.source_document_id)).size).toBe(3);
    expect(frozen.snapshot.sources).toHaveLength(3);
  });
  it("blocks a multi-document finalization when any declared run becomes partial",async()=>{
    const parent=(await syntheticProcess("hazardous")).assessmentId;
    const supplement=await persistSyntheticSample(syntheticSample("indeterminate",undefined,"partial-supplement"));
    const parentAssessment=(await store.assessment(projectId,parent))!;
    const supplementAssessment=(await store.assessment(projectId,supplement.assessmentId))!;
    const combinedId=crypto.randomUUID();
    const combined=await createAssessmentEvidenceSet(await app(),{projectId,targetWasteStreamId:parentAssessment.waste_stream_id,assessmentId:combinedId,assessedAt:"2026-09-10T14:00:00Z",sources:[
      {assessmentId:parent,expectedWasteStreamId:parentAssessment.waste_stream_id},
      {assessmentId:supplementAssessment.id,expectedWasteStreamId:supplementAssessment.waste_stream_id},
    ]});
    const ready=await makeReady(combinedId);
    const runIds=(combined.decision_snapshot.evidenceSet as {processingRunIds:string[]}).processingRunIds;
    await local.db.exec("reset role");
    await local.db.query("update production_processing_runs set status='partial',error_message='Synthetic partial run' where id=$1",[runIds[1]]);
    await local.db.exec("set role authenticated");
    const refreshed=(await loadBkWorkspace(await app(),projectId,combinedId))!;
    expect(refreshed.eligibility.reasons).toContain("Source processing must finish without failed or pending samples.");
    await expect(finalizations.finalize(projectId,combinedId,{id:crypto.randomUUID(),expectedRevision:ready.revision,pdf:await syntheticPdf(),legalFreezes:[],acknowledgedGaps:ready.eligibility.gaps.map(g=>g.id),artifactVersion:{test:"synthetic"}})).rejects.toThrow(/complete without failures/);
    expect(await finalizations.get(projectId,combinedId)).toBeNull();
  });
  it("rejects processing runs from another project or organisation",async()=>{
    const parent=(await syntheticProcess("hazardous")).assessmentId;
    const parentAssessment=(await store.assessment(projectId,parent))!;
    const documents=await domain.listAssessmentDocuments(projectId,parent);
    const originalProject=projectId;projectId=siblingId;
    const foreignProjectAssessment=(await syntheticProcess("hazardous")).assessmentId;
    const foreignProjectSnapshot=(await store.assessment(projectId,foreignProjectAssessment))!.decision_snapshot;
    projectId=originalProject;
    const crossProjectId=crypto.randomUUID();
    await domain.createAssessment({id:crossProjectId,project_id:projectId,waste_stream_id:parentAssessment.waste_stream_id,assessed_at:"2026-09-10T15:00:00Z",eal_code:parentAssessment.eal_code,is_hazardous:parentAssessment.is_hazardous,
      decision_snapshot:{...parentAssessment.decision_snapshot,processingRunId:foreignProjectSnapshot.processingRunId},documents,bk_output:parentAssessment.bk_output,compliance_evidence:parentAssessment.compliance_evidence});
    await local.db.exec("reset role");
    await expect(local.db.query("select public.production_validated_processing_runs($1,$2,$3)",[customer.organisationId,projectId,crossProjectId])).rejects.toThrow(/complete without failures/);
    await local.db.exec("set role authenticated");

    const foreignDocument=crypto.randomUUID();const foreignRun=crypto.randomUUID();
    await local.db.exec("reset role");
    await local.db.query("insert into source_documents(id,organisation_id,project_id,filename,storage_key,sha256) values($1,$2,$3,'synthetic.pdf',$4,$5)",[foreignDocument,other.organisationId,otherProjectId,`${other.organisationId}/${otherProjectId}/${foreignDocument}.pdf`,"a".repeat(64)]);
    await local.db.query("insert into production_processing_runs(id,organisation_id,project_id,source_document_id,status,finished_at) values($1,$2,$3,$4,'completed',now())",[foreignRun,other.organisationId,otherProjectId,foreignDocument]);
    await local.db.query("select set_config('request.jwt.claim.sub',$1,false)",[customer.userId]);await local.db.exec("set role authenticated");
    const crossOrganisationId=crypto.randomUUID();
    await domain.createAssessment({id:crossOrganisationId,project_id:projectId,waste_stream_id:parentAssessment.waste_stream_id,assessed_at:"2026-09-10T15:01:00Z",eal_code:parentAssessment.eal_code,is_hazardous:parentAssessment.is_hazardous,
      decision_snapshot:{...parentAssessment.decision_snapshot,processingRunId:foreignRun},documents,bk_output:parentAssessment.bk_output,compliance_evidence:parentAssessment.compliance_evidence});
    await local.db.exec("reset role");
    await expect(local.db.query("select public.production_validated_processing_runs($1,$2,$3)",[customer.organisationId,projectId,crossOrganisationId])).rejects.toThrow(/complete without failures/);
    await local.db.exec("set role authenticated");
  });
  it("rejects replacement evidence from another project and refuses inherited answers for new analysis",async()=>{
    const parent=(await syntheticProcess()).assessmentId;await finalizeReady(parent);
    const initialProject=projectId;projectId=siblingId;const replacement=(await syntheticProcess("hazardous")).assessmentId;projectId=initialProject;
    await expect(createAssessmentSuccessor(await app(),projectId,parent,{id:crypto.randomUUID(),replacementAssessmentId:replacement})).rejects.toThrow(/unavailable/);
    const unusable=(await syntheticProcess("unsupported")).assessmentId;
    await expect(createAssessmentSuccessor(await app(),projectId,parent,{id:crypto.randomUUID(),replacementAssessmentId:unusable})).rejects.toThrow(/this waste stream/);
    const localReplacement=(await syntheticProcess("hazardous")).assessmentId;
    const frozen=(await finalizations.get(projectId,parent))!;
    await expect(finalizations.successor(projectId,parent,crypto.randomUUID(),{assessmentId:localReplacement,workspace:frozen.snapshot.workspace})).rejects.toThrow(/this waste stream/);
  });

});
