import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

// Read-only qualification of the existing boundary. No Host patch, provider,
// real home/database access, deletion, or automatic retry.
const out='docs/architecture/evidence/p522-a05-native-career';
const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const write=(name,value)=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2)+'\n');};
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const read=(file,locked=false)=>{
 const absolute=locked?path.join(host,file):file,raw=fs.readFileSync(absolute),text=raw.toString('utf8');
 return {file:(locked?'LOCKED_HERMES/':'')+file,sha256:sha(raw),lines:text.split(/\r?\n/).length,
  anchors:text.split(/\r?\n/).flatMap((line,i)=>/FULL app authority|capability boundary|setPluginEnabled|handle.deactivate|rest:|register_tool|def dispatch|entry.handler|run_tool_execution_middleware|session_id=session_id|tool_call_id=tool_call_id|class ProfileReadAdapter|agentAttachmentStore|import\(|READY|BLOCKED|PARTIAL|PASS_SYNTHETIC|NOT VERIFIED/.test(line)?[{line:i+1,text:line.trim().slice(0,350)}]:[])};
};
if(process.argv.includes('--baseline')){
 const tracked=git('ls-files','-z').split('\0').filter(Boolean);
 const source=['apps/desktop/src/contrib/runtime-loader.ts','apps/desktop/src/contrib/plugin.ts','apps/desktop/src/sdk/runtime.ts','apps/desktop/src/sdk/index.ts','apps/desktop/src/contrib/plugins-store.ts','hermes_cli/plugins.py','hermes_cli/middleware.py','model_tools.py','tools/registry.py','apps/desktop/electron/main.ts','apps/desktop/electron/preload.ts','pyproject.toml','apps/desktop/package.json'];
 const project=['AGENTS.md','plan4.md','history4.md','docs/architecture/p5.2.2-a03-career-domain-readiness.md','docs/architecture/execution-records/20261106-1517-P5.2.2-A03-readiness-execution-record.md','docs/architecture/p5.2.2-a04-profile-readonly-vertical-slice.md','docs/architecture/execution-records/20261106-1740-P5.2.2-A04-execution-record.md',
  ...['openrouter-runtime-reliability','native-tool-activity','native-attachment-pipeline','native-session-persistence','native-artifact-lifecycle'].map((suffix,i)=>`docs/architecture/p5.2.2-host-a02-0${i+1}-${suffix}.md`),
  'docs/architecture/p5.2.2-host-a02-01r-backend-ready-closeout.md',
  ...['ProfileReadAdapter','CareerToolGateway','registry','careerToolContract'].map(n=>`src/agent/tools/${n}.ts`),
  'src/services/profile/profileReadPort.ts','src/services/profile/profileQueryService.ts','src/services/storage/repositories.ts','src/services/agent/agentToolService.ts','src/agent/runtime/hermes/HermesCareerToolCatalog.ts','src/agent/workflows/CareerWorkflowFacade.ts',
  'scripts/p522-host-a01-renderer.mjs','scripts/p522-host-a02-01-patches.mjs','scripts/p522-host-a02-04-patches.mjs','scripts/hermes-runtime-lock.json',
  ...walk('poc/host-a01'),...walk('poc/host-transport'),...walk('poc/host-experience'),
  ...walk('docs/architecture/evidence/p522-a04-profile-read'),
  ...['dependency-matrix','production-write-gate','test-plan'].map(n=>`docs/architecture/evidence/p522-a03-readiness/${n}.json`)];
 const refs=[...new Set(project)].map(f=>read(f));
 const locked=source.map(f=>read(f,true));
 const historical=JSON.parse(fs.readFileSync('docs/architecture/evidence/p522-host-a02-05/baseline.json','utf8')).checks;
 const checks=historical.map(c=>({file:c.path,expected:c.sha256,actual:sha(fs.readFileSync(path.join(host,c.path)))}));
 if(checks.some(c=>c.expected!==c.actual))throw Error('Historical locked source changed');
 const head=git('-C',host,'rev-parse','HEAD');
 if(head!=='eb52760564dbba2e5971fa54bd67384e281cd3b8')throw Error('Locked SHA changed');
 write('baseline',{at:new Date().toISOString(),head:git('rev-parse','HEAD'),origin:git('rev-parse','origin/main'),fetch:{command:'git fetch origin',exitCode:0,performedBeforeAudit:true},statusBeforeAudit:git('status','--short','--branch'),log:git('log','-10','--oneline'),worktrees:git('worktree','list','--porcelain'),diffCheck:git('diff','--check'),hermesHead:head,hermesStatus:git('-C',host,'status','--short'),runtimeVersion:'0.19.0',desktopVersion:JSON.parse(fs.readFileSync(path.join(host,'apps/desktop/package.json'),'utf8')).version,checks,lockedSources:locked,tracked:tracked.map(file=>({file,sha256:sha(fs.readFileSync(file))})),historicalManifests:walk('docs/architecture/evidence').filter(f=>f.endsWith('delivery-manifest.json')&&!f.includes('p522-a05-native-career')).map(file=>({file,sha256:sha(fs.readFileSync(file))}))});
 write('source-review',{method:'Current file bytes read; selected source anchors recorded. Source review is not native execution evidence.',files:refs});
 console.log(JSON.stringify({lockedSources:locked.length,referenceFiles:refs.length,historicalProtectedSources:checks.length,tracked:tracked.length}));
}
if(process.argv.includes('--probe')){
 let requests=0,disposed=0;
 const server=http.createServer((req,res)=>{requests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({synthetic:true,request:requests,path:req.url}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 const values=new Map();
 const atom=value=>({get:()=>value,set:v=>{value=v;}});
 const load=(file,mocks)=>{
  const source=fs.readFileSync(path.join(host,file),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  vm.runInNewContext(js,{exports,require:id=>{if(!(id in mocks))throw Error('Unexpected import '+id);return mocks[id];},window:{localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}},console},{filename:file});
  return exports;
 };
 try{
  const store=load('apps/desktop/src/contrib/plugins-store.ts',{'nanostores':{atom}});
  const sdk=load('apps/desktop/src/contrib/plugin.ts',{
   '@/hermes':{pluginRest:async(id,p)=>{const r=await fetch(`http://127.0.0.1:${port}/api/plugins/${id}${p}`);return r.json();},pluginSocket:()=>()=>{}},
   '@/i18n':{createPluginI18n:()=>({})},'@/lib/storage':{readKey:()=>null,writeKey:()=>{}},
   './registry':{registry:{register:()=>()=>{disposed++;},registerMany:()=>()=>{disposed++;}}}
  });
  const disposers=[],ctx=sdk.createPluginContext('a05-boundary-probe',d=>disposers.push(d));
  ctx.register({id:'probe',area:'routes',value:{}});
  store.publishPlugin({id:'a05-boundary-probe',name:'Synthetic probe',kind:'runtime',status:'loaded'},{activate:()=>{},deactivate:()=>disposers.forEach(d=>d())});
  const retained=ctx.rest;
  await retained('/read');
  await store.setPluginEnabled('a05-boundary-probe',false);
  const disabled=store.$pluginRecords.get()['a05-boundary-probe'].status;
  const after=await retained('/read');
  if(disabled!=='disabled'||disposed!==1||requests!==2||after.request!==2)throw Error('Boundary reproduction changed');
  write('disable-closure-probe',{status:'REPRODUCED_MISSING_BACKEND_REVOCATION',level:'CURRENT_LOCKED_FUNCTIONS_VM_WITH_REAL_LOOPBACK_HTTP_NOT_ELECTRON',method:'TypeScript transpilation of complete locked plugin.ts and plugins-store.ts; mocked dependencies explicitly listed; existing setPluginEnabled/createPluginContext bodies execute unchanged.',mocks:['nanostores atom','registry contribution disposer','storage','i18n','pluginRest transport to synthetic loopback server','window.localStorage'],disabledStatus:disabled,disposals:disposed,requestsBeforeDisable:1,requestsAfterDisable:1,totalRequests:requests,retainedClosureDeliveredAfterDisable:true,careerAdapterInvocations:0,realProfileReads:0,conclusion:'Disposal is not a backend grant invalidation. This probe is neither a real Career Tool Call nor proof that an extension cannot implement a new synthetic broker.'});
  console.log('CURRENT_LOCKED_DISABLE_CLOSURE_REPRODUCED');
 }finally{await new Promise(resolve=>server.close(resolve));}
}
if(process.argv.includes('--repair-handoff')){
 for(const [file,title] of [['plan4.md',' Plan 4：'],['history4.md',' History 4：']]){
  const text=fs.readFileSync(file,'utf8'),titleAt=text.indexOf(title);
  if(!text.startsWith('### 2026-11-06 A-05 D3：')||titleAt<0)throw Error('Unexpected handoff repair input');
  const inserted=text.slice(1,titleAt),rest='#'+text.slice(titleAt),separator=/\r?\n\r?\n/.exec(rest);
  if(!separator)throw Error('Missing original title separator');
  const at=separator.index+separator[0].length;
  fs.writeFileSync(file,rest.slice(0,at)+inserted+rest.slice(at));
 }
}
if(process.argv.includes('--deliver')){
 const baseline=JSON.parse(fs.readFileSync(`${out}/baseline.json`,'utf8'));
 const graph=new Map(),edges=[],external=new Set(),unresolved=[];
 function visit(file){
  if(graph.has(file))return;
  graph.set(file,sha(fs.readFileSync(file)));
  const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  function dependency(spec,kind){
   if(!spec.startsWith('.')&&!spec.startsWith('@/')){external.add(spec);edges.push({from:file,to:spec,kind,external:true});return;}
   const base=spec.startsWith('@/')?path.join('src',spec.slice(2)):path.join(path.dirname(file),spec);
   const target=[base,base+'.ts',base+'.tsx',base+'.js',path.join(base,'index.ts'),path.join(base,'index.tsx')].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
   if(!target){unresolved.push({from:file,spec,kind});return;}
   const normalized=target.replaceAll('\\','/');edges.push({from:file,to:normalized,kind});visit(normalized);
  }
  function node(n){
   if(ts.isImportDeclaration(n)&&!n.importClause?.isTypeOnly&&ts.isStringLiteral(n.moduleSpecifier)){
    const bindings=n.importClause?.namedBindings;
    const allTypeOnly=bindings&&ts.isNamedImports(bindings)&&bindings.elements.length>0&&bindings.elements.every(e=>e.isTypeOnly)&&!n.importClause?.name;
    if(!allTypeOnly)dependency(n.moduleSpecifier.text,'static-import');
   }
   if(ts.isExportDeclaration(n)&&!n.isTypeOnly&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))dependency(n.moduleSpecifier.text,'export');
   if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword){
    if(n.arguments.length===1&&ts.isStringLiteral(n.arguments[0]))dependency(n.arguments[0].text,'dynamic-import');
    else unresolved.push({from:file,expression:n.getText(ast),kind:'nonliteral-dynamic-import'});
   }
   ts.forEachChild(n,node);
  }node(ast);
 }
 visit('src/agent/tools/ProfileReadAdapter.ts');
 write('dependency-boundary-audit',{status:'BLOCKED_CURRENT_ADAPTER_GRAPH_CONTAINS_DEXIE',method:'Current TypeScript AST runtime imports/exports and literal dynamic imports; type-only imports excluded. Nonliteral/unresolved edges explicitly retained.',root:'src/agent/tools/ProfileReadAdapter.ts',files:[...graph].map(([file,sha256])=>({file,sha256})),edges,external:[...external].sort(),unresolved,containsDexie:external.has('dexie'),containsRepository:graph.has('src/services/storage/repositories.ts'),pluginBundleBuilt:false,proposal:'Keep this entire graph application-side; only serialize strict inputs/results across a narrow bridge. No existing dependency removed or excluded to claim PASS.'});
 write('integration-architecture',{status:'PROPOSED_NOT_IMPLEMENTED',decision:'ADR A05-01 option B awaiting review',actual:'Native Host still has fixtures; A04 Adapter has no native composition root.',nativeRegistration:'hermes_cli.plugins.PluginContext.register_tool -> tools.registry; Desktop ctx.register is UI-only',context:'model_tools.handle_function_call -> run_tool_execution_middleware supplies session_id/tool_call_id/turn_id',proposed:['Native Python plugin','narrow invocation bridge','application-side ProfileReadAdapter','existing CareerToolGateway and Registry','ProfileQueryService','same WorkspaceRepository'],authority:'Main control broker proposed; synthetic-only initial implementation; not production issuer',mainPreloadCoreModified:false});
 const units=JSON.parse(fs.readFileSync(`${out}/unit-results.json`,'utf8'));
 const unitEvidence={status:'PASS_SYNTHETIC_CURRENT_ROUND',tests:units.numPassedTests,files:units.numPassedTestSuites,evidence:'unit-results.json',nativeHostExecuted:false};
 write('authority-broker-verification',{status:'NOT_IMPLEMENTED',existingAdapterRegression:unitEvidence,required:['workspace/repository binding','person/profile/session','grantId/epoch/expiry/enabled','per-call and pre-delivery recheck','backend disable and in-flight revocation'],productionIssuer:false});
 const cases={
  'native-tool-registration':['career.profile.get','career.profile.search_facts','strict model-only filters','opt-in allowlist'],
  'native-tool-execution':['real Electron native model tool call','schema -> Adapter -> Gateway -> QueryService -> Repository','tool_call_id/result association','model response grounded in tool result','Tool Activity and Session persistence','synthetic A/B unique undisclosed markers','empty/error/no demo fallback'],
  'streaming-verification':['ordered native delta/tool call/tool result/follow-up delta/terminal','Session and call ID correlation'],
  'stop-verification':['Stop during generation','Stop during handler','Stop after result before final answer','late result discarded','no automatic reexecution','other Session unaffected'],
  'history-recovery':['tool history reload','Electron/backend restart','completed/failed/UNKNOWN do not replay','A/B histories isolated'],
  'unknown-lost-ack-verification':['server accepted','actual Adapter executed once','durable qualification ledger','ACK deliberately dropped','Host UNKNOWN','Electron and backend restart','query original operationId','no provider/model change','no resubmit/history reexecution'],
  'session-isolation':['Session A -> Profile A','Session B -> Profile B','result/activity/history isolation'],
  'optin-isolation':['false: no tools/grant/profile request/default Shell changes','true: exactly two read-only tools on synthetic data']
 };
 for(const [name,required] of Object.entries(cases))write(name,{status:'NOT_VERIFIED',reason:'Stopped before implementation for selected Main/Preload architecture review under user attachment A2.',nativeLaunches:0,cases:required.map(name=>({name,status:'NOT_RUN'})),historicalResultsDoNotSatisfyThisRound:true});
 write('revoke-verification',{status:'BLOCKED',currentProbe:'disable-closure-probe.json',probeLevel:'LOCKED_FUNCTIONS_VM_LOOPBACK_NOT_ELECTRON',backendCareerGrantImplemented:false,required:['disable rejects captured closure','epoch/session/profile switch invalidates old grant','expiry invalidates','in-flight delivery discarded'],existingSyntheticAdapterTests:unitEvidence});
 write('handler-ledger',{status:'NOT_VERIFIED',records:[],actualCareerHandlerExecutionsThisRound:0,scope:'No native Career execution happened. This empty audit declaration is not a durable operation ledger or exactly-once evidence.'});
 write('provider-qualification',{status:'NOT_RUN',realProviderRequests:0,localModelTransportRequests:0,credentialsRead:false,providerOrModelSwitches:0,reason:'Architecture gate reached before provider qualification; no retries or fallback.',next:'Use bounded deterministic local model transport first; extra real Provider calls require capability/budget confirmation.'});
 const svc='src/services/agent/agentToolService.ts',repo='src/services/storage/repositories.ts',facade='src/agent/workflows/CareerWorkflowFacade.ts',tail='src/services/jobs/tailoringService.ts',cmd='src/services/jobs/tailoringCommands.ts';
 const rows=[
  ['Profile','get',[svc,'src/services/profile/profileQueryService.ts'],'career.profile.get',null,'read',false,'D3/D4','p522-a04-profile-read'],
  ['Profile','search_facts',[svc,'src/services/profile/profileQueryService.ts'],'career.profile.search_facts',null,'read',false,'D3/D4','p522-a04-profile-adapter'],
  ['Profile','intake',[svc,repo],'career.profile.capture_intake','career.workflow.profile_intake_turn','provisional-write',false,'D7','guidedProfileIntake'],
  ['Profile','reconciliation',[svc,repo],'career.profile.reconcile_intake','career.workflow.profile_intake_finalize','draft-write',false,'D7','profileReconciliation'],
  ['Profile','confirmed commit',[svc,repo],'career.profile.commit_intake',null,'formal-write',true,'D6','guidedProfileIntakeRepository'],
  ['Resume','list',[svc,repo],'career.resume.list',null,'read',false,'D5','agentBranchIsolation'],
  ['Resume','get',[svc,repo],'career.resume.get',null,'read',false,'D5','agentBranchIsolation'],
  ['Resume','revision',[svc,repo],'career.resume.get_revision',null,'read',false,'D5','repositoryTailoring'],
  ['Resume','branch',[svc,repo],'career.resume.create_job_from_profile','career.workflow.tailor_resume','branch-write',true,'D6','branch'],
  ['Resume','preview',[svc,'src/domain/resumeDocument/mapper.ts','src/domain/resumePresentation/projector.ts'],'career.export.resume','career.workflow.resume_export','derived-artifact-write',true,'D5','export'],
  ['Resume','export',[svc,'src/domain/resumePresentation/projector.ts'],'career.export.resume','career.workflow.resume_export','derived-artifact-write',true,'D5','export'],
  ['Job','list',[svc,repo],'career.job.list',null,'read',false,'D5','jobWorkflow'],
  ['Job','get',[svc,repo],'career.job.get',null,'read',false,'D5','jobWorkflow'],
  ['Job','JD parsing',[svc,'src/services/jobs/jobWorkflow.ts'],'career.job.parse','career.workflow.job_intake','draft-write (facade analyze_only is pure analysis)',false,'D5','jobWorkflow'],
  ['Job','requirement graph',['src/services/jobs/jobWorkflow.ts',svc],'career.job.parse','career.workflow.job_intake','analysis/draft; no dedicated graph tool',false,'D5','jobWorkflow'],
  ['Job','job analysis',[svc,'src/services/jobs/jobWorkflow.ts'],'career.job.analyze_fit','career.workflow.job_fit','analysis/fit-artifact; no Profile/Resume content write',false,'D5','jobWorkflow'],
  ['Career Intelligence','profile/job context',[svc,'src/domain/careerContext/retrieveCareerContext.ts'],'career.context.retrieve',null,'read',false,'D5','p45c1c15-career-context-binding'],
  ['Career Intelligence','requirement matching',[svc,'src/domain/jobOptimization/matching.ts'],'career.job.analyze_fit','career.workflow.job_fit','analysis/fit-artifact',false,'D5','matcher'],
  ['Career Intelligence','capability coverage',[svc,'src/domain/jobOptimization/v2/coverage.ts'],'career.job.analyze_fit','career.workflow.job_fit','analysis/fit-artifact',false,'D5','tailoringEngineV2'],
  ['Career Intelligence','match scoring',[svc,'src/domain/jobOptimization/v2/analyze.ts'],'career.job.analyze_fit','career.workflow.job_fit','analysis/fit-artifact',false,'D5','matcher'],
  ['Career Intelligence','evidence explanation',[svc,'src/domain/jobOptimization/v2/evidence.ts'],'career.job.analyze_fit','career.workflow.job_fit','analysis/fit-artifact',false,'D5','tailoringEngineV2'],
  ['Tailoring','create session',[svc,tail,cmd],'career.tailoring.create_session','career.workflow.tailor_resume','session/draft-write',false,'D7','tailoringCommands'],
  ['Tailoring','question plan',[tail],'career.tailoring.create_session','career.workflow.tailor_resume','session/draft-write; no standalone plan tool',false,'D7','repositoryTailoringV2'],
  ['Tailoring','answer question',[svc,tail,cmd],'career.tailoring.answer_question','career.workflow.tailor_resume','session/draft-write',false,'D7','tailoringCommands'],
  ['Tailoring','generate diff',[svc,tail,cmd],'career.tailoring.generate_changes','career.workflow.tailor_resume','proposal-write',false,'D7','tailoringDiff'],
  ['Tailoring','review diff',[svc,tail,cmd],'career.tailoring.review_diff','career.workflow.tailor_resume','review-state-write',false,'D7','tailoringCommands'],
  ['Tailoring','preview',[svc,tail,cmd],'career.tailoring.preview_changes','career.workflow.tailor_resume','read/derived-preview',false,'D7','tailoringCommands'],
  ['Tailoring','confirmed apply',[svc,tail,cmd,repo],'career.tailoring.apply_changes','career.workflow.tailor_resume','formal-write',true,'D6/D7','tailoringCommands']
 ];
 const gatewayText=fs.readFileSync('src/agent/tools/CareerToolGateway.ts','utf8'),facadeText=fs.readFileSync(facade,'utf8'),testFiles=walk('tests/unit');
 const inventory=rows.map(([domain,capability,sources,tool,workflow,kind,confirmation,stage,test])=>{
  for(const file of sources)if(!fs.existsSync(file))throw Error('Inventory missing source '+file);
  if(!gatewayText.includes(`name: "${tool}"`))throw Error('Inventory tool missing '+tool);
  if(workflow&&!facadeText.includes(`name: "${workflow}"`))throw Error('Inventory facade missing '+workflow);
  return {domain,capability,sources:sources.map(file=>({file,sha256:sha(fs.readFileSync(file))})),existingImplementation:'Existing business path behind listed Gateway mapping; granular Host contract still requires qualification, not implemented this round.',gatewayTool:tool,workflowFacade:workflow,needsNativeAdapter:true,adapterDecision:domain==='Profile'&&['get','search_facts'].includes(capability)?'Reuse A04 Adapter behind new native bridge':'Reuse business implementation; add scoped native adapter after stage approval',readWrite:kind,humanConfirmation:confirmation?'Required at formal mutation/export boundary; production trusted protocol still BLOCKED':'No formal Profile/Resume commit at this step; scope and source review still required',tests:testFiles.filter(f=>path.basename(f).startsWith(test)).map(f=>({file:f,executedThisRound:/p522-a04-profile-(read|adapter)\.test\.ts$/.test(f)})),missingHostEvidence:['native call/result association','scope and backend revocation','Stop/history/no replay','full capability-specific native result and error cases'],stage};
 });
 write('business-capability-inventory',{status:'SOURCE_INVENTORY_ONLY_NOT_IMPLEMENTATION_OR_QUALIFICATION',count:inventory.length,notes:['Preview/export share existing export entry, not an invented preview tool','requirement graph/coverage/scoring/explanation are underlying analysis facets, not separate Gateway tools','D5/D6/D7 mapping is follow-up planning only','Tailoring default question budgets remain mode-dependent; no semantic changes'],items:inventory});
 write('production-authority-gate',{status:'BLOCKED',issuerImplemented:false,syntheticBrokerImplementedThisRound:false,adr:'../../p5.2.2-a05-native-career-authority-adr.md',scope:'D3 review only; no production trust approval'});
 write('production-read-gate',{status:'BLOCKED',D3:'BLOCKED_NOT_QUALIFIED',D4:'NOT_STARTED',productionWrite:'BLOCKED',trustedConfirmation:'BLOCKED',realUserProfileExposed:false});
 write('failure-record',{status:'PRESERVED',failures:[{kind:'CURRENT_BOUNDARY_DEFECT',evidence:'disable-closure-probe.json',detail:'Captured rest closure remains callable after Desktop plugin disable; not actual Career backend failure.'}],toolingErrors:['PowerShell rg literal glob path scripts/p522* rejected; corrected using directory plus -g filters','Guessed tests/unit/profileReadAdapter.test.ts did not exist; used actual p522-a04 tests','Guessed tools/tool_context.py absent; reviewed thread_context.py/approval/middleware instead','PowerShell parameter passed to rg by mistake; corrected search','src/services/resume directory absent; used actual service and domain paths','Initial handoff insertion assumed LF and split CRLF title after first character; repaired exact inserted segment, preserving original title/body, then made insertion CRLF-aware and checked saved headings'],nativeFailures:[],nativeRuns:0,historicalEvidenceOverwritten:false});
 const record='docs/architecture/execution-records/20261106-1930-P5.2.2-A05-execution-record.md';
 fs.writeFileSync(record,`# P5.2.2-A05 执行记录\n\n日期：2026-11-06（Asia/Shanghai）。D3 BLOCKED / NOT QUALIFIED，架构审核分支交付。尚未提交、未推送。\n\n## 用户要求与实际范围\n\n用户要求锁定Hermes原生Profile工具与D3可靠性，限定合成数据，不进入D4。附件A2明确若需Main/Preload/Core架构改动先交ADR。实际完成当前边界审查、旧闭包受控复现、既有合成回归、三方案ADR和28项后续业务盘点；没有实现Native桥接，不能宣称D3完成。\n\n## 基线与证据\n\nHEAD/fetch后origin/main=91461b7611229fe43424b86721bbb00f8e46ad68，起始干净；八worktree保留。Hermes SHA=eb52760564dbba2e5971fa54bd67384e281cd3b8，Runtime0.19.0/Desktop0.17.0。97历史锁定源、13重点源、2559 tracked及既有manifest原件纳入保护。baseline/source-review记录当前SHA；全量历史测试不重跑。\n\n## 决策和限制\n\n锁定SDK有Python register_tool/middleware原生关联，无需虚构Host API。Desktop disable只卸载贡献且旧rest closure仍可请求；完整锁定函数体VM+真实loopback复现，非Electron。选定推荐Main授权控制/Preload窄桥、应用侧Adapter/Repository；此方案需要先审核，未落地。并非声称所有测试broker都必须改Core；Renderer-only合成路径作为替代，未实现。\n\n## 验证\n\nnode scripts/p522-a05-boundary-audit.mjs --baseline --probe退出0，当前缺口复现。pnpm typecheck退出0；pnpm exec vitest run tests/unit/p522-a04-profile-read.test.ts tests/unit/p522-a04-profile-adapter.test.ts --reporter=default --reporter=json --outputFile=docs/architecture/evidence/p522-a05-native-career/unit-results.json退出0，两文件31项。changed ESLint、JSON/引用/哈希/diff最终结果见test-results.json。未跑Electron/Provider/build/Native TS/历史Playwright，无Native handler执行，空ledger不算PASS。\n\n## NEXT_CHAT_HANDOFF\n\n先审核p5.2.2-a05-native-career-authority-adr.md方案B（或明确选择方案A合成替代），仅继续D3。完整Native调用/Streaming/Stop/历史/禁用撤权/Executed+LostACK/UNKNOWN/A-B/optIn资格全部未齐；D4生产读、生产写与可信确认BLOCKED。无产品源码/锁定源修改，无删除/数据/密钥/依赖/Schema/表变更。plan4/history4同步本任务状态，历史失败保留，不自动提交推送。\n`);
 const handoff='## 2026-11-06 A-05 D3：BLOCKED / ADR 待审核，未取得原生资格\n\n用户要求仅D3合成Native Profile工具接入与可靠性。main/HEAD/fetch后origin=91461b7，A04已提交，起始干净；八worktree与Hermes eb527605/Runtime0.19.0保留。本轮锁定完整函数体VM+真实loopback复现disable后旧ctx.rest仍请求（非Electron）；Python正式register_tool/middleware具备原生关联，但现有Host未接Profile Adapter/独立授权控制。推荐Main授权控制+Preload窄桥、Repository仍应用侧；依附件A2先交独立ADR审核，未实施，不推断所有合成方案都需Core改动。\n\n当前typecheck和A04两文件31项回归退出0；新增只读审计脚本/报告/证据和28项业务盘点，changed lint/JSON/引用/保护/diff见最终证据。无真实Native Career Call/Streaming/Stop/历史不重执/服务端已执行丢ACK/Handler Ledger/A-B/default运行资格，全部NOT VERIFIED；生产authority/读写/可信确认继续BLOCKED。无Electron/Provider/真实资料/密钥访问/产品源码或锁定源修改/删除/新依赖/新表/提交推送。主报告p5.2.2-a05-native-career-tool-integration.md，独立ADR p5.2.2-a05-native-career-authority-adr.md，证据p522-a05-native-career，执行记录20261106-1930-P5.2.2-A05。下一步用户审核方案B或选择合成替代后仅继续D3；不进D4。尚未提交。\n\n';
 for(const file of ['plan4.md','history4.md']){
  const original=fs.readFileSync(file,'utf8');
  if(!original.includes('## 2026-11-06 A-05 D3：')){const separator=/\r?\n\r?\n/.exec(original);if(!separator)throw Error('Missing handoff title separator');const at=separator.index+separator[0].length;fs.writeFileSync(file,original.slice(0,at)+handoff+original.slice(at));}
 }
 const changed=baseline.tracked.filter(({file,sha256})=>!fs.existsSync(file)||sha(fs.readFileSync(file))!==sha256);
 const lockedChanged=baseline.lockedSources.filter(({file,sha256})=>sha(fs.readFileSync(path.join(host,file.replace('LOCKED_HERMES/',''))))!==sha256);
 const oldManifestChanged=baseline.historicalManifests.filter(({file,sha256})=>sha(fs.readFileSync(file))!==sha256);
 const checksChanged=baseline.checks.filter(c=>sha(fs.readFileSync(path.join(host,c.file)))!==c.actual);
 const worktrees=git('worktree','list','--porcelain');
 write('final-protection-verification',{status:changed.length||lockedChanged.length||oldManifestChanged.length||checksChanged.length||worktrees!==baseline.worktrees?'FAIL':'PASS',head:git('rev-parse','HEAD'),origin:git('rev-parse','origin/main'),trackedFiles:baseline.tracked.length,changedTrackedFiles:changed,changedLockedSources:lockedChanged,changedHistoricalProtectedSources:checksChanged,changedHistoricalManifests:oldManifestChanged,worktreesUnchanged:worktrees===baseline.worktrees,staged:git('diff','--cached','--stat'),noDeletionCommandsExecuted:true,noProductionSourceChanges:true,handoffSaved:['plan4.md','history4.md'].every(f=>fs.readFileSync(f,'utf8').includes(handoff)),mainPreloadCoreModified:false});
 console.log(JSON.stringify({inventory:inventory.length,currentDependencyFiles:graph.size,dexie:external.has('dexie'),unresolved:unresolved.length,record,protectionChanges:changed.length+lockedChanged.length+oldManifestChanged.length+checksChanged.length}));
}
if(process.argv.includes('--seal')){
 const tests={status:'PASS_DIRECTED_AUDIT_ONLY_D3_BLOCKED',commands:[
  {command:'git fetch origin',exitCode:0},
  {command:'node scripts/p522-a05-boundary-audit.mjs --baseline --probe',exitCode:0,result:'97 historical sources unchanged; existing disable closure defect reproduced, not a native qualification PASS'},
  {command:'pnpm typecheck',exitCode:0},
  {command:`pnpm exec vitest run tests/unit/p522-a04-profile-read.test.ts tests/unit/p522-a04-profile-adapter.test.ts --reporter=default --reporter=json --outputFile=${out}/unit-results.json`,exitCode:0,tests:31,files:2,level:'SYNTHETIC_EXISTING_ADAPTER_REGRESSION'},
  {command:'node scripts/p522-a05-boundary-audit.mjs --deliver',exitCode:0,result:'173 runtime dependency files, Dexie present, zero unresolved edges; 28 capability inventory rows; protected file differences zero'},
  {command:'pnpm exec eslint scripts/p522-a05-boundary-audit.mjs --max-warnings=0',exitCode:0},
  {command:'git diff --check',exitCode:0}
 ],notRun:['Native Host/Electron','Native tool registration/execution','local model transport/real Provider','Streaming/Stop/later results','tool history reload/restart/no replay','backend Career disable/in-flight revoke','executed-server lost ACK/operation status recovery','Native Session A/B/opt-in/default Shell','build','Native TypeScript (no Host changes)','all historical Playwright/release gate'],reason:'Selected independent native control architecture requires user review before Main/Preload implementation; neither docs nor existing regression results are D3 qualification.'};
 write('test-results',tests);
 const jsonFiles=walk(out).filter(f=>f.endsWith('.json')&&!f.endsWith('delivery-manifest.json'));
 for(const file of jsonFiles)JSON.parse(fs.readFileSync(file,'utf8'));
 const docs=['docs/architecture/p5.2.2-a05-native-career-tool-integration.md','docs/architecture/p5.2.2-a05-native-career-authority-adr.md','docs/architecture/execution-records/20261106-1930-P5.2.2-A05-execution-record.md'];
 const links=docs.flatMap(file=>[...fs.readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)].filter(m=>!m[1].includes('://')).map(m=>({from:file,target:m[1],exists:fs.existsSync(path.resolve(path.dirname(file),m[1].split('#')[0]))})));
 if(links.some(l=>!l.exists))throw Error('Broken delivery link');
 if(JSON.parse(fs.readFileSync(`${out}/final-protection-verification.json`,'utf8')).status!=='PASS')throw Error('Protection verification failed');
 git('diff','--check');
 const all=[...docs,'scripts/p522-a05-boundary-audit.mjs',...walk(out).filter(f=>!f.endsWith('delivery-manifest.json')),'plan4.md','history4.md'];
 write('delivery-manifest',{status:'ADR_REVIEW_DELIVERY_D3_BLOCKED_NOT_COMPLETE',head:git('rev-parse','HEAD'),notCommitted:true,notPushed:true,linksChecked:links,jsonFilesParsed:jsonFiles.length,files:all.map(file=>({path:file,sha256:sha(fs.readFileSync(file)),localHandoffOnly:['plan4.md','history4.md'].includes(file)})),selfHashOmitted:true,noProductionQualification:true});
 console.log(JSON.stringify({jsonParsed:jsonFiles.length,links:links.length,files:all.length,status:'ADR_REVIEW_DELIVERY_D3_BLOCKED_NOT_COMPLETE'}));
}
