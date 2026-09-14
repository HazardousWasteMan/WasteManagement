import { sameOrigin } from "@/lib/production/http";
import { describe,expect,it } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { renderToStaticMarkup } from "react-dom/server";
import { BK_QUESTIONS,validateAnswer,type BkAnswers } from "@/lib/bk-skjema/questions";
import { buildBkWorkspace,decisionForField,fieldAttention,legalFieldsForDecision } from "@/lib/bk-skjema/workspace";
import { sourceHighlights } from "@/lib/bk-skjema/evidence";
import { fillBkPdf } from "@/lib/bk-skjema/fill-pdf";
import { FormPane } from "@/components/data-lab/FormPane";
import type { AnalysedSample } from "@/lib/bk-skjema/analyse-bundle";
import geometry from "@/lib/data/bk-skjema-field-geometry.json";
import { syntheticSample } from "./synthetic-fixtures";
const sample=syntheticSample("hazardous") as AnalysedSample;
const context={projectId:"project",projectName:"Invented site",pickupLocation:"Invented pickup location",streamId:"stream",originProcess:"escavo terre e rocce"};
const blank=readFileSync("public/forms/bk-skjema-blank.pdf");

describe("logical BK questions and evidence",()=>{
  it("accepts the browser-facing Host when Next reconstructs an internal request URL, but rejects foreign origins",()=>{
    expect(()=>sameOrigin(new Request("http://localhost:3000/api",{headers:{host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000"}}))).not.toThrow();
    expect(()=>sameOrigin(new Request("http://localhost:3000/api",{headers:{host:"127.0.0.1:3000",origin:"https://foreign.test"}}))).toThrow();
  });
  it("maps actual human and receiver controls exactly once, retaining all actual widget names",async()=>{
    const document=await PDFDocument.load(blank);
    const names=document.getForm().getFields().map(f=>f.getName());
    expect(names).toHaveLength(103);expect(geometry.widgets).toHaveLength(109);
    const controls=BK_QUESTIONS.flatMap(q=>q.controls);
    expect(new Set(controls).size).toBe(controls.length);
    expect(controls.every(name=>names.includes(name))).toBe(true);
    const human=sample.fields.filter(f=>f.src==="human");expect(human.length).toBeGreaterThan(0);
    expect(human.every(f=>controls.includes(f.field))).toBe(true);
    expect(human.every(field=>BK_QUESTIONS.some(question=>question.controls.includes(field.field)))).toBe(true);
    expect(BK_QUESTIONS.find(q=>q.id==="smell")?.controls).toEqual(["TextField40"]);
  });
  it("keeps long production description appearances inside the actual widget without changing saved text",async()=>{
    const text="Invented mineral waste with synthetic analytical results and supporting evidence. ".repeat(12);
    const result=await fillBkPdf(blank,[{field:"TextField38",label:"Description",src:"derived",value:text}],{fitText:true});
    expect(result.outcomes[0].filled).toBe(true);
    const document=await PDFDocument.load(result.pdf);
    const field=document.getForm().getTextField("TextField38");
    expect(field.getText()).toBe(text);
    const widget=field.acroField.getWidgets()[0];
    const appearance=widget.getAppearances()!.normal as PDFRawStream;
    const stream=Buffer.from(decodePDFRawStream(appearance).decode()).toString("latin1");
    const fontSize=Number(stream.match(/\/Helvetica ([\d.]+) Tf/)![1]);
    const font=document.getForm().getDefaultFont();
    const lines=[...stream.matchAll(/<([0-9A-F]+)> Tj/g)];
    expect(lines.length).toBeGreaterThan(1);
    for(const [,hex] of lines){
      const line=Buffer.from(hex,"hex").toString("ascii");
      const drawnWidth=Array.from(line).reduce((sum,char)=>sum+font.widthOfTextAtSize(char,fontSize),0);
      expect(drawnWidth).toBeLessThanOrEqual(widget.getRectangle().width-3);
    }
    expect(appearance.dict.has(PDFName.of("Resources"))).toBe(true);
  });
  it("allows the generated narrative to be edited in an immutable pre-finalization draft",()=>{
    const answer=validateAnswer("description",{values:{text:"Reviewed synthetic narrative. HP and EAL conclusions remain separate from landfill acceptance."}});
    const workspace=buildBkWorkspace(sample,context,{description:answer});
    const field=workspace.fields.find(field=>field.field==="TextField38")!;
    expect(field.src).toBe("human");
    expect(field.value).toContain("Reviewed synthetic narrative. HP and EAL conclusions remain separate from landfill acceptance.");
    expect(decisionForField(workspace,"TextField38")).toMatchObject({status:"complete",source:"human",questionId:"description"});
  });
  it("splits one administrative answer across real digit controls",()=>{
    const workspace=buildBkWorkspace(sample,context,{"waste-number":validateAnswer("waste-number",{values:{code:"1234"}})});
    expect([23,24,25,26].map(n=>workspace.fields.find(f=>f.field===`TextField${n}`)?.value).join("")).toBe("1234");
    expect(()=>validateAnswer("waste-number",{values:{code:"1"}})).toThrow();
  });
  it.each([0,1,2,3,4,5])("maps physical choice %s to the correct actual checkbox",async index=>{
    const workspace=buildBkWorkspace(sample,context,{physical:validateAnswer("physical",{value:String(index),detail:index===5?"Description":""})});
    expect(workspace.fields.filter(f=>/^Checkbox(27|28|29|30|31|32)$/.test(f.field)&&f.check).map(f=>f.field)).toEqual([`Checkbox${27+index}`]);
    const filled=await PDFDocument.load((await fillBkPdf(blank,workspace.fields)).pdf);
    expect(filled.getForm().getCheckBox(`Checkbox${27+index}`).isChecked()).toBe(true);
  });
  it.each([0,1,2,3,4,5,6,7])("maps origin choice %s and clears the alternatives",index=>{
    const workspace=buildBkWorkspace(sample,context,{origin:validateAnswer("origin",{value:String(index),detail:index===7?"Another origin":""})});
    expect(workspace.fields.filter(f=>/^Checkbox(11|12|13|14|15|16|17|18)$/.test(f.field)&&f.check).map(f=>f.field)).toEqual([`Checkbox${11+index}`]);
  });
  it("groups delivery and recurrence and activates the correct paired recurring fields",async()=>{
    const initial=buildBkWorkspace(sample,context);
    expect(decisionForField(initial,"group6")?.status).toBe("needs_input");
    expect(decisionForField(initial,"TextField42")?.status).toBe("not_applicable");
    const emptyPdf=await PDFDocument.load((await fillBkPdf(blank,initial.fields)).pdf);
    expect(emptyPdf.getForm().getRadioGroup("group6").getSelected()).toBeUndefined();
    const workspace=buildBkWorkspace(sample,context,{delivery:validateAnswer("delivery",{value:"first"}),"fraction-0":validateAnswer("fraction-0",{values:{measured:"10",variation:"8-12"}})});
    expect(workspace.fields.find(f=>f.field==="group1")?.select).toBe("Radio3");
    expect(workspace.fields.find(f=>f.field==="group6")?.select).toBe("Radio2");
    expect(workspace.fields.find(f=>f.field==="TextField42")?.value).toBe("10");
    expect(workspace.fields.find(f=>f.field==="TextField46")?.value).toBe("8-12");
    expect(decisionForField(workspace,"TextField43")?.status).toBe("needs_input");
  });
  it("reuses context honestly and excludes the receiver from user tasks",()=>{
    const missing=structuredClone(sample);missing.fields.find(f=>f.field==="TextField4")!.value=undefined;
    const workspace=buildBkWorkspace(missing,context);
    expect(decisionForField(workspace,"TextField4")).toMatchObject({status:"complete",source:"project/context"});
    expect(workspace.fields.find(f=>f.field==="TextField4")?.citations).toEqual([]);
    expect(decisionForField(workspace,"Checkbox11")).toMatchObject({status:"complete",source:"project/context"});
    expect(decisionForField(workspace,"TextField1")).toMatchObject({status:"not_applicable",source:"receiver"});
    expect(workspace.decisions.filter(d=>d.source==="receiver").every(d=>d.status!=="needs_input")).toBe(true);
  });
  it("keeps a populated extracted control green when another part of its question is missing",()=>{
    const workspace=buildBkWorkspace(sample,context);
    expect(decisionForField(workspace,"TextField6")?.status).toBe("needs_input");
    expect(fieldAttention(workspace).TextField6.status).toBe("complete");
    expect(fieldAttention(workspace).TextField7.status).toBe("needs_input");
    expect(workspace.fields.every(f=>decisionForField(workspace,f.field))).toBe(true);
  });
  it("preserves document citations and exact source selection geometry",()=>{
    const cited=structuredClone(sample);
    cited.fields.find(item=>item.field==="TextField6")!.citations=[{blockId:"/page/0/Text/synthetic",page:0,text:"Example producer",bbox:[10,20,200,40],documentRef:"sha256:"+"a".repeat(64)}];
    const workspace=buildBkWorkspace(cited,context);
    const field=workspace.fields.find(f=>f.citations?.some(c=>c.bbox))!;
    const original=cited.fields.find(f=>f.field===field.field)!;
    expect(field.citations).toEqual(original.citations);
    expect(sourceHighlights(field)).toEqual(original.citations!.filter(c=>c.bbox&&c.page!==null).map(c=>({page:c.page,bbox:c.bbox,blockId:c.blockId})));
    const legacy=renderToStaticMarkup(<FormPane pdf={new Blob()} fields={[field]} selected={field.field} onSelect={()=>{}}/>);
    expect(legacy).toContain("show source in the report");expect(legacy).toContain("bg-lime");
  });
  it("exposes derived/legal evidence and keeps indeterminate distinct from missing human input",()=>{
    const unknown=structuredClone(sample);
    unknown.classification.hazard.isHazardous=null;unknown.classification.eal.code=null;
    const citation={citations:[{paragraphId:"basis",label:"Saved legal basis",sourceLink:"https://lovdata.no/",verifiedAt:"2026-09-01",disputed:false,primary:true}]};
    unknown.fields.find(f=>f.field==="Checkbox10")!.legalCitation=citation;
    unknown.fields.find(f=>f.field==="Checkbox10")!.legalCitationKey="eal-legal-basis";
    const workspace=buildBkWorkspace(unknown,context);
    expect(decisionForField(workspace,"Checkbox1")).toMatchObject({status:"cannot_determine",source:"classification"});
    expect(decisionForField(workspace,"TextField40")?.status).toBe("needs_input");
    expect(decisionForField(workspace,"TextField35")?.status).toBe("cannot_determine");
    expect(workspace.fields.find(f=>f.field==="Checkbox10")?.legalCitation).toEqual(citation);
    expect(legalFieldsForDecision(workspace,decisionForField(workspace,"TextField17"))[0].legalCitation).toEqual(citation);
    const attention=Object.fromEntries(workspace.decisions.flatMap(d=>d.controls.map(c=>[c,{status:d.status,label:d.title}])));
    const markup=renderToStaticMarkup(<FormPane pdf={new Blob()} fields={workspace.fields} attention={attention} selected={null} onSelect={()=>{}}/>);
    expect(markup).toContain('data-field="TextField40"');expect(markup).toContain('data-status="needs_input"');expect(markup).toContain('data-status="cannot_determine"');expect(markup).toContain("border-dashed");
  });
  it("ready means user questions complete while explicit evidence gaps remain; no source snapshot changes",()=>{
    const original=structuredClone(sample);
    const answers:BkAnswers={delivery:{value:"single"}};
    const preliminary=buildBkWorkspace(sample,context,answers);
    for(const d of preliminary.decisions.filter(d=>d.status==="needs_input")){
      const q=BK_QUESTIONS.find(q=>q.id===d.questionId)!;
      answers[q.id]=q.kind==="choice"?{value:q.options![0].value}:q.kind==="multi_choice"?{selected:[q.options![4].value]}:{values:Object.fromEntries(q.parts!.map(p=>[p.key,p.pattern?"1".repeat(p.max):"Provided"]))};
    }
    const workspace=buildBkWorkspace(sample,context,answers);
    expect(workspace.state).toBe("ready");expect(workspace.summary.needsInput).toBe(0);expect(workspace.summary.cannotDetermine).toBeGreaterThan(0);
    expect(sample).toEqual(original);
    expect(workspace.fields.find(f=>f.field==="TextField38")?.value).toContain("Uavklart");
  });
});
