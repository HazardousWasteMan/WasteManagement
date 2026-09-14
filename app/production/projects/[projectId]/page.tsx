import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { getProductionApplication } from "@/lib/production/server";
import { AnalysisUploadDialog, DocumentForm, ProcessingRefresh } from "@/components/production/ProjectForms";
import type { ProjectOverview } from "@/lib/production/processing-types";
import { AssessmentSummaryCard } from "@/components/production/AssessmentSummaryCard";
import { ProductionStatus } from "@/components/production/ProductionStatus";
import { formatProductionDate } from "@/lib/production/presentation";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  let overview: ProjectOverview | null;
  try { overview = await (await getProductionApplication()).processing.overview(projectId); }
  catch (error) { unstable_rethrow(error); return <main className="p-8"><h1>Project unavailable</h1><p>Check the organisation setup or retry when the service is available.</p></main>; }
  if (!overview) notFound();
  const { project, documents, runs, samples, streams, assessments } = overview;
  const now = overview.checkedAt;
  const activeUntil = Math.max(0, ...runs.filter(run => run.status === "processing" && Date.parse(run.lease_expires_at) > now).map(run => Date.parse(run.lease_expires_at)));
  const latestByStream=new Map(streams.map(stream=>[stream.id,assessments.filter(item=>item.waste_stream_id===stream.id).sort((a,b)=>b.version-a.version)[0]]));
  const sampleByAssessment=new Map(samples.filter(sample=>sample.assessment_id).map(sample=>[sample.assessment_id!,sample]));
  return <main className="mx-auto min-h-screen max-w-6xl space-y-8 px-5 py-8 text-forest sm:px-8 lg:py-12">
    <ProcessingRefresh until={activeUntil} />
    <header className="space-y-6 border-b border-forest/10 pb-7"><Link href="/production/projects" className="text-sm font-medium text-forest/60 hover:underline">← Projects</Link><div className="flex flex-wrap items-end justify-between gap-5"><div><h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1><p className="mt-2 text-sm text-forest/60">{project.location||"Location not added"}</p></div><AnalysisUploadDialog projectId={projectId}/></div>
      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm"><div><dt className="text-forest/50">Waste streams</dt><dd className="mt-0.5 text-lg font-semibold">{streams.length}</dd></div><div><dt className="text-forest/50">Assessments</dt><dd className="mt-0.5 text-lg font-semibold">{assessments.length}</dd></div><div><dt className="text-forest/50">Documents</dt><dd className="mt-0.5 text-lg font-semibold">{documents.length}</dd></div></dl>
    </header>
    <section className="space-y-4" aria-labelledby="streams-heading"><div><h2 id="streams-heading" className="text-xl font-semibold">Waste streams</h2><p className="mt-1 text-sm text-forest/60">Current classification and BK progress for each identified stream.</p></div>
      {!streams.length && <div className="rounded-2xl border border-dashed border-forest/20 bg-white/60 p-8 text-center"><h3 className="font-semibold">No waste streams yet</h3><p className="mt-2 text-sm text-forest/60">Add an analysis report to identify samples and begin an assessment.</p></div>}
      <div className="grid gap-4">{streams.map(stream=>{
        const assessment=latestByStream.get(stream.id);const matrix=assessment?String(sampleByAssessment.get(assessment.id)?.source_metadata.matrix||""):"";
        return assessment?<AssessmentSummaryCard key={stream.id} projectId={projectId} streamName={stream.name} material={matrix||null} assessment={assessment}/>:<article key={stream.id} className="rounded-2xl border border-forest/10 bg-white p-5"><h3 className="font-semibold">{stream.name}</h3><p className="mt-1 text-sm text-forest/60">Material not specified</p><div className="mt-4"><ProductionStatus tone="warning">Assessment unavailable</ProductionStatus></div></article>;
      })}</div>
      <p className="text-sm text-forest/60">BK documents remain drafts until they are reviewed and finalized.</p>
    </section>
    <details className="rounded-2xl border border-forest/10 bg-white p-5"><summary className="cursor-pointer font-semibold">Analysis documents and processing history</summary><section className="mt-5 space-y-4" aria-label="Analysis documents">
      {!documents.length && <p>No uploaded documents.</p>}
      {documents.map(document => {
        const attempts = runs.filter(run => run.source_document_id === document.id);
        const latest = attempts[0];
        const active = attempts.some(run => run.status === "processing" && Date.parse(run.lease_expires_at) > now);
        return <article key={document.id} className="rounded-2xl border border-forest/15 bg-white p-5 space-y-3">
          <h3 className="font-semibold"><a className="underline" href={`/api/production/projects/${projectId}/documents/${document.id}`}>{document.filename}</a></h3>
          <p className="text-xs text-forest/55">Uploaded {formatProductionDate(document.created_at)}</p>
          {!attempts.length && <p>Uploaded; processing has not started.</p>}
          {attempts.map(run => <div key={run.id} className="border-l-2 border-forest/20 pl-3 text-sm space-y-1">
            <p><strong>{run.status === "processing" && Date.parse(run.lease_expires_at) <= now ? "Interrupted — reprocessing available" : run.status === "completed" ? "Analysis complete" : run.status === "partial" ? "Analysis partially complete" : run.status === "failed" ? "Analysis failed" : "Analysis in progress"}</strong> · {formatProductionDate(run.started_at)}</p>
            {run.error_message && <p>{run.error_message}</p>}
            <ul>{samples.filter(sample => sample.run_id === run.id).map(sample => <li key={sample.sample_index}>
              {String(sample.source_metadata.marking || `Sample ${sample.sample_index + 1}`)} · {String(sample.source_metadata.matrix || "Material not identified")} · {sample.status === "succeeded" ? "Saved" : sample.status === "failed" ? "Needs attention" : "Processing"}
              {sample.error_message && ` — ${sample.error_message}`}
            </li>)}</ul>
          </div>)}
          <DocumentForm projectId={projectId} documentId={document.id} initialOrigin={latest?.origin_process} disabled={active} />
        </article>;
      })}
    </section></details>
  </main>;
}
