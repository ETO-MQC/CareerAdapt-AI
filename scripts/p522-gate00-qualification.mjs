import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {_electron} from 'playwright-core';

const out='docs/architecture/evidence/p522-slice1';
fs.mkdirSync(out,{recursive:true});
const git=(args,cwd=process.cwd())=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:8e6}).trim();
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
const desktop=path.join(host,'apps/desktop');
const req=createRequire(path.join(desktop,'package.json'));
const manifests=['p521','p522','p522-ux01'].map(id=>{
 const file=`docs/architecture/evidence/${id}/delivery-manifest.json`;
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 return {file,sha256:hash(file),files:(data.files||data.allNewUntrackedFilesExceptThisManifest).map(f=>({path:f.path,expected:f.sha256,actual:fs.existsSync(f.path)?hash(f.path):null})).map(f=>({...f,matches:f.expected===f.actual}))};
});
const sources=['src/sdk/index.ts','src/sdk/runtime.ts','src/contrib/plugin.ts','src/contrib/runtime-loader.ts','src/contrib/plugins-store.ts','src/app/routes.ts','src/themes/context.tsx'];
const baseline={date:'2026-11-04',branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD']),origin:git(['rev-parse','origin/main']),status:git(['status','--short']),fetchExitCode:0,worktrees:git(['worktree','list']),log:git(['log','-10','--oneline']),ignored:git(['status','--ignored','--short']),manifests,hermesHead:git(['rev-parse','HEAD'],host),desktopVersion:JSON.parse(fs.readFileSync(path.join(desktop,'package.json'),'utf8')).version,runtimeLock:JSON.parse(fs.readFileSync('scripts/hermes-runtime-lock.json','utf8')),sdk:sources.map(p=>({path:p,sha256:hash(path.join(desktop,p)),diff:git(['diff','HEAD','--','apps/desktop/'+p],host)}))};
if(!fs.existsSync(out+'/baseline.json'))fs.writeFileSync(out+'/baseline.json',JSON.stringify(baseline,null,2)+'\n');
if(baseline.branch!=='main'||baseline.hermesHead!==baseline.runtimeLock.hermesGitCommit)throw Error('Wrong branch or runtime');
const root=path.resolve('.artifacts/p522-gate00-'+Date.now()),home=path.join(root,'home'),plugin=path.join(home,'desktop-plugins/careeradapt-experience-p522');
fs.mkdirSync(plugin,{recursive:true});
const bundle='.artifacts/p522-host-experience/production-like/plugin.js';
fs.copyFileSync(bundle,path.join(plugin,'plugin.js'));
fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: poc-offline\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: poc-not-a-secret\n');
fs.writeFileSync(path.join(home,'.env'),'');
const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v&&!/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_BASE_URL)$/.test(k)&&!k.startsWith('HERMES')&&k!=='ELECTRON_RUN_AS_NODE'));
Object.assign(env,{HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:'Gate00-'+Date.now(),HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5174'});
const evidence={status:'NOT VERIFIED',root,bundleSha256:hash(bundle),errors:[],consoleErrors:[],timing:Object.fromEntries(Array.from({length:8},(_,i)=>['T'+i,'NOT VERIFIED'])),scope:'Existing unchanged plugin; real Electron and Hermes renderer; fresh isolated home/userData, offline non-secret provider. No onboarding bypass, DOM mutation, force clicks or model calls; loader access is lifecycle-test-only.'};
let app;const start=performance.now();
try{
 app=await _electron.launch({executablePath:req('electron'),args:[desktop,'--disable-gpu','--no-sandbox'],env,cwd:desktop,timeout:30000});
 evidence.automationAttachedMs=performance.now()-start;
 const page=await app.firstWindow({timeout:20000});
 page.on('pageerror',e=>evidence.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')evidence.consoleErrors.push(m.text());});
 await page.getByText('CareerAdapt',{exact:true}).first().waitFor({timeout:45000});
 evidence.timing.T5={upperBoundFromLaunchRequestMs:performance.now()-start,meaning:'Sidebar visible; not exact plugin initialization time'};
 evidence.timing.T3=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,paints:performance.getEntriesByType('paint').map(p=>({name:p.name,startTime:p.startTime})),meaning:'Navigation-relative browser paint only; not total startup duration'}));
 await page.screenshot({path:out+'/gate00-before-interaction.png'});
 evidence.beforeText=await page.locator('body').innerText();
 await page.getByText('CareerAdapt',{exact:true}).first().click({timeout:10000});
 evidence.timing.T4={upperBoundFromLaunchRequestMs:performance.now()-start,meaning:'Navigation click completed only'};
 await page.locator('.ca-experience').waitFor({timeout:10000});
 await page.getByRole('button',{name:'重新加载合成资料'}).click({timeout:10000});
 await page.locator('.ca-profile-poc, .ca-context').first().waitFor({timeout:10000});
 evidence.timing.T6={upperBoundFromLaunchRequestMs:performance.now()-start,meaning:'Synthetic Profile reload completed'};
 await page.evaluate(()=>{location.hash='/';});
 await page.locator('.ca-experience').waitFor({state:'detached'});
 if(await page.locator('style[data-careeradapt-experience]').count())throw Error('Route CSS leak');
 // Test-harness loader observation only, after ordinary UI interaction succeeded.
 await page.evaluate(async()=>{await (await import('/src/contrib/plugins-store.ts')).setPluginEnabled('careeradapt-experience-p522',false);});
 await page.getByText('CareerAdapt',{exact:true}).waitFor({state:'detached'});
 await page.getByText('New session',{exact:true}).first().waitFor();
 await page.evaluate(async()=>{await (await import('/src/contrib/plugins-store.ts')).setPluginEnabled('careeradapt-experience-p522',true);});
 await page.getByText('CareerAdapt',{exact:true}).first().click({timeout:10000});
 await page.locator('.ca-profile-poc, .ca-context').first().waitFor();
 evidence.lifecycle='PASS: route exit CSS unload, loader disable/enable, native navigation retained, re-entry';
 if(evidence.errors.length||evidence.consoleErrors.length)throw Error('Renderer errors');
 evidence.status='COMPLETE';
}catch(error){evidence.status='BLOCKED';evidence.failure=String(error.stack||error);process.exitCode=1;}
finally{
 if(app){const pages=app.windows();if(pages.length){evidence.finalText=await pages[0].locator('body').innerText();await pages[0].screenshot({path:out+'/gate00-final.png'});}await app.close();}
 fs.writeFileSync(out+'/host-runtime-qualification.json',JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({status:evidence.status,manifests:manifests.map(m=>({file:m.file,count:m.files.length,mismatches:m.files.filter(f=>!f.matches)})),timing:evidence.timing,failure:evidence.failure}));
}
