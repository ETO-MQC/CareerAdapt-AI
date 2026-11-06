import fs from 'node:fs';
import path from 'node:path';
import {root as stageRoot,sha} from './p522-host-a02-03-common.mjs';
export async function attachmentCases({app,page,result,snap,save,shot,assert,prereq,send,workspace}){
 const fixtures=path.join(stageRoot,'fixtures');
 const manifest=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.local.json'),'utf8'));
 const ledger=[];result.attachments=ledger;
 const state=()=>page.evaluate(async()=>{const c=await import('/src/store/composer.ts');return c.$composerAttachments.get().map(a=>({...a,previewUrl:a.previewUrl?{present:true,encodedLength:a.previewUrl.length}:undefined}));});
 const until=async(predicate,ms,why)=>{const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,250));}throw Error(why);};
 const menu=async name=>{const composer=page.locator('[data-slot="composer-root"]');const trigger=composer.locator('button').filter({has:page.locator('[data-icon="add"]')});
  if(await trigger.count()===1)await trigger.click();else {const buttons=await composer.getByRole('button').evaluateAll(bs=>bs.map(b=>({label:b.getAttribute('aria-label'),text:b.textContent})));result.composerButtons=buttons;const candidate=composer.getByRole('button',{name:/attach|context|tools/i}).first();await candidate.click();}
  await page.getByRole('menuitem',{name,exact:true}).click();};
 const removeAll=async()=>{for(let i=0;i<15;i++){const remove=page.locator('[data-slot="composer-attachments"]').getByRole('button',{name:/^Remove /});if(!await remove.count())break;await remove.first().click();}await until(async()=>!(await state()).length,5000,'Attachments not removed');};
 const task=async(name,fn)=>{try{const detail=await fn();save(name,{status:'PASS',...detail});}catch(error){save(name,{status:'FAIL_OR_NOT_VERIFIED',error:String(error),state:await state()});result.caseFailures??=[];result.caseFailures.push({name,error:String(error)});}save('attachment-staging-ledger',{records:ledger,rpc:result.rpc.filter(r=>/^(file|image)\./.test(r.method))});};
 await task('file-picker-verification',async()=>{
  console.log('USER_ACTION FILE_PICKER: select sample.txt AND sample.pdf from .artifacts/p522-host-a02-03/fixtures');
  await menu('Files…');await until(async()=>(await state()).some(a=>a.label==='sample.txt')&&(await state()).some(a=>a.label==='sample.pdf'),180000,'User file selection not observed');
  await until(async()=>(await state()).filter(a=>a.kind==='file').every(a=>a.attachedSessionId&&!a.uploadState),30000,'Gateway stage not finished');
  const selected=await state();ledger.push({kind:'file-picker',selected,session:(await snap()).sessionId});await shot('files-selected');
  const pdf=page.getByRole('button',{name:'Remove sample.pdf',exact:true});await pdf.click();
  const before=result.rpc.length;
  if(!(await snap()).busy){await send('tool-attachment-txt','Read the attached synthetic text file. Return the unique marker found inside it. Do not call any tools.');
   const t=result.turns.at(-1);save('model-understanding-ledger',{prerequisite:prereq.status,fullQualification:prereq.status==='PASS',records:[{sample:'sample.txt',markerAbsentFromPrompt:true,expected:manifest.markers.txt,answer:t.deltaText,correct:t.deltaText.includes(manifest.markers.txt),session:t.sessionBefore,submit:t.rpc.filter(r=>r.method==='prompt.submit')}],pdf:'BLOCKED_A02_02_L4'});}
  return {nativeDialog:true,multiple:true,selected,removedPdf:true,rpcSinceSend:result.rpc.slice(before),MIMEAndSizeDisplayed:'NOT_EXPOSED_IN_CHIP',pdfUnderstanding:'BLOCKED_A02_02_L4'};
 });
 await removeAll();
 await task('image-picker-verification',async()=>{
  console.log('USER_ACTION IMAGE_PICKER: select image.png');await menu('Images…');
  await until(async()=>(await state()).some(a=>a.kind==='image'&&a.previewUrl),180000,'Image picker selection/preview not observed');
  const selected=await state();ledger.push({kind:'image-picker',selected});await shot('image-selected');
  if(!(await snap()).busy){await send('tool-attachment-image','Read all text visible in the attached synthetic image. Do not call tools.');const t=result.turns.at(-1);save('image-routing-ledger',{mode:'native',auxiliaryProvider:false,prerequisite:prereq.status,expected:manifest.markers.png,answer:t.deltaText,correct:t.deltaText.includes(manifest.markers.png),nativeRpc:t.rpc,fullQualification:prereq.status==='PASS'});}
  return {nativeDialog:true,selected,fixture:manifest.records.find(r=>r.filename==='image.png')};
 });
 await removeAll();
 await task('clipboard-verification',async()=>{
  await app.evaluate(({clipboard,nativeImage},image)=>{globalThis.__a03OldClipboard=clipboard.readImage();clipboard.writeImage(nativeImage.createFromPath(image));},path.join(fixtures,'image.png'));
  await menu('Paste image');await until(async()=>(await state()).some(a=>a.kind==='image'&&a.previewUrl),10000,'Native clipboard image missing');
  const selected=await state();const data=fs.readFileSync(selected[0].path);await shot('clipboard-image');ledger.push({kind:'clipboard',selected,byteLength:data.length,sha256:sha(data)});
  await removeAll();await app.evaluate(({clipboard})=>{if(globalThis.__a03OldClipboard&&!globalThis.__a03OldClipboard.isEmpty())clipboard.writeImage(globalThis.__a03OldClipboard);else clipboard.clear();});
  return {actualElectronClipboard:true,selected,byteLength:data.length,sha256:sha(data),removed:true,submitted:false};
 });
 await task('os-drag-drop-verification',async()=>{
  console.log('USER_ACTION OS_DROP: drag sample.txt AND image.png from Explorer onto Composer');
  await until(async()=>(await state()).some(a=>a.kind==='file')&&(await state()).some(a=>a.kind==='image'),180000,'Real OS multi-file drop not observed');
  const selected=await state();ledger.push({kind:'os-drop-user-assisted',selected});await shot('os-dropped');await removeAll();
  return {method:'USER_ASSISTED_OS_EXPLORER_DROP',selected,fileAndImageAndMultiple:true,unsupported:'NOT_VERIFIED',cancel:'NOT_VERIFIED'};
 });
 await task('folder-reference-verification',async()=>{
  console.log('USER_ACTION FOLDER_PICKER: select fixtures/folder');await menu('Folder…');
  await until(async()=>(await state()).some(a=>a.kind==='folder'),180000,'Folder picker not observed');
  const selected=await state();ledger.push({kind:'folder',selected});await shot('folder-selected');await removeAll();
  return {selected,semantics:'Directory listing only; not recursive upload',nativeSelected:true};
 });
 // Actual application-origin drag format; this is deliberately NOT OS input.
 await task('app-drag-drop-verification',async()=>{
  fs.copyFileSync(path.join(fixtures,'sample.txt'),path.join(workspace,'in-app.txt'));
  const mime=await page.evaluate(async()=>{const m=await import('/src/app/chat/hooks/use-composer-actions.ts');return m.HERMES_PATHS_MIME;});
  const dt=await page.evaluateHandle(({mime})=>{const d=new DataTransfer();d.setData(mime,JSON.stringify([{path:'in-app.txt',isDirectory:false}]));return d;},{mime});
  await page.getByRole('textbox',{name:'Message',exact:true}).dispatchEvent('drop',{dataTransfer:dt});await dt.dispose();
  const draft=await page.getByRole('textbox',{name:'Message',exact:true}).innerText();await shot('in-app-ref');assert.ok(draft.includes('in-app.txt'),'Native app-origin drop did not insert ref');await page.getByRole('textbox',{name:'Message',exact:true}).fill('');
  return {level:'L3_RENDERER_SYNTHETIC_APPLICATION_DRAG_EVENT_NOT_PHYSICAL_GESTURE',mime,draft,attachments:await state(),crossSession:'UNIT_ONLY'};
 });
 save('session-binding-ledger',{records:ledger.map(r=>({kind:r.kind,selected:r.selected,session:r.session})),rpc:result.rpc.filter(r=>/^(file|image)\.|prompt.submit/.test(r.method))});
 save('performance-verification',{scope:'Small synthetic files only',processMetrics:await app.evaluate(({app})=>app.getAppMetrics().map(m=>({type:m.type,memory:m.memory}))),rssPeak:'NOT_SAMPLED',largeBoundary:'NOT_VERIFIED',rendererResponsive:true});
}
