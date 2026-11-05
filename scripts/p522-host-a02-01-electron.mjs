import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {_electron} from 'playwright-core';

const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop');
const req=createRequire(path.join(desktop,'package.json'));
const out='docs/architecture/evidence/p522-host-a02-01',run=Date.now();
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
const result={run,status:'RUNNING',provider:config.base_url,model:config.model,events:[],rpc:[],turns:[],errors:[],consoleErrors:[],screenshots:[],toolCalls:0,scope:'Real locked Electron, native Composer/Stop/Store/Runtime, synthetic content only'};
let app,page;
const snap=()=>page.evaluate(async()=>{const s=await import('/src/store/session.ts');const states=await import('/src/store/session-states.ts');return {busy:s.$busy.get(),awaiting:s.$awaitingResponse.get(),sessionId:s.$activeSessionId.get(),model:s.$currentModel.get(),provider:s.$currentProvider.get(),messages:s.$messages.get(),state:states.$sessionStates.get()[s.$activeSessionId.get()]};});
const shot=async stage=>{const file=`${out}/screenshots/${run}-${stage}.png`;await page.screenshot({path:file});result.screenshots.push(file);};
const pending=new Map();
function frame(data,direction){try{const value=JSON.parse(String(data)),at=Date.now();if(direction==='sent'&&value.method){const r={at,id:value.id,method:value.method,sessionId:value.params?.session_id};result.rpc.push(r);pending.set(value.id,r);}
  if(direction==='received'&&value.id!==undefined){const r=pending.get(value.id);if(r){r.ackAt=at;r.rejected=Boolean(value.error);if(value.error)r.error=value.error.message;r.resultKeys=Object.keys(value.result??{});}}
  if(direction==='received'&&value.params?.type){const e=value.params;if(/^(message\.|error$|session.info|tool\.)/.test(e.type)){result.events.push({at,type:e.type,sessionId:e.session_id,payload:e.payload});if(e.type==='tool.start')result.toolCalls++;}}
}catch{/* Non-JSON wire frames are not evidence. */}}
async function send(label,text,{stop=false}={}) {
  const before=await snap(),offset=result.events.length,rpcOffset=result.rpc.length;
  const editor=page.getByRole('textbox',{name:'Message',exact:true});await editor.fill(text);
  const turn={label,tClick:Date.now(),sessionBefore:before.sessionId};result.turns.push(turn);
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.waitForFunction(async()=>{const s=await import('/src/store/session.ts');return s.$busy.get()||s.$messages.get().some(m=>m.role==='assistant');},null,{timeout:10000});
  if(stop){
    await page.waitForFunction(()=>document.querySelector('[data-slot="aui_assistant-message-content"]')?.textContent?.trim().length>30,null,{timeout:30000});
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
    await page.waitForFunction(async()=>{const s=await import('/src/store/session.ts');return !s.$busy.get()&&s.$messages.get().some(m=>m.role==='assistant');},null,{timeout:45000});
  }
  turn.tComplete=Date.now();turn.final=await snap();
  turn.events=result.events.slice(offset);turn.rpc=result.rpc.slice(rpcOffset);
  const submit=turn.rpc.find(r=>r.method==='prompt.submit');turn.tRpcSend=submit?.at;turn.tAck=submit?.ackAt;
  const deltas=turn.events.filter(e=>e.type==='message.delta');turn.tFirstDelta=deltas[0]?.at;
  turn.deltaText=deltas.map(e=>e.payload?.text??'').join('');turn.interims=turn.events.filter(e=>e.type==='message.interim').map(e=>e.payload?.text);
  turn.completes=turn.events.filter(e=>e.type==='message.complete').map(e=>e.payload);
  turn.ttftMs=turn.tFirstDelta-turn.tClick;turn.totalMs=turn.tComplete-turn.tClick;
  assert.equal(turn.rpc.filter(r=>r.method==='prompt.submit').length,1,'Duplicate submit');
  assert.equal(result.toolCalls,0,'Unexpected tool execution');
  if(!stop){assert.ok(deltas.length>1,'No continuous deltas');assert.equal(turn.deltaText,turn.completes.at(-1)?.text,'Delta/final mismatch');}
  assert.equal(turn.final.busy,false);assert.equal(turn.final.awaiting,false);
  if(turn.final.messages.some(m=>m.error))throw Error('Native conversation contains error');
  await shot(label);save(`electron-run-${run}`,result);
}
try {
  app=await _electron.launch({executablePath:req('electron'),args:[desktop,'--disable-gpu','--no-sandbox'],cwd:workspace,env,timeout:20000});
  page=await app.firstWindow({timeout:15000});page.setDefaultTimeout(10000);
  page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(m.text());});
  page.on('websocket',socket=>{socket.on('framesent',e=>frame(e.payload,'sent'));socket.on('framereceived',e=>frame(e.payload,'received'));});
  const later=page.getByRole('button',{name:/choose a provider later/i});
  await Promise.any([later.waitFor({state:'visible',timeout:20000}),page.getByRole('button',{name:'Add context',exact:true}).waitFor({state:'visible',timeout:20000})]);
  if(await later.isVisible())await later.click();
  await page.getByRole('button',{name:/AI 连接.*ready/i}).waitFor({timeout:20000});
  const nav=page.getByRole('navigation',{name:'CareerAdapt 主导航',exact:true});await nav.getByRole('button',{name:'AI 工作台',exact:true}).click();
  const dismiss=page.getByRole('button',{name:/dismiss/i});if(await dismiss.count())await dismiss.first().click();
  await shot('ready');
  await send('context-1','Synthetic test only. Do not call tools. Remember the code A02-CONTEXT-68Q. Reply exactly: A02-CONTEXT-STORED.');
  await send('context-2','Do not call tools. What code did I ask you to remember? Reply only with that code.');
  assert.ok(result.turns[1].deltaText.includes('A02-CONTEXT-68Q'),'Multi-turn context lost');
  await send('long-stop','Do not call tools. Write 200 numbered sentences about abstract geometric shapes, one sentence per line. Continue until all 200 are finished.',{stop:true});
  await send('after-stop','Do not call tools. Reply exactly: A02-AFTER-STOP-OK.');
  result.status='PASS';
}catch(error){result.status='FAIL';result.failure=String(error.stack??error);if(app)result.windows=app.windows().map(w=>w.url());if(page){result.url=page.url();result.body=await page.locator('body').innerText().catch(()=>'(unavailable)');await shot('failure').catch(e=>{result.screenshotFailure=String(e);});}process.exitCode=1;}
finally {
  if(app)await app.close();
  // Only this run's exact credential-bearing file is removed. The user's
  // provider.local.json is retained and no directory is deleted.
  if(fs.existsSync(configPath))fs.unlinkSync(configPath);
  result.credentialCleanup={file:'[TEST_HOME]/config.yaml',removed:!fs.existsSync(configPath),userLocalConfigRetained:true};
  save(`electron-run-${run}`,result);save('interaction-verification',result);
  console.log(JSON.stringify({run,status:result.status,turns:result.turns.length,errors:result.errors.length,failure:result.failure?.split('\n')[0]}));
}
