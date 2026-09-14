import { describe,expect,it } from "vitest";
import { EAL_MODEL_VERSION,readEalAssignment,resolveEal,reviewEalSelection } from "@/lib/hp-classification/eal";

const mirror = [
  {nivaa:3,kode:"170503",beskrivelse:"Jord og stein som inneholder farlige stoffer",beskrivelseEn:"soil and stones containing dangerous substances",farlig:true},
  {nivaa:3,kode:"170504",beskrivelse:"Annen jord og stein",beskrivelseEn:"soil and stones other than those mentioned in 17 05 03",farlig:false},
];
const absolute = [{nivaa:3,kode:"100101",beskrivelse:"Bunnaske",beskrivelseEn:"bottom ash",farlig:false}];
const base={originProcess:"excavation",material:"soil and stones",labStatedEalCode:null,originToChapterLookup:{excavation:"1705"}};

describe("structured EAL resolution",()=>{
  it("does not let catalogue order change the suggestion or selection",()=>{
    const first=resolveEal({...base,hazardStatus:"hazardous",catalogue:mirror});
    const reversed=resolveEal({...base,hazardStatus:"hazardous",catalogue:[...mirror].reverse()});
    expect(first.suggestedCode).toBe("17 05 03*");
    expect(reversed.suggestedCode).toBe(first.suggestedCode);
    expect(reversed.selectedCode).toBe(first.selectedCode);
    expect(reversed.candidates.map(candidate=>candidate.code)).toEqual(first.candidates.map(candidate=>candidate.code));
  });

  it("does not default chapter 17 01 to concrete when material is unknown",()=>{
    const result=resolveEal({hazardStatus:"indeterminate",originProcess:"construction",material:null,labStatedEalCode:null,originToChapterLookup:{construction:"1701"}});
    expect(result.candidates.some(candidate=>candidate.code==="17 01 01")).toBe(true);
    expect(result.suggestedCode).toBeNull();
    expect(result.selectedCode).toBeNull();
    expect(result.resolutionStatus).toBe("ambiguous");
  });

  it("leaves a mirror pair unresolved when HP is indeterminate",()=>{
    const result=resolveEal({...base,hazardStatus:"indeterminate",catalogue:mirror});
    expect(result.selectedCode).toBeNull();
    expect(result.resolutionStatus).toBe("requires_human_review");
    expect(result.reason).toContain("indeterminate");
  });

  it("resolves a material-specific mirror pair from a reviewed HP aggregate",()=>{
    expect(resolveEal({...base,hazardStatus:"hazardous",catalogue:mirror}).selectedCode).toBe("17 05 03*");
    expect(resolveEal({...base,hazardStatus:"non_hazardous",catalogue:mirror}).selectedCode).toBe("17 05 04");
  });

  it("allows a unique absolute entry to resolve independently of HP",()=>{
    const common={originProcess:"ash",material:"bottom ash",labStatedEalCode:null,originToChapterLookup:{ash:"1001"},catalogue:absolute};
    expect(resolveEal({...common,hazardStatus:"hazardous"}).selectedCode).toBe("10 01 01");
    expect(resolveEal({...common,hazardStatus:"indeterminate"}).selectedCode).toBe("10 01 01");
  });

  it("requires origin/process before generating a confident decision",()=>{
    const result=resolveEal({...base,hazardStatus:"hazardous",originProcess:null,catalogue:mirror});
    expect(result.resolutionStatus).toBe("insufficient_context");
    expect(result.candidates).toEqual([]);
  });

  it("keeps machine suggestion and evidence when a person selects a candidate",()=>{
    const machine=resolveEal({...base,hazardStatus:"indeterminate",labStatedEalCode:"17 05 03*",catalogue:mirror});
    const reviewed=reviewEalSelection(machine,{selectedCode:"17 05 04",reason:"Site records confirm uncontaminated excavated soil."});
    expect(reviewed.modelVersion).toBe(EAL_MODEL_VERSION);
    expect(reviewed.machineSuggestion.code).toBe("17 05 03*");
    expect(reviewed.selectedCode).toBe("17 05 04");
    expect(reviewed.humanSelection?.reason).toContain("Site records");
    expect(reviewed.humanSelection?.evidenceSnapshot).toEqual([...machine.originEvidence,...machine.materialEvidence]);
  });

  it("keeps legacy snapshots readable without promoting them to modern finalization evidence",()=>{
    const legacy=readEalAssignment({code:"17 05 03*",description:"soil",confidence:"old result",confidenceNo:"eldre resultat"});
    expect(legacy.code).toBe("17 05 03*");
    expect(legacy.modelVersion).toBe("legacy");
    expect(legacy.resolutionStatus).toBe("requires_human_review");
    expect(()=>reviewEalSelection(legacy,{selectedCode:"17 05 03*",reason:"review"})).toThrow(/reprocessed/);
  });
});
