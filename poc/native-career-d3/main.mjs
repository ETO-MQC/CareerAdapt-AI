import {app,ipcMain,BrowserWindow} from 'electron';
import fs from 'node:fs';
import {D3Controller,serveD3Pipe} from './controller.mjs';

export async function installD3({nativeConnection}){
 if(process.env.CAREERADAPT_D3!=='1')return;
 const config=JSON.parse(fs.readFileSync(process.env.CAREERADAPT_D3_CONFIG,'utf8'));
 let domain=null,domainGeneration=0;
 const awaiting=new Map();
 const controller=new D3Controller({ledger:config.ledger,workspaces:config.workspaces,
  resolveSession:async id=>{const connection=await nativeConnection();const r=await fetch(`${connection.baseUrl}/api/sessions/${encodeURIComponent(id)}`,{headers:{'X-Hermes-Session-Token':connection.token},signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('NATIVE_SESSION_UNAVAILABLE');return r.json();},
  dispatch:request=>new Promise((resolve,reject)=>{
   if(!domain||domain.isDestroyed()){reject(Error('DOMAIN_NOT_READY'));return;}
   const generation=domainGeneration,timer=setTimeout(()=>{awaiting.delete(request.requestId);reject(Error('DOMAIN_TIMEOUT'));},15000);
   awaiting.set(request.requestId,{resolve,reject,timer,generation});
   const fault=fs.existsSync(config.faultFile)?JSON.parse(fs.readFileSync(config.faultFile,'utf8')):{};
   domain.send('careeradapt:d3:read',{...request,testDelayMs:fault.mode==='hold-read'?2500:0});
  })});
 const allowed=e=>{const win=BrowserWindow.fromWebContents(e.sender);if(!win||e.senderFrame!==e.sender.mainFrame||!e.sender.getURL().startsWith(config.rendererOrigin+'/'))throw Error('FORBIDDEN');};
 ipcMain.handle('careeradapt:d3:attach',e=>{allowed(e);controller.lifecycle(false,'domain-attach-or-reload');domain=e.sender;domainGeneration++;return {syntheticOnly:true,boot:controller.boot};});
 ipcMain.handle('careeradapt:d3:lifecycle',(e,enabled)=>{allowed(e);if(e.sender!==domain)throw Error('FORBIDDEN');return controller.lifecycle(enabled);});
 ipcMain.handle('careeradapt:d3:context-changed',e=>{allowed(e);if(e.sender!==domain)throw Error('FORBIDDEN');return controller.lifecycle(controller.enabled,'native-session-context-changed');});
 ipcMain.handle('careeradapt:d3:started',(e,id)=>{allowed(e);if(e.sender!==domain||typeof id!=='string')throw Error('FORBIDDEN');return controller.started(id);});
 ipcMain.handle('careeradapt:d3:verify',(e,requestId)=>{allowed(e);if(e.sender!==domain||typeof requestId!=='string')throw Error('FORBIDDEN');const p=controller.pending.get(requestId);return Boolean(p&&controller.valid(p));});
 ipcMain.handle('careeradapt:d3:complete',(e,payload)=>{
  allowed(e);if(e.sender!==domain||!payload||Object.keys(payload).some(k=>!['requestId','result'].includes(k))||typeof payload.requestId!=='string'||JSON.stringify(payload).length>280000)throw Error('INVALID_REQUEST');
  const waiter=awaiting.get(payload.requestId),p=controller.pending.get(payload.requestId),r=payload.result;
  if(!waiter||waiter.generation!==domainGeneration||!p)throw Error('EXPIRED_REQUEST');
  if(!r||typeof r.ok!=='boolean'||![0,1].includes(r.applicationExecutions)||Object.keys(r).some(k=>!['ok','data','error','requestId','applicationExecutions','zeroWrites'].includes(k)))throw Error('INVALID_DOMAIN_RESULT');
  if(r.ok&&(!r.data||r.data.profileId!==p.profileId||r.data.personId!==p.personId||r.zeroWrites!==true))throw Error('DOMAIN_RESULT_SCOPE_MISMATCH');
  clearTimeout(waiter.timer);awaiting.delete(payload.requestId);waiter.resolve(r);return {accepted:true};
 });
 app.on('web-contents-created',(_event,wc)=>{
  const revoke=()=>{if(wc===domain){controller.lifecycle(false,'renderer-exit-or-navigation');domain=null;domainGeneration++;for(const wait of awaiting.values()){clearTimeout(wait.timer);wait.reject(Error('DOMAIN_DISCONNECTED'));}awaiting.clear();}};
  wc.on('destroyed',revoke);wc.on('render-process-gone',revoke);wc.on('did-start-navigation',(_e,_url,inPlace,isMainFrame)=>{if(isMainFrame&&!inPlace)revoke();});
 });
 controller.record({event:'PIPE_LISTEN_BEGIN'});
 const server=await serveD3Pipe(controller,{pipe:config.pipe,secret:config.secret,fault:()=>{
  // Test-only fault file is private launch configuration, never IPC or model input.
  if(!fs.existsSync(config.faultFile))return null;const f=JSON.parse(fs.readFileSync(config.faultFile,'utf8'));return f.mode==='lost-ack'?'lost-ack':null;
 }});
 controller.record({event:'PIPE_LISTEN_READY'});
 app.on('before-quit',()=>{controller.lifecycle(false,'main-exit');server.close();});
}
