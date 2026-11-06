import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {_electron} from 'playwright-core';
import {sha,clean} from './p522-host-a02-03-common.mjs';
import {providerObserver} from './p522-host-a02-03-proxy.mjs';
import {attachmentCases} from './p522-host-a02-03-targeted.mjs';

const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop');
const req=createRequire(path.join(desktop,'package.json'));
const out=process.argv.find(a=>a.startsWith('--evidence-dir='))?.slice(15)??'docs/architecture/evidence/p522-host-a02-03',run=Date.now();
const startupBudgetMs=150_000+45_000+45_000+15_000;
const appRoot=path.resolve(process.argv.find(a=>a.startsWith('--app-root='))?.slice(11)??desktop);
const root=path.resolve(`.artifacts/p522-host-a02-03/run-${run}`),home=path.join(root,'home'),workspace=path.join(root,'workspace');
fs.mkdirSync(home,{recursive:true});fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(`${out}/screenshots`,{recursive:true});
const config=JSON.parse(fs.readFileSync('artifacts/p522-host-a02-01/provider.local.json','utf8').replace(/^\uFEFF/,''));
assert.ok(new URL(config.base_url));assert.ok(config.model);assert.ok(config.api_key.trim());
const save=(file,value)=>fs.writeFileSync(`${out}/${file}.json`,JSON.stringify(JSON.parse(JSON.stringify(clean(value),(k,v)=> typeof v==='string' && v.startsWith('data:') ? '[DATA_URL_OMITTED]' : v)),null,2)+'\n');
// Native config, single app-level API attempt, no auxiliary/fallback Provider,
// no Career plugins or real workspace. Pin to the inert planning toolset.
const observer=await providerObserver();
const configPath=path.join(home,'config.yaml');
fs.writeFileSync(configPath,`model:\n  default: ${JSON.stringify(config.model)}\n  provider: custom\n  base_url: ${JSON.stringify(observer.url)}\n  api_key: ${JSON.stringify(config.api_key)}\nagent:\n  api_max_retries: 1\n  max_turns: 6\n  image_input_mode: native\n  reasoning_effort: none\n`);
fs.writeFileSync(path.join(home,'.env'),'');
fs.appendFileSync(configPath,'toolsets: [todo]\n');
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|USERNAME|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env=Object.fromEntries(Object.entries(process.env).filter(([name,value])=>value&&allowed.test(name)));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:'A02-01-'+run,HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5193',HERMES_DESKTOP_CWD:workspace,HERMES_IGNORE_RULES:'1',HERMES_TUI_TOOLSETS:'todo'});
env.CAREERADAPT_STARTUP_TRACE=path.join(root,'startup.jsonl');
env.HERMES_DUMP_REQUESTS='0';
// The locked runtime selects environment credentials for openrouter.ai even
// when model.api_key exists; keep this only in the isolated child environment.
if(new URL(config.base_url).hostname==='openrouter.ai')env.OPENROUTER_API_KEY=config.api_key;
// Actual round-2 stdout announcement was 91.9s; this is consumed by the
// locked Main resolver itself, separately from the health/gateway budgets.
env.HERMES_DESKTOP_PORT_ANNOUNCE_TIMEOUT_MS='150000';
const result={run,status:'RUNNING',provider:config.base_url,model:config.model,events:[],rpc:[],turns:[],errors:[],consoleErrors:[],screenshots:[],toolCalls:0,scope:'Real locked Electron, native Composer/Stop/Store/Runtime, synthetic content only'};
let app,page;
const snap=()=>page.evaluate(async()=>{const s=await import('/src/store/session.ts');const states=await import('/src/store/session-states.ts');return {busy:s.$busy.get(),awaiting:s.$awaitingResponse.get(),sessionId:s.$activeSessionId.get(),model:s.$currentModel.get(),provider:s.$currentProvider.get(),messages:s.$messages.get(),state:states.$sessionStates.get()[s.$activeSessionId.get()]};});
const shot=async stage=>{const file=`${out}/screenshots/${run}-${stage}.png`;result.fontStates??=[];result.fontStates.push({stage,...await page.evaluate(()=>({status:document.fonts.status,pending:[...document.fonts].filter(f=>f.status!=='loaded').map(f=>({family:f.family,status:f.status}))}))});try{await page.screenshot({path:file,timeout:10000});result.screenshots.push(file);}catch(error){result.screenshotFailures??=[];result.screenshotFailures.push({stage,error:String(error)});}};
const pending=new Map();
const heartbeat=setInterval(()=>save(`electron-run-${run}`,result),15000);
async function until(predicate,timeoutMs,reason){const end=Date.now()+timeoutMs;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error(reason);}
function frame(data,direction){try{const value=JSON.parse(String(data)),at=Date.now();if(direction==='sent'&&value.method){const r={at,id:value.id,method:value.method,sessionId:value.params?.session_id,params:clean(Object.fromEntries(Object.entries(value.params??{}).map(([k,v])=>[k,/base64|data_url/.test(k)?{encodedLength:String(v).length,sha256:sha(String(v))}:v])))};result.rpc.push(r);pending.set(value.id,r);}
  if(direction==='received'&&value.id!==undefined){const r=pending.get(value.id);if(r){r.ackAt=at;r.rejected=Boolean(value.error);if(value.error)r.error=value.error.message;r.resultKeys=Object.keys(value.result??{});r.result=value.result;}}
  if(direction==='received'&&value.params?.type){const e=value.params;if(/^(message\.|error$|session.info|tool\.)/.test(e.type)){result.events.push({at,type:e.type,sessionId:e.session_id,payload:e.payload});if(e.type==='tool.start')result.toolCalls++;}}
}catch{/* Non-JSON wire frames are not evidence. */}}
async function send(label,text,{stop=false}={}) {
  const before=await snap(),offset=result.events.length,rpcOffset=result.rpc.length;
  const editor=page.getByRole('textbox',{name:'Message',exact:true});await editor.fill(text);
  const turn={label,tClick:Date.now(),sessionBefore:before.sessionId};result.turns.push(turn);
  await page.evaluate(()=>{window.__a02Paints=[];window.__a02Observer?.disconnect();const baseline=[...document.querySelectorAll('[data-slot="aui_assistant-message-content"]')].at(-1)?.textContent??'';window.__a02Observer=new MutationObserver(()=>{const nodes=[...document.querySelectorAll('[data-slot="aui_assistant-message-content"]')];const text=nodes.at(-1)?.textContent??'';window.__a02Paints.push({at:Date.now(),text,changed:text!==baseline});});window.__a02Observer.observe(document.body,{childList:true,subtree:true,characterData:true});});
  await page.evaluate(()=>{window.__attachmentPaints=[];window.__samplePaints=true;let last='';const sample=()=>{if(!window.__samplePaints)return;const n=[...document.querySelectorAll('[data-slot="aui_assistant-message-content"]')].at(-1);if(n){const r=n.getBoundingClientRect();let top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),left=Math.max(0,r.left),right=Math.min(innerWidth,r.right);for(let p=n.parentElement;p;p=p.parentElement){const c=getComputedStyle(p);if(/hidden|clip|scroll|auto/.test(c.overflow+c.overflowY+c.overflowX)){const q=p.getBoundingClientRect();top=Math.max(top,q.top);bottom=Math.min(bottom,q.bottom);left=Math.max(left,q.left);right=Math.min(right,q.right);}}const text=n.textContent??'';if(text!==last&&text.trim()){window.__attachmentPaints.push({at:Date.now(),text,visible:bottom>top&&right>left&&getComputedStyle(n).visibility==='visible',bounds:{top,bottom,left,right},shell:document.querySelector('.ca-host-shell [data-chat-surface]')?.getBoundingClientRect().toJSON()});last=text;}}requestAnimationFrame(sample);};requestAnimationFrame(sample);});
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(async()=>{const s=await import('/src/store/session.ts');return s.$busy.get()||s.$messages.get().some(m=>m.role==='assistant');},null,{timeout:10000});
  if(stop){
    await until(()=>result.events.slice(offset).filter(e=>e.type==='message.delta').map(e=>e.payload?.text??'').join('').length>30,180000,'No current-turn stream to interrupt');
    turn.stopClick=Date.now();await page.locator('[data-slot="composer-root"]').getByRole('button',{name:'Stop',exact:true}).click();
    await page.waitForFunction(async()=>!(await import('/src/store/session.ts')).$busy.get(),null,{timeout:10000});
    turn.stopUiMs=Date.now()-turn.stopClick;turn.afterStop=await snap();
    await shot('stop');
    await new Promise(resolve=>setTimeout(resolve,10000));turn.afterObservation=await snap();
    turn.interrupt=result.rpc.slice(rpcOffset).find(r=>r.method==='session.interrupt');
    turn.interruptAckMs=turn.interrupt?.ackAt-turn.stopClick;
    turn.sameAfterObservation=JSON.stringify(turn.afterStop.messages)===JSON.stringify(turn.afterObservation.messages);
    assert.ok(turn.sameAfterObservation,'Late content polluted interrupted UI');assert.ok(turn.interruptAckMs<=2000,'Interrupt ACK exceeded target');
  }else{
    await until(()=>result.events.slice(offset).some(e=>e.type==='message.complete'),120000,'No native completion event for current turn');
    await page.waitForFunction(async()=>{const s=await import('/src/store/session.ts');return !s.$busy.get()&&!s.$awaitingResponse.get();},null,{timeout:10000});
  }
  turn.tComplete=Date.now();turn.final=await snap();turn.visiblePaints=await page.evaluate(()=>{window.__samplePaints=false;return window.__attachmentPaints;});
  turn.uiPaints=await page.evaluate(()=>{window.__a02Observer.disconnect();return window.__a02Paints;});
  turn.tFirstUiPaint=turn.uiPaints.find(p=>p.at>=turn.tClick&&p.changed&&p.text.trim())?.at;
  turn.events=result.events.slice(offset);turn.rpc=result.rpc.slice(rpcOffset);
  const submit=turn.rpc.find(r=>r.method==='prompt.submit');turn.tRpcSend=submit?.at;turn.tAck=submit?.ackAt;
  const deltas=turn.events.filter(e=>e.type==='message.delta');turn.tFirstDelta=deltas[0]?.at;
  turn.deltaText=deltas.map(e=>e.payload?.text??'').join('');turn.interims=turn.events.filter(e=>e.type==='message.interim').map(e=>e.payload?.text);
  turn.completes=turn.events.filter(e=>e.type==='message.complete').map(e=>e.payload);
  turn.ttftMs=turn.tFirstDelta-turn.tClick;turn.totalMs=turn.tComplete-turn.tClick;
  assert.equal(turn.rpc.filter(r=>r.method==='prompt.submit').length,1,'Duplicate submit');
  if(!label.startsWith('tool'))assert.equal(turn.events.filter(e=>e.type==='tool.start').length,0,'Unexpected tool execution');
  const terminal=turn.completes.at(-1);
  if(terminal?.status==='error'||terminal?.error){result.providerFailure={label,error:terminal.error??terminal.text,model:terminal.usage?.model,knownTerminal:true};throw Error('Native Provider terminal failure: '+(terminal.error??terminal.text));}
  if(!stop&&!label.startsWith('tool')){assert.ok(deltas.length>=3,'Fewer than three nonempty deltas');assert.equal(turn.deltaText,turn.completes.at(-1)?.text,'Delta/final mismatch');}
  assert.equal(turn.final.busy,false);assert.equal(turn.final.awaiting,false);
  if(!label.startsWith('tool')&&turn.final.messages.some(m=>m.error))throw Error('Native conversation contains error');
  turn.nativeUi={body:await page.locator('body').innerText(),url:page.url()};
  await shot(label);save(`electron-run-${run}`,result);
}
try {
  // Playwright's screenshot font wait is independent of application readiness.
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
  app=await _electron.launch({executablePath:req('electron'),args:[appRoot,'--disable-gpu','--no-sandbox'],cwd:workspace,env,timeout:30000});
  result.process={stdout:'',stderr:''};
  app.process().stdout?.on('data',c=>{result.process.stdout+=c.toString();});
  app.process().stderr?.on('data',c=>{result.process.stderr+=c.toString();});
  result.main=await app.evaluate(({app})=>({appPath:app.getAppPath(),argv:process.argv}));
  page=await app.firstWindow({timeout:15000});page.setDefaultTimeout(10000);
  page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});
  page.on('websocket',socket=>{socket.on('framesent',e=>frame(e.payload,'sent'));socket.on('framereceived',e=>frame(e.payload,'received'));});
  const later=page.getByRole('button',{name:/choose a provider later/i});
  result.onboardingBranch=await Promise.race([Promise.any([later.waitFor({state:'visible',timeout:startupBudgetMs}).then(()=>'native-provider-choice'),page.getByRole('textbox',{name:'Message',exact:true}).click({trial:true,timeout:startupBudgetMs}).then(()=>'native-composer-actionable')]),page.getByText("Hermes couldn't start",{exact:true}).waitFor({timeout:startupBudgetMs}).then(()=>{throw Error('Native boot failure overlay appeared; see startup trace');})]);
  if(await later.isVisible())await later.click();
  await page.getByRole('button',{name:/AI 连接.*ready/i}).waitFor({timeout:startupBudgetMs});
  const trace=fs.readFileSync(env.CAREERADAPT_STARTUP_TRACE,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const ready=trace.find(e=>e.kind==='backend.ready');
  const port=Number(/port=(\d+)/.exec(ready.line)[1]);
  const health=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(5000)});
  result.backend={traceReady:ready,healthStatus:health.status,health:await health.json(),gateway:'online'};
  const nav=page.getByRole('navigation',{name:'CareerAdapt 主导航',exact:true});await nav.getByRole('button',{name:'AI 工作台',exact:true}).click();
  const dismiss=page.getByRole('button',{name:/dismiss/i});if(await dismiss.count())await dismiss.first().click();
  await shot('ready');
  const prereq=JSON.parse(fs.readFileSync(`${out}/prerequisite-verification.json`,'utf8'));
  await attachmentCases({app,page,result,snap,save,shot,assert,root,home,workspace,prereq,send});
  result.status='PARTIAL';
}catch(error){result.status='FAIL';result.failure=String(error.stack??error);if(app)result.windows=app.windows().map(w=>w.url());if(page){result.url=page.url();result.body=await page.locator('body').innerText().catch(()=>'(unavailable)');await shot('failure').catch(e=>{result.screenshotFailure=String(e);});}process.exitCode=1;}
finally {
  clearInterval(heartbeat);
  save(`electron-run-${run}`,result);
  if(app)await app.close();
  observer.close();
  if(fs.existsSync(configPath))fs.writeFileSync(configPath,'# Qualification complete; credential removed from this isolated config.\n');
  result.credentialCleanup={file:'[TEST_HOME]/config.yaml',credentialCleared:true,fileRetained:fs.existsSync(configPath),userLocalConfigRetained:true};
  if(fs.existsSync(env.CAREERADAPT_STARTUP_TRACE))fs.writeFileSync(`${out}/startup-${run}.jsonl`,JSON.stringify(clean(fs.readFileSync(env.CAREERADAPT_STARTUP_TRACE,'utf8')))+'\n');
  save(`electron-run-${run}`,result);save('interaction-verification',result);
  console.log(JSON.stringify({run,status:result.status,turns:result.turns.length,errors:result.errors.length,failure:result.failure?.split('\n')[0]}));
}
