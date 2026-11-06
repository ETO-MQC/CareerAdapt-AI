import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {out,root,host,sha,write,git,config,files,clean} from './p522-host-a02-03-common.mjs';
const read=(f,fallback={status:'NOT_VERIFIED'})=>fs.existsSync(`${out}/${f}.json`)?JSON.parse(fs.readFileSync(`${out}/${f}.json`,'utf8')):fallback;
const round2=read('provider-payload-round2',{records:[]}),round3=read('provider-payload-ledger',{records:[]});
const payloads=[...round2.records,...round3.records].filter((r,i,a)=>a.findIndex(x=>x.at===r.at)===i);
write('provider-payload-ledger',{status:'PARTIAL',method:'Test-only transparent observer forwards to unchanged configured upstream; no retries. Native request dumping disabled.',rawBase64Saved:false,headersSaved:false,records:payloads});
const image=read('third/image-routing-ledger'),picker=read('third/image-picker-third-verification');
const txt=read('model-understanding-ledger');
const imagePayloads=payloads.filter(r=>r.messages?.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));
write('image-routing-ledger',{status:image.correct?'NATIVE_EVIDENCE_PASS_PREREQUISITE_PARTIAL':'PARTIAL',native:image,providerPayloads:imagePayloads,autoAndText:read('image-routing-local'),auxiliaryProvider:false,textModeRealVision:'NOT_VERIFIED_NO_AUXILIARY_PROVIDER_CONFIGURED'});
write('model-understanding-ledger',{status:'PARTIAL',prerequisite:read('prerequisite-verification').status,fullQualification:false,records:[...(txt.records??[]).filter(r=>r.sample==='sample.txt'),{sample:'clipboard/image.png',correct:image.correct??false,expected:image.expected,answer:image.answer,actualImagePayload:imagePayloads.length>0}],pdf:'BLOCKED_A02_02_L4'});
const staged=read('attachment-staging-ledger');
const third=read('third/targeted-third-round');
write('attachment-staging-ledger',{...staged,thirdRound:third,localRemoteMock:read('upload-function-local')});
const oldPicker=read('image-picker-verification');
write('image-picker-verification',{round2:oldPicker.round2??oldPicker,round3:picker,status:picker.status??'NOT_VERIFIED',fullQualification:false});
const actualThird=read('third/interaction-verification');
write('session-binding-ledger',{round2:read('session-binding-ledger').round2??read('session-binding-ledger'),thirdRpc:actualThird.rpc?.filter(r=>/^(file|image)\.|prompt.submit/.test(r.method)),crossSession:'NOT_VERIFIED'});
write('session-isolation-verification',read('third/session-isolation-verification'));
write('upload-failure-verification',{status:'FAIL_WRONG_PREFIX_FIXED_L2_ELECTRON_PENDING',actualRpc:actualThird.rpc?.filter(r=>r.method==='file.attach'),failure:read('failure-record').pathResolutionDefect,patch:read('attachment-path-patch'),resolver:read('path-resolution-verification'),retry:read('upload-function-local')});
write('cancellation-verification',{status:'PARTIAL',removedPdfBeforeSubmit:true,removedClipboardChip:true,remoteBytesErased:false,note:'Chip removal prevents selected reference submission; ordinary staged files remain on disk. No remote erase claim.',duringUploadRace:'UNIT_ONLY',nativeDialogCancel:'NOT_INDEPENDENTLY_OBSERVED',unknownProtection:'10 deterministic transport scenarios passed; not server idempotence'});
const previousPerformance=read('performance-verification');
write('performance-verification',{smallFiles:previousPerformance.smallFiles??previousPerformance,nativeBoundary:read('third/performance-boundary-verification'),localBoundary:read('performance-boundary-local'),actualImageAttachMs:actualThird.rpc?.filter(r=>r.method==='image.attach').map(r=>r.ackAt-r.at),upstreamImageRequestMs:imagePayloads.map(r=>r.completedAt-r.at),fullLifecycleRssPeak:'NOT_QUALIFIED',providerLargeFileTest:false});
const providerConfig=read('provider-config-verification');
write('provider-config-verification',{...providerConfig,returnedModelIds:[...new Set(payloads.map(r=>r.returnedModel).filter(Boolean))],imageReturnedModel:'NOT_OBSERVED',nativeTestConnection:'Loopback transparent observer forwarding to configured upstream; no alternative Provider'});
write('test-results',{status:'PARTIAL_NOT_ALL_GATES_PASS',checks:[
 {command:'pnpm typecheck',exitCode:0,scope:'Before and after'},
 {command:'native vitest --project ui composer/store/actions/attachments/prompt-actions/draft (5 files)',exitCode:0,passed:121},
 {command:'python -m pytest tests/test_tui_gateway_server.py -k "file_attach or image_attach or pdf_attach"',exitCode:0,passed:16,deselected:448},
 {command:'python -m pytest tests/agent/test_context_references.py tests/agent/test_image_routing.py',exitCode:1,passed:121,failed:8,failures:['test_blocks_sensitive_home_and_hermes_paths (Windows HOME test uses HOME while Path.home uses USERPROFILE)','7 TestExtractImageRefs absolute/home path cases (POSIX extraction regex versus Windows paths)'],upstreamModified:false},
 {command:'native vitest --project electron hardening.test.ts wsl-clipboard-image.test.ts',exitCode:0,passed:22,policyDeviation:'Existing hardening tests recursively removed their own temporary directories; see failure-record.json. Not compliant with no-delete instruction.'},
 {command:'python scripts/p522-host-a02-03-local.py',exitCode:0,contextCases:10},
 {command:'node scripts/p522-host-a02-03-upload-test.mjs',exitCode:0,scope:'MOCK_ONLY_L2 4 routes/read failure/explicit retry'},
 {command:'image routing decision matrix',exitCode:0,cases:6,scope:'MOCK_ONLY_L2; no auxiliary Provider'},
 {command:'node scripts/p522-host-a01-renderer.mjs --careeradapt --reliability --build --evidence-dir=.../renderer-build --build-dir=.artifacts/p522-host-a02-03/renderer-build',exitCode:0,warnings:'Existing CSS delimiter, barrel and large chunk warnings'},
 {command:'node scripts/p522-host-a01-native-typecheck.mjs --evidence-dir=.../renderer-build',exitCode:0,baseline:0,integrated:0,introduced:0},
 {command:'node scripts/p522-host-a02-01-faults.mjs --evidence-dir=.../unknown-regression',exitCode:0,cases:10},
 {command:'pnpm exec eslint scripts/p522-host-a02-03-*.mjs',exitCode:0},
 {command:'git diff --check',exitCode:0},
 {command:'node scripts/p522-host-a02-03-boundary.mjs',exitCode:0,cases:3,scope:'MOCK_ONLY_L2 exact Main validation and actual 16 MiB boundary files'},
 {command:'Opt-in attachment path patch',status:'UNIT_AND_BUILD_PASS_ELECTRON_NOT_REVERIFIED',scope:'--careeradapt --attachments only; exact locked source SHA'},
 {command:'optIn=false default Shell regression',status:'DEFAULT_BUILD_PASS_RUNTIME_NOT_REVERIFIED',reason:'Integration plugin absent in default build; three Electron rounds exhausted'}
 ]});
