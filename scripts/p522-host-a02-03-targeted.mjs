import fs from 'node:fs';
import path from 'node:path';
import {root as stageRoot,sha} from './p522-host-a02-03-common.mjs';
// Last bounded Electron round: image submission and native IPC limits.
export async function attachmentCases({app,page,result,snap,save,shot,assert,send,prereq}){
 const fixtures=path.join(stageRoot,'fixtures'),manifest=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.local.json'),'utf8'));
 const composer=page.locator('[data-slot="composer-root"]');
 const menu=async label=>{await composer.getByRole('button',{name:'Add context',exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();};
 const state=()=>page.evaluate(async()=>{const c=await import('/src/store/composer.ts');return c.$composerAttachments.get().map(a=>({...a,previewUrl:a.previewUrl?{present:true,length:a.previewUrl.length}:undefined}));});
 const clear=async()=>{const removals=page.locator('[data-slot="composer-attachments"]').getByRole('button',{name:/^Remove /});while(await removals.count())await removals.first().click();};
 console.log('USER_ACTION LAST_IMAGE_PICKER: filename E:\\DEF\\CareerAdapt AI\\.artifacts\\p522-host-a02-03\\fixtures\\image.png');
 await menu('Images…');
 try{
  await page.locator('[data-slot="composer-attachments"] img').waitFor({timeout:300000});
  const selected=await state();save('image-picker-third-verification',{status:'PASS_NATIVE_SELECTION_AND_PREVIEW',selected,fixture:manifest.records.find(r=>r.filename==='image.png')});await shot('native-image-picker-third');await clear();
 }catch(error){save('image-picker-third-verification',{status:'NOT_VERIFIED',error:String(error)});}
 const oldClipboard=await app.evaluate(({clipboard})=>({text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF()}));
 await app.evaluate(({clipboard,nativeImage},p)=>{globalThis.__a03OriginalImage=clipboard.readImage();clipboard.writeImage(nativeImage.createFromPath(p));},path.join(fixtures,'image.png'));
 try{
  await menu('Paste image');await page.locator('[data-slot="composer-attachments"] img').waitFor();
  const selected=await state(),bytes=fs.readFileSync(selected[0].path);await shot('native-clipboard-before-submit');
  save('clipboard-submit-verification',{status:'STAGED_LOCAL',selected,byteLength:bytes.length,sha256:sha(bytes),fixtureSha256:manifest.records.find(r=>r.filename==='image.png').sha256});
  try{await send('tool-image-clipboard','Read all the text visible in the attached synthetic image. Do not call tools.');const t=result.turns.at(-1);save('image-routing-ledger',{status:'OBSERVED',mode:'native',auxiliaryProvider:false,prerequisite:prereq.status,fullQualification:false,expected:manifest.markers.png,answer:t.deltaText,correct:t.deltaText.includes(manifest.markers.png),rpc:t.rpc,actualSelection:'Native Electron clipboard image'});}catch(error){save('image-routing-ledger',{status:'PROVIDER_OR_RUNTIME_FAILURE',mode:'native',failure:String(error),fullQualification:false});}
 }finally{await app.evaluate(({clipboard},previous)=>{clipboard.write({text:previous.text,html:previous.html,rtf:previous.rtf,...(globalThis.__a03OriginalImage&&!globalThis.__a03OriginalImage.isEmpty()?{image:globalThis.__a03OriginalImage}:{})});},oldClipboard);await clear();}
 // Test-only native dialog response injection; never reported as OS selection.
 await app.evaluate(({dialog})=>{globalThis.__a03OriginalDialog=dialog.showOpenDialog;globalThis.__a03DialogPaths=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:globalThis.__a03DialogPaths});});
 const pick=async paths=>{await app.evaluate((_electron,p)=>{globalThis.__a03DialogPaths=p;},paths);await menu('Files…');};
 await pick([path.join(fixtures,'missing-controlled.txt'),path.join(fixtures,'sample.txt')]);
 await page.waitForFunction(async()=>{const a=(await import('/src/store/composer.ts')).$composerAttachments.get();return a.some(x=>x.uploadState==='error');});
 const failure=await state();await shot('partial-upload-failure');assert.ok(failure.some(a=>a.uploadState==='error'));
 await clear();await new Promise(r=>setTimeout(r,1000));assert.equal((await state()).length,0);
 save('upload-failure-verification',{status:'PARTIAL',level:'REAL_ELECTRON_AND_GATEWAY_TEST_DIALOG_RETURN_ONLY_MOCKED',partialFailure:failure,removedErrorDoesNotReappear:true,retry:'MOCK_ONLY_L2_UPLOAD_FUNCTION',unknownAutomaticResend:false});
 await pick([path.join(fixtures,'sample.txt')]);await page.getByRole('button',{name:'Preview sample.txt',exact:true}).waitFor();const before=await state(),oldUrl=page.url();
 await page.getByRole('button',{name:'＋ 新建对话',exact:true}).click();await page.waitForTimeout(500);const after=await state();assert.equal(after.length,0,'Attachment crossed to new draft');
 await page.goto(oldUrl);await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();await page.waitForTimeout(500);const returned=await state();
 save('session-isolation-verification',{status:'PASS_DRAFT_SWITCH_ONLY',before,after,returned,oldUrl,providerCrossSession:'NOT_VERIFIED',sessionBindingRuntime:(await snap()).sessionId});await clear();
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.__a03OriginalDialog;});
 const metrics=[],timer=setInterval(async()=>{try{metrics.push({at:Date.now(),processes:await app.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,memory:m.memory})))});}catch(error){result.metricsError=String(error);}},200);
 const bounds=[];
 try{for(const size of [16*1024*1024-1,16*1024*1024,16*1024*1024+1]){
  const p=path.join(fixtures,`boundary-${size}.bin`);fs.writeFileSync(p,Buffer.alloc(size,65));const start=Date.now();
  const observation=await page.evaluate(async p=>{const t=performance.now();try{const url=await window.hermesDesktop.readFileDataUrl(p);return {accepted:true,encodedLength:url.length-url.indexOf(',')-1,elapsed:performance.now()-t};}catch(error){return {accepted:false,error:String(error),elapsed:performance.now()-t};}},p);
  bounds.push({rawBytes:size,elapsedMs:Date.now()-start,...observation});assert.equal(observation.accepted,size<=16*1024*1024);
 }}finally{clearInterval(timer);}
 save('performance-boundary-verification',{status:'PASS_NATIVE_MAIN_READ_LIMIT',limits:{mainReadFileDataUrl:16*1024*1024,gatewayImageAttachBytes:25*1024*1024,pdfAttachBytes:50*1024*1024,pdfAttachPages:25,fileAttach:'No explicit byte cap in locked handler'},bounds,metrics,base64Expansion:'4*ceil(rawBytes/3); approximately 4/3 plus strings and buffers',providerLargeFileTest:false});
 save('targeted-third-round',{status:'PARTIAL',attachmentRpc:result.rpc.filter(r=>/^(image|file)\./.test(r.method)),noPrerequisiteRepeat:true});
}
