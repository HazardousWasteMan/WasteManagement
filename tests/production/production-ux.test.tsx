import { describe,expect,it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HazardAssessmentPanel, hazardSummaryLabel, hpStatusLabel } from "@/components/production/HazardAssessmentPanel";
import { AssessmentSummaryCard } from "@/components/production/AssessmentSummaryCard";
import { evidenceDocumentForField, UnsavedStatus } from "@/components/production/BkWorkspace";
import { highlightSelectionKey, type Highlight } from "@/components/data-lab/DocumentPane";
import { effectiveEal, resolveEal } from "@/lib/hp-classification/eal";
import { HP_CODES } from "@/lib/hp-classification/hp-outcome";
import { syntheticSample } from "./synthetic-fixtures";

const catalogue=[{nivaa:3,kode:"170503",beskrivelse:"Synthetic hazardous material",beskrivelseEn:"Synthetic hazardous material",farlig:true},{nivaa:3,kode:"170504",beskrivelse:"Synthetic ordinary material",beskrivelseEn:"Synthetic ordinary material",farlig:false}];
const unresolved=resolveEal({hazardStatus:"indeterminate",originProcess:"synthetic",material:"synthetic material",labStatedEalCode:null,originToChapterLookup:{synthetic:"1705"},catalogue});
const visibleText=(html:string)=>html.replace(/<[^>]+>/g," ").replace(/\s+/g," ");

describe("production UX presentation",()=>{
  it("presents every HP property with customer-facing status text",()=>{
    const sample=syntheticSample("indeterminate");
    const html=renderToStaticMarkup(<HazardAssessmentPanel hazard={sample.classification.hazard} measurements={sample.classification.measurementBoundary.measurements}/>);
    for(const hp of HP_CODES)expect(html).toContain(hp);
    expect(html).toContain("Cannot fully determine");
    expect(html).toContain(hpStatusLabel.not_assessable);
    expect(html).not.toContain("not_assessable");
    expect(html).not.toContain("resultsByHp");
  });

  it("never presents a legacy false boolean as a confirmed non-hazardous assessment",()=>{
    const legacy=structuredClone(syntheticSample("ordinary").classification.hazard);
    delete legacy.aggregate;delete legacy.outcomeVersion;legacy.isHazardous=false;
    expect(hazardSummaryLabel(legacy)).toBe("Cannot fully determine");
  });

  it("shows a concise unsaved state for batched edits",()=>{
    expect(renderToStaticMarkup(<UnsavedStatus count={3}/>)).toContain("Unsaved changes · 3");
    expect(renderToStaticMarkup(<UnsavedStatus count={0}/>)).toContain("All changes saved");
  });

  it("does not treat reallocated equivalent highlights as new evidence selection",()=>{
    const first:Highlight={page:2,bbox:[10,20,30,40],blockId:"synthetic-block"};
    const afterSave:Highlight=structuredClone(first);
    expect(highlightSelectionKey(afterSave)).toBe(highlightSelectionKey(first));
    expect(highlightSelectionKey({...afterSave,page:3})).not.toBe(highlightSelectionKey(first));
  });

  it("selects the document named by field provenance and otherwise preserves the active source",()=>{
    const first={document:{id:"document-a",sha256:"a".repeat(64)}};
    const second={document:{id:"document-b",sha256:"b".repeat(64)}};
    const sources=[first,second] as Parameters<typeof evidenceDocumentForField>[1];
    const field={field:"TextField1",citations:[{page:0,bbox:null,text:"Invented evidence",blockId:"synthetic-block",documentRef:`sha256:${second.document.sha256}`}]} as Parameters<typeof evidenceDocumentForField>[0];
    expect(evidenceDocumentForField(field,sources)).toBe("document-b");
    const fieldWithoutCitation={...field,citations:[]} as Parameters<typeof evidenceDocumentForField>[0];
    expect(evidenceDocumentForField(fieldWithoutCitation,sources)).toBeNull();
  });

  it("uses effective EAL and professional finalized-state copy without visible technical identifiers",()=>{
    const eal=effectiveEal({decisions:[unresolved]});
    const assessment={id:"00000000-0000-4000-8000-000000000002",waste_stream_id:"synthetic-stream",version:4,created_at:"2026-09-11T10:00:00Z",eal_code:"17 05 04",is_hazardous:null,effectiveEal:eal,hazardStatus:"indeterminate" as const,bkStatus:"finalized" as const,finalized:true};
    const html=renderToStaticMarkup(<AssessmentSummaryCard projectId="00000000-0000-4000-8000-000000000001" streamName="Synthetic soil" material="Soil" assessment={assessment}/>);
    const text=visibleText(html);
    expect(text).toContain("Needs review");
    expect(text).toContain("View finalized BK");
    expect(text).toContain("Indeterminate");
    expect(text).not.toContain(assessment.id);
    expect(text).not.toContain("needs_review");
    expect(text).not.toContain("Assessment 4");
  });
});
