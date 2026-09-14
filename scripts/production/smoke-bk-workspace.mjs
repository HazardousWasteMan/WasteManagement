/** Offline full-browser smoke. Run after build with node --import tsx ... . Requires
 * Playwright (or PRODUCTION_SMOKE_PLAYWRIGHT_PATH) and its installed Chromium browser.
 * Starts fresh local PostgreSQL, simulated Auth/PostgREST and the built Next app on loopback.
 * It does not use configured customer credentials or contact remote services. */
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {BK_QUESTIONS} from '../../lib/bk-skjema/questions.ts';
import {SYNTHETIC_ANSWERS,syntheticPdf} from '../../tests/production/synthetic-fixtures.ts';
import {createCleanLocalDatabase,seedLocalOrganisation} from './local-database.ts';
const {chromium}=await import(process.env.PRODUCTION_SMOKE_PLAYWRIGHT_PATH ? pathToFileURL(path.join(process.env.PRODUCTION_SMOKE_PLAYWRIGHT_PATH,'index.mjs')).href : 'playwright');
const root=process.cwd();
const output=await mkdtemp(path.join(tmpdir(),'bk-workspace-smoke-'));
const uploadPdf=path.join(output,'synthetic-analysis.pdf');
await writeFile(uploadPdf,await syntheticPdf(2,'browser-smoke'));
const local=await createCleanLocalDatabase();
const customer=await seedLocalOrganisation(local.db,'Offline smoke customer');
await local.db.query("select set_config('request.jwt.claim.sub',$1,false)",[customer.userId]);
await local.db.exec('set role authenticated');
const tables=new Set(['organisations','projects','waste_streams','source_documents','assessments','assessment_source_documents','production_processing_runs','production_processing_samples','production_bk_revisions','production_finalizations','production_audit_events']);
const backend=createServer(async(request,response)=>{
  try {
    const url=new URL(request.url,'http://127.0.0.1');
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
    let data;
    if(url.pathname==='/auth/v1/token')data={access_token:'offline-access-token',refresh_token:'offline-refresh-token',expires_in:3600,token_type:'bearer',user:{id:customer.userId,email:'offline@example.test'}};
    else if(url.pathname.includes('/rpc/')){
      const name=url.pathname.split('/').at(-1);
      assert.match(name,/^production_[a-z_]+$/);
      const keys=Object.keys(body);keys.forEach(key=>assert.match(key,/^p_[a-z0-9_]+$/));
      const args=keys.map((key,i)=>`${key}=>$${i+1}`).join(',');
      const values=Object.values(body).map(v=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
      const call=`public.${name}(${args})`;
      data=(await local.db.query(`select ${name==='production_register_samples'?call:`to_jsonb(${call})`} as result`,values)).rows[0].result;
    } else {
      const table=url.pathname.split('/').at(-1);assert.ok(tables.has(table));
      if(request.method==='POST'&&table==='projects')data=(await local.db.query('insert into projects(organisation_id,name,location) values($1,$2,$3) returning *',[body.organisation_id,body.name,body.location??''])).rows[0];
      else {
        assert.equal(request.method,'GET');
        const where=[];const values=[];
        for(const [key,value] of url.searchParams)if(['organisation_id','project_id','assessment_id','waste_stream_id','id','revision'].includes(key)){assert.ok(value.startsWith('eq.'));values.push(value.slice(3));where.push(`${key}=$${values.length}`);}
        let order='';const columns=url.searchParams.get('order');
        if(columns){const parts=columns.split(',').map(part=>{const [name,direction]=part.split('.');assert.ok(['revision','created_at','started_at','sample_index','id'].includes(name));return `${name} ${direction==='desc'?'desc':'asc'}`;});order=` order by ${parts.join(',')}`;}
        const limit=url.searchParams.get('limit')==='1'?' limit 1':'';
        const selected=table==='production_finalizations'?'id,organisation_id,project_id,assessment_id,bk_revision,snapshot,snapshot_sha256,pdf_sha256,finalized_at,created_by':'*';
        const rows=(await local.db.query(`select ${selected} from ${table}${where.length?' where '+where.join(' and '):''}${order}${limit}`,values)).rows;
        data=String(request.headers.accept).includes('vnd.pgrst.object')?(rows[0]??null):rows;
      }
    }
    response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(data));
  }catch(error){response.writeHead(400,{'content-type':'application/json'});response.end(JSON.stringify({message:error.message,code:error.code}));}
});
await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
const apiPort=backend.address().port;
// Reserve an unused loopback port and release it just before launching Next.
const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const appPort=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const env={...process.env,NEXT_TELEMETRY_DISABLED:'1',BASIC_AUTH_USER:'offline-smoke',BASIC_AUTH_PASSWORD:'temporary-offline-smoke',
  PRODUCTION_ORGANISATION_ID:customer.organisationId,PRODUCTION_SUPABASE_URL:`http://127.0.0.1:${apiPort}`,PRODUCTION_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_offline',PRODUCTION_APP_EMAIL:'offline@example.test',PRODUCTION_APP_PASSWORD:'offline',
  SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',DATALAB_API_KEY:'offline-provider',ANTHROPIC_API_KEY:''};
const server=spawn(process.execPath,['--import',path.join(root,'scripts/production/smoke-provider.mjs'),path.join(root,'node_modules/next/dist/bin/next'),'start','--port',String(appPort),'--hostname','127.0.0.1'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
let browser;
let activePage;
try {
  const base=`http://127.0.0.1:${appPort}`;
  for(let i=0;i<80;i++){try{if((await fetch(base)).status===401)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({httpCredentials:{username:env.BASIC_AUTH_USER,password:env.BASIC_AUTH_PASSWORD},viewport:{width:1600,height:1100},acceptDownloads:true});
  const page=await context.newPage();activePage=page;const errors=[];
  page.on("response",async r=>{if(r.status()>=400)console.log("HTTP failure",r.status(),r.url(),(await r.text()).slice(0,500));});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/production/projects`);
  await page.getByLabel('Project name',{exact:true}).fill('Browser smoke site');
  await page.getByLabel('Location (optional)').fill('Known pickup location');
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await page.waitForURL(/\/production\/projects\/[0-9a-f-]+$/);
  await page.getByLabel('Analysis PDF (up to 25 MB)').setInputFiles(uploadPdf);
  const upload=page.waitForResponse(r=>r.url().endsWith('/documents')&&r.request().method()==='POST',{timeout:60000});
  await page.getByRole('button',{name:'Upload and analyse'}).click();
  const uploadResponse=await upload;assert.equal(uploadResponse.status(),200);
  const result=await uploadResponse.json();assert.equal(result.run.status,'completed');
  await page.getByRole('link',{name:/Continue BK|Review EAL/}).first().waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('a')).filter(a=>/Continue BK|Review EAL/.test(a.textContent)).length===2);
  assert.equal((await local.db.query('select count(*)::int as n from source_documents')).rows[0].n,1);
  await page.getByRole('link',{name:/Continue BK|Review EAL/}).first().click();
  await page.locator('[data-field="TextField6"]').waitFor();
  assert.equal(await page.locator('[data-field="TextField6"]').getAttribute('data-status'),'complete');
  await page.locator('[data-field="TextField6"]').click();
  const evidence=page.getByRole('complementary',{name:'Source evidence'});
  await evidence.locator('canvas').first().waitFor();
  await page.waitForFunction(()=>!document.body.textContent.includes('Rendering pages…'));
  const highlight=evidence.locator('.pointer-events-none.absolute').first();assert.ok(await highlight.count());
  const position=await highlight.evaluate(el=>({left:el.style.left,top:el.style.top,width:el.style.width,height:el.style.height}));
  assert.ok(Object.values(position).every(v=>v.endsWith('%')));
  await page.screenshot({path:path.join(output,'document-evidence.png')});
  await page.locator('[data-field="TextField40"]').click();
  await page.getByLabel('Smell / description',{exact:true}).fill('No noticeable smell');
  const saved=page.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Save changes'}).click();
  assert.equal((await saved).status(),200);
  await page.waitForFunction(()=>document.querySelector('[data-field="TextField40"]')?.getAttribute('data-status')==='complete');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download draft BK',exact:true}).click();
  const download=await downloadPromise;await download.saveAs(path.join(output,'draft-bk.pdf'));
  const pdf=await PDFDocument.load(await readFile(path.join(output,'draft-bk.pdf')));
  assert.equal(pdf.getForm().getTextField('TextField40').getText(),'No noticeable smell');
  await page.screenshot({path:path.join(output,'saved-answer.png')});
  await page.reload();await page.locator('[data-field="TextField40"][data-status="complete"]').waitFor();
  let finalized=false;
  if(process.argv.includes('--finalize')) {
    const assessmentUrl=page.url();const assessmentId=assessmentUrl.split('/').at(-1);const projectId=assessmentUrl.split('/').at(-3);
    // Exercise the real logical editors, rather than inserting ready state directly.
    for(let i=0;i<25;i++) {
      const current=(await local.db.query('select workspace from production_bk_revisions where assessment_id=$1 order by revision desc limit 1',[assessmentId])).rows[0].workspace;
      const decision=current.decisions.find(d=>d.status==='needs_input');if(!decision)break;
      const question=BK_QUESTIONS.find(q=>q.id===decision.questionId);const answer=SYNTHETIC_ANSWERS[question.id];assert.ok(answer,question.id);
      if(question.kind==='choice')await page.getByRole('radio',{name:question.options.find(o=>o.value===answer.value).label,exact:true}).check();
      else if(question.kind==='multi_choice')for(const value of answer.selected??(answer.value?[answer.value]:[]))await page.getByRole('checkbox',{name:question.options.find(o=>o.value===value).label,exact:true}).check();
      else for(const part of question.parts)await page.getByLabel(part.label,{exact:true}).fill(answer.values[part.key]);
      const saved=page.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='POST');
      await page.getByRole('button',{name:'Save changes'}).click();assert.equal((await saved).status(),200);
      const completedControl=question.kind==='choice'?question.options.find(o=>o.value===answer.value).controls[0]:question.kind==='multi_choice'?question.options.find(o=>(answer.selected??(answer.value?[answer.value]:[])).includes(o.value)).controls[0]:decision.controls[0];
      await page.locator(`[data-field="${completedControl}"][data-status="complete"]`).waitFor();
    }
    const lifecycle=page.getByRole('region',{name:'Assessment lifecycle'});
    await lifecycle.getByText('Ready to finalize',{exact:true}).waitFor();
    for(const checkbox of await lifecycle.getByRole('checkbox').all())await checkbox.check();
    const finalResponse=page.waitForResponse(r=>r.url().endsWith('/finalize')&&r.request().method()==='POST');
    await lifecycle.getByRole('button',{name:'Finalize BK',exact:true}).click();
    const finalizedResponse=await finalResponse;assert.equal(finalizedResponse.status(),200,await finalizedResponse.text());
    await page.getByRole('link',{name:'Download finalized BK',exact:true}).waitFor();
    const finalDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Download finalized BK',exact:true}).click();
    await (await finalDownload).saveAs(path.join(output,'finalized-bk.pdf'));
    const frozen=(await local.db.query('select snapshot,pdf_sha256 from production_finalizations where assessment_id=$1',[assessmentId])).rows[0];
    const bytes=await readFile(path.join(output,'finalized-bk.pdf'));
    await page.screenshot({path:path.join(output,'finalized.png')});
    await local.db.exec('reset role');await local.db.query("update projects set name='Later site name',location='Later pickup' where id=$1",[projectId]);await local.db.exec('set role authenticated');
    await page.reload();await page.getByRole('link',{name:'Download finalized BK',exact:true}).waitFor();
    const url=`${base}/api/production/projects/${projectId}/assessments/${assessmentId}/bk`;
    assert.deepEqual(await (await context.request.get(url)).body(),bytes);
    assert.equal(await page.getByRole('link',{name:frozen.snapshot.workspace.context.projectName,exact:true}).count(),1);
    await page.getByRole('button',{name:'Create a new assessment',exact:true}).click();
    await page.waitForURL(u=>u.pathname.includes('/assessments/')&&u.pathname!==new URL(assessmentUrl).pathname);
    const nextId=page.url().split('/').at(-1);
    await page.getByLabel('Smell / description',{exact:true}).fill('Revised observation');
    const successorSave=page.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='POST');await page.getByRole('button',{name:'Save changes'}).click();assert.equal((await successorSave).status(),200);
    assert.deepEqual(await (await context.request.get(url)).body(),bytes);
    assert.deepEqual((await local.db.query('select snapshot,pdf_sha256 from production_finalizations where assessment_id=$1',[assessmentId])).rows[0],frozen);
    assert.equal((await local.db.query('select previous_assessment_id from assessments where id=$1',[nextId])).rows[0].previous_assessment_id,assessmentId);
    // Finalize the edited successor, then choose another processed sample explicitly.
    await lifecycle.getByText('Ready to finalize',{exact:true}).waitFor();
    for(const checkbox of await lifecycle.getByRole('checkbox').all())await checkbox.check();
    const secondFinal=page.waitForResponse(r=>r.url().endsWith('/finalize')&&r.request().method()==='POST');
    await lifecycle.getByRole('button',{name:'Finalize BK',exact:true}).click();assert.equal((await secondFinal).status(),200);
    await page.getByLabel('Evidence for the new revision').waitFor();
    await page.getByLabel('Evidence for the new revision').selectOption(assessmentId);
    await page.getByRole('button',{name:'Create a new assessment',exact:true}).click();
    await page.waitForURL(u=>u.pathname.includes('/assessments/')&&!u.pathname.endsWith(nextId));
    const replacementId=page.url().split('/').at(-1);
    const replacementDraft=(await local.db.query('select answers,state from production_bk_revisions where assessment_id=$1',[replacementId])).rows[0];
    assert.deepEqual(replacementDraft.answers,{});assert.equal(replacementDraft.state,'draft');
    assert.equal((await local.db.query('select previous_assessment_id from assessments where id=$1',[replacementId])).rows[0].previous_assessment_id,nextId);
    assert.deepEqual(await (await context.request.get(url)).body(),bytes);
    finalized=true;
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,samples:2,sourceDocuments:1,finalizationAndSuccessorVerified:finalized,sourceHighlight:position,output},null,2));
} catch(error) {
  if(activePage){await activePage.screenshot({path:path.join(output,'failure.png')});console.log((await activePage.locator('body').innerText()).slice(0,3000));}
  console.log('Smoke artifacts:',output);throw error;
} finally {
  await writeFile(path.join(output,'server.log'),logs);
  await browser?.close();server.kill('SIGTERM');await new Promise(resolve=>backend.close(resolve));await local.db.close();
}
