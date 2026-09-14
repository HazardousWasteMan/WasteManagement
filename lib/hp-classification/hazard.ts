import hpThresholds from "../data/hp-thresholds.json";
import type { SampleMetadata } from "./types";
import { aggregateHp, HP_CODES, HP_RULE_VERSION, normalizeHStatement, type AggregateHazard, type HpCode, type HpIssue, type HpOutcome, type LegacyHpOutcome, type RuleCalculation } from "./hp-outcome";
export interface NormalizedResultWithClp {
  measurementId?: string; inputId?: string; substanceName: string; resultPct: number;
  hStatement: string; hazardClass: string; mFactorAcute: number | null; mFactorChronic: number | null;
  censoring?: "<" | "<=" | "non-detect" | "detected" | "missing";
  /** Alternative forms of ONE measurement are mutually exclusive, never simultaneous mass. */
  alternativeGroup?: string; scenarioId?: string; assumedSpecies?: boolean;
}
export interface TestResult {
  testName: "flammability" | "skin_corrosion" | "skin_irritation";
  result: string; isPositive: boolean;
}
/** Historical snapshots remain readable; new calculations return CurrentHazardClassification. */
export interface HazardClassification {
  resultsByHp: Record<string, HpOutcome | LegacyHpOutcome>;
  aggregate?: AggregateHazard; outcomeVersion?: string;
  triggeringSubstancesByHp: Record<string,string[]>;
  isHazardous: boolean | null; triggeredHps: string[]; confidenceFlags: string[];
  confidenceFlagsNo?: string[]; hasDetectedHazardousSubstance?: boolean | null;
}
export interface CurrentHazardClassification extends HazardClassification {
  resultsByHp: Record<HpCode,HpOutcome>; aggregate: AggregateHazard; outcomeVersion: string;
}
export type HpEvidenceContext = { issues?: HpIssue[] };
type Input = NormalizedResultWithClp & { code: string; id: string; measurement: string };
export function classifyHazard(results: NormalizedResultWithClp[], metadata: SampleMetadata, tests: TestResult[], context: HpEvidenceContext = {}): CurrentHazardClassification {
  const issues: HpIssue[] = [...context.issues ?? []];
  const inputs: Input[]=[];
  const seen=new Set<string>();
  results.forEach((r,index)=>{
    const measurement=r.measurementId ?? `input-${index+1}`;
    const code=normalizeHStatement(r.hStatement);
    if(!code || !Number.isFinite(r.resultPct) || r.resultPct<0 || r.censoring==="missing") {
      issues.push({code:"invalid_hp_input",measurementIds:[measurement],reason:"Invalid concentration, censoring or H-statement"});return;
    }
    const id=r.inputId ?? `${measurement}/${r.scenarioId ?? r.substanceName}/${code}`;
    const key=JSON.stringify([measurement,r.scenarioId,r.substanceName,code,r.hazardClass]);
    if(seen.has(key))return;seen.add(key);
    inputs.push({...r,code,id,measurement});
  });
  const outcomes={} as Record<HpCode,HpOutcome>;
  const outcome=(hp:HpCode):HpOutcome=>outcomes[hp]??=( {hp,status:"not_assessable",coverage:"screening_only",reason:"No sufficient property evidence",measurementIds:[],inputIds:[],ruleVersion:HP_RULE_VERSION,calculations:[],issues:[],conservativeAssumption:false} );
  for(const hp of HP_CODES)outcome(hp);
  const uncertain=(r:Input)=>r.assumedSpecies===true || r.alternativeGroup!==undefined || (r.censoring!==undefined && r.censoring!=="detected");
  // For each equation, sum contributions within each alternative, then take at most ONE
  // alternative per elemental measurement. The lower bound contains confirmed inputs only.
  function evaluate(hp:HpCode, rule:string, formula:string, threshold:number, coefficients:Record<string,number>, cutoffs:Record<string,number>={}, individual=false, filter:(r:Input)=>boolean=()=>true) {
    const relevant=inputs.filter(r=>coefficients[r.code]!==undefined&&filter(r));
    function bound(lower:boolean) {
      const groups=new Map<string,Map<string,{value:number;inclusive:boolean}>>();
      const used:Input[]=[];
      for(const r of relevant) {
        const c=lower&&uncertain(r)?0:r.resultPct;
        if(c<(cutoffs[r.code]??0)||c===0||(!lower&&r.censoring==="<"&&c===(cutoffs[r.code]??0)))continue;
        const value=c*coefficients[r.code];used.push(r);
        const group=r.alternativeGroup ?? r.measurement;
        const scenario=r.scenarioId ?? "reported";
        const variants=groups.get(group)??new Map<string,{value:number;inclusive:boolean}>();
        const prior=variants.get(scenario)??{value:0,inclusive:true};
        const inclusive=lower||r.censoring!=="<";
        variants.set(scenario,individual ? (value>prior.value?{value,inclusive}:value===prior.value?{value,inclusive:inclusive||prior.inclusive}:prior) : {value:prior.value+value,inclusive:prior.inclusive&&inclusive});groups.set(group,variants);
      }
      const scenarios: {measurementGroup:string;scenarioId:string;contribution:number}[]=[];
      const values=[...groups.entries()].map(([measurementGroup,g])=>{
        const max=Math.max(...[...g.values()].map(v=>v.value));
        const selected=[...g.entries()].find(([,v])=>v.value===max&&v.inclusive)??[...g.entries()].find(([,v])=>v.value===max)!;
        scenarios.push({measurementGroup,scenarioId:selected[0],contribution:max});
        return {value:max,inclusive:[...g.values()].some(v=>v.value===max&&v.inclusive)};
      });
      const value=individual?Math.max(0,...values.map(v=>v.value)):values.reduce((a,b)=>a+b.value,0);
      return {value,inclusive:individual?values.some(v=>v.value===value&&v.inclusive):values.every(v=>v.inclusive),used,scenarios};
    }
    const lower=bound(true),upper=bound(false),o=outcome(hp);
    const calculation:RuleCalculation={rule,formula,thresholdPct:threshold,lower:lower.value,upper:upper.value,upperInclusive:upper.inclusive,scenarios:upper.scenarios,cutoffPct:cutoffs,inputIds:upper.used.map(r=>r.id)};
    o.calculations.push(calculation);
    o.inputIds=[...new Set([...o.inputIds,...upper.used.map(r=>r.id)])];
    o.measurementIds=[...new Set([...o.measurementIds,...upper.used.map(r=>r.measurement)])];
    if(relevant.some(uncertain))o.conservativeAssumption=true;
    if(lower.value>=threshold){o.status="triggered";o.coverage="property_assessed";o.reason=`Confirmed concentration meets ${rule}`;}
    else if((upper.value>threshold||(upper.value===threshold&&upper.inclusive))&&o.status!=="triggered") {
      o.status="requires_manual_assessment";o.reason="Only the conservative upper bound reaches a legal threshold";
      o.issues.push({code:"upper_bound_crossing",measurementIds:upper.used.filter(uncertain).map(r=>r.measurement),reason:`${rule}: censoring or alternative species can change the conclusion`});
    }else if(o.status==="not_assessable") {o.status="not_triggered";o.reason="No threshold reached by eligible inputs; this is not a complete waste assessment";}
  }
  const individual=(hp:HpCode,h:string,t:number)=>evaluate(hp,`${hp}:${h}`,`individual c(${h}) >= ${t}%`,t,{[h]:1},{},true);
  evaluate("HP8","HP8:H314","sum H314 >= 5%",5,{H314:1},{H314:1});
  evaluate("HP4","HP4:SkinCorr1A","sum Skin Corr. 1A H314 >= 1%",1,{H314:1},{H314:1},false,r=>/^Skin\s*Corr\.?\s*1A$/i.test(r.hazardClass.trim()));
  evaluate("HP4","HP4:H318","sum H318 >= 10%",10,{H318:1},{H318:1});
  evaluate("HP4","HP4:H315+H319","sum H315 + sum H319 >= 20%",20,{H315:1,H319:1},{H315:1,H319:1});
  if(inputs.some(r=>r.code==="H314"&&!/^Skin\s*Corr\.?\s*1[ABC]$/i.test(r.hazardClass.trim()))) {
    outcome("HP4").issues.push({code:"unknown_h314_subclass",measurementIds:inputs.filter(r=>r.code==="H314").map(r=>r.measurement),reason:"HP4 requires an established Skin Corr. 1A subclass"});
  }
  for(const [h,t] of [["H335",20],["H370",1],["H371",10],["H372",1],["H373",10]] as const)individual("HP5",h,t);
  if(metadata.physicalState==="liquid"&&metadata.viscosity40cMm2s!==null&&Number.isFinite(metadata.viscosity40cMm2s)&&metadata.viscosity40cMm2s>=0&&metadata.viscosity40cMm2s<=20.5)evaluate("HP5","HP5:H304","sum H304 >= 10%, viscosity <= 20.5 mm2/s",10,{H304:1});
  else if(inputs.some(r=>r.code==="H304")&&metadata.physicalState==="liquid"&&(metadata.viscosity40cMm2s===null||!Number.isFinite(metadata.viscosity40cMm2s)||metadata.viscosity40cMm2s<0))outcome("HP5").issues.push({code:"missing_viscosity",measurementIds:inputs.filter(r=>r.code==="H304").map(r=>r.measurement),reason:"Liquid aspiration assessment needs viscosity"});
  for(const t of hpThresholds.filter(t=>t.hpCode==="HP6")) {
    if(!t.hStatement||t.concentrationLimitPct===null)continue;
    const cutoff=/Acute Tox\. [123] /.test(t.hazardClass??"")?0.1:1;
    evaluate("HP6",`HP6:${t.hazardClass}`,`sum ${t.hazardClass} >= ${t.concentrationLimitPct}%`,t.concentrationLimitPct,{[t.hStatement]:1},{[t.hStatement]:cutoff},false,r=>r.hazardClass===t.hazardClass);
  }
  for(const r of inputs.filter(r=>/^H3(?:0[012]|1[012]|3[012])$/.test(r.code)))if(!hpThresholds.some(t=>t.hpCode==="HP6"&&t.hStatement===r.code&&t.hazardClass===r.hazardClass))outcome("HP6").issues.push({code:"unknown_acute_category",measurementIds:[r.measurement],reason:"No established HP6 category/route threshold"});
  individual("HP7","H350",0.1);individual("HP7","H351",1);
  individual("HP10","H360",0.3);individual("HP10","H361",3);
  individual("HP11","H340",0.1);individual("HP11","H341",1);
  individual("HP13","H317",10);individual("HP13","H334",10);
  individual("HP14","H420",0.1);
  evaluate("HP14","2017/997:acute","sum H400 >= 25%",25,{H400:1},{H400:0.1});
  evaluate("HP14","2017/997:weighted-chronic","100 sum H410 + 10 sum H411 + sum H412 >= 25%",25,{H410:100,H411:10,H412:1},{H410:0.1,H411:1,H412:1});
  evaluate("HP14","2017/997:chronic","sum H410 + H411 + H412 + H413 >= 25%",25,{H410:1,H411:1,H412:1,H413:1},{H410:0.1,H411:1,H412:1,H413:1});
  // Existing test schema does not establish full HP3 (flash point, pyrophoric, water-reactive,
  // etc.) or accredited scope. A positive is useful evidence; a negative covers only its test.
  for(const [hp,name] of [["HP3","flammability"],["HP8","skin_corrosion"],["HP4","skin_irritation"]] as const) {
    const matching=tests.filter(t=>t.testName===name&&typeof t.isPositive==="boolean");
    if(matching.some(t=>t.isPositive)) {const o=outcome(hp);o.status="triggered";o.coverage="property_assessed";o.reason=`Positive reported ${name} test`;o.inputIds.push(`test:${name}`);}
    else if(matching.length) {
      const o=outcome(hp);
      if(o.status==="triggered") {o.status="requires_manual_assessment";o.coverage="screening_only";o.reason="Negative test conflicts with the calculation; test scope needs verification";}
      o.issues.push({code:"test_scope_unverified",measurementIds:[],reason:`Negative ${name} does not establish complete property/test applicability`});
    }
  }
  for(const hp of ["HP1","HP2","HP3","HP9","HP12","HP15"] as const) {
    const o=outcome(hp);if(o.status==="triggered")continue;
    o.status=["HP9","HP12","HP15"].includes(hp)?"requires_manual_assessment":"not_assessable";
    const indicatorCodes: Partial<Record<HpCode,string[]>> = {
      HP1:["H200","H201","H202","H203","H204","H240","H241"],
      HP2:["H270","H271","H272"],
      HP3:["H220","H221","H222","H223","H224","H225","H226","H228","H242","H250","H251","H252","H260","H261"],
    };
    const indicators=inputs.filter(r=>indicatorCodes[hp]?.includes(r.code));
    if(indicators.length) {o.status="requires_manual_assessment";o.measurementIds=indicators.map(r=>r.measurement);o.inputIds=indicators.map(r=>r.id);o.conservativeAssumption=indicators.some(uncertain);}
    o.reason="Requires scoped test, process/context or qualified assessment evidence";
    o.issues.push({code:"property_evidence_required",measurementIds:o.measurementIds,reason:o.reason});
  }
  // Norwegian Annex 2: confirmed EUH029/031/032 presence invokes HP12 unless tests
  // establish absence of the hazardous property. HP15 codes require the form exception
  // to be evidenced; no blanket "not applicable" inference is made here.
  for(const [hp,codes] of [["HP12",["EUH029","EUH031","EUH032"]],["HP15",["H205","EUH001","EUH019","EUH044"]]] as const) {
    const relevant=inputs.filter(r=>(codes as readonly string[]).includes(r.code)&&r.resultPct>0);
    if(relevant.length) {
      const o=outcome(hp);o.inputIds=relevant.map(r=>r.id);o.measurementIds=relevant.map(r=>r.measurement);o.conservativeAssumption=relevant.some(uncertain);
      if(relevant.some(r=>!uncertain(r))) {o.status="triggered";o.coverage="property_assessed";o.reason="Confirmed substance presence invokes Annex 2; no evidenced exception supplied";o.issues=[];}
      else {o.status="requires_manual_assessment";o.reason="Hazard indication depends on censored concentration or assumed species";}
    }
  }
  for(const hp of HP_CODES) {
    const o=outcome(hp);
    if(o.status==="not_triggered"&&(o.issues.length||issues.length||inputs.length===0)) {o.status="not_assessable";o.reason="Evidence gaps prevent a negative conclusion";}
    if(inputs.some(r=>r.assumedSpecies)&&o.status==="not_triggered") {
      o.status="not_assessable";o.issues.push({code:"species_set_unverified",measurementIds:inputs.filter(r=>r.assumedSpecies).map(r=>r.measurement),reason:"Enumerated forms are screening alternatives, not a proven exhaustive composition"});
    }
  }
  if(outcome("HP8").status==="triggered")Object.assign(outcome("HP4"),{status:"not_applicable",coverage:"property_assessed",reason:"HP4 is superseded by confirmed HP8",supersededBy:"HP8",issues:[]});
  const aggregate=aggregateHp(outcomes,issues);
  const triggeredHps=HP_CODES.filter(hp=>outcomes[hp].status==="triggered");
  const triggeringSubstancesByHp:Record<string,string[]>={};
  for(const hp of triggeredHps) {
    const ids=outcomes[hp].calculations.filter(c=>c.lower>=c.thresholdPct).flatMap(c=>c.inputIds);
    const names=[...new Set(inputs.filter(r=>ids.includes(r.id)&&!uncertain(r)).map(r=>r.substanceName))];
    if(names.length)triggeringSubstancesByHp[hp]=names;
  }
  return {resultsByHp:outcomes,aggregate,outcomeVersion:HP_RULE_VERSION,triggeringSubstancesByHp,isHazardous:aggregate.status==="hazardous"?true:aggregate.status==="non_hazardous"?false:null,triggeredHps,
    confidenceFlags:aggregate.issues.map(i=>`${i.code}: ${i.reason}`),confidenceFlagsNo:aggregate.status==="indeterminate"?["HP-vurderingen er ufullstendig eller usikker. Farlig avfall kan ikke utelukkes."]:[]};
}
