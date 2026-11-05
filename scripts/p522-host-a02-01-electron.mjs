import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {_electron} from 'playwright-core';

const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop');
const req=createRequire(path.join(desktop,'package.json'));
const out=process.argv.find(a=>a.startsWith('--evidence-dir='))?.slice(15)??'docs/architecture/evidence/p522-host-a02-01/continuation',run=Date.now();
const startupBudgetMs=150_000+45_000+45_000+15_000;
const appRoot=path.resolve(process.argv.find(a=>a.startsWith('--app-root='))?.slice(11)??desktop);
const root=path.resolve(`.artifacts/p522-host-a02-01/run-${run}`),home=path.join(root,'home'),workspace=path.join(root,'workspace');
fs.mkdirSync(home,{recursive:true});fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(`${out}/screenshots`,{recursive:true});
const config=JSON.parse(fs.readFileSync('.artifacts/p522-host-a02-01/provider.local.json','utf8').replace(/^\uFEFF/,''));
assert.equal(config.base_url,'https://openrouter.ai/api/v1');assert.equal(config.model,'dots-studio/dots-3-note-preview:free');assert.ok(config.api_key.trim());
const redact=value=>JSON.stringify(value).replaceAll(config.api_key,'[REDACTED]').replaceAll(root.replaceAll('\\','\\\\'),'[TEST_ROOT]').replaceAll(host.replaceAll('\\','\\\\'),'[HERMES_ROOT]');
const save=(file,value)=>fs.writeFileSync(`${out}/${file}.json`,JSON.stringify(JSON.parse(redact(value)),null,2)+'\n');
// Native config, single app-level API attempt, no auxiliary/fallback Provider,
// no Career plugins or real workspace. Pin to the inert planning toolset.
const configPath=path.join(home,'config.yaml');
fs.writeFileSync(configPath,`model:\n  default: ${JSON.stringify(config.model)}\n  provider: custom\n  base_url: ${JSON.stringify(config.base_url)}\n  api_key: ${JSON.stringify(config.api_key)}\nagent:\n  api_max_retries: 1\n  max_turns: 1\n  image_input_mode: native\n  reasoning_effort: none\n`);
fs.writeFileSync(path.join(home,'.env'),'');
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|USERNAME|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env=Object.fromEntries(Object.entries(process.env).filter(([name,value])=>value&&allowed.test(name)));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:'A02-01-'+run,HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5190',HERMES_DESKTOP_CWD:workspace,HERMES_IGNORE_RULES:'1',HERMES_TUI_TOOLSETS:'todo'});
env.CAREERADAPT_STARTUP_TRACE=path.resolve(`${out}/startup-${run}.jsonl`);
env.HERMES_DUMP_REQUESTS='1';
// The locked runtime selects environment credentials for openrouter.ai even
// when model.api_key exists; keep this only in the isolated child environment.
env.OPENROUTER_API_KEY=config.api_key;
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
function frame(data,direction){try{const value=JSON.parse(String(data)),at=Date.now();if(direction==='sent'&&value.method){const r={at,id:value.id,method:value.method,sessionId:value.params?.session_id};result.rpc.push(r);pending.set(value.id,r);}
  if(direction==='received'&&value.id!==undefined){const r=pending.get(value.id);if(r){r.ackAt=at;r.rejected=Boolean(value.error);if(value.error)r.error=value.error.message;r.resultKeys=Object.keys(value.result??{});}}
  if(direction==='received'&&value.params?.type){const e=value.params;if(/^(message\.|error$|session.info|tool\.)/.test(e.type)){result.events.push({at,type:e.type,sessionId:e.session_id,payload:e.payload});if(e.type==='tool.start')result.toolCalls++;}}
}catch{/* Non-JSON wire frames are not evidence. */}}
async function send(label,text,{stop=false}={}) {
  const before=await snap(),offset=result.events.length,rpcOffset=result.rpc.length;
  const editor=page.getByRole('textbox',{name:'Message',exact:true});await editor.fill(text);
  const turn={label,tClick:Date.now(),sessionBefore:before.sessionId};result.turns.push(turn);
  await page.evaluate(()=>{window.__a02Paints=[];window.__a02Observer?.disconnect();const baseline=[...document.querySelectorAll('[data-slot="aui_assistant-message-content"]')].at(-1)?.textContent??'';window.__a02Observer=new MutationObserver(()=>{const nodes=[...document.querySelectorAll('[data-slot="aui_assistant-message-content"]')];const text=nodes.at(-1)?.textContent??'';window.__a02Paints.push({at:Date.now(),text,changed:text!==baseline});});window.__a02Observer.observe(document.body,{childList:true,subtree:true,characterData:true});});
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(async()=>{const s=await import('/src/store/session.ts');return s.$busy.get()||s.$messages.get().some(m=>m.role==='assistant');},null,{timeout:10000});
  if(stop){
    await until(()=>result.events.slice(offset).filter(e=>e.type==='message.delta').map(e=>e.payload?.text??'').join('').length>30,45000,'No current-turn stream to interrupt');
    turn.stopClick=Date.now();await page.getByRole('button',{name:'Stop',exact:true}).click();
    await page.waitForFunction(async()=>!(await import('/src/store/session.ts')).$busy.get(),null,{timeout:500});
    turn.stopUiMs=Date.now()-turn.stopClick;turn.afterStop=await snap();
    await shot('stop');
    await new Promise(resolve=>setTimeout(resolve,10000));turn.afterObservation=await snap();
    turn.interrupt=result.rpc.slice(rpcOffset).find(r=>r.method==='session.interrupt');
    turn.interruptAckMs=turn.interrupt?.ackAt-turn.stopClick;
    turn.sameAfterObservation=JSON.stringify(turn.afterStop.messages)===JSON.stringify(turn.afterObservation.messages);
    assert.ok(turn.sameAfterObservation,'Late content polluted interrupted UI');assert.ok(turn.interruptAckMs<=2000,'Interrupt ACK exceeded target');
  }else{
    await until(()=>result.events.slice(offset).some(e=>e.type==='message.complete'),60000,'No native completion event for current turn');
    await page.waitForFunction(async()=>{const s=await import('/src/store/session.ts');return !s.$busy.get()&&!s.$awaitingResponse.get();},null,{timeout:10000});
  }
  turn.tComplete=Date.now();turn.final=await snap();
  turn.uiPaints=await page.evaluate(()=>{window.__a02Observer.disconnect();return window.__a02Paints;});
  turn.tFirstUiPaint=turn.uiPaints.find(p=>p.at>=turn.tClick&&p.changed&&p.text.trim())?.at;
  turn.events=result.events.slice(offset);turn.rpc=result.rpc.slice(rpcOffset);
  const submit=turn.rpc.find(r=>r.method==='prompt.submit');turn.tRpcSend=submit?.at;turn.tAck=submit?.ackAt;
  const deltas=turn.events.filter(e=>e.type==='message.delta');turn.tFirstDelta=deltas[0]?.at;
  turn.deltaText=deltas.map(e=>e.payload?.text??'').join('');turn.interims=turn.events.filter(e=>e.type==='message.interim').map(e=>e.payload?.text);
  turn.completes=turn.events.filter(e=>e.type==='message.complete').map(e=>e.payload);
  turn.ttftMs=turn.tFirstDelta-turn.tClick;turn.totalMs=turn.tComplete-turn.tClick;
  assert.equal(turn.rpc.filter(r=>r.method==='prompt.submit').length,1,'Duplicate submit');
  assert.equal(result.toolCalls,0,'Unexpected tool execution');
  const terminal=turn.completes.at(-1);
  if(terminal?.status==='error'||terminal?.error){result.providerFailure={label,error:terminal.error??terminal.text,model:terminal.usage?.model,knownTerminal:true};throw Error('Native Provider terminal failure: '+(terminal.error??terminal.text));}
  if(!stop){assert.ok(deltas.length>1,'No continuous deltas');assert.equal(turn.deltaText,turn.completes.at(-1)?.text,'Delta/final mismatch');}
  assert.equal(turn.final.busy,false);assert.equal(turn.final.awaiting,false);
  if(turn.final.messages.some(m=>m.error))throw Error('Native conversation contains error');
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
  await send('context-1','Synthetic test only. Do not call tools. Remember the code A02-CONTEXT-68Q. Reply exactly: A02-CONTEXT-STORED.');
  await send('context-2','What code did I ask you to remember?');
  assert.ok(result.turns[1].deltaText.includes('A02-CONTEXT-68Q'),'Multi-turn context lost');
  await send('long-stop','Do not call tools. Write 200 numbered sentences about abstract geometric shapes, one sentence per line. Continue until all 200 are finished.',{stop:true});
  await send('after-stop','Do not call tools. Reply exactly: A02-AFTER-STOP-OK.');
  result.stage='NATIVE_IMAGE_PICKER';save(`electron-run-${run}`,result);
  await page.getByRole('button',{name:'Add context',exact:true}).click();
  await page.getByRole('menuitem',{name:/^Images/}).click();
  console.log(JSON.stringify({run,stage:'NATIVE_IMAGE_PICKER',fixture:path.resolve('.artifacts/p522-host-a02-01/vision.png')}));
  await page.locator('[data-slot="composer-attachments"]').waitFor({timeout:180000});
  await shot('image-preview');
  await send('vision','Please read the unique string in the center of the attached image. Reply only with that string. Do not call tools.');
  const fixture=JSON.parse(fs.readFileSync('.artifacts/p522-host-a02-01/vision-fixture.json','utf8'));
  assert.ok(result.turns.at(-1).deltaText.includes(fixture.marker),'Image marker not recognized');
  result.status='PASS';
}catch(error){result.status='FAIL';result.failure=String(error.stack??error);if(app)result.windows=app.windows().map(w=>w.url());if(page){result.url=page.url();result.body=await page.locator('body').innerText().catch(()=>'(unavailable)');await shot('failure').catch(e=>{result.screenshotFailure=String(e);});}process.exitCode=1;}
finally {
  clearInterval(heartbeat);
  const desktopLog=path.join(home,'logs/desktop.log');
  if(fs.existsSync(desktopLog))result.desktopLog=fs.readFileSync(desktopLog,'utf8');
  save(`electron-run-${run}`,result);
  if(app)await app.close();
  const sessions=path.join(home,'sessions');
  if(fs.existsSync(sessions)){
    result.providerDumps=fs.readdirSync(sessions).filter(f=>f.startsWith('request_dump_')).map(f=>{const dump=JSON.parse(fs.readFileSync(path.join(sessions,f),'utf8'));if(dump.request?.headers)dump.request.headers.Authorization='[REDACTED]';return dump;});
  }
  // Only this run's exact credential-bearing file is removed. The user's
  // provider.local.json is retained and no directory is deleted.
  if(fs.existsSync(configPath))fs.unlinkSync(configPath);
  result.credentialCleanup={file:'[TEST_HOME]/config.yaml',removed:!fs.existsSync(configPath),userLocalConfigRetained:true};
  save(`electron-run-${run}`,result);save('interaction-verification',result);
  console.log(JSON.stringify({run,status:result.status,turns:result.turns.length,errors:result.errors.length,failure:result.failure?.split('\n')[0]}));
}
