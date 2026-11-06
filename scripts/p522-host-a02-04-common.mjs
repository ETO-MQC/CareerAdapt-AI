import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const out='docs/architecture/evidence/p522-host-a02-04';
export const root=path.resolve('.artifacts/p522-host-a02-04');
export const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
export const desktop=path.join(host,'apps/desktop');
export const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export const write=(n,v)=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(`${out}/${n}.json`,JSON.stringify(v,null,2)+'\n');};
export const git=(...a)=>execFileSync('git',a,{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
export const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
if(process.argv.includes('--baseline')){
 fs.mkdirSync(root,{recursive:true});
 const old=JSON.parse(fs.readFileSync('docs/architecture/evidence/p522-host-a02-03/baseline.json','utf8'));
 const checks=old.checks.map(c=>({...c,baselineSha256:sha(fs.readFileSync(path.join(host,c.path)))}));
 const protectedFiles=[...files('docs/architecture/evidence').filter(f=>!f.includes('p522-host-a02-04')), ...files('scripts').filter(f=>/p522-host-a02-03-|p522-host-a01-renderer/.test(f))];
 write('baseline',{at:new Date().toISOString(),head:git('rev-parse','HEAD'),origin:git('rev-parse','origin/main'),status:git('status','--short'),ignored:git('status','--short','--ignored'),diff:git('diff'),stagedDiff:git('diff','--cached'),worktrees:git('worktree','list','--porcelain'),hermesHead:git('-C',host,'rev-parse','HEAD'),checks,protectedFiles:protectedFiles.map(file=>({file,sha256:sha(fs.readFileSync(file))})),main:{file:'.artifacts/p522-host-a02-01/main-integration/main.mjs',sha256:sha(fs.readFileSync('.artifacts/p522-host-a02-01/main-integration/main.mjs'))},previousManifestSha256:sha(fs.readFileSync('docs/architecture/evidence/p522-host-a02-03/delivery-manifest.json')),deletionPolicy:'No filesystem cleanup, all test data retained'});
 const sources=['hermes_state.py','tui_gateway/server.py','apps/desktop/src/store/composer.ts','apps/desktop/src/store/session.ts','apps/desktop/src/store/session-states.ts','apps/desktop/src/lib/inflight-turn-journal.ts','apps/desktop/src/app/session/hooks/use-session-state-cache.ts','apps/desktop/src/app/session/hooks/use-session-actions/index.ts','apps/desktop/src/app/session/hooks/use-route-resume.ts','apps/desktop/src/app/chat/composer/hooks/use-composer-draft.ts'];
 write('session-source-audit',{status:'SOURCE_AUDIT',sources:sources.map(file=>({file,sha256:sha(fs.readFileSync(path.join(host,file)))})),authority:{transcripts:'HERMES_HOME/state.db via hermes_state.SessionDB; Gateway owns persistence',runtime:'tui_gateway.server in-memory sessions, rebuilt by session.resume',renderer:'session-state cache is a projection, not authority',drafts:'hermes:composer-drafts:v3 localStorage, max 50 nonempty text drafts; attachments memory-only',inflight:'Native inflightTurnJournal v1 localStorage, 24 entries/7 days/400ms throttle; recovery aid, not authority'},unknownFinding:'A02-01 UNKNOWN is local assistant.error; native journal clears idle state. Reload/restart can drop the uncertainty guard. Deterministic reproduction and minimal native-journal overlay required.',historyPreserved:true});
 console.log(JSON.stringify({protectedFiles:protectedFiles.length,sourceChecks:checks.length}));
}
