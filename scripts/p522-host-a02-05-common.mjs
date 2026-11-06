import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const out='docs/architecture/evidence/p522-host-a02-05';
export const root=path.resolve('.artifacts/p522-host-a02-05');
export const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
export const desktop=path.join(host,'apps/desktop');
export const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
export const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
export const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);
export const write=(name,value)=>{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2)+'\n');};
if(process.argv.includes('--baseline')){
 fs.mkdirSync(root,{recursive:true});
 const previous=JSON.parse(fs.readFileSync('docs/architecture/evidence/p522-host-a02-04/baseline.json','utf8'));
 const protectedFiles=files('docs/architecture/evidence').filter(f=>!f.includes('p522-host-a02-05')).concat(files('scripts').filter(f=>/p522-host-a0/.test(f)));
 const checks=previous.checks.map(c=>({path:c.path,sha256:sha(fs.readFileSync(path.join(host,c.path)))}));
 const manifests=protectedFiles.filter(f=>f.endsWith('delivery-manifest.json')).map(file=>({file,sha256:sha(fs.readFileSync(file))}));
 write('baseline',{at:new Date().toISOString(),head:git('rev-parse','HEAD'),origin:git('rev-parse','origin/main'),originScope:'local remote-tracking ref; no network fetch',status:git('status','--short'),ignored:git('status','--short','--ignored'),staged:git('diff','--cached'),unstaged:git('diff'),worktrees:git('worktree','list','--porcelain'),manualA04Commit:git('log','-1','--format=%H %s'),a04Status:'PARTIAL / MANUALLY_COMMITTED',hermesHead:git('-C',host,'rev-parse','HEAD'),checks,manifests,protectedFiles:protectedFiles.map(file=>({file,sha256:sha(fs.readFileSync(file))})),deletionPolicy:'No filesystem deletions; all isolated directories retained'});
 const sources=['apps/desktop/src/app/artifacts/artifact-utils.ts','apps/desktop/src/app/artifacts/index.tsx','apps/desktop/src/types/hermes.ts','apps/desktop/src/hermes.ts','apps/desktop/src/lib/desktop-fs.ts','apps/desktop/src/lib/media.ts','apps/desktop/electron/main.ts','tui_gateway/server.py','hermes_state.py'];
 write('artifact-source-audit',{sources:sources.map(file=>({file,sha256:sha(fs.readFileSync(path.join(host,file)))})),nativeRecord:['id','kind','value','href','label','sessionId','sessionTitle','timestamp'],identity:'session.id + colon + normalized value; derived reference, not file identity',nativeTaskId:false,nativeMessageIdExposed:false,nativeLifecycle:false,nativeVersions:false,nativeArtifactDatabase:false,events:'message.start/delta/complete and tool events belong to turns, no artifact.* events',persistence:'Re-derived from native state.db message history; bytes remain in workspace; no snapshots',safety:'Native parser also finds proposed tool-call input paths and arbitrary assistant links. Neither proves file creation or successful completion.'});
 console.log(JSON.stringify({checks:checks.length,protectedFiles:protectedFiles.length,manifests:manifests.length}));
}
