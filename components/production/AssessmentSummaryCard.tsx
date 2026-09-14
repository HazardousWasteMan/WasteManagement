import Link from "next/link";
import type { AssessmentSummary } from "@/lib/production/processing-types";
import { ProductionStatus } from "./ProductionStatus";
import { formatProductionDate } from "@/lib/production/presentation";

export function AssessmentSummaryCard({projectId,streamName,material,assessment}:{projectId:string;streamName:string;material?:string|null;assessment:AssessmentSummary}) {
  const hazardous = assessment.hazardStatus === "hazardous" ? "Hazardous" : assessment.hazardStatus === "non_hazardous" ? "Non-hazardous" : "Indeterminate";
  const bk = assessment.bkStatus === "finalized" ? "Finalized" : assessment.bkStatus === "draft_ready" ? "Draft ready" : assessment.bkStatus === "needs_review" ? "Needs review" : "Needs input";
  const href = `/production/projects/${projectId}/assessments/${assessment.id}`;
  const action = assessment.finalized ? "View finalized BK" : assessment.effectiveEal.status === "needs_review" ? "Review EAL" : "Continue BK";
  const actionHref = assessment.effectiveEal.status === "needs_review" && !assessment.finalized ? `${href}?focus=eal#eal-review` : href;
  const hazardTone=assessment.hazardStatus==="hazardous"?"danger":assessment.hazardStatus==="non_hazardous"?"success":"warning";
  const bkTone=assessment.finalized?"success":assessment.bkStatus==="needs_review"||assessment.bkStatus==="needs_input"?"warning":"neutral";
  return <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h3 className="text-lg font-semibold">{streamName}</h3><p className="mt-1 text-sm text-forest/60">{material||"Material not specified"}</p></div>
      <Link className="rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-cream shadow-sm hover:bg-forest-light" href={actionHref}>{action}</Link>
    </div>
    <dl className="mt-5 grid gap-4 border-t border-forest/10 pt-4 sm:grid-cols-3">
      <div><dt className="text-xs font-medium uppercase tracking-wide text-forest/45">EAL</dt><dd className="mt-1 font-semibold">{assessment.effectiveEal.label}</dd></div>
      <div><dt className="text-xs font-medium uppercase tracking-wide text-forest/45">Hazard assessment</dt><dd className="mt-1"><ProductionStatus tone={hazardTone}>{hazardous}</ProductionStatus></dd></div>
      <div><dt className="text-xs font-medium uppercase tracking-wide text-forest/45">BK status</dt><dd className="mt-1"><ProductionStatus tone={bkTone}>{bk}</ProductionStatus></dd></div>
    </dl>
    <p className="mt-4 text-xs text-forest/45">Updated {formatProductionDate(assessment.created_at)}</p>
  </section>;
}
