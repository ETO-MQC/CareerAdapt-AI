import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const project=path.resolve('.');
const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('D3 exact anchor changed: '+a);return s.replace(a,b);};
export function d3RendererPatch(source,file){
 if(file.endsWith('/src/main.tsx'))return `import ${JSON.stringify(path.join(project,'.artifacts/p522-a05/application.mjs').replaceAll('\\','/'))};\nimport { $selectedStoredSessionId as d3StoredSession } from '@/store/session';\nd3StoredSession.listen(() => { void (window as unknown as {careerD3?: {contextChanged: () => Promise<unknown>}}).careerD3?.contextChanged(); });\n`+source;
 if(file.endsWith('/src/contrib/plugins-store.ts')){
  const anchor="  saveDecisions({ ...$pluginDecisions.get(), [id]: enabled })";
  return replace(source,anchor,`  if (id === 'careeradapt-d3-profile') {
    const bridge = (window as unknown as {careerD3?: {lifecycle: (enabled: boolean) => Promise<{enabled: boolean}>}}).careerD3
    if (!bridge) throw new Error('D3 control bridge unavailable')
    try {
      const committed = await bridge.lifecycle(enabled)
      if (committed.enabled !== enabled) throw new Error('D3 lifecycle commit mismatch')
    } catch (error) {
      handles.get(id)?.deactivate()
      patchPlugin(id, {status: 'error', error: 'D3 revoke not confirmed; local access closed'})
      throw error
    }
  }
${anchor}`);
 }
 return source;
}
export function recordD3Patch(file,original,patched){
 const folder='docs/architecture/evidence/p522-a05-native-career/implementation';fs.mkdirSync(folder,{recursive:true});
 const target=path.join(folder,'patches.json'),records=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):[];
 const patchedSha256=crypto.createHash('sha256').update(patched).digest('hex');
 if(!records.some(r=>r.file===file&&r.patchedSha256===patchedSha256))records.push({file,originalSha256:crypto.createHash('sha256').update(original).digest('hex'),patchedSha256,upstreamWritten:false});
 const snapshot=path.join(folder,'patched',file+'.txt');fs.mkdirSync(path.dirname(snapshot),{recursive:true});fs.writeFileSync(snapshot,patched);
 fs.writeFileSync(target,JSON.stringify(records,null,2)+'\n');
}
