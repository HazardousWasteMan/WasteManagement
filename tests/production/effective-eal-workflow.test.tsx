import { describe,expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { effectiveEal, resolveEal, reviewEalSelection } from "@/lib/hp-classification/eal";
import { AssessmentSummaryCard } from "@/components/production/AssessmentSummaryCard";
import { answerBkQuestions, loadBkWorkspace } from "@/lib/production/bk-workspace";
import { selectionAfterSave } from "@/components/production/BkWorkspace";
import { syntheticSample } from "./synthetic-fixtures";
import type { BkRevision } from "@/lib/production/bk-draft-store";
import type { BkWorkspace as Workspace } from "@/lib/bk-skjema/workspace";

const catalogue = [
  {nivaa:3,kode:"170503",beskrivelse:"Syntetisk farlig masse",beskrivelseEn:"synthetic material containing dangerous substances",farlig:true},
  {nivaa:3,kode:"170504",beskrivelse:"Syntetisk ordinær masse",beskrivelseEn:"synthetic material other than those mentioned in 17 05 03",farlig:false},
];
const unresolved=resolveEal({hazardStatus:"indeterminate",originProcess:"synthetic",material:"synthetic material",labStatedEalCode:null,originToChapterLookup:{synthetic:"1705"},catalogue});
const machine=resolveEal({hazardStatus:"non_hazardous",originProcess:"synthetic",material:"synthetic material",labStatedEalCode:null,originToChapterLookup:{synthetic:"1705"},catalogue});
const reviewed=reviewEalSelection(unresolved,{selectedCode:"17 05 03*",reason:"Synthetic review evidence supports this candidate."});

function summary(eal:ReturnType<typeof effectiveEal>,stale:string|null="17 05 04") {
  return {id:"assessment",waste_stream_id:"stream",version:1,created_at:"2026-01-01T00:00:00Z",eal_code:stale,is_hazardous:null,effectiveEal:eal,hazardStatus:"indeterminate" as const,bkStatus:"needs_input" as const,finalized:false};
}

describe("effective production EAL",()=>{
  it("prefers a reviewed selection over a stale original assessment code",()=>{
    const result=effectiveEal({decisions:[unresolved,reviewed],persistedCode:"17 05 04"});
    expect(result).toMatchObject({code:"17 05 03*",status:"reviewed"});
    const html=renderToStaticMarkup(<AssessmentSummaryCard projectId="project" streamName="Synthetic stream" assessment={summary(result)}/>);
    expect(html).toContain("17 05 03*");
    expect(html).not.toContain("17 05 04");
  });

  it("shows Needs review with a direct action when no selection is resolved",()=>{
    const html=renderToStaticMarkup(<AssessmentSummaryCard projectId="project" streamName="Synthetic stream" assessment={summary(effectiveEal({decisions:[unresolved],persistedCode:null}),null)}/>);
    expect(html).toContain("Needs review");
    expect(html).toContain("focus=eal#eal-review");
  });

  it("does not revive a stale persisted code when structured EAL requires review",()=>{
    expect(effectiveEal({decisions:[unresolved],persistedCode:"17 05 04"})).toMatchObject({code:null,status:"needs_review"});
  });

  it("shows a resolved machine EAL without requiring review",()=>{
    const result=effectiveEal({decisions:[machine]});
    expect(result).toMatchObject({code:"17 05 04",status:"machine_resolved"});
    const html=renderToStaticMarkup(<AssessmentSummaryCard projectId="project" streamName="Synthetic stream" assessment={summary(result,null)}/>);
    expect(html).toContain("17 05 04");
    expect(html).toContain("Continue BK");
  });
});

describe("batch BK workflow",()=>{
  it("persists several logical answers in one revision and retains them after reload",async()=>{
    const sample=syntheticSample("ordinary");
    sample.classification.eal=unresolved;
    const assessment={id:"assessment",organisation_id:"organisation",project_id:"project",waste_stream_id:"stream",previous_assessment_id:null,version:1,assessed_at:"2026-01-01T00:00:00Z",created_at:"2026-01-01T00:00:00Z",created_by:"user",eal_code:null,is_hazardous:false,decision_snapshot:sample,bk_output:{fields:sample.fields},compliance_evidence:[]};
    let saved:BkRevision|null=null;
    let finalized=false;
    const save=vi.fn(async(_projectId:string,_assessmentId:string,id:string,expectedRevision:number,workspace:BkRevision["workspace"]):Promise<BkRevision>=>{
      saved={id,organisation_id:"organisation",project_id:"project",assessment_id:"assessment",revision:expectedRevision+1,state:workspace.state,answers:workspace.answers,workspace,created_at:"2026-01-01T00:00:01Z",created_by:"user"};
      return saved;
    });
    const app={
      processing:{assessment:async()=>assessment,overview:async()=>({checkedAt:0,project:{id:"project",organisation_id:"organisation",name:"Synthetic project",location:"Synthetic site",created_at:"2026-01-01T00:00:00Z",created_by:"user"},documents:[],runs:[],samples:[],streams:[{id:"stream",organisation_id:"organisation",project_id:"project",name:"Synthetic stream",origin_process:"synthetic",description:"Invented",created_at:"2026-01-01T00:00:00Z",created_by:"user"}],assessments:[]})},
      drafts:{get:async()=>saved,history:async()=>saved?[{revision:saved.revision,state:saved.state,created_at:saved.created_at}]:[],links:async()=>[],save},
      finalizations:{get:async()=>finalized?({id:"final",snapshot:{workspace:saved?.workspace}}):null,audit:async()=>[]},
    } as never;
    const result=await answerBkQuestions(app,"project","assessment",{id:"request",expectedRevision:0,answers:{colour:{values:{description:"Grey"}},smell:{values:{description:"No noticeable smell"}},physical:{value:"0"},pretreatment:{selected:["0","3"]}}});
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.revision).toBe(1);
    expect(result.workspace.answers).toMatchObject({colour:{values:{description:"Grey"}},smell:{values:{description:"No noticeable smell"}},physical:{value:"0"},pretreatment:{selected:["0","3"]}});
    expect(result.workspace.fields.filter(field=>["Checkbox33","Checkbox36"].includes(field.field)&&field.check).map(field=>field.field)).toEqual(["Checkbox33","Checkbox36"]);
    const reloaded=await loadBkWorkspace(app,"project","assessment");
    expect(reloaded?.revision).toBe(1);
    expect(reloaded?.workspace.answers.smell).toEqual({values:{description:"No noticeable smell"}});
    expect(reloaded?.workspace.ealDecision.machineSuggestion).toEqual(unresolved.machineSuggestion);

    finalized=true;
    await expect(answerBkQuestions(app,"project","assessment",{id:"later",expectedRevision:1,answers:{smell:{values:{description:"Changed"}}}})).rejects.toThrow(/finalized/);
  });

  it("keeps the selected evidence field after an unrelated workspace save",()=>{
    const sample=syntheticSample("ordinary");
    const field=sample.fields.find(item=>item.citations?.length)?.field??sample.fields[0].field;
    const current={modelVersion:1,mappingVersion:"test",state:"draft",fields:sample.fields,decisions:[],answers:{},context:{projectId:"project",projectName:"Synthetic",pickupLocation:"Site",streamId:"stream",originProcess:null},ealDecision:unresolved,summary:{ready:0,needsInput:1,cannotDetermine:1,receiver:1}} as Workspace;
    const next=structuredClone(current);
    next.answers.smell={values:{description:"No noticeable smell"}};
    expect(selectionAfterSave(field,next)).toBe(field);
  });
});
