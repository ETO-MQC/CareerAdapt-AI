import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const out='docs/architecture/evidence/p522-host-a02-01';
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(name,value)=>fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2)+'\n');
const baseline=read(`${out}/baseline.json`),host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
const checks=baseline.sourceChecks.concat(baseline.patchChecks,baseline.protectedManifest).map(entry=>({path:entry.path,expected:entry.expected,actual:hash(fs.readFileSync(path.join(host,entry.path)))}));
if(checks.some(entry=>entry.expected!==entry.actual))throw Error('Protected upstream changed');
write('final-protection-verification',{status:'PASS',hermesHead:execFileSync('git',['-C',host,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:baseline.sourceChecks.length,originalPatches:baseline.patchChecks.length,protectedFiles:baseline.protectedManifest.length,checks});
const provider=read(`${out}/provider-verification.json`),vision=read(`${out}/vision-api.json`);
write('streaming-verification',{directApi:{status:provider.records.find(r=>r.stream)?.status,record:provider.records.find(r=>r.stream)},nativeElectron:{status:'NOT_VERIFIED',completedSamples:0,tClick:null,tRpcSend:null,tAck:null,tFirstDelta:null,tFirstPaint:null,tComplete:null,reason:'Two pre-submit startup timeouts; stopped per AGENTS.md §5'},statistics:{sampleSize:1,p50TTFTMs:provider.records.find(r=>r.stream)?.ttftMs,p95:null,reliableP95:false,scope:'One direct API streaming sample; no native UI samples'}});
write('stop-verification',{status:'NOT_VERIFIED',reason:'Native Composer unreachable before timeout; Stop never clicked',uiFeedbackMs:null,interruptAckMs:null,runtimeInterrupted:null,providerConnectionTerminated:null,lateDeltaObservation:null});
write('vision-verification',{api:vision,nativeUi:{status:'NOT_VERIFIED',reason:'Electron startup gate failed; native attachment/submit not executed',imagePayloadIntoRequestedModel:'NOT_VERIFIED',auxiliaryVisionQualification:false},scope:'Provider Vision Probe only; not A-02-03'});
const defaultFiles=fs.readdirSync('.artifacts/p522-host-a02-01-default/assets').filter(file=>/\.(js|css)$/.test(file));
const forbidden=['ca-host-shell','virtual:careeradapt-host/navigation','UNKNOWN：请求执行结果未知'];
const defaultHits=defaultFiles.flatMap(file=>{const text=fs.readFileSync(`.artifacts/p522-host-a02-01-default/assets/${file}`,'utf8');return forbidden.filter(marker=>text.includes(marker)).map(marker=>({file,marker}));});
write('default-build-verification',{status:defaultHits.length?'FAIL':'PASS',optIn:false,reliabilityFlag:true,careerPatchesApplied:false,assetsScanned:defaultFiles.length,hits:defaultHits,uiInteraction:'NOT_VERIFIED; one screenshot font-load timeout; original failure preserved in default/'});
if(defaultHits.length)throw Error('Career patches leaked into default build');
write('test-results',{status:'PARTIAL',checks:[
  {command:'pnpm typecheck',phase:'before/after changes',exitCode:0},
  {command:'node --test tests/p522-host-a02-01-patches.test.mjs',exitCode:0,tests:3},
  {command:'node scripts/p522-host-a02-01-faults.mjs',exitCode:0,cases:10},
  {command:'node <locked Hermes>/node_modules/vitest/vitest.mjs run --project ui src/app/session/hooks/use-message-stream/stream-flush.test.tsx src/app/session/hooks/use-message-stream/terminal-error-frame.test.tsx src/app/session/hooks/use-prompt-actions/resolve-target-session.test.ts',cwd:'<locked Hermes>/apps/desktop',exitCode:0,files:3,tests:12},
  {command:'node scripts/p522-host-a02-01-provider.mjs',exitCode:0,requests:3},
  {command:'node scripts/p522-host-a02-01-provider.mjs --vision',exitCode:0,requests:1},
  {command:'node scripts/p522-host-a01-renderer.mjs --careeradapt --reliability --build --evidence-dir='+out+' --build-dir=.artifacts/p522-host-a02-01-renderer',exitCode:0},
  {command:'node scripts/p522-host-a01-renderer.mjs --reliability --build --evidence-dir='+out+'/default --build-dir=.artifacts/p522-host-a02-01-default',exitCode:0},
  {command:'node scripts/p522-host-a01-native-typecheck.mjs --evidence-dir='+out,exitCode:0,baselineDiagnostics:0,integratedDiagnostics:0},
  {command:'pnpm exec eslint scripts/p522-host-a02-01-*.mjs scripts/p522-host-a01-renderer.mjs scripts/p522-host-a01-native-typecheck.mjs scripts/p522-host-a01-fallback.mjs tests/p522-host-a02-01-patches.test.mjs --max-warnings=0',exitCode:0},
  {command:'git diff --check',exitCode:0},
  {command:'node scripts/p522-host-a02-01-electron.mjs',attempts:2,exitCodes:[1,1],completedTurns:0},
  {command:'node scripts/p522-host-a01-fallback.mjs --renderer=http://127.0.0.1:5191 --evidence-dir='+out+'/default',attempts:1,exitCode:1,reason:'screenshot waited for fonts; no functional PASS'}
],notRun:['full historical unit/E2E','PDF/C1/C2','installer','native image UI after startup gate','real tool chain'],warnings:['Inherited CSS parsing warning and large-barrel/chunk warnings in both builds; no threshold changes']});
write('failure-record',{status:'OPEN_GATE',failures:[
  {stage:'fixture initial',reason:'VM lacked URL/Error globals; fixed harness, original fault-failure JSON retained'},
  {stage:'initial lint',reason:'Next module variable rule; renamed fixture variable, final lint passed'},
  {stage:'Career Electron attempt 1',run:1793849641525,reason:'All readiness waits rejected before UI; no screenshot available'},
  {stage:'Career Electron attempt 2',run:1793849730015,reason:'Native backend ready wait timed out, screenshot shows offline/onboarding; root cause NOT_ESTABLISHED'},
  {stage:'default Electron',run:1793849951907,reason:'Screenshot font-load timeout before interaction assertions'},
],stoppedAfterTwoCareerTimeouts:true,notQualified:['native UI streaming/multi-turn/Stop/late-delta handling','native image selection/staging/provider payload','native auth/429/timeout/error recovery','default shell interaction regression'],noProviderRateLimitObserved:true,noMainPreloadPythonChanges:true});
// Enumerate only this delivery, never include local credentials or runtime homes.
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const file=path.join(dir,entry.name);return entry.isDirectory()?walk(file):[file];});}
const files=[...walk(out),...fs.readdirSync('scripts').filter(f=>f.startsWith('p522-host-a02-01-')).map(f=>'scripts/'+f),'scripts/p522-host-a01-renderer.mjs','scripts/p522-host-a01-native-typecheck.mjs','scripts/p522-host-a01-fallback.mjs','tests/p522-host-a02-01-patches.test.mjs','docs/architecture/p5.2.2-host-a02-01-openrouter-runtime-reliability.md'].filter(file=>!file.endsWith('delivery-manifest.json'));
const credential=read('.artifacts/p522-host-a02-01/provider.local.json').api_key;
if(files.some(file=>fs.readFileSync(file).includes(Buffer.from(credential))))throw Error('Credential leak in delivery');
write('delivery-manifest',{date:'2026-11-05',timezone:'Asia/Shanghai',status:'PARTIAL_NOT_COMPLETE',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),committed:false,pushed:false,excluded:['provider.local.json','all .artifacts runtime homes/build output','ignored plan4.md/history4.md'],files:files.map(file=>({path:file.replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:hash(fs.readFileSync(file))}))});
console.log(JSON.stringify({status:'PARTIAL_NOT_COMPLETE',deliveryFiles:files.length,protectedChecks:checks.length,credentialLeak:false}));
