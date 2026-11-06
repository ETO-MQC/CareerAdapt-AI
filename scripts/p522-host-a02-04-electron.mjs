import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
import {out,root,host,desktop,sha,write} from './p522-host-a02-04-common.mjs';
import {sanitize} from './p522-host-a02-02-evidence.mjs';

// One main qualification sequence includes normal close/relaunch using identical
// isolated directories. No filesystem cleanup or direct Store writes.
const recoveryOnly=process.argv.includes('--recovery-only');
const unknownOnly=process.argv.includes('--unknown-only');
const restoreOnly=process.argv.includes('--restore-only');
const run=Number(process.argv.find(a=>a.startsWith('--resume-run='))?.slice(13)??Date.now()),qualification=Date.now(),dir=path.join(root,`run-${run}`),home=path.join(dir,'home'),workspace=path.join(dir,'workspace'),fixtures=path.join(dir,'attachments');
for(const p of [home,workspace,fixtures,`${out}/screenshots`])fs.mkdirSync(p,{recursive:true});
const config=JSON.parse(fs.readFileSync('artifacts/p522-host-a02-01/provider.local.json','utf8').replace(/^\uFEFF/,''));
assert.ok(config.api_key?.trim(),'Configured Provider required for normal history creation');
const clean=v=>sanitize(v,[config.api_key]);
const save=(name,value)=>write(name,clean(value));
const configPath=path.join(home,'config.yaml');
fs.writeFileSync(configPath,`model:\n  default: ${JSON.stringify(config.model)}\n  provider: custom\n  base_url: ${JSON.stringify(config.base_url)}\n  api_key: ${JSON.stringify(config.api_key)}\nagent:\n  api_max_retries: 1\n  max_turns: 2\n  image_input_mode: native\n  reasoning_effort: none\ntoolsets: [todo]\n`);
fs.writeFileSync(path.join(home,'.env'),'');
const req=createRequire(path.join(desktop,'package.json'));
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|USERNAME|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env=Object.fromEntries(Object.entries(process.env).filter(([n,v])=>v&&allowed.test(n)));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(dir,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:`A02-04-${run}`,HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5194',HERMES_DESKTOP_CWD:workspace,HERMES_IGNORE_RULES:'1',HERMES_TUI_TOOLSETS:'todo',HERMES_DUMP_REQUESTS:'0',HERMES_DESKTOP_PORT_ANNOUNCE_TIMEOUT_MS:'150000',CAREERADAPT_STARTUP_TRACE:path.join(dir,'startup.jsonl')});
if(new URL(config.base_url).hostname==='openrouter.ai')env.OPENROUTER_API_KEY=config.api_key;
const sample=path.join(fixtures,'valid path.txt'),prefix=path.join(fixtures,'prefix'),missing=path.join(fixtures,'prefix missing.txt');
fs.writeFileSync(sample,`SYNTHETIC SESSION A ONLY ${run}\n`);
fs.writeFileSync(prefix,'WRONG PREFIX NEVER UPLOAD');
const result={run,status:'RUNNING',level:'REAL_ELECTRON_NATIVE_GATEWAY',rpc:[],events:[],errors:[],screenshots:[],cases:[],launches:[],providerRequests:'Only native Send; no direct Provider requests',isolated:true};
let app,page,epoch=0;
const persist=()=>save(recoveryOnly?`electron-recovery-${qualification}`:`electron-run-${run}`,result);
const heartbeat=setInterval(persist,15000);
const snap=()=>page.evaluate(async()=>{const s=await import('/src/store/session.ts'),c=await import('/src/store/composer.ts');return {runtimeId:s.$activeSessionId.get(),storedId:s.$selectedStoredSessionId.get(),sessions:s.$sessions.get(),messages:s.$messages.get(),busy:s.$busy.get(),awaiting:s.$awaitingResponse.get(),attachments:c.$composerAttachments.get().map(({previewUrl,...a})=>({...a,hasPreview:Boolean(previewUrl)})),draftTexts:JSON.parse(localStorage.getItem('hermes:composer-drafts:v3')??'{}'),rememberedRoute:s.getRememberedRoute(),rememberedSession:s.getRememberedSessionId(),journal:JSON.parse(localStorage.getItem('hermes.desktop.inflightTurnJournal.v1')??'null')};});
const editor=()=>page.getByRole('textbox',{name:'Message',exact:true});
const shot=async name=>{const file=`${out}/screenshots/${run}-${qualification}-${epoch}-${name}.png`;await page.screenshot({path:file,timeout:10000});result.screenshots.push(file);};
const wire=socket=>{socket.on('framesent',e=>{try{const v=JSON.parse(String(e.payload));if(v.method)result.rpc.push({epoch,at:Date.now(),id:v.id,method:v.method,params:v.params});}catch{/* Binary/non-JSON frames contain no RPC. */}});socket.on('framereceived',e=>{try{const v=JSON.parse(String(e.payload));if(v.id!==undefined){const r=result.rpc.findLast(r=>r.epoch===epoch&&r.id===v.id);if(r){r.result=v.result;r.error=v.error;}}if(v.params?.type)result.events.push({epoch,at:Date.now(),...v.params});}catch{/* Non-JSON frames contain no event. */}});};
async function ready(){
 const later=page.getByRole('button',{name:/choose a provider later/i});
 await Promise.any([later.waitFor({timeout:255000}),editor().waitFor({timeout:255000})]);
 if(await later.isVisible())await later.click();
 await page.getByRole('button',{name:/AI 连接.*ready/i}).waitFor({timeout:255000});
 const nav=page.getByRole('navigation',{name:'CareerAdapt 主导航',exact:true});
 if(!(await editor().isVisible()))await nav.getByRole('button',{name:'AI 工作台',exact:true}).click();
 await editor().waitFor({timeout:30000});
 // Do not dismiss generic banners: the native UNKNOWN error also owns a
 // Dismiss button. Closing it here would alter the state under qualification.
}
async function launch(){
 epoch++;process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
 app=await _electron.launch({executablePath:req('electron'),args:[path.resolve('.artifacts/p522-host-a02-01/main-integration'),'--disable-gpu','--no-sandbox'],cwd:workspace,env,timeout:30000});
 result.launches.push({epoch,pid:app.process().pid,startedAt:Date.now(),stdout:'',stderr:''});
 const l=result.launches.at(-1);app.process().stdout?.on('data',c=>{l.stdout+=c.toString();});app.process().stderr?.on('data',c=>{l.stderr+=c.toString();});
 page=await app.firstWindow({timeout:20000});page.setDefaultTimeout(15000);
 page.on('websocket',wire);page.on('pageerror',e=>result.errors.push({epoch,error:e.message}));
 await ready();l.readyAt=Date.now();l.readyState=await snap();await shot('ready');persist();
}
async function close(){
 const l=result.launches.at(-1),proc=app.process();
 await app.close();l.closedAt=Date.now();l.exitCode=proc.exitCode;app=null;
}
async function attempt(name,fn){
 try{const value=await fn();result.cases.push({name,status:'PASS',...value});persist();return value;}
 catch(error){const failure={name,status:'FAIL',error:String(error.stack??error)};result.cases.push(failure);save(`${name}-failure-${run}`,failure);persist();return null;}
}
async function send(text){
 const offset=result.events.length,rpcOffset=result.rpc.length;
 await editor().fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.waitForFunction(async()=>{const s=await import('/src/store/session.ts');return Boolean(s.$selectedStoredSessionId.get());},null,{timeout:30000});
 const end=Date.now()+120000;
 while(Date.now()<end&&!result.events.slice(offset).some(e=>e.type==='message.complete'))await page.waitForTimeout(250);
 const after=await snap(),calls=result.rpc.slice(rpcOffset).filter(r=>r.method==='prompt.submit');
 assert.equal(calls.length,1,'Exactly one native prompt.submit per Send');
 return {after,events:result.events.slice(offset),calls,completed:result.events.slice(offset).some(e=>e.type==='message.complete'),url:page.url()};
}
async function pick(paths){
 await app.evaluate(({dialog},p)=>{globalThis.__a04Dialog??=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:p});},paths);
 const composer=page.locator('[data-slot="composer-root"]');await composer.getByRole('button',{name:'Add context',exact:true}).click();await page.getByRole('menuitem',{name:'Files…',exact:true}).click();
}
try{
 await launch();
 if(recoveryOnly){
  const historic=JSON.parse(fs.readFileSync(`${out}/history-verification.json`,'utf8'));
  const urlA=historic.a.url,urlB=historic.b.url;
  await page.evaluate(url=>{location.hash=new URL(url).hash;},urlA);await page.waitForTimeout(1500);
  let staged,originalMovedStagedReadable;
  if(!unknownOnly){
  const offset=result.rpc.length;
  await pick([sample]);
  await page.waitForFunction(async()=>(await import('/src/store/composer.ts')).$composerAttachments.get().some(a=>a.attachedSessionId&&!a.uploadState));
  const valid=await snap();staged=valid.attachments[0];
  assert.equal(sha(fs.readFileSync(staged.path)),sha(fs.readFileSync(sample)));
  const remove=async()=>{const buttons=page.locator('[data-slot="composer-attachments"]').getByRole('button',{name:/^Remove /});while(await buttons.count())await buttons.first().click();};
  await remove();await pick([missing]);
  await page.waitForFunction(async()=>(await import('/src/store/composer.ts')).$composerAttachments.get().some(a=>a.uploadState==='error'));
  const missingState=await snap(),calls=result.rpc.slice(offset).filter(r=>r.method==='file.attach');
  assert.equal(calls.length,2);assert.ok(!calls[0].error);assert.ok(calls[1].error,'Missing quoted path must fail at native Gateway');
  assert.ok(calls.every(r=>r.params.path.startsWith('"')&&r.params.path.endsWith('"')));
  await shot('missing-full-path-rejected');await remove();
  const moved=path.join(fixtures,'valid path moved.txt');fs.renameSync(sample,moved);
  originalMovedStagedReadable=fs.existsSync(staged.path)&&sha(fs.readFileSync(staged.path))===sha(fs.readFileSync(moved));
  fs.renameSync(moved,sample);assert.ok(originalMovedStagedReadable);
  save('attachment-path-electron-reverification',{status:'PASS',level:'Real Electron/Gateway; native dialog return test injection, not OS picker',reason:'First main-run assertion observed transient unbound chips before native eager upload; this check waits for attachedSessionId and ACK',valid,missingState,calls,prefixExists:fs.existsSync(prefix),prefixNeverUploaded:true,originalMovedStagedReadable,providerRequests:0});
  }
  // Inject a genuine renderer transport failure before forwarding a submit.
  // The renderer cannot know whether it executed; the fixture knows it did not.
  // No transcript/Store mutation and no Provider request creates this UNKNOWN.
  let inject=false;
  const intercepted=[];
  if(!restoreOnly){
  await page.routeWebSocket(url=>new URL(url).pathname.endsWith('/api/ws'),route=>{
   const server=route.connectToServer();
   route.onMessage(message=>{
    let request;try{request=JSON.parse(String(message));}catch{server.send(message);return;}
    if(request.method)result.rpc.push({epoch,at:Date.now(),id:request.id,method:request.method,params:request.params,observer:'Playwright WebSocket boundary'});
    if(inject&&request.method==='prompt.submit'){
     inject=false;intercepted.push({method:request.method,id:request.id,params:request.params,forwarded:false});
     route.close({code:1011,reason:'A02-04 synthetic ACK-loss transport boundary'});server.close();return;
    }
    server.send(message);
   });
   server.onMessage(message=>{try{const response=JSON.parse(String(message));if(response.id!==undefined){const call=result.rpc.findLast(r=>r.epoch===epoch&&r.id===response.id);if(call){call.result=response.result;call.error=response.error;}}}catch{/* Forward opaque messages unchanged. */}route.send(message);});
  });
  await page.reload();await ready();await page.waitForTimeout(1000);
  inject=true;await editor().fill(`SYNTHETIC_UNKNOWN_${run}`);await page.getByRole('button',{name:'Send',exact:true}).click();
  }
  await page.waitForFunction(async()=>(await import('/src/store/session.ts')).$messages.get().some(m=>m.error?.startsWith('UNKNOWN')),null,{timeout:30000});
  const unknown=await snap();if(!restoreOnly)assert.equal(intercepted.length,1);assert.ok(unknown.journal?.entries[unknown.storedId]);save(`unknown-before-reload-${qualification}`,unknown);await shot('unknown-before-reload');
  const submitCount=()=>result.rpc.filter(r=>r.method==='prompt.submit').length;
  const beforeReload=submitCount();await page.reload();await ready();await page.waitForTimeout(1500);
  await page.waitForFunction(async()=>(await import('/src/store/session.ts')).$messages.get().some(m=>m.error?.startsWith('UNKNOWN')),null,{timeout:45000});
  const afterReload=await snap();assert.ok(afterReload.messages.some(m=>m.error?.startsWith('UNKNOWN')));assert.equal(submitCount(),beforeReload);await shot('unknown-after-reload');
  await close();await new Promise(r=>setTimeout(r,1000));await launch();await page.waitForTimeout(1500);
  await page.waitForFunction(async()=>(await import('/src/store/session.ts')).$messages.get().some(m=>m.error?.startsWith('UNKNOWN')),null,{timeout:45000});
  const afterRestart=await snap();assert.ok(afterRestart.messages.some(m=>m.error?.startsWith('UNKNOWN')));assert.equal(submitCount(),beforeReload);await shot('unknown-after-restart');
  await editor().fill('DO_NOT_EXECUTE_GUARDED_SESSION');await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForTimeout(1200);
  assert.equal(submitCount(),beforeReload,'Restored UNKNOWN must still block normal submit');
  await page.evaluate(url=>{location.hash=new URL(url).hash;},urlB);await page.waitForTimeout(1500);
  const recovery=await send('Do not call tools. Reply exactly SESSION_B_RECOVERY_OK.');
  assert.ok(recovery.completed);assert.ok(recovery.after.messages.some(m=>m.parts.some(p=>p.text==='SESSION_B_RECOVERY_OK')));
  save('unknown-recovery-electron',{status:'PASS',level:'Real native Renderer/Gateway recovery; controlled pre-forward WebSocket failure, not actual lost backend ACK',intercepted,unknown,afterReload,afterRestart,noAutomaticSubmitOnReloadRestart:true,restoredGuardBlocksSubmit:true,differentSessionNewTask:recovery,providerRequests:1,oldUnknownNotCleared:true});
  if(staged)save('attachment-session-binding-reverification',{status:'PASS_TXT_NATIVE_REFERENCE_AND_BYTES',staged,originalSha256:sha(fs.readFileSync(sample)),stagedSha256:sha(fs.readFileSync(staged.path)),originalMovedStagedReadable,aStoredId:historic.a.after.storedId,bStoredId:historic.b.after.storedId,restartedA:afterRestart.messages,bMessages:recovery.after.messages,metadata:'Native TXT references remain in persisted user text; attachmentRefs is optimistic Renderer metadata and is not durable for TXT',png:'NOT_RETESTED_A02_03_PARTIAL_PRESERVED',deletion:'No files deleted; two explicit single-file synthetic rename operations'});
  result.status='PARTIAL';
 }else{
 const initial=await snap();
 const pathCheck=await attempt('attachment-path-electron',async()=>{
  const offset=result.rpc.length;
  await pick([missing]);
  await page.waitForFunction(async()=>(await import('/src/store/composer.ts')).$composerAttachments.get().some(a=>a.uploadState==='error'));
  const missingState=await snap();
  const removals=page.locator('[data-slot="composer-attachments"]').getByRole('button',{name:/^Remove /});while(await removals.count())await removals.first().click();
  await pick([sample]);
  await page.waitForFunction(async()=>(await import('/src/store/composer.ts')).$composerAttachments.get().some(a=>!a.uploadState&&a.path?.includes('valid path')));
  const validState=await snap(),calls=result.rpc.slice(offset).filter(r=>r.method==='file.attach');
  assert.equal(calls.length,2);assert.ok(calls[0].error,'Missing full path must fail');assert.ok(!calls[1].error);assert.equal(sha(fs.readFileSync(validState.attachments[0].path)),sha(fs.readFileSync(sample)));
  assert.ok(calls.every(r=>r.params.path.startsWith('"')&&r.params.path.endsWith('"')));
  await shot('attachment-identity');
  return {level:'Real Electron/Gateway; test-only dialog return injection, not OS picker qualification',missingState,validState,calls,wrongPrefixUploaded:false,prefixExists:true};
 });
 const a=await send('Do not call tools. Reply exactly SESSION_A_OK.');
 save('session-create-verification',{status:a.after.storedId?'PASS_NATIVE_FIRST_SEND':'FAIL',initial,a,pathCheck:Boolean(pathCheck),semantics:'Empty native sessions remain drafts; DB row/list entry created on first prompt, by native design'});
 await editor().fill(`DRAFT_A_${run}`);await page.waitForTimeout(700);
 await pick([sample]);await page.waitForFunction(async()=>(await import('/src/store/composer.ts')).$composerAttachments.get().some(a=>!a.uploadState));
 const draftA=await snap(),urlA=page.url();
 await page.getByRole('button',{name:'＋ 新建对话',exact:true}).click();await page.waitForTimeout(500);
 const newB=await snap();assert.equal(newB.messages.length,0);assert.equal(newB.attachments.length,0);
 const b=await send('Do not call tools. Reply exactly SESSION_B_OK.');
 assert.notEqual(a.after.storedId,b.after.storedId);assert.notEqual(a.after.runtimeId,b.after.runtimeId);
 await editor().fill(`DRAFT_B_${run}`);await page.waitForTimeout(700);
 const draftB=await snap(),urlB=page.url();
 // Hash navigation keeps the renderer alive and exercises native scope swaps.
 await page.evaluate(url=>{location.hash=new URL(url).hash;},urlA);await page.waitForTimeout(1500);
 const returnedA=await snap(),textA=await editor().innerText();
 await page.evaluate(url=>{location.hash=new URL(url).hash;},urlB);await page.waitForTimeout(1500);
 const returnedB=await snap(),textB=await editor().innerText();
 save('session-switch-verification',{status:textA.includes(`DRAFT_A_${run}`)&&textB.includes(`DRAFT_B_${run}`)&&returnedA.attachments.length===1&&returnedB.attachments.length===0?'PASS':'FAIL',draftA,draftB,returnedA,returnedB,textA,textB,urlA,urlB});
 await shot('session-B');
 const beforeReload=result.rpc.filter(r=>r.method==='prompt.submit').length;
 await page.reload();await ready();await page.waitForTimeout(1000);
 const reloaded=await snap(),reloadText=await editor().innerText();
 save('reload-verification',{status:reloaded.storedId===b.after.storedId&&reloadText.includes(`DRAFT_B_${run}`)&&result.rpc.filter(r=>r.method==='prompt.submit').length===beforeReload?'PASS':'FAIL',reloaded,reloadText,noNewSubmits:result.rpc.filter(r=>r.method==='prompt.submit').length===beforeReload});
 await shot('reloaded-B');
 await page.evaluate(url=>{location.hash=new URL(url).hash;},urlA);await page.waitForTimeout(1500);
 const afterReloadA=await snap();
 save('draft-persistence-verification',{status:'OBSERVED_REAL_ELECTRON',draftA,draftB,reloadText,afterReloadA,attachmentDraftSemantics:'Memory only; retained on in-renderer A/B switch; intentionally absent after reload/restart, text persisted separately'});
 const beforeRestart=await snap();await shot('before-close-A');
 const submitsBeforeRestart=result.rpc.filter(r=>r.method==='prompt.submit').length;
 await close();await page?.waitForTimeout(1).catch(()=>{});
 await new Promise(r=>setTimeout(r,1200));
 await launch();await page.waitForTimeout(1500);
 const restarted=await snap(),restartText=await editor().innerText();
 save('electron-restart-verification',{status:restarted.storedId===a.after.storedId&&restartText.includes(`DRAFT_A_${run}`)&&result.rpc.filter(r=>r.method==='prompt.submit').length===submitsBeforeRestart?'PASS':'FAIL',sameIsolatedDirectories:true,beforeRestart,restarted,restartText,noNewSubmits:result.rpc.filter(r=>r.method==='prompt.submit').length===submitsBeforeRestart,launches:result.launches.map(l=>({epoch:l.epoch,pid:l.pid,startedAt:l.startedAt,closedAt:l.closedAt,exitCode:l.exitCode}))});
 await shot('restart-A');
 await page.evaluate(url=>{location.hash=new URL(url).hash;},urlB);await page.waitForTimeout(1500);
 const restartB=await snap();
 save('history-verification',{status:'OBSERVED_REAL_NATIVE_RESTORE',a,b,restarted,restartB,toolActivity:'NOT_VERIFIED_NO_TOOL_EXECUTION_IN_THIS_RUN',timestamps:'Native messages include timestamp fields when supplied by backend',readDoesNotReplay:result.rpc.filter(r=>r.method==='prompt.submit').length===submitsBeforeRestart});
 const staged=pathCheck?.validState.attachments[0];
 save('attachment-session-binding',{status:staged?'OBSERVED_REAL_GATEWAY':'NOT_VERIFIED',submittedA:a.after.messages.flatMap(m=>m.attachmentRefs??[]),originalSha256:sha(fs.readFileSync(sample)),staged:staged?{...staged,exists:fs.existsSync(staged.path),sha256:sha(fs.readFileSync(staged.path))}:null,restartedAReferences:restarted.messages.flatMap(m=>m.attachmentRefs??[]),bReferences:restartB.messages.flatMap(m=>m.attachmentRefs??[]),draftReferencesLostOnReload:afterReloadA.attachments.length===0,originalMoveDelete:'NOT_PERFORMED_NO_DELETE_POLICY',png:'Historical A02-03 image reception remains PARTIAL; not resent'});
 save('session-isolation-verification',{status:a.after.storedId!==b.after.storedId&&restartB.storedId===b.after.storedId&&!JSON.stringify(restartB.messages).includes('SESSION_A_OK')?'PASS':'FAIL',ids:[a.after.storedId,b.after.storedId],newB,restartedA:restarted,restartedB:restartB});
 save('duplicate-execution-verification',{status:result.rpc.filter(r=>r.method==='prompt.submit').length===2?'PASS_TWO_SENDS_NO_REPLAY':'FAIL',submitCount:result.rpc.filter(r=>r.method==='prompt.submit').length,toolStartCount:result.events.filter(e=>e.type==='tool.start').length,scope:'Normal A/B, reload and real Electron/backend restart; transport fault evidence separate L2'});
 result.status='PARTIAL';
 }
}catch(error){result.status='FAIL';result.failure=String(error.stack??error);if(page){result.lastState=await snap().catch(()=>null);result.body=await page.locator('body').innerText().catch(()=>null);await shot('failure').catch(()=>{});}process.exitCode=1;}
finally{
 clearInterval(heartbeat);
 if(app)await close().catch(error=>{result.closeError=String(error);});
 fs.writeFileSync(configPath,'# Qualification finished; credential cleared; test files retained.\n');
 result.credentialCleared=true;result.filesRetained=true;persist();save(recoveryOnly?'recovery-interaction-verification':'interaction-verification',result);
 console.log(JSON.stringify({run,status:result.status,submits:result.rpc.filter(r=>r.method==='prompt.submit').length,cases:result.cases.map(({name,status})=>({name,status})),failure:result.failure?.split('\n')[0]}));
}
