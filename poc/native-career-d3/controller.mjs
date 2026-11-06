import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';

export const PLUGIN_ID='careeradapt-d3-profile';
export const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const strict=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
export class D3Controller {
 constructor({ledger,resolveSession,workspaces,dispatch,now=Date.now}){
  this.ledger=ledger;this.resolveSession=resolveSession;this.workspaces=workspaces;this.dispatch=dispatch;this.now=now;
  this.enabled=false;this.epoch=0;this.grants=new Map();this.pending=new Map();this.operations=new Map();
  this.boot=crypto.randomUUID();
  if(fs.existsSync(ledger))for(const line of fs.readFileSync(ledger,'utf8').split('\n').filter(Boolean)){const row=JSON.parse(line);if(row.operationId)this.operations.set(row.operationId,row);}
  this.record({event:'BOOT',boot:this.boot,enabled:false,epoch:0});
 }
 record(value){const row={at:this.now(),...value};const fd=fs.openSync(this.ledger,'a');try{fs.writeSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(row.operationId)this.operations.set(row.operationId,row);return row;}
 lifecycle(enabled,reason='native-plugin-toggle'){
  if(typeof enabled!=='boolean')throw Error('INVALID_REQUEST');
  this.enabled=false;this.epoch++;this.grants.clear();
  for(const p of this.pending.values())p.revoked=true;
  this.record({event:'LIFECYCLE',enabled:false,epoch:this.epoch,reason,boot:this.boot});
  if(enabled){this.enabled=true;this.record({event:'LIFECYCLE',enabled:true,epoch:this.epoch,reason,boot:this.boot});}
  return {enabled:this.enabled,epoch:this.epoch,syntheticOnly:true};
 }
 valid(p){return this.enabled&&!p.revoked&&p.boot===this.boot&&p.epoch===this.epoch&&p.leaseExpiry>this.now()&&this.grants.get(p.sessionId)===p.grantId;}
 started(operationId){const p=this.pending.get(operationId),row=this.operations.get(operationId);if(!p||!this.valid(p)||!row||row.handlerExecutions!==0)throw Error('INVALID_EXECUTION_START');this.record({...row,state:'STARTED',handlerExecutions:1});return {accepted:true};}
 async bound(sessionId){
  const session=await this.resolveSession(sessionId);
  // Native REST is an independent exact-ID record lookup, not a renderer grant.
  if(!session||session.id!==sessionId||typeof session.cwd!=='string')throw Error('UNBOUND_SESSION');
  const policy=this.workspaces.find(w=>w.cwd.toLowerCase()===session.cwd.toLowerCase());
  if(!policy)throw Error('UNBOUND_WORKSPACE');
  return policy;
 }
 async invoke(request){
  if(!strict(request,['kind','operationId','sessionId','turnId','toolCallId','tool','args'])||!id(request.operationId)||!id(request.sessionId)||!id(request.turnId)||!id(request.toolCallId)||!['career.profile.get','career.profile.search_facts'].includes(request.tool))throw Error('INVALID_REQUEST');
  if(!strict(request.args,request.tool.endsWith('search_facts')?['sectionTypes','limit','cursor','query']:['sectionTypes','limit','cursor']))throw Error('INVALID_REQUEST');
  if(!this.enabled)throw Error('SCOPE_REVOKED');
  const scope=await this.bound(request.sessionId);
  if(!this.enabled)throw Error('SCOPE_REVOKED');
  const payloadHash=hash({tool:request.tool,args:request.args});
  const previous=this.operations.get(request.operationId);
  if(previous){if(previous.sessionId!==request.sessionId||previous.payloadHash!==payloadHash||previous.toolCallId!==request.toolCallId)throw Error('OPERATION_CONFLICT');return {status:'UNKNOWN',operationId:request.operationId,reexecution:false};}
  const grantId=this.grants.get(request.sessionId)||crypto.randomUUID();this.grants.set(request.sessionId,grantId);
  const p={...request,...scope,grantId,epoch:this.epoch,boot:this.boot,leaseExpiry:this.now()+60000,requestId:request.operationId,profileVersionNumber:1,profileRevision:1,revoked:false};
  this.pending.set(request.operationId,p);
  const base={operationId:request.operationId,sessionId:p.sessionId,turnId:p.turnId,toolCallId:p.toolCallId,tool:p.tool,profileId:p.profileId,payloadHash,handlerExecutions:0,boot:this.boot};
  this.record({...base,state:'ACCEPTED'});
  try{
   if(!this.valid(p))throw Error('SCOPE_REVOKED');
   this.record({...base,state:'DISPATCHED',handlerExecutions:0});
   const result=await this.dispatch(p);
   const handlerExecutions=this.operations.get(p.operationId).handlerExecutions;
   if(!this.valid(p)){this.record({...base,state:'REVOKED',handlerExecutions});throw Error('SCOPE_REVOKED');}
   const row=this.record({...base,state:result.ok?'COMPLETED':'FAILED',handlerExecutions,resultRef:hash(result),result,applicationExecutions:result.applicationExecutions});
   p.result=row.result;p.resultRef=row.resultRef;
   return {status:'READY',operationId:p.operationId,resultRef:p.resultRef};
  }catch(error){if(!['COMPLETED','FAILED'].includes(this.operations.get(p.operationId)?.state))this.record({...base,state:!this.valid(p)?'REVOKED':'UNKNOWN',handlerExecutions:this.operations.get(p.operationId)?.handlerExecutions||0,error:error.message});throw error;}
 }
 release(operationId){const p=this.pending.get(operationId);if(!p||!this.valid(p)||!p.result)throw Error('SCOPE_REVOKED');p.candidate=true;return {status:'CANDIDATE',operationId,result:p.result};}
 commitDelivery(operationId){const p=this.pending.get(operationId);if(!p||!this.valid(p)||!p.candidate)throw Error('SCOPE_REVOKED');this.pending.delete(operationId);this.record({...this.operations.get(operationId),state:'DELIVERED',releaseEpoch:this.epoch});return {status:'AUTHORIZED',operationId};}
 cancel(operationId){const p=this.pending.get(operationId);if(p)p.revoked=true;return {status:'CANCELLED',operationId};}
 async status(operationId,sessionId){const scope=await this.bound(sessionId),row=this.operations.get(operationId);if(!row||row.sessionId!==sessionId||row.profileId!==scope.profileId)throw Error('NOT_FOUND');return {operationId,state:['ACCEPTED','DISPATCHED','STARTED'].includes(row.state)?'UNKNOWN':row.state,handlerExecutions:row.handlerExecutions,resultRef:row.resultRef,payloadHash:row.payloadHash,sessionId:row.sessionId,toolCallId:row.toolCallId,turnId:row.turnId};}
}

// Length-prefixed local named-pipe protocol, one authenticated invocation per
// connection. No TCP listener or renderer-accessible secret. Node's pipe uses
// the current user's default Windows DACL; readableAll/writableAll stay false.
export async function serveD3Pipe(controller,{pipe,secret,fault=()=>null}){
 const server=net.createServer(socket=>{
  let buffer=Buffer.alloc(0),busy=false,current=null,completed=false;
  const send=value=>{const body=Buffer.from(JSON.stringify(value)),head=Buffer.alloc(4);head.writeUInt32BE(body.length);socket.write(Buffer.concat([head,body]));};
  socket.setTimeout(65000,()=>socket.destroy());
  socket.on('close',()=>{if(current&&!completed){controller.cancel(current);controller.lifecycle(false,'unexpected-plugin-disconnect');}});
  socket.on('error',error=>controller.record({event:'PIPE_ERROR',code:error.code||'TRANSPORT_ERROR'})); // close performs revocation.
  socket.on('data',chunk=>{
   buffer=Buffer.concat([buffer,chunk]);if(buffer.length>300000){socket.destroy();return;}
   const processFrame=async()=>{
    if(busy||buffer.length<4)return;const length=buffer.readUInt32BE(0);if(length>280000){socket.destroy();return;}if(buffer.length<length+4)return;
    const bytes=buffer.subarray(4,length+4);buffer=buffer.subarray(length+4);busy=true;
    try{
     const frame=JSON.parse(bytes.toString('utf8'));
     if(!strict(frame,['request','mac'])||typeof frame.mac!=='string')throw Error('FORBIDDEN');
     const expected=crypto.createHmac('sha256',secret).update(JSON.stringify(frame.request)).digest('hex');
     if(frame.mac.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(frame.mac),Buffer.from(expected)))throw Error('FORBIDDEN');
     const r=frame.request;
     if(r.kind==='invoke'){
      current=r.operationId;
      const value=await controller.invoke(r);
      if(fault(r)==='lost-ack'&&value.status==='READY'){controller.lifecycle(false,'injected-lost-ack-disconnect');completed=true;socket.destroy();return;}
      send(value);
      if(value.status!=='READY')completed=true; // A definitive no-replay reply is a normal close, not a broken in-flight pipe.
     }else if(r.kind==='release'&&strict(r,['kind','operationId'])&&r.operationId===current){send(controller.release(current));}
     else if(r.kind==='commit-delivery'&&strict(r,['kind','operationId'])&&r.operationId===current){send(controller.commitDelivery(current));completed=true;}
     else if(r.kind==='cancel'&&strict(r,['kind','operationId'])&&r.operationId===current){send(controller.cancel(current));completed=true;}
     else if(r.kind==='status'&&strict(r,['kind','operationId','sessionId'])&&id(r.operationId)&&id(r.sessionId)){send(await controller.status(r.operationId,r.sessionId));completed=true;}
     else throw Error('INVALID_REQUEST');
    }catch(error){send({status:'ERROR',error:error.message});completed=true;}
    finally{busy=false;if(buffer.length)void processFrame();}
   };void processFrame();
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({path:pipe,readableAll:false,writableAll:false},resolve);});
 return server;
}