const baseline=read('baseline');
const checks=baseline.checks.map(c=>({...c,actual:sha(fs.readFileSync(path.join(host,c.path)))}));
const history=baseline.history.map(f=>({...f,finalSha256:sha(fs.readFileSync(f.file)),unchanged:f.sha256===sha(fs.readFileSync(f.file))}));
const audit=read('source-audit').files.map(f=>({...f,finalSha256:sha(fs.readFileSync(path.join(host,f.path)))}));
assert.ok(checks.every(c=>c.expected===c.actual));assert.ok(history.every(f=>f.unchanged));assert.ok(audit.every(f=>f.sha256===f.finalSha256));
assert.equal(sha(fs.readFileSync(baseline.main.file)),baseline.main.sha256);
write('final-protection-verification',{status:'SOURCE_AND_HISTORY_PROTECTION_PASS_NO_DELETE_POLICY_FAILED',checks,history,attachmentSourceChecks:audit,mainArtifactUnchanged:true,hermesHead:git('-C',host,'rev-parse','HEAD'),worktrees:git('worktree','list'),providerConfigIgnored:Boolean(git('check-ignore','artifacts/p522-host-a02-01/provider.local.json')),productionChanges:[],deletionPolicyDeviation:read('failure-record').deletionPolicyDeviation,commit:'Not committed or pushed'});
// Normalize and sanitize only this task's new text evidence before final scanning.
for(const file of files(out).filter(f=>/\.(json|jsonl|txt)$/.test(f))){const raw=fs.readFileSync(file,'utf8');let value;try{value=JSON.stringify(clean(JSON.parse(raw)),null,2)+'\n';}catch{value=clean(raw);}fs.writeFileSync(file,value);}
const scanned=files(out),leaks=scanned.filter(f=>fs.readFileSync(f).includes(Buffer.from(config.api_key)));assert.deepEqual(leaks,[]);
const textLeaks=scanned.filter(f=>/\.(json|jsonl|txt)$/.test(f)&&/data:image\/[\w+.-]+;base64,[A-Za-z0-9+/]{100,}/.test(fs.readFileSync(f,'utf8')));assert.deepEqual(textLeaks,[]);
const credentials=files(root).filter(f=>path.basename(f)==='config.yaml').map(file=>({file,retained:true,containsCredential:fs.readFileSync(file).includes(Buffer.from(config.api_key))}));assert.ok(credentials.every(c=>!c.containsCredential));
write('credential-audit',{status:'PASS',filesScanned:scanned.length,keyMatches:0,rawImageBase64EvidenceMatches:0,isolatedConfigs:credentials,sourceConfigUnchangedAndIgnored:true});
const report='docs/architecture/p5.2.2-host-a02-03-native-attachment-pipeline.md';
write('delivery-manifest',{status:'PARTIAL',commit:git('rev-parse','HEAD'),submitted:false,pushed:false,files:[...files(out).filter(f=>!f.endsWith('delivery-manifest.json')),report,...files('scripts').filter(f=>/p522-host-a02-03/.test(f))].filter(f=>fs.existsSync(f)).map(file=>({path:file,sha256:sha(fs.readFileSync(file))})),deletionPolicySatisfied:false});
console.log(JSON.stringify({status:'PARTIAL',protected:checks.length,historyManifests:history.length,imagePayloads:imagePayloads.length,txtCorrect:txt.records?.[0]?.correct,imageCorrect:image.correct??false,secretMatches:0}));
