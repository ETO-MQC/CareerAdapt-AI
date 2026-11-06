import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
import {startD3Model} from './p522-a05-local-model.mjs';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop'),req=createRequire(path.join(desktop,'package.json'));
const out='docs/architecture/evidence/p522-a05-native-career/implementation',run=Date.now(),root=path.resolve(`.artifacts/p522-a05/run-${run}`),home=path.join(root,'home');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(home,{recursive:true});
const workspaces=['A','B','empty'].map(profileId=>({profileId,personId:`person-${profileId}`,workspaceId:'d3-synthetic-application',cwd:path.join(root,'workspace-'+profileId)}));
for(const w of workspaces)fs.mkdirSync(w.cwd,{recursive:true});
const slash=String.fromCharCode(92);
const model=await startD3Model(),config={pipe:slash+slash+'.'+slash+'pipe'+slash+'careeradapt-d3-'+crypto.randomUUID(),secret:crypto.randomBytes(32).toString('hex'),ledger:path.join(root,'ledger.jsonl'),faultFile:path.join(root,'fault.json'),workspaces,rendererOrigin:'http://127.0.0.1:5196'};
fs.writeFileSync(config.faultFile,JSON.stringify({mode:null}));fs.writeFileSync(path.join(root,'control.json'),JSON.stringify(config));
const plugin=path.join(home,'plugins/careeradapt_d3_profile');fs.mkdirSync(plugin,{recursive:true});
for(const name of ['plugin.yaml','__init__.py'])fs.copyFileSync('poc/native-career-d3/python/'+name,path.join(plugin,name));
const desktopPlugin=path.join(home,'desktop-plugins/careeradapt-d3-profile');fs.mkdirSync(desktopPlugin,{recursive:true});
fs.writeFileSync(path.join(desktopPlugin,'plugin.js'),`export default {id:'careeradapt-d3-profile',name:'D3 Synthetic Profile',defaultEnabled:false,register(){}};\n`);
fs.writeFileSync(path.join(home,'config.yaml'),`model:\n  default: d3-local\n  provider: custom\n  base_url: ${JSON.stringify(model.url)}\n  api_key: local-synthetic-not-a-provider-key\nplugins:\n  enabled: [careeradapt_d3_profile]\ntoolsets: [career_d3]\nagent:\n  api_max_retries: 1\n  max_turns: 3\n  reasoning_effort: none\nsessions:\n  auto_archive: false\n`);
fs.writeFileSync(path.join(home,'.env'),'');
const env=Object.fromEntries(Object.entries(process.env).filter(([n,v])=>v&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|USERNAME|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(n)));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:`D3-${run}`,HERMES_DESKTOP_DEV_SERVER:config.rendererOrigin,HERMES_DESKTOP_CWD:workspaces[0].cwd,HERMES_IGNORE_RULES:'1',HERMES_TUI_TOOLSETS:'career_d3',HERMES_DESKTOP_PORT_ANNOUNCE_TIMEOUT_MS:'150000',CAREERADAPT_D3:'1',CAREERADAPT_D3_CONFIG:path.join(root,'control.json'),CAREERADAPT_D3_PIPE:config.pipe,CAREERADAPT_D3_SECRET:config.secret});
let app,page,epoch=0;
const evidence={run,status:'RUNNING',cases:[],launches:[],rpc:[],events:[],errors:[],processOutput:[],deletions:0,providerQualification:'DETERMINISTIC_LOCAL_PROTOCOL_DRIVER_NOT_REAL_PROVIDER'};
const redact=value=>JSON.parse(JSON.stringify(value).replaceAll(config.secret,'[PIPE_AUTH_REDACTED]'));
const save=()=>{fs.writeFileSync(`${out}/electron-${run}.json`,JSON.stringify(redact({...evidence,modelRequests:model.requests,modelEvents:model.events}),null,2)+'\n');};
const heartbeat=setInterval(save,15000);
const ledger=()=>fs.existsSync(config.ledger)?fs.readFileSync(config.ledger,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(100);}throw Error('D3 bounded condition timed out');}
async function launch(){
 epoch++;app=await _electron.launch({executablePath:req('electron'),args:[path.resolve('.artifacts/p522-a05/main'),'--disable-gpu','--no-sandbox'],cwd:workspaces[0].cwd,env,timeout:30000});
 evidence.launches.push({epoch,pid:app.process().pid,at:Date.now()});for(const channel of ['stdout','stderr'])app.process()[channel].on('data',chunk=>{evidence.processOutput.push({epoch,channel,text:String(chunk)});save();});page=await app.firstWindow({timeout:20000});page.setDefaultTimeout(15000);
 page.on('pageerror',error=>{evidence.errors.push(error.message);save();});
 page.on('websocket',socket=>{
  socket.on('framesent',e=>{try{const v=JSON.parse(String(e.payload));if(v.method)evidence.rpc.push({epoch,at:Date.now(),...v});}catch{/* Ignore non-JSON transport frames. */}});
  socket.on('framereceived',e=>{try{const v=JSON.parse(String(e.payload));if(v.params?.type)evidence.events.push({epoch,at:Date.now(),...v.params});if(v.id!==undefined){const request=evidence.rpc.findLast(r=>r.epoch===epoch&&r.id===v.id);if(request){request.result=v.result;request.error=v.error;}}}catch{/* Ignore non-JSON transport frames. */}});
 });
 const later=page.getByRole('button',{name:/choose a provider later/i}),nav=page.getByRole('navigation',{name:'CareerAdapt 主导航',exact:true});
 await Promise.any([later.waitFor({timeout:210000}),nav.waitFor({timeout:210000})]);if(await later.isVisible())await later.click();
 await page.getByRole('button',{name:/AI 连接.*ready/i}).waitFor({timeout:210000});
 await until(()=>page.evaluate(()=>Boolean(window.careerD3)),20000);
 await until(()=>page.evaluate(async url=>(await import(url)).diagnostics.ready,'/@fs/'+path.resolve('.artifacts/p522-a05/application.mjs').replaceAll('\\','/')),20000);
 await page.evaluate(async()=>{await(await import('/src/contrib/runtime-loader.ts')).discoverRuntimePlugins();});
 await until(()=>page.evaluate(async()=>Boolean((await import('/src/contrib/plugins-store.ts')).$pluginRecords.get()['careeradapt-d3-profile'])),20000);
 evidence.launches.at(-1).ready=Date.now();save();
}
async function close(){if(app){const process=app.process();await app.close();evidence.launches.at(-1).exitCode=process.exitCode;app=null;}}
async function toggle(enabled){
 // Drive the real native Settings switch; never call broker.revoke from runner.
 await page.evaluate(()=>{location.hash='#/settings?tab=plugins';});
 let control=page.getByRole('switch',{name:/D3 Synthetic Profile/});
 if(!await control.isVisible()){
  const plugins=page.getByRole('button',{name:/^Plugins$/i});if(await plugins.isVisible())await plugins.click();
 }
 await control.waitFor();const checked=await control.getAttribute('aria-checked');
 if((checked==='true')!==enabled)await control.click();
 await until(async()=>{const state=await page.evaluate(async()=> (await import('/src/contrib/plugins-store.ts')).$pluginRecords.get()['careeradapt-d3-profile']);return state.status===(enabled?'loaded':'disabled');});
 const last=ledger().filter(r=>r.event==='LIFECYCLE').at(-1);assert.equal(last.enabled,enabled);evidence.cases.push({name:enabled?'native-enable-switch':'native-disable-switch',status:'PASS',epoch: last.epoch});save();
}
const snapshot=()=>page.evaluate(async()=>{const s=await import('/src/store/session.ts');return {storedId:s.$selectedStoredSessionId.get(),runtimeId:s.$activeSessionId.get(),busy:s.$busy.get(),messages:s.$messages.get()};});
async function newSession(profile){
 await page.getByRole('navigation',{name:'CareerAdapt 主导航'}).getByRole('button',{name:'AI 工作台',exact:true}).click();
 await page.getByRole('button',{name:'＋ 新建对话',exact:true}).click();
 // Set native draft workspace using the existing store action, not identity.
 const cwd=workspaces.find(w=>w.profileId===profile).cwd;
 await page.evaluate(async cwd=>{(await import('/src/store/session.ts')).setCurrentCwd(cwd);},cwd);
}
async function begin(tag){
 const offset=evidence.events.length,requests=evidence.rpc.length;
 await page.getByRole('textbox',{name:'Message',exact:true}).fill(`D3_CASE:${tag}. Read the synthetic Profile using the available Career tool once. Use only the actual tool result; do not retry errors.`);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 return {offset,requests,tag};
}
async function finish(turn){
 await until(()=>evidence.events.slice(turn.offset).find(e=>e.type==='message.complete'),45000);
 const state=await snapshot(),events=evidence.events.slice(turn.offset),rpc=evidence.rpc.slice(turn.requests).filter(r=>r.method==='prompt.submit');
 assert.equal(rpc.length,1,'Native turn must not auto resend');return {state,events,submits:rpc};
}
async function send(tag){return finish(await begin(tag));}
async function stop(){const button=page.getByRole('button',{name:/^Stop$/i});await button.click();}
async function check(name,fn){try{const detail=await fn();evidence.cases.push({name,status:'PASS',detail});save();return detail;}catch(error){evidence.cases.push({name,status:'FAIL',error:String(error.stack||error)});save();throw error;}}
async function pipeStatus(operationId,sessionId){return new Promise((resolve,reject)=>{
 const socket=net.connect(config.pipe),request={kind:'status',operationId,sessionId},raw=JSON.stringify(request),mac=crypto.createHmac('sha256',config.secret).update(raw).digest('hex'),body=Buffer.from(JSON.stringify({request,mac})),head=Buffer.alloc(4);head.writeUInt32BE(body.length);let buffer=Buffer.alloc(0);
 socket.setTimeout(5000,()=>socket.destroy(Error('status timeout')));socket.on('connect',()=>socket.write(Buffer.concat([head,body])));socket.on('error',reject);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(buffer.length>=4&&buffer.length>=buffer.readUInt32BE(0)+4){const value=JSON.parse(buffer.subarray(4).toString());socket.end();resolve(value);}});
});}
let a,b,lost;
try{
 await launch();await toggle(true);
 await check('native-A-call-streaming-result',async()=>{await newSession('A');a=await send('A');const text=JSON.stringify(a);assert.match(text,/P522_A05_SYNTHETIC_PROFILE_A_/);assert.doesNotMatch(text,/P522_A05_SYNTHETIC_PROFILE_B_/);const done=ledger().findLast(r=>r.state==='DELIVERED');assert.equal(done.applicationExecutions,1);assert.equal(done.result.zeroWrites,true);assert.ok(a.events.some(e=>e.type.includes('tool')));return a;});
 await check('native-B-isolation',async()=>{await newSession('B');b=await send('B');assert.notEqual(b.state.storedId,a.state.storedId);assert.match(JSON.stringify(b),/P522_A05_SYNTHETIC_PROFILE_B_/);assert.doesNotMatch(JSON.stringify(b),/P522_A05_SYNTHETIC_PROFILE_A_/);return b;});
 await check('search-miss-no-invention',async()=>{const result=await send('search-miss');assert.doesNotMatch(JSON.stringify(result.state.messages),/D3_NO_SUCH_KEYWORD.*P522_A05_SYNTHETIC/);const record=ledger().findLast(r=>r.state==='DELIVERED');assert.equal(record.result.data.items.length,0);return result;});
 await check('stop-generation',async()=>{model.controls.beforeToolMs=5000;const executions=ledger().filter(r=>r.state==='STARTED').length,turn=await begin('stop-generation');await until(()=>model.events.some(e=>e.tag.includes('stop-generation')));await stop();const r=await finish(turn);model.controls.beforeToolMs=0;assert.equal(ledger().filter(r=>r.state==='STARTED').length,executions);return r;});
 await check('stop-during-handler-late-result',async()=>{fs.writeFileSync(config.faultFile,JSON.stringify({mode:'hold-read'}));const offset=ledger().length,turn=await begin('stop-handler');await until(()=>ledger().slice(offset).some(r=>r.state==='STARTED'));await stop();const result=await finish(turn);fs.writeFileSync(config.faultFile,JSON.stringify({mode:null}));assert.doesNotMatch(JSON.stringify(result.state.messages.at(-1)),/P522_A05_SYNTHETIC/);return result;});
 await check('stop-after-tool-before-answer',async()=>{model.controls.afterToolMs=5000;const turn=await begin('stop-after-tool');await until(()=>model.events.some(e=>e.event==='after-tool-hold'&&e.tag.includes('stop-after-tool')));await stop();const r=await finish(turn);model.controls.afterToolMs=0;return r;});
 await check('native-disable-in-flight',async()=>{fs.writeFileSync(config.faultFile,JSON.stringify({mode:'hold-read'}));const offset=ledger().length,turn=await begin('disable-inflight');await until(()=>ledger().slice(offset).some(r=>r.state==='STARTED'));await toggle(false);await until(()=>ledger().slice(offset).some(r=>r.state==='REVOKED'));fs.writeFileSync(config.faultFile,JSON.stringify({mode:null}));const r=await finish(turn);assert.doesNotMatch(JSON.stringify(r.events.filter(e=>e.type.includes('tool'))),/P522_A05_SYNTHETIC_PROFILE/);return r;});
 await toggle(true);
 await check('reload-no-handler-replay',async()=>{const count=ledger().filter(r=>r.state==='STARTED').length;await page.reload();await page.getByRole('navigation',{name:'CareerAdapt 主导航'}).waitFor();await sleep(2000);assert.equal(ledger().filter(r=>r.state==='STARTED').length,count);assert.equal(ledger().filter(r=>r.event==='LIFECYCLE').at(-1).enabled,false);return {handlerExecutions:count};});
 await toggle(false);await toggle(true);await newSession('A');
 await check('executed-server-lost-ack',async()=>{fs.writeFileSync(config.faultFile,JSON.stringify({mode:'lost-ack'}));const turn=await send('lost-ack');lost=ledger().findLast(r=>r.state==='COMPLETED');assert.ok(lost);assert.equal(lost.handlerExecutions,1);assert.equal(lost.applicationExecutions,1);assert.match(JSON.stringify(turn.state.messages),/UNKNOWN/);fs.writeFileSync(config.faultFile,JSON.stringify({mode:null}));return {operationId:lost.operationId,turn};});
 const beforeRestart=ledger().filter(r=>r.state==='STARTED').length;
 await close();await launch();
 await check('restart-ledger-query-no-reexecution',async()=>{const status=await pipeStatus(lost.operationId,lost.sessionId);assert.equal(status.state,'COMPLETED');assert.equal(status.handlerExecutions,1);assert.equal(ledger().filter(r=>r.state==='STARTED').length,beforeRestart);return status;});
 evidence.status='PASS_DIRECTED_NATIVE_CASES_REQUIRES_FINAL_AUDIT';
}catch(error){evidence.status='PARTIAL';evidence.failure=String(error.stack||error);process.exitCode=1;if(page&&!page.isClosed())await page.screenshot({path:`${out}/failure-${run}.png`,timeout:10000}).catch(e=>{evidence.screenshotError=String(e);});}
finally{clearInterval(heartbeat);await close();evidence.ledger=ledger();await model.close();save();}
console.log(JSON.stringify({run,status:evidence.status,cases:evidence.cases.map(({name,status})=>({name,status})),errors:evidence.errors,failure:evidence.failure}));
