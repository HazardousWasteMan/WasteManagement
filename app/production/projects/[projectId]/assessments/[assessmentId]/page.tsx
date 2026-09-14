import { notFound, unstable_rethrow } from "next/navigation";
import { getProductionApplication } from "@/lib/production/server";
import { loadBkWorkspace } from "@/lib/production/bk-workspace";
import { BkWorkspace } from "@/components/production/BkWorkspace";
import { uuid } from "@/lib/production/http";

export default async function AssessmentPage({params,searchParams}:{params:Promise<{projectId:string;assessmentId:string}>;searchParams:Promise<{revision?:string;focus?:string}>}) {
  let loaded;
  const query=await searchParams;
  const revision=query.revision===undefined?undefined:Number(query.revision);
  if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))notFound();
  try {
    const ids=await params;
    loaded=await loadBkWorkspace(await getProductionApplication(),uuid(ids.projectId),uuid(ids.assessmentId),revision);
  } catch(error) {unstable_rethrow(error);return <main className="p-8"><h1>BK workspace unavailable</h1><p>Retry when the production service is available.</p></main>;}
  if(!loaded)notFound();
  // Raw provider payload is retained server-side; only the evidence needed by this view is sent.
  const {sample: _sample,...view}=loaded;
  void _sample;
  return <BkWorkspace key={`${loaded.assessmentId}:${loaded.finalization?.id??revision??"current"}`} {...view} readOnly={revision!==undefined||!!loaded.finalization} focusEal={query.focus==="eal"}/>;
}
