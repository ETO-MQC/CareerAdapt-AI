import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn, execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const out='docs/architecture/evidence/p522-host-a02-01r';
fs.mkdirSync(out,{recursive:true});
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
const desktop=path.join(host,'apps/desktop');
const req=createRequire(path.join(desktop,'package.json'));
const {build}=req('esbuild');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:8*1024*1024}).trim();
const root=path.resolve('.artifacts/p522-host-a02-01r/probe-'+Date.now());
const home=path.join(root,'home'),workspace=path.join(root,'workspace');
for(const d of [home,workspace])fs.mkdirSync(d,{recursive:true});
const redact=s=>String(s).replaceAll(root,'[PROBE_ROOT]').replaceAll(host,'[HERMES_ROOT]').replaceAll(process.env.USERPROFILE,'[USER]');
const save=(name,value)=>fs.writeFileSync(`${out}/${name}.json`,redact(JSON.stringify(value,null,2))+'\n');
const prior=['p522-host-a01','p522-host-a01r','p522-host-a01r-fb01','p522-host-a02-00','p522-host-a02-01'].map(folder=>{
 const file=`docs/architecture/evidence/${folder}/delivery-manifest.json`,m=JSON.parse(fs.readFileSync(file,'utf8'));
 const entries=m.files??m.allNewUntrackedFilesExceptThisManifest;
 return {file,sha256:hash(fs.readFileSync(file)),count:entries.length,mismatches:entries.filter(e=>!fs.existsSync(e.path)||hash(fs.readFileSync(e.path))!==e.sha256).map(e=>e.path)};
});
const protectedFiles=JSON.parse(fs.readFileSync('docs/architecture/evidence/p522-host-a01/hermes-source-map.json','utf8')).sourceMap.map(e=>({path:e.file,expected:e.sha256,actual:hash(fs.readFileSync(path.join(host,e.file)))}));
const patches=JSON.parse(fs.readFileSync('docs/architecture/evidence/p522-host-a02-01/patch-manifest.json','utf8'));
const patchChecks=patches.records.map(e=>({path:e.file,expected:e.originalSha256,actual:hash(fs.readFileSync(path.join(host,e.file)))}));
const baseline={head:git('rev-parse','HEAD'),origin:git('rev-parse','origin/main'),status:git('status','--short'),ignored:git('status','--ignored','--short'),worktrees:git('worktree','list'),hermesHead:git('-C',host,'rev-parse','HEAD'),prior,protectedFiles,patchChecks};
save('baseline',baseline);
// Old manifests include shared files intentionally superseded by later commits.
// Preserve their mismatches as history; the latest delivery and upstream hashes
// are the active protection gate. The initial clean Git baseline was recorded.
if(baseline.hermesHead!=='eb52760564dbba2e5971fa54bd67384e281cd3b8'||prior.at(-1).mismatches.length||protectedFiles.concat(patchChecks).some(e=>e.expected!==e.actual))throw Error('Protection mismatch');
// Compile the actual locked pure helpers; no upstream files are written.
await build({entryPoints:['backend-env','backend-command','backend-health'].map(n=>path.join(desktop,'electron',n+'.ts')),outdir:path.join(root,'helpers'),bundle:true,platform:'node',format:'esm'});
const load=n=>import(pathToFileURL(path.join(root,'helpers',n+'.js')));
const {buildDesktopBackendEnv}=await load('backend-env');
const {serveBackendArgs,sourceDeclaresServe,dashboardFallbackArgs}=await load('backend-command');
const {waitForHermesReady}=await load('backend-health');
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|USERNAME|OS|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const inherited=Object.fromEntries(Object.entries(process.env).filter(([n,v])=>v&&allowed.test(n)));
const venv=path.join(host,'venv'),command=path.join(venv,'Scripts/python.exe');
const args=['-m','hermes_cli.main',...serveBackendArgs()];
const actualArgs=sourceDeclaresServe(fs.readFileSync(path.join(host,'hermes_cli/subcommands/dashboard.py'),'utf8'))?args:dashboardFallbackArgs(args);
const token=crypto.randomBytes(32).toString('hex');
const env={...inherited,HERMES_HOME:home,...buildDesktopBackendEnv({hermesHome:home,pythonPathEntries:[host,path.join(venv,'Lib/site-packages')],venvRoot:venv,currentEnv:inherited}),TERMINAL_CWD:workspace,HERMES_DASHBOARD_SESSION_TOKEN:token,HERMES_DESKTOP:'1',HERMES_WEB_DIST:path.join(desktop,'dist'),HERMES_IGNORE_RULES:'1',HERMES_TUI_TOOLSETS:'todo'};
save('backend-command',{command,args:actualArgs,cwd:workspace,home,source:host,venv,env:{...env,HERMES_DASHBOARD_SESSION_TOKEN:'[REDACTED]'},sourceReferences:['main.ts:createPythonBackend/resolveHermesBackend/startHermes','backend-command.ts','backend-env.ts','backend-health.ts','windows-hermes-path.ts'],budgets:{port:90000,health:45000,totalWithSchedulingMargin:145000},modelRequests:0});
const record={spawnAt:Date.now(),pid:null,stdoutFirstMs:null,stderrFirstMs:null,ready:[],exitCode:null,signal:null,spawnError:null,running:false};
const buffers={stdout:'',stderr:''},captures={stdout:'',stderr:''};
let resolveReady,rejectReady;
const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
const child=spawn(command,actualArgs,{cwd:workspace,env,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});
record.pid=child.pid;record.running=true;
child.on('error',e=>{record.spawnError=e.message;rejectReady(e);});
child.on('exit',(code,signal)=>{record.exitCode=code;record.signal=signal;record.running=false;rejectReady(Error('Child exited before READY'));});
for(const channel of ['stdout','stderr'])child[channel].on('data',chunk=>{
 record[channel+'FirstMs']??=Date.now()-record.spawnAt;
 captures[channel]+=chunk.toString();buffers[channel]+=chunk.toString();
 let nl;while((nl=buffers[channel].indexOf('\n'))!==-1){const line=buffers[channel].slice(0,nl).replace(/\r$/,'');buffers[channel]=buffers[channel].slice(nl+1);const m=/^HERMES_(BACKEND|DASHBOARD)_READY port=(\d+)$/.exec(line);if(m){const event={channel,kind:m[1],port:Number(m[2]),elapsedMs:Date.now()-record.spawnAt};record.ready.push(event);resolveReady(event);}}
});
const timer=setTimeout(()=>rejectReady(Error('90s port announcement budget exhausted')),90000);
let health={status:'NOT_RUN'},handshake;
try{
 handshake=await ready;clearTimeout(timer);
 const listening=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port:handshake.port});s.setTimeout(2000);s.on('connect',()=>{s.destroy();resolve(true);});s.on('error',()=>resolve(false));s.on('timeout',()=>{s.destroy();resolve(false);});});
 const attempts=[];
 const fetchJson=async(url,auth,options={})=>{const started=Date.now();const r=await fetch(url,{headers:auth?{Authorization:`Bearer ${auth}`}:{},signal:AbortSignal.timeout(options.timeoutMs??15000)});const body=await r.json();attempts.push({path:new URL(url).pathname,status:r.status,ms:Date.now()-started,body});if(!r.ok)throw Error(`${r.status}: ${JSON.stringify(body)}`);return body;};
 await waitForHermesReady(`http://127.0.0.1:${handshake.port}`,{fetchPublicJson:(url,opts)=>fetchJson(url,null,opts),fetchJson,token});
 health={status:'PASS',listening,attempts,elapsedMs:Date.now()-record.spawnAt,logic:'Actual locked waitForHermesReady, public health then native status fallback',gateway:'NOT_TESTED until Electron'};
 record.classification=handshake.channel==='stderr'?'B':handshake.elapsedMs>20000?'A':'F: native startup healthy within 20 seconds';
}catch(e){clearTimeout(timer);record.failure=String(e.stack);record.classification=record.ready.length?'D':'C';process.exitCode=1;}
finally{
 save('ready-handshake',{events:record.ready,classification:record.classification,stdoutObserved:record.ready.some(e=>e.channel==='stdout'),stderrObserved:record.ready.some(e=>e.channel==='stderr')});
 save('health-verification',health);
 record.runningBeforeCleanup=record.running;
 if(record.running){child.kill();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,3000);});}
 save('backend-process',record);
 for(const c of ['stdout','stderr'])fs.writeFileSync(`${out}/${c}-capture.log`,redact(captures[c]).replaceAll(token,'[REDACTED]'));
 console.log(JSON.stringify({classification:record.classification,ready:record.ready,health:health.status,failure:record.failure}));
}
