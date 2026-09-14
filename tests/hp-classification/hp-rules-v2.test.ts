import {describe,it,expect} from "vitest";
import {classifyHazard,type NormalizedResultWithClp} from "@/lib/hp-classification/hazard";
import {aggregateHp,HP_CODES,HP_RULE_VERSION,normalizeHStatement,readHpOutcome,type HpOutcome} from "@/lib/hp-classification/hp-outcome";
import type {SampleMetadata} from "@/lib/hp-classification/types";
const metadata={physicalState:"solid",viscosity40cMm2s:null} as SampleMetadata;
const row=(hStatement:string,resultPct:number,patch:Partial<NormalizedResultWithClp>={}):NormalizedResultWithClp=>({substanceName:"invented substance",hStatement,resultPct,hazardClass:"synthetic",mFactorAcute:null,mFactorChronic:null,...patch});
const calc=(rows:NormalizedResultWithClp[])=>classifyHazard(rows,metadata,[]);
describe("HP v2 independent waste-rule boundaries (synthetic only)",()=>{
 it.each(["H360","H360D","H360F","H360FD","H360Fd","H360Df","H361","H361d","H361f","H361fd"])("HP10 individual boundary %s",h=>{
  const t=h.startsWith("H360")?0.3:3;
  expect(calc([row(h,t-0.00001)]).resultsByHp.HP10.status).toBe("not_triggered");
  for(const c of [t,t+0.00001])expect(calc([row(h,c)]).resultsByHp.HP10.status).toBe("triggered");
  expect(calc([row(h,t*0.6,{substanceName:"a"}),row(h,t*0.6,{substanceName:"b"})]).resultsByHp.HP10.status).toBe("not_triggered");
 });
 it("normalizes only recognized qualifiers",()=>{expect(normalizeHStatement(" h360Df ")).toBe("H360");expect(normalizeHStatement("H360garbage")).toBeNull();expect(calc([row("H350i",0.1)]).resultsByHp.HP7.status).toBe("triggered");});
 it.each([["H410",0.25],["H411",2.5],["H412",25],["H400",25],["H413",25],["H420",0.1]] as const)("HP14 boundary %s",(h,t)=>{
  expect(calc([row(h,t-0.000001)]).resultsByHp.HP14.status).toBe("not_triggered");
  for(const c of [t,t+0.000001])expect(calc([row(h,c)]).resultsByHp.HP14.status).toBe("triggered");
 });
 it("uses 100 H410 + 10 H411 + H412 without M factors",()=>{
  const h=calc([row("H410",0.1,{mFactorChronic:10000}),row("H411",1),row("H412",5)]).resultsByHp.HP14;
  expect(h.status).toBe("triggered");expect(h.calculations.find(c=>c.rule==="2017/997:weighted-chronic")?.lower).toBe(25);
  expect(calc([row("H400",0.3,{mFactorAcute:10000})]).resultsByHp.HP14.status).toBe("not_triggered");
 });
 it("applies individual cutoffs before sums and never sums H420",()=>{
  expect(calc(Array.from({length:400},()=>row("H410",0.099))).resultsByHp.HP14.status).toBe("not_triggered");
  expect(calc(Array.from({length:30},()=>row("H411",0.99))).resultsByHp.HP14.status).toBe("not_triggered");
  expect(calc([row("H420",0.06),row("H420",0.06)]).resultsByHp.HP14.status).toBe("not_triggered");
 });
 it.each(["Skin Corr. 1A","Skin Corr. 1B","Skin Corr. 1C"])("HP4 subclass %s",hazardClass=>{
  expect(calc([row("H314",1,{hazardClass})]).resultsByHp.HP4.status).toBe(hazardClass.endsWith("1A")?"triggered":"not_triggered");
  const h=calc([row("H314",5,{hazardClass})]);expect(h.resultsByHp.HP8.status).toBe("triggered");expect(h.resultsByHp.HP4).toMatchObject({status:"not_applicable",supersededBy:"HP8"});
 });
 it("HP4/8 have 1% cutoffs; unqualified H314 needs review",()=>{
  const h=calc(Array.from({length:10},()=>row("H314",0.9,{hazardClass:"Skin Corr. 1A"})));
  expect(h.resultsByHp.HP4.status).toBe("not_triggered");expect(h.resultsByHp.HP8.status).toBe("not_triggered");expect(calc([row("H314",2)]).resultsByHp.HP4.status).toBe("not_assessable");
 });
 it("retains LOQ ambiguity instead of confirmed hazard",()=>{
  const h=calc([row("H360D",0.5,{censoring:"<",measurementId:"m1"})]);
  expect(h.resultsByHp.HP10).toMatchObject({status:"requires_manual_assessment",conservativeAssumption:true,measurementIds:["m1"]});expect(h.isHazardous).toBeNull();
 });
 it("distinguishes < and <= at legal thresholds and cutoffs",()=>{
  expect(calc([row("H360",0.3,{censoring:"<"})]).resultsByHp.HP10.status).toBe("not_triggered");
  expect(calc([row("H360",0.3,{censoring:"<="})]).resultsByHp.HP10.status).toBe("requires_manual_assessment");
  expect(calc(Array.from({length:300},()=>row("H410",0.1,{censoring:"<"}))).resultsByHp.HP14.status).toBe("not_triggered");
 });
 it("does not sum alternative forms of one elemental measurement",()=>{
  const variants=[row("H410",0.15,{measurementId:"metal",alternativeGroup:"metal",scenarioId:"oxide",assumedSpecies:true}),row("H410",0.15,{measurementId:"metal",alternativeGroup:"metal",scenarioId:"salt",assumedSpecies:true})];
  const h=calc(variants).resultsByHp.HP14;expect(h.calculations.find(c=>c.rule==="2017/997:weighted-chronic")?.upper).toBe(15);expect(h.status).toBe("not_assessable");
  expect(calc([{...variants[0],resultPct:0.3}]).resultsByHp.HP14.status).toBe("requires_manual_assessment");
 });
 it("deduplicates repeated CLP entries for the same measurement",()=>{const r=row("H410",0.15,{measurementId:"same"});expect(calc([r,r]).resultsByHp.HP14.status).toBe("not_triggered");});
 it("confirmed trigger wins while manual outcomes remain",()=>{
  const h=calc([row("H350",0.1)]);expect(h.aggregate.status).toBe("hazardous");for(const hp of ["HP9","HP12","HP15"] as const)expect(h.resultsByHp[hp].status).toBe("requires_manual_assessment");
 });
 it("missing tests never become not applicable or overall false",()=>{
  const h=calc([]);expect(h.isHazardous).toBeNull();for(const hp of ["HP1","HP2","HP3"] as const)expect(h.resultsByHp[hp].status).toBe("not_assessable");
 });
 it("requires all 15 resolved properties and no issues for non-hazardous",()=>{
  const complete=Object.fromEntries(HP_CODES.map(hp=>[hp,{hp,status:"not_triggered",coverage:"property_assessed",reason:"Synthetic complete scoped assessment",measurementIds:["evidence"],inputIds:["evidence"],ruleVersion:HP_RULE_VERSION,calculations:[],issues:[],conservativeAssumption:false}])) as unknown as Record<typeof HP_CODES[number],HpOutcome>;
  expect(aggregateHp(complete).status).toBe("non_hazardous");complete.HP9.status="requires_manual_assessment";expect(aggregateHp(complete).status).toBe("indeterminate");complete.HP7.status="triggered";expect(aggregateHp(complete).status).toBe("hazardous");
 });
 it.each([["HP12","EUH029"],["HP12","EUH031"],["HP15","H205"],["HP15","EUH019"]] as const)("%s confirmed presence %s",(hp,h)=>{
  expect(calc([row(h,0.01)]).resultsByHp[hp].status).toBe("triggered");
  expect(calc([row(h,0.01,{censoring:"<"})]).resultsByHp[hp].status).toBe("requires_manual_assessment");
 });
 it.each([["H318",10],["H315",20],["H319",20]] as const)("HP4 %s boundary",(h,t)=>{
  expect(calc([row(h,t-0.0001)]).resultsByHp.HP4.status).toBe("not_triggered");
  for(const value of [t,t+0.0001])expect(calc([row(h,value)]).resultsByHp.HP4.status).toBe("triggered");
 });
 it("records a negative test/calculation conflict for review",()=>{
  const h=classifyHazard([row("H314",5,{hazardClass:"Skin Corr. 1B"})],metadata,[{testName:"skin_corrosion",result:"Negative synthetic test",isPositive:false}]);
  expect(h.resultsByHp.HP8.status).toBe("requires_manual_assessment");expect(h.aggregate.status).toBe("indeterminate");
 });
 it("HP6 applies the acute-category cutoff before summing",()=>{
  const rows=Array.from({length:60},()=>row("H301",0.099,{hazardClass:"Acute Tox. 3 (Oral)"}));
  expect(calc(rows).resultsByHp.HP6.status).toBe("not_triggered");
 });
 it("invalid inputs and screening-only negatives prevent a non-hazardous aggregate",()=>{
  const h=calc([row("H360",NaN)]);expect(h.aggregate.status).toBe("indeterminate");expect(h.aggregate.issues.some(i=>i.code==="invalid_hp_input")).toBe(true);
  const negative=calc([row("H360",0.01)]).resultsByHp.HP10;expect(negative.coverage).toBe("screening_only");
 });
 it("reads legacy snapshots without upgrading false to proof",()=>{const frozen={HP7:true,HP9:false};const before=JSON.stringify(frozen);expect(readHpOutcome("HP9",false).status).toBe("not_assessable");expect(readHpOutcome("HP7",true).ruleVersion).toBe("legacy");expect(JSON.stringify(frozen)).toBe(before);});
});
