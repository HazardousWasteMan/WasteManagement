/* Test-only Node preload for the offline browser smoke. It generates invented provider
 * structures in memory and blocks every non-loopback fetch except the simulated provider. */
const reports=["Invented soil A","Invented soil B"].map((marking,index)=>({
  sampleNo:`SYN-${index+1}`,marking,matrix:"soil",firstPage:index,lastPage:index,pageRange:String(index),
}));
const pages=reports.map(report=>({
  id:`/page/${report.firstPage}/Page/synthetic`,block_type:"Page",bbox:[0,0,595,842],children:[{
    id:`/page/${report.firstPage}/Table/header`,block_type:"Table",bbox:[20,20,575,130],
    html:`<table><tr data-bbox="20 20 575 60"><td>Prøvenr.:</td><td>${report.sampleNo}</td><td>Prøvemerking:</td><td>${report.marking}</td><td>Matrise:</td><td>${report.matrix}</td></tr></table>`,
  },{
    id:`/page/${report.firstPage}/Table/results`,block_type:"Table",bbox:[20,150,575,260],
    html:`<table><tr data-bbox="20 170 575 210"><td>Benzo[a]pyrene</td><td>${report.sampleNo.endsWith("2")?"0.02":"100000"}</td><td>mg/kg TS</td></tr></table>`,
  }],
}));
const samples=reports.map((report,index)=>({
  rapportnummer:"SYNTHETIC-BROWSER-1",laboratorium:"Example laboratory",avfallsprodusent:"Example producer",
  oppdragsgiver:"Example organisation",provenummer:report.sampleNo,provemerking:report.marking,matrise:report.matrix,
  fysisk_form:"powder",totalinnhold_utfort:true,ristetest_utfort:false,kolonnetest_utfort:false,
  analyseresultater:[{parameter:"Benzo[a]pyrene",analyte_id:"benzo-a-pyrene",verdi:index?0.02:100000,
    raw_value_text:index?"0.02":"100000",enhet:"mg/kg TS",under_loq:false,loq:0.001,
    analytical_context:"Total content",verdi_citations:[`/page/${report.firstPage}/Table/results`]}],
}));
const original=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==="string"||input instanceof URL?String(input):input.url);
  if(url.hostname==="www.datalab.to"){
    let body;
    if(url.pathname==="/api/v1/convert")body={request_check_url:"https://www.datalab.to/synthetic/convert"};
    else if(url.pathname==="/api/v1/extract")body={request_check_url:`https://www.datalab.to/synthetic/extract/${init.body.get("page_range")}`};
    else if(url.pathname==="/synthetic/convert")body={status:"complete",json:{children:pages},checkpoint_id:"synthetic",page_count:pages.length,total_cost:0};
    else {
      const index=reports.findIndex(report=>report.pageRange===url.pathname.split("/").at(-1));
      if(index<0)throw new Error("Unexpected synthetic provider page range");
      body={status:"complete",extraction_schema_json:samples[index],total_cost:0};
    }
    return Response.json(body);
  }
  if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname))throw new Error("Offline smoke blocked a non-loopback fetch");
  return original(input,init);
};
