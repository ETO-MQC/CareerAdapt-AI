import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reliabilityPatch,targets} from '../scripts/p522-host-a02-01-patches.mjs';

const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
for(const file of Object.values(targets)) {
  const source=fs.readFileSync(path.join(host,file),'utf8').replaceAll('\r\n','\n');
  test(`locked source and exact anchors: ${file}`,()=>{
    const patched=reliabilityPatch(source,'/'+file);
    assert.notEqual(patched,source);
    assert.throws(()=>reliabilityPatch(source+'\n','/'+file),/SHA changed/);
    assert.throws(()=>reliabilityPatch(patched,'/'+file),/SHA changed/);
  });
}
test('unrelated module remains byte-identical',()=>{
  assert.equal(reliabilityPatch('export const untouched = true;','/src/unrelated.ts'),'export const untouched = true;');
});
