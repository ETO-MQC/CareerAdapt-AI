import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';

export const out = 'docs/architecture/evidence/p522-host-a02-01';
export const host = path.join(process.env.LOCALAPPDATA, 'hermes/hermes-agent');
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
export const write = (name, value) => {
  fs.mkdirSync(out, {recursive:true});
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(value, null, 2)+'\n');
};
const git = (...args) => execFileSync('git', args, {encoding:'utf8', maxBuffer:8*1024*1024}).trim();
const fetch = spawnSync('git', ['fetch', 'origin'], {encoding:'utf8'});
if (fetch.status !== 0) throw Error('git fetch failed');
const source = JSON.parse(fs.readFileSync('docs/architecture/evidence/p522-host-a02-00/source-map.json', 'utf8'));
const sourceChecks = source.files.map(file => ({path:file.path, expected:file.sha256, actual:sha(fs.readFileSync(path.join(host,file.path)))}));
const patches = JSON.parse(fs.readFileSync('docs/architecture/evidence/p522-host-a01r/patch-manifest.json', 'utf8'));
const patchChecks = patches.records.map(file => ({path:file.file, expected:file.originalSha256, actual:sha(fs.readFileSync(path.join(host,file.file)))}));
const manifests = ['p522-host-a01','p522-host-a01r','p522-host-a01r-fb01','p522-host-a02-00'].map(folder => {
  const file = `docs/architecture/evidence/${folder}/delivery-manifest.json`;
  const manifest = JSON.parse(fs.readFileSync(file,'utf8'));
  const entries = manifest.files ?? manifest.allNewUntrackedFilesExceptThisManifest;
  if (!entries) throw Error('Unknown manifest structure: '+file);
  return {file, sha256:sha(fs.readFileSync(file)), count:entries.length, mismatches:entries.map(entry=>({path:entry.path,expected:entry.sha256,actual:fs.existsSync(entry.path)?sha(fs.readFileSync(entry.path)):null})).filter(entry=>entry.expected!==entry.actual)};
});
const protectedManifest = JSON.parse(fs.readFileSync('docs/architecture/evidence/p522-host-a01/hermes-source-map.json','utf8')).sourceMap.map(file=>({path:file.file,expected:file.sha256,actual:sha(fs.readFileSync(path.join(host,file.file)))}));
write('baseline', {at:new Date().toISOString(),fetchExitCode:fetch.status,head:git('rev-parse','HEAD'),origin:git('rev-parse','origin/main'),status:git('status','--short'),diff:git('diff'),cached:git('diff','--cached'),ignored:git('status','--ignored','--short'),worktrees:git('worktree','list'),hermesHead:git('-C',host,'rev-parse','HEAD'),hermesStatus:git('-C',host,'status','--short'),sourceChecks,patchChecks,manifests,protectedManifest, historicalReference:'07ff30982f08dfdd300247204d9e3720e2d5c015; reference only, never reset'});
if (sourceChecks.concat(patchChecks,protectedManifest).some(item=>item.actual!==item.expected)) throw Error('Protected source mismatch');
console.log(JSON.stringify({head:git('rev-parse','HEAD'),sourceFiles:sourceChecks.length,patchFiles:patchChecks.length,manifests:manifests.map(m=>({file:m.file,count:m.count,mismatches:m.mismatches.map(e=>e.path)}))}));
