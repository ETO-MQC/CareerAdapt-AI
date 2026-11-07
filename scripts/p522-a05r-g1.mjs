import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {_electron} from 'playwright-core';
import {startD3Model} from './p522-a05-local-model.mjs';

const out=path.resolve('docs/architecture/evidence/p522-a05r'),run=Date.now();
const root=path.resolve('.artifacts/p522-a05r/g1-'+run),home=path.join(root,'home');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(home,{recursive:true});
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'),desktop=path.join(host,'apps/desktop'),req=createRequire(path.join(desktop,'package.json'));
const model=await startD3Model(),slash=String.fromCharCode(92);
const config={pipe:slash+slash+'.'+slash+'pipe'+slash+'careeradapt-d3-g1-'+crypto.randomUUID(),secret:crypto.randomBytes(32).toString('hex'),ledger:path.join(root,'ledger.jsonl'),faultFile:path.join(root,'fault.json'),workspaces:[],rendererOrigin:'http://127.0.0.1:5196'};
fs.writeFileSync(path.join(root,'control.json'),JSON.stringify(config));fs.writeFileSync(config.faultFile,'{}');
const plugin=path.join(home,'plugins/careeradapt_d3_profile');fs.mkdirSync(plugin,{recursive:true});
for(const file of ['__init__.py','plugin.yaml'])fs.copyFileSync('poc/native-career-d3/python/'+file,path.join(plugin,file));
fs.writeFileSync(path.join(home,'config.yaml'),`model:\n  default: d3-local\n  provider: custom\n  base_url: ${model.url}\n  api_key: local-synthetic-not-a-provider-key\nplugins:\n  enabled: [careeradapt_d3_profile]\ntoolsets: [career_d3]\n`);fs.writeFileSync(path.join(home,'.env'),'');
const env=Object.fromEntries(Object.entries(process.env).filter(([n,v])=>v&&/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|USERNAME|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(n)));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:'D3-G1-'+run,HERMES_DESKTOP_DEV_SERVER:config.rendererOrigin,HERMES_DESKTOP_CWD:root,HERMES_IGNORE_RULES:'1',HERMES_TUI_TOOLSETS:'career_d3',HERMES_DESKTOP_PORT_ANNOUNCE_TIMEOUT_MS:'150000',CAREERADAPT_D3:'1',CAREERADAPT_D3_CONFIG:path.join(root,'control.json'),CAREERADAPT_D3_PIPE:config.pipe,CAREERADAPT_D3_SECRET:config.secret,PYTHONIOENCODING:'utf-8'});
const result={run,status:'RUNNING',stages:[],logs:[],pipe:config.pipe,root,provider:'LOCAL_PROTOCOL_ONLY',acl:{status:'NOT_VERIFIED_SID',readableAll:false,writableAll:false,claim:'No resistance to malicious same-user local code claimed'},bundles:['main/main.mjs','main/preload.cjs','application.mjs'].map(f=>({file:'.artifacts/p522-a05/'+f,sha256:crypto.createHash('sha256').update(fs.readFileSync('.artifacts/p522-a05/'+f)).digest('hex')}))};
const save=()=>fs.writeFileSync(path.join(out,'g1-'+run+'.json'),JSON.stringify(result,null,2)+'\n');
async function stage(name,timeout,fn){const row={name,timeout,started:Date.now(),status:'RUNNING'};result.stages.push(row);save();let timer;try{row.detail=await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(name+' timeout')),timeout);})]);row.status='PASS';row.exitCode=0;}catch(e){row.status='FAIL';row.exitCode=1;row.error=String(e.stack);throw e;}finally{clearTimeout(timer);row.finished=Date.now();save();}}
let app,page;
try{
 await stage('A Main startup',30000,async()=>{app=await _electron.launch({executablePath:req('electron'),args:[path.resolve('.artifacts/p522-a05/main'),'--disable-gpu','--no-sandbox'],cwd:root,env,timeout:29000});for(const channel of ['stdout','stderr'])app.process()[channel].on('data',b=>{result.logs.push({at:Date.now(),channel,text:String(b).replaceAll(config.secret,'[REDACTED]')});save();});return {pid:app.process().pid};});
 await stage('B Named pipe listening',5000,()=>new Promise((resolve,reject)=>{const socket=net.connect(config.pipe);socket.setTimeout(4000,()=>socket.destroy(Error('pipe connect timeout')));socket.on('error',reject);socket.on('connect',()=>{socket.end();resolve({connected:true,ledger:fs.readFileSync(config.ledger,'utf8').trim().split('\n').map(JSON.parse)});});}));
 await stage('C Preload handshake',25000,async()=>{page=await app.firstWindow({timeout:15000});await page.waitForLoadState('domcontentloaded',{timeout:8000});assert.equal(await page.evaluate(()=>typeof window.careerD3?.attach),'function');return {apiPresent:true};});
 await stage('D Application readiness',20000,async()=>{const url='/@fs/'+path.resolve('.artifacts/p522-a05/application.mjs').replaceAll('\\','/');const value=await page.evaluate(async url=>{const m=await import(url);await m.ready;return {ready:m.diagnostics.ready,calls:m.diagnostics.calls.length};},url);assert.equal(value.ready,true);assert.equal(value.calls,0);return value;});
 await stage('E Python native plugin readiness',20000,async()=>{const code=`import sys,json;sys.path.insert(0,${JSON.stringify(host)});from hermes_cli.plugins import discover_plugins;discover_plugins();from model_tools import get_tool_definitions;rows=get_tool_definitions(enabled_toolsets=['career_d3'],quiet_mode=True);names=sorted(r['function']['name'] for r in rows);assert names==['career.profile.get','career.profile.search_facts'],names;print(json.dumps(names))`;
 const p=spawnSync(path.join(host,'venv/Scripts/python.exe'),['-c',code],{env,cwd:root,encoding:'utf8',timeout:18000});const detail={exitCode:p.status,stdout:p.stdout,stderr:p.stderr,error:p.error?.message};assert.equal(p.status,0,JSON.stringify(detail));return detail;});
 await stage('F Native Host readiness',205000,async()=>{const later=page.getByRole('button',{name:/choose a provider later/i}),nav=page.getByRole('navigation',{name:'CareerAdapt 主导航',exact:true});await Promise.any([later.waitFor({timeout:200000}),nav.waitFor({timeout:200000})]);if(await later.isVisible())await later.click();await page.getByRole('button',{name:/AI 连接.*ready/i}).waitFor({timeout:200000});return {nativeGatewayReady:true,modelRequests:model.requests.length};});
 result.status='PASS_G1';
}catch(e){result.status='FAIL_G1_STOP_G2_G6';result.failure=String(e.stack);process.exitCode=1;if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'g1-'+run+'-failure.png'),timeout:5000}).catch(e=>{result.screenshotError=String(e);});}
finally{if(app){const p=app.process();await app.close();result.cleanup={electronPid:p.pid,exitCode:p.exitCode};}await model.close();result.modelRequests=model.requests.length;result.cleanup={...result.cleanup,protocolDriverClosed:true};save();}
console.log(JSON.stringify({status:result.status,stages:result.stages,cleanup:result.cleanup}));
