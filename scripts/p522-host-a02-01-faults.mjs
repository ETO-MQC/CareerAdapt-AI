import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {reliabilityPatch, targets, patchRecord} from './p522-host-a02-01-patches.mjs';

const host=path.join(process.env.LOCALAPPDATA,'hermes/hermes-agent');
const req=createRequire(path.join(host,'apps/desktop/package.json'));
const ts=req('typescript'),{WebSocketServer}=req('ws');
const out=process.argv.find(arg=>arg.startsWith('--evidence-dir='))?.slice(15)??'docs/architecture/evidence/p522-host-a02-01';
fs.mkdirSync(out,{recursive:true});
const atom = value => {const listeners=new Set();return {get:()=>value,set:next=>{value=next;for(const fn of listeners)fn(value);},subscribe:fn=>{listeners.add(fn);fn(value);return ()=>listeners.delete(fn);}};};
// React effect/store adapters are deterministic. Transport, JSON-RPC pending
// calls, exact hook bodies, timeouts and reconnection use the locked sources.
function load(file, imports={}, patched=false) {
  const original=fs.readFileSync(path.join(host,file),'utf8');
  const source=patched?reliabilityPatch(original.replaceAll('\r\n','\n'),'/'+file):original;
  const loadedModule={exports:{}};
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module:loadedModule,exports:loadedModule.exports,require:name=>{
    if (!(name in imports)) throw Error('Unmapped fixture import: '+name);
    return imports[name];
  },WebSocket,URL,Error,setTimeout,clearTimeout,DOMException,AbortSignal,console,window:{hermesDesktop:{getConnection:async()=>({wsUrl:imports.wsUrl})}}},{filename:file});
  return loadedModule.exports;
}
const {JsonRpcGatewayClient}=load('apps/shared/src/json-rpc-gateway.ts');
const records=[];
async function scenario(kind,patched) {
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});
  await new Promise(resolve=>server.once('listening',resolve));
  const wsUrl=`ws://127.0.0.1:${server.address().port}`;
  const ledger={kind,patched,requestsSent:0,serverReceived:0,executions:0,ack:'NONE',sessionId:'synthetic-runtime',messageId:null};
  server.on('connection',socket=>socket.on('message',data=>{
    const frame=JSON.parse(String(data));
    if(frame.method==='session.resume') {socket.send(JSON.stringify({id:frame.id,result:{session_id:'synthetic-runtime'}}));return;}
    if(frame.method!=='prompt.submit')throw Error('Unexpected fixture method');
    ledger.serverReceived++;
    if(kind==='session-not-found'&&ledger.serverReceived===1) {ledger.ack='EXPLICIT_REJECTION';socket.send(JSON.stringify({id:frame.id,error:{message:'session not found'}}));return;}
    ledger.executions++;
    if(ledger.serverReceived===1&&kind!=='before-send'&&kind!=='session-not-found') {
      ledger.ack='LOST';
      if(kind==='response-disconnect')socket.send(JSON.stringify({method:'event',params:{type:'message.delta',session_id:'synthetic-runtime',payload:{delta:'synthetic partial'}}}));
      if(kind!=='timeout')socket.close();
      return;
    }
    ledger.ack='RECEIVED';socket.send(JSON.stringify({id:frame.id,result:{accepted:true}}));
  }));
  const gateway=new JsonRpcGatewayClient({notConnectedErrorMessage:'Hermes gateway is not connected',closedErrorMessage:'Hermes gateway connection closed',requestTimeoutMs:40,socketFactory:url=>{
    const socket=new WebSocket(url),send=socket.send.bind(socket);
    socket.send=data=>{if(JSON.parse(data).method==='prompt.submit')ledger.requestsSent++;return send(data);};return socket;
  }});
  const realRequest=gateway.request.bind(gateway);
  gateway.request=(...args)=>{if(args[0]==='prompt.submit')ledger.transportCalls=(ledger.transportCalls??0)+1;return realRequest(...args);};
  if(kind!=='before-send')await gateway.connect(wsUrl);
  const gatewayAtom=atom(gateway),gatewayState=atom(kind==='before-send'?'closed':'open');
  gateway.onState(state=>gatewayState.set(state));
  const gatewayHook=load(targets.gateway,{
    '@hermes/shared':{isGatewayReauthRequired:()=>false,resolveGatewayWsUrl:async()=>wsUrl},
    '@nanostores/react':{useStore:a=>a.get()},
    react:{useCallback:f=>f,useEffect:f=>f(),useRef:value=>{const ref={current:value};if(typeof value==='string')gatewayState.subscribe(next=>{ref.current=next;});return ref;}},
    '@/store/gateway':{$gateway:gatewayAtom,isActivePrimary:()=>true,ensureActiveGatewayOpen:async()=>gateway},
    '@/store/profile':{$activeGatewayProfile:atom(null)},
    '@/store/session':{$gatewayState:gatewayState,setConnection:()=>{}},wsUrl
  },patched).useGatewayRequest();
  const states=atom({'synthetic-runtime':{messages:[],busy:false,awaitingResponse:false}});
  const busyRef={current:false};
  const utils=load('apps/desktop/src/app/session/hooks/use-prompt-actions/utils.ts',{
    '@/i18n':{translateNow:()=>''},'@/lib/desktop-slash-commands':{},'@/lib/provider-setup-errors':{isProviderSetupErrorMessage:()=>false}
  });
  const submit=load(targets.submit,{
    react:{useCallback:f=>f},'@/hermes':{PROMPT_SUBMIT_REQUEST_TIMEOUT_MS:40},
    '@/lib/chat-messages':{textPart:text=>({type:'text',text})},'@/lib/chat-runtime':{optimisticAttachmentRef:()=>null},
    '@/lib/composer-input-sanitize':{sanitizeComposerInput:s=>s},'@/lib/mutable-ref':{setMutableRef:(ref,value)=>{ref.current=value;}},
    '@/lib/voice-playback':{isVoicePlaybackActive:()=>false,takeVoicePlaybackInterrupted:()=>false},
    '@/store/composer':{$composerAttachments:atom([]),clearComposerAttachments:()=>{},terminalContextBlocksFromDraft:()=>[]},
    '@/store/notifications':{clearNotifications:()=>{},notify:()=>{},notifyError:()=>{}},
    '@/store/onboarding':{requestDesktopOnboarding:()=>{}},
    '@/store/session':{$sessions:atom([]),resolveComposerSessionKey:s=>s,setBusy:()=>{},setAwaitingResponse:()=>{},setMessages:()=>{}},
    '@/store/session-states':{$sessionStates:states},'../session-context-drift':{sessionContextDrift:()=>null},
    '../use-session-actions/utils':{resolveSessionProfile:async()=>null},'./utils':utils
  },patched).useSubmitPrompt({
    activeSessionIdRef:{current:'synthetic-runtime'},busyRef,copy:{promptFailed:'Failed'},
    createBackendSessionForSend:async()=>{throw Error('Unexpected create');},
    getRoutedStoredSessionId:()=>null,getRuntimeIdForStoredSession:()=>null,getRouteToken:()=>'/synthetic',
    requestGateway:gatewayHook.requestGateway,resumeStoredSession:()=>{},selectedStoredSessionIdRef:{current:'synthetic-stored'},
    syncAttachmentsForSubmit:async()=>[],updateSessionState:(id,update)=>{const next=update(states.get()[id]);states.set({...states.get(),[id]:next});return next;}
  });
  try {
    ledger.submitReturned=await submit('SYNTHETIC A02 FAULT');
    const state=states.get()['synthetic-runtime'];
    ledger.messageId=state.messages.find(m=>m.role==='user')?.id;
    ledger.finalUI={busy:state.busy,awaiting:state.awaitingResponse,pendingBranchGroup:state.pendingBranchGroup,submitLockReleased:utils._submitInFlight.size===0,userMessages:state.messages.filter(m=>m.role==='user').length,errors:state.messages.filter(m=>m.error).map(m=>m.error)};
    ledger.reexecuted=ledger.executions>1;
    if(patched&&['ack-lost','response-disconnect','timeout'].includes(kind)){
      assert.equal(ledger.executions,1);assert.equal(ledger.requestsSent,1);
      assert.match(ledger.finalUI.errors[0],/^UNKNOWN/);assert.equal(state.busy,false);assert.equal(state.awaitingResponse,false);
      assert.equal(state.pendingBranchGroup,null);assert.equal(utils._submitInFlight.size,0);
      const before=ledger.requestsSent;await submit('SYNTHETIC QUEUE DRAIN',{fromQueue:true});assert.equal(ledger.requestsSent,before);
      ledger.unknownQueueDrainBlocked=true;
    }
    if(patched&&['before-send','session-not-found'].includes(kind)){assert.equal(ledger.executions,1);assert.equal(ledger.submitReturned,true);}
    records.push(ledger);
  } finally {gateway.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));}
}
try {
  for(const patched of [false,true])for(const kind of ['before-send','ack-lost','response-disconnect','timeout','session-not-found'])await scenario(kind,patched);
  assert.ok(records.some(r=>!r.patched&&r.reexecuted),'Must reproduce original duplicate execution');
  fs.writeFileSync(`${out}/retry-fault-verification.json`,JSON.stringify({status:'PASS',level:'L2 isolated real WebSocket fixture + locked native JSON-RPC and hook bodies; deterministic React/store adapters, no real Provider',records},null,2)+'\n');
  const patches=Object.values(targets).map(file=>{const source=fs.readFileSync(path.join(host,file),'utf8');return patchRecord(file,source,reliabilityPatch(source.replaceAll('\r\n','\n'),'/'+file));});
  fs.writeFileSync(`${out}/reliability-patch-manifest.json`,JSON.stringify({upstreamCommit:'eb52760564dbba2e5971fa54bd67384e281cd3b8',exactAnchors:true,defaultOptIn:false,records:patches},null,2)+'\n');
  console.log(JSON.stringify({status:'PASS',cases:records.length,originalDuplicateCases:records.filter(r=>!r.patched&&r.reexecuted).map(r=>r.kind)}));
}catch(error){fs.writeFileSync(`${out}/fault-failure-${Date.now()}.json`,JSON.stringify({error:String(error.stack),records},null,2)+'\n');throw error;}
