import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {host,root,write,sha} from './p522-host-a02-03-common.mjs';
const req=createRequire(path.join(host,'apps/desktop/package.json')),ts=req('typescript');
const source=fs.readFileSync(path.join(host,'apps/desktop/electron/hardening.ts'),'utf8'),mod={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:mod,exports:mod.exports,require:req,process,Buffer,URL,Error,Set});
const {resolveReadableFileForIpc,DATA_URL_READ_MAX_BYTES}=mod.exports,records=[];
for(const size of [DATA_URL_READ_MAX_BYTES-1,DATA_URL_READ_MAX_BYTES,DATA_URL_READ_MAX_BYTES+1]){
 const file=path.join(root,'fixtures',`boundary-${size}.bin`);fs.writeFileSync(file,Buffer.alloc(size,65));const started=performance.now(),rssBefore=process.memoryUsage().rss;
 const record={rawBytes:size,filename:path.basename(file),sha256:sha(fs.readFileSync(file)),rssBefore};
 try{const resolved=await resolveReadableFileForIpc(file,{maxBytes:DATA_URL_READ_MAX_BYTES,purpose:'File preview'});const bytes=await fs.promises.readFile(resolved.resolvedPath);const encoded=bytes.toString('base64');record.accepted=true;record.base64Length=encoded.length;record.rssAfterEncoding=process.memoryUsage().rss;assert.equal(encoded.length,4*Math.ceil(size/3));}catch(error){record.accepted=false;record.error=String(error);}
 assert.equal(record.accepted,size<=DATA_URL_READ_MAX_BYTES);record.elapsedMs=performance.now()-started;records.push(record);
}
write('performance-boundary-local',{status:'PASS_MOCK_ONLY_L2_MAIN_FUNCTION_REAL_FILES',scope:'Exact locked Main file validation + fs.readFile + base64, no Electron IPC/Renderer/Provider',mainReadLimit:DATA_URL_READ_MAX_BYTES,records,rendererRssPeak:'NOT_VERIFIED',gatewayImageCap:25*1024*1024,pdfRpcCap:50*1024*1024,pdfPages:25,genericFileAttachCap:'No explicit cap in locked file.attach handler'});
console.log(JSON.stringify({status:'PASS_MOCK_ONLY_L2',boundaries:3}));
