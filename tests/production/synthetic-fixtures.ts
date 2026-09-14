/** Invented fixtures only: no customer names, contacts, report excerpts or provider payloads. */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { bkFromDatalab } from "@/lib/bk-skjema/from-datalab";
import type { AnalysedSample } from "@/lib/bk-skjema/analyse-bundle";
import type { LegalCitationView } from "@/lib/compliance/citation-view";
export const SYNTHETIC_ANSWERS = {
  delivery:{value:"single"},pickup:{values:{location:"Example test site"}},marking:{values:{reference:"TEST-1"}},
  producer:{values:{name:"Example producer",number:"123456789"}},address:{values:{street:"Example road 1",postal:"0001",town:"Test town"}},
  contact:{values:{name:"Test contact",phone:"12345678",email:"test@example.test"}},transporter:{values:{name:"Example carrier",phone:"12345678",email:"carrier@example.test"}},
  "waste-number":{values:{code:"1234"}},industry:{values:{code:"123"}},municipality:{values:{code:"1234"}},
  origin:{value:"0"},material:{value:"0"},physical:{value:"0"},pretreatment:{value:"4"},colour:{values:{description:"Grey"}},smell:{values:{description:"No noticeable smell"}},
};
export function syntheticSample(kind: "ordinary"|"hazardous"|"indeterminate"|"unsupported"|"wet-basis"|"mixed-invalid", legalCitations?: Record<string,LegalCitationView|null>, evidenceId?: string): AnalysedSample {
  const raw={rapportnummer:"SYNTHETIC-1",laboratorium:"Example test laboratory",avfallsprodusent:"Example producer",oppdragsgiver:"Example customer",provenummer:"TEST-1",provemerking:"TEST-1",matrise:"jord",fysisk_form:"pulver",totalinnhold_utfort:kind!=="indeterminate",ristetest_utfort:kind==="indeterminate",
    analyseresultater:[{parameter:"Benzo[a]pyrene",analyte_id:"benzo-a-pyrene",verdi:kind==="hazardous"?100000:0.01,enhet:kind==="indeterminate"?"mg/l":kind==="unsupported"||kind==="mixed-invalid"?"ppm":kind==="wet-basis"?"mg/kg":"mg/kg TS",under_loq:false,loq:0.001}]};
  if(kind==="mixed-invalid")raw.analyseresultater.push({...raw.analyseresultater[0],enhet:"mg/kg TS"});
  const result=bkFromDatalab(raw,{},"escavo terre e rocce",legalCitations,evidenceId?{documentRef:`sha256:${evidenceId}`,sampleId:`sample:${evidenceId}`}:undefined);
  return {subReport:{sampleNo:"TEST-1",marking:"TEST-1",matrix:"jord",firstPage:0,lastPage:0,pageRange:"0-0"},extractionState:"complete",fields:result.fields,metadata:result.source.metadata,results:result.source.results,classification:result.classification,normalizationTrace:result.normalizationTrace,unmatchedAnalytes:result.unmatchedAnalytes,raw,costCents:0};
}
export async function syntheticPdf(samples=1,label="example") {
  const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let n=0;n<samples;n++)pdf.addPage().drawText(`INVENTED TEST REPORT (${label}) - sample ${n+1}. Not customer data.`,{font,size:14,x:40,y:700});
  return Buffer.from(await pdf.save());
}
