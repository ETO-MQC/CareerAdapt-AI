import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {_electron} from 'playwright-core';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent'), desktop=path.join(host,'apps/desktop');
const req=createRequire(path.join(desktop,'package.json'));
const root=path.resolve('.artifacts/p522-ux01-startup-'+Date.now());
const out='docs/architecture/evidence/p522-ux01/startup-observations.json';
const evidence={status:'PARTIAL',environment:'Locked source Desktop / existing Vite 5174 / offline loopback provider; fresh isolated profiles then immediate relaunch of each. Cold means application-profile cold, NOT OS/filesystem-cache cold. No credentials or real data.',runs:[],limitations:['T0 is harness launch request, not OS process birth','T1 creation and T2 first-visible not reliably observed through late-attached public automation','T4 is navigation interaction probe, not full Host readiness','T5 is sidebar contribution visible, not exact module initialization duration','T7 Agent Runtime readiness NOT VERIFIED; no model request']};
const envBase=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>v&&!/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_BASE_URL)$/.test(k)&&!k.startsWith('HERMES')&&k!=='ELECTRON_RUN_AS_NODE'));
fs.mkdirSync(root,{recursive:true});
for(let pair=1;pair<=3;pair++){
 const home=path.join(root,'pair-'+pair,'home'), plugin=path.join(home,'desktop-plugins/careeradapt-experience-p522');
 fs.mkdirSync(plugin,{recursive:true});
 fs.copyFileSync('.artifacts/p522-host-experience/production-like/plugin.js',path.join(plugin,'plugin.js'));
 fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: poc-offline\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: poc-not-a-secret\n');fs.writeFileSync(path.join(home,'.env'),'');
 for(const kind of ['profile-cold','profile-warm']){
  const run={pair,kind,T0:'NOT VERIFIED (OS birth)',T1:'NOT VERIFIED',T2:'NOT VERIFIED',T3:'NOT VERIFIED',T4:'NOT VERIFIED',T5:'NOT VERIFIED',T6:'NOT VERIFIED',T7:'NOT VERIFIED',errors:[]};
  const start=performance.now(); let app;
  try{
   app=await _electron.launch({executablePath:req('electron'),args:[desktop,'--disable-gpu','--no-sandbox'],cwd:desktop,env:{...envBase,HERMES_HOME:home,HERMES_DESKTOP_USER_DATA_DIR:path.join(root,'pair-'+pair,'user-data'),HERMES_DESKTOP_IGNORE_EXISTING:'1',HERMES_DESKTOP_HERMES_ROOT:host,HERMES_DESKTOP_APP_NAME:'UX01-'+pair,HERMES_DESKTOP_DEV_SERVER:'http://127.0.0.1:5174'},timeout:30000});
   run.launchAutomationAttachedMs=performance.now()-start;run.pid=app.process().pid;
   const page=await app.firstWindow({timeout:20000});run.firstWindowObservedMs=performance.now()-start;
   page.on('pageerror',e=>run.errors.push(e.message));
   await page.getByText('CareerAdapt',{exact:true}).first().waitFor({timeout:45000});run.T5={observedAfterLaunchRequestMs:performance.now()-start,definition:'sidebar contribution visible upper bound'};
   run.T3=await page.evaluate(()=>({timeOrigin:performance.timeOrigin,paints:performance.getEntriesByType('paint').map(p=>({name:p.name,startTime:p.startTime})),definition:'Renderer navigation-relative paint, not launch-relative; first window may include boot overlay'}));
   run.T4='NOT VERIFIED: no interaction retry after two blocked samples';
   run.T6='NOT VERIFIED: Host overlay; no forced click or private state mutation';
   run.visibleText=(await page.locator('body').innerText()).slice(-5000);
   run.windowVisibility=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),title:w.getTitle()})));
   const shot='docs/architecture/evidence/p522-ux01/screenshots/startup-'+pair+'-'+kind+'.png';await page.screenshot({path:shot});run.screenshot=shot;
   run.status='OBSERVED';
  }catch(error){run.status='FAILED';run.failure=String(error.stack||error);}
  finally{if(app)await app.close();evidence.runs.push(run);fs.writeFileSync(out,JSON.stringify(evidence,null,2));}
  console.log(pair,kind,run.status,JSON.stringify(run.T5));
  if(run.status==='FAILED'&&evidence.runs.slice(-2).every(r=>r.status==='FAILED')&&evidence.runs.length>=2){console.log('Two consecutive failures; stop.');process.exit(1);}
 }
}
