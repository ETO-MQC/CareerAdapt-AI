import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {_electron} from 'playwright-core';
const desktop=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent/apps/desktop'),req=createRequire(path.join(desktop,'package.json')),{build}=req('esbuild');
const run=Date.now(),root=path.resolve('.artifacts/p522-a05/main-probe-'+run),out='docs/architecture/evidence/p522-a05-native-career/implementation';fs.mkdirSync(root,{recursive:true});
const userData=path.join(root,'user-data');fs.mkdirSync(userData,{recursive:true});
const application=process.argv.includes('--application'),defaultMode=process.argv.includes('--default'),applicationUrl='http://127.0.0.1:5196/@fs/'+path.resolve('.artifacts/p522-a05/application.mjs').replaceAll('\\','/');
const server=http.createServer((_request,response)=>response.end('<!doctype html><title>D3 Main Probe</title><p>Isolated IPC probe, no Hermes runtime</p>'+ (application?`<script type="module" src="${applicationUrl}"></script>`:'')));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,slash=String.fromCharCode(92),config={pipe:slash+slash+'.'+slash+'pipe'+slash+'careeradapt-d3-probe-'+crypto.randomUUID(),secret:crypto.randomBytes(32).toString('hex'),ledger:path.join(root,'ledger.jsonl'),faultFile:path.join(root,'fault.json'),workspaces:[],rendererOrigin:origin};
const configuration=path.join(root,'config.json');fs.writeFileSync(configuration,JSON.stringify(config));
const preload=defaultMode?path.join(desktop,'dist/electron-preload.js'):path.resolve('.artifacts/p522-a05/main/preload.cjs');
const source=`import {app,BrowserWindow} from 'electron';import {installD3} from ${JSON.stringify(path.resolve('poc/native-career-d3/main.mjs'))};app.setPath('userData',${JSON.stringify(userData)});app.whenReady().then(async()=>{await installD3({nativeConnection:async()=>{throw Error('NO_NATIVE_RUNTIME_IN_THIS_PROBE')}});const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true,preload:${JSON.stringify(preload)}}});await w.loadURL(${JSON.stringify(origin+'/')});});`;
await build({stdin:{contents:source,loader:'js',resolveDir:process.cwd()},outfile:path.join(root,'probe.mjs'),bundle:true,platform:'node',format:'esm',external:['electron']});
let app;const result={run,status:'RUNNING',level:'REAL_ELECTRON_MAIN_PRELOAD_ONLY_NOT_NATIVE_HERMES',cases:[],userDataIsolated:true};
try{
 const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH)$/i.test(name)));
 app=await _electron.launch({executablePath:req('electron'),args:[path.join(root,'probe.mjs'),'--disable-gpu','--no-sandbox'],env:{...env,CAREERADAPT_D3:defaultMode?'0':'1',CAREERADAPT_D3_CONFIG:configuration},timeout:15000});
 const page=await app.firstWindow({timeout:5000});await page.waitForLoadState();
 if(application){const ready=await page.evaluate(async url=>{const composition=await import(url);await composition.ready;return {ready:composition.diagnostics.ready,calls:composition.diagnostics.calls.length};},applicationUrl);assert.equal(ready.ready,true);assert.equal(ready.calls,0);result.applicationComposition=ready;}
 if(defaultMode){assert.equal(await page.evaluate(()=>typeof window.careerD3),'undefined');assert.equal(fs.existsSync(config.ledger),false);result.defaultProbe=true;result.status='PASS';result.cases=['no D3 Preload API','no Main grant/ledger/broker startup'];}
 else{
 const attach=await page.evaluate(()=>window.careerD3.attach());assert.equal(attach.syntheticOnly,true);
 const enabled=await page.evaluate(()=>window.careerD3.lifecycle(true));assert.equal(enabled.enabled,true);
 const disabled=await page.evaluate(()=>window.careerD3.lifecycle(false));assert.equal(disabled.enabled,false);assert.ok(disabled.epoch>enabled.epoch);
 const invalid=await page.evaluate(async()=>{try{await window.careerD3.lifecycle({enabled:true});return false;}catch{return true;}});assert.equal(invalid,true);
 await page.reload();const invalidated=fs.readFileSync(config.ledger,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.event==='LIFECYCLE').at(-1);assert.equal(invalidated.enabled,false);
 result.status='PASS';result.cases=['named pipe listen succeeds','isolated Preload bridge attach','Main enable/disable committed before ACK','invalid setter payload rejected','reload invalidates old lifecycle'];
 }
}catch(error){result.status='FAIL';result.error=String(error.stack||error);process.exitCode=1;}
finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));fs.writeFileSync(`${out}/main-probe-${run}.json`,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify(result));
