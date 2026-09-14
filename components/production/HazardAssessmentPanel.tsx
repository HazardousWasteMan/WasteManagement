import { HP_CODES, readHpOutcome, type HpStatus } from "@/lib/hp-classification/hp-outcome";
import type { HazardClassification } from "@/lib/hp-classification/hazard";
import type { Measurement } from "@/lib/hp-classification/measurement";
import { ProductionStatus } from "./ProductionStatus";
import { effectiveHazardStatus } from "@/lib/production/presentation";

const names:Record<(typeof HP_CODES)[number],string>={HP1:"Explosive",HP2:"Oxidising",HP3:"Flammable",HP4:"Irritant",HP5:"Specific target organ toxicity",HP6:"Acute toxicity",HP7:"Carcinogenic",HP8:"Corrosive",HP9:"Infectious",HP10:"Toxic for reproduction",HP11:"Mutagenic",HP12:"Releases an acute toxic gas",HP13:"Sensitising",HP14:"Ecotoxic",HP15:"May exhibit a hazardous property later"};
export const hpStatusLabel:Record<HpStatus,string>={triggered:"Triggered",not_triggered:"Not triggered",not_assessable:"Cannot assess from available evidence",not_applicable:"Not applicable",requires_manual_assessment:"Requires contextual assessment"};
const symbol:Record<HpStatus,string>={triggered:"!",not_triggered:"✓",not_assessable:"?",not_applicable:"—",requires_manual_assessment:"—"};

export function hazardSummaryLabel(hazard:HazardClassification) {
  const state=effectiveHazardStatus({hazard,persisted:hazard.isHazardous});
  if(state==="hazardous")return "Hazardous";
  if(state==="non_hazardous")return "Non-hazardous";
  return "Cannot fully determine";
}

export function HazardAssessmentPanel({hazard,measurements=[],hasGeneralLegalBasis=false}:{hazard:HazardClassification;measurements?:Measurement[];hasGeneralLegalBasis?:boolean}) {
  const summary=hazardSummaryLabel(hazard);
  return <section className="rounded-2xl border border-forest/10 bg-white p-5 shadow-sm" aria-labelledby="hazard-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="hazard-heading" className="text-lg font-semibold">Hazard assessment</h2><p className="mt-1 max-w-2xl text-sm text-forest/65">All hazardous properties are shown individually. Unresolved properties remain open for review and are never treated as negative findings.</p></div><ProductionStatus tone={summary==="Hazardous"?"danger":summary==="Non-hazardous"?"success":"warning"}>{summary}</ProductionStatus></div>
    {hasGeneralLegalBasis&&<p className="mt-4 rounded-xl bg-cream/70 p-3 text-sm text-forest/70">The assessment contains general legal references. Applicability still depends on the evidence and rule shown for each HP property.</p>}
    <div className="mt-5 divide-y divide-forest/10 border-y border-forest/10">{HP_CODES.map(hp=>{
      const outcome=readHpOutcome(hp,hazard.resultsByHp[hp]??false);
      const relevant=measurements.filter(item=>outcome.measurementIds.includes(item.measurementId));
      const tone=outcome.status==="triggered"?"text-red-800":outcome.status==="not_triggered"?"text-emerald-800":"text-amber-800";
      return <details key={hp} className="group py-3"><summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_1rem] items-center gap-3 text-sm"><span><strong>{hp}</strong><span className="text-forest/60"> · {names[hp]}</span></span><span className={`text-right font-medium ${tone}`}><span aria-hidden="true">{symbol[outcome.status]} </span>{hpStatusLabel[outcome.status]}</span><span aria-hidden="true" className="text-forest/35 transition group-open:rotate-180">⌄</span></summary>
        <div className="mt-3 grid gap-3 rounded-xl bg-cream/60 p-4 text-sm text-forest/75 sm:grid-cols-2">
          <div><h3 className="font-semibold text-forest">Why</h3><p className="mt-1">{outcome.reason}</p></div>
          <div><h3 className="font-semibold text-forest">Evidence used</h3>{relevant.length?<ul className="mt-1 list-disc pl-5">{relevant.map(item=><li key={item.measurementId}>{item.rawLabel}: {item.rawValueText??"value unavailable"} {item.rawUnit}</li>)}</ul>:<p className="mt-1">No eligible measurement was used for this property.</p>}</div>
          {!!outcome.calculations.length&&<div><h3 className="font-semibold text-forest">Calculation and threshold</h3><ul className="mt-1 space-y-1">{outcome.calculations.map((item,index)=><li key={`${item.rule}-${index}`}>{item.formula} · threshold {item.thresholdPct}%</li>)}</ul></div>}
          <div><h3 className="font-semibold text-forest">Assumptions</h3><p className="mt-1">{outcome.conservativeAssumption?"The calculation includes a conservative assumption.":"No conservative assumption is recorded for this outcome."}</p></div>
          {!!outcome.issues.length&&<div className="sm:col-span-2"><h3 className="font-semibold text-forest">Limitations</h3><ul className="mt-1 list-disc pl-5">{outcome.issues.map((issue,index)=><li key={`${issue.code}-${index}`}>{issue.reason}</li>)}</ul></div>}
        </div>
      </details>;
    })}</div>
  </section>;
}
