import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForNativeGatewayReady} from '../scripts/p522-host-a02-01-gateway-ready.mjs';
class Socket extends EventTarget{
 static last;closed=0;listeners=new Map();
 constructor(){super();Socket.last=this;}
 addEventListener(n,f){super.addEventListener(n,f);this.listeners.set(f,n);}
 removeEventListener(n,f){super.removeEventListener(n,f);this.listeners.delete(f);}
 close(){this.closed++;}
 frame(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
}
test('requires actual ready, sends no RPC, cleans listeners once',async()=>{const p=waitForNativeGatewayReady('ws://synthetic',{WebSocketClass:Socket});const s=Socket.last;s.dispatchEvent(new Event('open'));s.frame({method:'event',params:{type:'session.info'}});assert.equal(s.closed,0);s.frame({method:'event',params:{type:'gateway.ready'}});await p;assert.equal(s.closed,1);assert.equal(s.listeners.size,0);});
for(const event of ['error','close'])test(event+' rejects and cleans listeners',async()=>{const p=waitForNativeGatewayReady('ws://synthetic',{WebSocketClass:Socket});const s=Socket.last;s.dispatchEvent(new Event(event));await assert.rejects(p,/before native gateway.ready/);assert.equal(s.listeners.size,0);assert.equal(s.closed,1);});
test('bounded timeout, including open without ready',async()=>{const p=waitForNativeGatewayReady('ws://synthetic',{WebSocketClass:Socket,timeoutMs:10});const s=Socket.last;s.dispatchEvent(new Event('open'));await assert.rejects(p,/timed out/);assert.equal(s.listeners.size,0);assert.equal(s.closed,1);});
