import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {createHmac} from 'node:crypto';
import {setupRead} from '../unit/p522-a04-fixtures';
import {ProfileReadAdapter,type ProfileReadAuthorityContext} from '@/agent/tools/ProfileReadAdapter';
// @ts-expect-error Node-only D3 qualification transport.
import {D3Controller,serveD3Pipe} from '../../poc/native-career-d3/controller.mjs';

describe('D3 locked native dispatcher -> real user-scoped named pipe -> existing Adapter',()=>{
 it('registers exactly two tools, keeps A/B separate, rejects injection and never repeats an operation',async()=>{
  const root=path.resolve('.artifacts/p522-a05/native-pipe-'+crypto.randomUUID()),home=path.join(root,'home'),plugin=path.join(home,'plugins/careeradapt_d3_profile');fs.mkdirSync(plugin,{recursive:true});
  for(const file of ['plugin.yaml','__init__.py'])fs.copyFileSync('poc/native-career-d3/python/'+file,path.join(plugin,file));
  fs.writeFileSync(path.join(home,'config.yaml'),'plugins:\n  enabled: [careeradapt_d3_profile]\n');fs.writeFileSync(path.join(home,'.env'),'');
  const {service,db}=await setupRead(),before=JSON.stringify(await Promise.all(db.tables.map(async t=>({name:t.name,rows:await t.toArray()}))));
  const executions:string[]=[];
  const controller=new D3Controller({ledger:path.join(root,'ledger.jsonl'),workspaces:['A','B'].map(id=>({cwd:'synthetic-'+id,workspaceId:'synthetic-workspace',personId:'person-'+id,profileId:id})),resolveSession:async(sessionId:string)=>({id:sessionId,cwd:'synthetic-'+sessionId.slice(-1)}),dispatch:async(request:ProfileReadAuthorityContext&{tool:string;args:unknown})=>{
   const context={workspaceId:request.workspaceId,personId:request.personId,profileId:request.profileId,sessionId:request.sessionId,grantId:request.grantId,epoch:request.epoch,leaseExpiry:request.leaseExpiry,requestId:request.requestId,profileVersionNumber:1,profileRevision:1};
   controller.started(request.requestId);executions.push(request.requestId);
   const adapter=new ProfileReadAdapter(service,{context:async()=>context,verify:async()=>controller.valid(controller.pending.get(request.requestId))});
   return {...await adapter.execute(request.tool,request.args),applicationExecutions:1};
  }});controller.lifecycle(true,'synthetic-test-only-not-native-disable');
  const slash=String.fromCharCode(92),pipe=slash+slash+'.'+slash+'pipe'+slash+'careeradapt-d3-test-'+crypto.randomUUID(),secret=crypto.randomUUID();
  const server=await serveD3Pipe(controller,{pipe,secret});
  const host=path.join(process.env.LOCALAPPDATA!,'hermes/hermes-agent'),output=path.join(root,'result.json');
  const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH)$/i;
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key))),NODE_ENV:'test' as const,HERMES_HOME:home,HERMES_IGNORE_RULES:'1',HERMES_TUI_TOOLSETS:'career_d3',CAREERADAPT_D3:'1',CAREERADAPT_D3_PIPE:pipe,CAREERADAPT_D3_SECRET:secret,D3_LOCKED_ROOT:host,D3_REGISTRY_OUTPUT:output,PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1'};
  try{
   const result=await new Promise<{code:number|null;output:string}>((resolve,reject)=>{const child=spawn(path.join(host,'venv/Scripts/python.exe'),[path.resolve('scripts/p522-a05-native-registry.py')],{env,windowsHide:true});let text='';const timer=setTimeout(()=>{child.kill();reject(Error('bounded native registry timeout'));},45000);child.stdout.on('data',chunk=>{text+=chunk;});child.stderr.on('data',chunk=>{text+=chunk;});child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,output:text});});});
   expect(result.code,result.output).toBe(0);expect(executions).toHaveLength(3);expect(new Set(executions).size).toBe(3);
   expect(JSON.stringify(await Promise.all(db.tables.map(async t=>({name:t.name,rows:await t.toArray()}))))).toBe(before);
   const report=JSON.parse(fs.readFileSync(output,'utf8'));report.scope='Native Python registry + real named pipe + synthetic service-side Adapter; no Electron Host or production authority';report.executions=executions;report.zeroBusinessWrites=true;
   fs.writeFileSync('docs/architecture/evidence/p522-a05-native-career/implementation/native-registry-pipe.json',JSON.stringify(report,null,2)+'\n');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 },55000);
 it('executes the actual adapter once, drops ACK on the real pipe, restarts broker and only queries the original operation',async()=>{
  const root=path.resolve('.artifacts/p522-a05/lost-ack-'+crypto.randomUUID());fs.mkdirSync(root,{recursive:true});
  const {service}=await setupRead();let executions=0;
  const ledger=path.join(root,'ledger.jsonl'),workspaces=[{cwd:'synthetic-A',workspaceId:'synthetic-workspace',personId:'person-A',profileId:'A'}],resolveSession=async(id:string)=>({id,cwd:'synthetic-A'});
  const controller=new D3Controller({ledger,workspaces,resolveSession,dispatch:async(request:ProfileReadAuthorityContext&{tool:string;args:unknown})=>{
   executions++;controller.started(request.requestId);
   const context={workspaceId:request.workspaceId,personId:request.personId,profileId:request.profileId,sessionId:request.sessionId,grantId:request.grantId,epoch:request.epoch,leaseExpiry:request.leaseExpiry,requestId:request.requestId,profileVersionNumber:1,profileRevision:1};
   return {...await new ProfileReadAdapter(service,{context:async()=>context,verify:async()=>controller.valid(controller.pending.get(request.requestId))}).execute(request.tool,request.args),applicationExecutions:executions};
  }});controller.lifecycle(true,'synthetic-test-not-native-disable');
  const slash=String.fromCharCode(92),pipe=slash+slash+'.'+slash+'pipe'+slash+'careeradapt-d3-lost-'+crypto.randomUUID(),secret=crypto.randomUUID();
  const call=(request:unknown)=>new Promise<Record<string,unknown>>((resolve,reject)=>{
   const socket=net.connect(pipe),raw=JSON.stringify(request),mac=createHmac('sha256',secret).update(raw).digest('hex'),body=Buffer.from(JSON.stringify({request,mac})),head=Buffer.alloc(4);head.writeUInt32BE(body.length);let bytes=Buffer.alloc(0),settled=false;
   socket.setTimeout(3000,()=>socket.destroy(Error('bounded pipe timeout')));socket.on('connect',()=>socket.write(Buffer.concat([head,body])));socket.on('error',reject);
   socket.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk as Buffer]);if(bytes.length>=4&&bytes.length>=bytes.readUInt32BE(0)+4){settled=true;resolve(JSON.parse(bytes.subarray(4).toString()));socket.end();}});socket.on('end',()=>{if(!settled)resolve({status:'UNKNOWN'});});
  });
  let server=await serveD3Pipe(controller,{pipe,secret,fault:()=> 'lost-ack'});
  const request={kind:'invoke',operationId:crypto.randomUUID(),sessionId:'native-A',turnId:'turn-lost-ack',toolCallId:'call-lost-ack',tool:'career.profile.get',args:{limit:1}};
  try{
   expect((await call(request)).status).toBe('UNKNOWN');expect(executions).toBe(1);expect(controller.enabled).toBe(false);
   await new Promise<void>(resolve=>server.close(()=>resolve()));
   const restart=new D3Controller({ledger,workspaces,resolveSession,dispatch:async()=>{executions++;throw Error('MUST_NOT_EXECUTE');}});
   server=await serveD3Pipe(restart,{pipe,secret});
   const status=await call({kind:'status',operationId:request.operationId,sessionId:request.sessionId});expect(status.state).toBe('COMPLETED');expect(status.handlerExecutions).toBe(1);
   restart.lifecycle(true,'synthetic-test-reenable');expect((await call(request)).status).toBe('UNKNOWN');expect(executions).toBe(1);
   fs.writeFileSync('docs/architecture/evidence/p522-a05-native-career/implementation/lost-ack-pipe.json',JSON.stringify({status:'PASS_REAL_PIPE_SYNTHETIC_ADAPTER_NOT_ELECTRON_HOST',operationId:request.operationId,actualApplicationExecutions:executions,authoritativeStatus:status,oldGrantInvalidated:true,ledger:fs.readFileSync(ledger,'utf8').trim().split('\n').map(line=>JSON.parse(line)),nativeHostQualified:false},null,2)+'\n');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 },15000);
});
