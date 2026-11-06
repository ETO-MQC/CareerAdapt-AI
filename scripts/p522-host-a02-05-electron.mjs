import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
import {out,root,host,desktop,write,sha} from './p522-host-a02-05-common.mjs';
import {loadLocalPool,selectModels,credential} from './p522-host-a02-05-provider-pool.mjs';
import {sanitize} from './p522-host-a02-02-evidence.mjs';
// Reviewed: no deletion/cleanup calls. Only close this script's Electron app;
// retain home, workspace, downloads, screenshots, and logs after qualification.
const qualification=Date.now(),resume=process.argv.find(a=>a.startsWith('--resume-run='))?.slice(13),run=Number(resume || qualification),dir=path.join(root,`run-${run}`),home=path.join(dir,'home'),workspace=path.join(dir,'workspace');
for(const folder of [home,workspace,path.join(out,'screenshots')])fs.mkdirSync(folder,{recursive:true});
const selected=selectModels(loadLocalPool().pool,'tool_execution')[0];assert.ok(selected,'Verified tool model required');
const {provider,model}=selected,key=credential(provider),secrets=loadLocalPool().pool.providers.map(credential).filter(Boolean);
const config=path.join(home,'config.yaml');
fs.writeFileSync(config,`model:\n  default: ${JSON.stringify(model.id)}\n  provider: custom\n  base_url: ${JSON.stringify(provider.base_url)}\n  api_key: ${JSON.stringify(key)}\nagent:\n  api_max_retries: 1\n  max_turns: 4\n  reasoning_effort: none\ntoolsets: [file]\nsessions:\n  auto_archive: false\n`);
fs.writeFileSync(path.join(home,'.env'),'');
const req=createRequire(path.join(desktop,'package.json'));
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|USERNAME|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env=Object.fromEntries(Object.entries(process.env).filter(([n,v])=>v&&allowed.test(n)));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(dir,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:`A02-05-${run}`,HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5195',HERMES_DESKTOP_CWD:workspace,HERMES_IGNORE_RULES:'1',HERMES_TUI_TOOLSETS:'file',HERMES_DUMP_REQUESTS:'0',HERMES_DESKTOP_PORT_ANNOUNCE_TIMEOUT_MS:'150000',CAREERADAPT_STARTUP_TRACE:path.join(dir,'startup.jsonl')});
if(new URL(provider.base_url).hostname==='openrouter.ai')env.OPENROUTER_API_KEY=key;
const result={run,status:'RUNNING',provider:provider.id,model:model.id,launches:[],cases:[],rpc:[],events:[],screenshots:[],errors:[],submissions:[],mainSha:sha(fs.readFileSync('.artifacts/p522-host-a02-01/main-integration/main.mjs')),deletions:0};
const persist=()=>write(`electron-${qualification}`,sanitize(result,secrets));
let app,page,epoch=0;
const heartbeat=setInterval(persist,15000);
const editor=()=>page.getByRole('textbox',{name:'Message',exact:true});
const nav=()=>page.getByRole('navigation',{name:'CareerAdapt 主导航',exact:true});
const snapshot=()=>page.evaluate(async()=>{const s=await import('/src/store/session.ts');return {storedId:s.$selectedStoredSessionId.get(),runtimeId:s.$activeSessionId.get(),busy:s.$busy.get(),awaiting:s.$awaitingResponse.get(),messages:s.$messages.get()};});
async function shot(name){const file=`${out}/screenshots/${run}-${qualification}-${epoch}-${name}.png`;await page.screenshot({path:file,timeout:10000,scale:'css'});result.screenshots.push(file);}
async function ready(){
 const later=page.getByRole('button',{name:/choose a provider later/i});
 await Promise.any([later.waitFor({timeout:210000}),nav().waitFor({timeout:210000})]);
 if(await later.isVisible())await later.click();
 await page.getByRole('button',{name:/AI 连接.*ready/i}).waitFor({timeout:210000});
}
async function launch(){
 epoch++;process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
 app=await _electron.launch({executablePath:req('electron'),args:[path.resolve('.artifacts/p522-host-a02-01/main-integration'),'--disable-gpu','--no-sandbox'],cwd:workspace,env,timeout:30000});
 result.launches.push({epoch,pid:app.process().pid,startedAt:Date.now()});
 page=await app.firstWindow({timeout:20000});page.setDefaultTimeout(15000);
 page.on('pageerror',e=>result.errors.push(e.message));
 page.on('websocket',socket=>{
  socket.on('framesent',e=>{try{const v=JSON.parse(String(e.payload));if(v.method)result.rpc.push({epoch,at:Date.now(),...v});}catch{/* Opaque frames are not logged. */}});
  socket.on('framereceived',e=>{try{const v=JSON.parse(String(e.payload));if(v.params?.type)result.events.push({epoch,at:Date.now(),...v.params});if(v.id!==undefined){const r=result.rpc.findLast(r=>r.epoch===epoch&&r.id===v.id);if(r){r.result=v.result;r.error=v.error;}}}catch{/* Opaque frames are not logged. */}});
 });
 await ready();result.launches.at(-1).readyAt=Date.now();persist();
}
async function close(){if(!app)return;const process=app.process();await app.close();result.launches.at(-1).closedAt=Date.now();result.launches.at(-1).exitCode=process.exitCode;app=null;}
async function check(name,fn){try{const value=await fn();result.cases.push({name,status:'PASS',...value});persist();return value;}catch(e){result.cases.push({name,status:'FAIL',error:String(e.stack || e)});persist();process.exitCode=1;return null;}}
async function send(text){
 if(!await editor().isVisible())await nav().getByRole('button',{name:'AI 工作台',exact:true}).click();await editor().waitFor();
 const offset=result.events.length,rpcOffset=result.rpc.length,started=Date.now();
 await editor().fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();
 const end=Date.now()+90000;while(Date.now()<end&&!result.events.slice(offset).some(e=>e.type==='message.complete'))await page.waitForTimeout(200);
 const terminal=result.events.slice(offset).find(e=>e.type==='message.complete'),state=await snapshot();
 const submissions=result.rpc.slice(rpcOffset).filter(r=>r.method==='prompt.submit');assert.equal(submissions.length,1,'No automatic replay');
 result.submissions.push({startedAt:started,elapsedMs:Date.now()-started,terminal,state,submissions});persist();
 assert.ok(terminal,'Native terminal required');assert.notEqual(terminal.payload?.status,'error','Provider failure cannot count as successful generation');return state;
}
async function artifacts(){await nav().getByRole('button',{name:'工作成果',exact:true}).click();await page.getByRole('main',{name:'工作成果',exact:true}).waitFor();await page.getByRole('button',{name:'刷新成果',exact:true}).waitFor();}
const pathA=path.join(workspace,`result-A-${run}.txt`),pathB=path.join(workspace,`result-B-${run}.txt`),textA=`SYNTHETIC_ARTIFACT_A_${run}`,textB=`SYNTHETIC_ARTIFACT_B_${run}`;
const fileButton=label=>page.getByRole('region',{name:'成果列表'}).getByRole('button').filter({has:page.getByText(label,{exact:true})});
let a,b;
try{
 await launch();
 if(!resume){
 await check('empty-state',async()=>{await artifacts();await page.getByText('暂无工作成果。请在 AI 工作台明确要求生成文件。',{exact:true}).waitFor();await shot('empty');return {syntheticStoreWrites:0};});
 a=await check('real-provider-create',async()=>{const state=await send(`Use the file tool to write EXACTLY ${textA} to the absolute path ${JSON.stringify(pathA)}. Create this synthetic qualification file now, then respond with its path. Do not run shell commands. Do not merely describe the operation.`);assert.equal(fs.readFileSync(pathA,'utf8').trim(),textA);await artifacts();await fileButton(path.basename(pathA)).click();await page.getByText(textA,{exact:true}).waitFor();await shot('created-preview');return state;});
 }else{
  const previous=JSON.parse(fs.readFileSync(`${out}/electron-${run}.json`,'utf8'));
  a=previous.cases.find(c=>c.name==='real-provider-create'&&c.status==='PASS');assert.ok(a,'Reuse only proved native generation');
  await artifacts();await fileButton(path.basename(pathA)).click();await page.getByText(textA,{exact:true}).waitFor();
  result.reusedCreation={evidence:`electron-${run}.json`,sessionId:a.storedId,noRepeatedModelRequest:true};
 }
 await check('download',async()=>{
  const target=path.join(dir,'download.txt');
  await app.evaluate(({BrowserWindow},target)=>{globalThis.__artifactDownload={status:'WAITING'};BrowserWindow.getAllWindows()[0].webContents.session.once('will-download',(_event,item)=>{item.setSavePath(target);globalThis.__artifactDownload={status:'STARTED',name:item.getFilename()};item.once('done',(_event,state)=>{globalThis.__artifactDownload={status:state};});});},target);
  await page.getByRole('button',{name:'下载文件',exact:true}).click();
  const end=Date.now()+15000;let native;
  while(Date.now()<end){native=await app.evaluate(()=>globalThis.__artifactDownload);if(native.status==='completed')break;await page.waitForTimeout(200);}
  assert.equal(native.status,'completed','Electron native download must complete');assert.equal(sha(fs.readFileSync(pathA)),sha(fs.readFileSync(target)));return {matchedBytes:true,nativeDownload:native};
 });
 await check('real-provider-update',async()=>{await page.getByRole('button',{name:'打开来源会话',exact:true}).click();const update=`${textA}_UPDATED`;await send(`Use the file tool to overwrite ${JSON.stringify(pathA)} with EXACTLY ${update}. Then give the path. This is a new explicit update request.`);assert.equal(fs.readFileSync(pathA,'utf8').trim(),update);await artifacts();assert.equal(await fileButton(path.basename(pathA)).count(),1);await fileButton(path.basename(pathA)).click();await page.getByText(update,{exact:true}).waitFor();await shot('updated-preview');return {items:1,oldBytesRetained:false,nativeSnapshotSupport:false};});
 b=await check('session-isolation',async()=>{await nav().getByRole('button',{name:'AI 工作台',exact:true}).click();await page.getByRole('button',{name:'＋ 新建对话',exact:true}).click();const state=await send(`Use the file tool to write EXACTLY ${textB} to ${JSON.stringify(pathB)}. Then report its path.`);assert.notEqual(state.storedId,a.storedId);await artifacts();await page.getByRole('combobox',{name:'来源会话'}).selectOption({value:JSON.stringify(['default',state.storedId])});assert.equal(await fileButton(path.basename(pathA)).count(),0);await fileButton(path.basename(pathB)).click();await page.getByText(textB,{exact:true}).waitFor();return state;});
 await check('reload-restores-artifacts',async()=>{await page.reload();await ready();await artifacts();await fileButton(path.basename(pathA)).click();await page.getByText(`${textA}_UPDATED`,{exact:true}).waitFor();await shot('reload');return {sessionA:a.storedId,sessionB:b?.storedId};});
 await check('three-viewports',async()=>{const measurements=[];for(const [width,height] of [[1920,1080],[1440,900],[1024,768]]){await page.setViewportSize({width,height});await page.waitForTimeout(300);const m=await page.getByRole('main',{name:'工作成果',exact:true}).evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,height:el.clientHeight,buttons:[...el.querySelectorAll('button')].map(b=>({text:b.textContent,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))}));assert.ok(m.scroll<=m.client+1);measurements.push({width,height,...m});await shot(`${width}x${height}`);}return {measurements};});
 await close();await launch();
 await check('electron-restart-restores-artifacts',async()=>{await artifacts();await fileButton(path.basename(pathA)).click();await page.getByText(`${textA}_UPDATED`,{exact:true}).waitFor();assert.equal(await fileButton(path.basename(pathB)).count(),1);await shot('restart');return {nativeDbExists:fs.existsSync(path.join(home,'state.db')),noRegeneration:true};});
 result.status=result.cases.some(c=>c.status==='FAIL')?'PARTIAL':'PASS_REAL_CREATION_UPDATE_PREVIEW_DOWNLOAD_ISOLATION_RELOAD_RESTART';
}catch(e){result.status='PARTIAL';result.failure=String(e.stack || e);if(page&&!page.isClosed())await shot('failure').catch(error=>{result.screenshotError=String(error);});process.exitCode=1;}
finally{clearInterval(heartbeat);await close();fs.writeFileSync(config,'# A02-05 isolated qualification complete; credential removed, directory retained.\n');persist();}
console.log(JSON.stringify({status:result.status,cases:result.cases.map(({name,status})=>({name,status})),evidence:`electron-${qualification}.json`}));
