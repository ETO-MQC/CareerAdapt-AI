// A local HTTP health response precedes the lazy gateway import on this lock.
// Wait for the existing native ready event; never submit an RPC or retry work.
export function waitForNativeGatewayReady(url,{WebSocketClass=globalThis.WebSocket,timeoutMs=45000,onEvent=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  const socket=new WebSocketClass(url);let done=false;
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);for(const [name,handler] of listeners)socket.removeEventListener(name,handler);socket.close();onEvent(error?'failed':'ready');if(error)reject(error);else resolve();};
  const opened=()=>onEvent('open');
  const message=event=>{let frame;try{frame=JSON.parse(String(event.data));}catch{return;}if(frame.method==='event'&&frame.params?.type==='gateway.ready')finish();};
  const closed=()=>finish(Error('Local Hermes gateway closed before native gateway.ready'));
  const failed=()=>finish(Error('Local Hermes gateway failed before native gateway.ready'));
  const listeners=[['open',opened],['message',message],['close',closed],['error',failed]];
  const timer=setTimeout(()=>finish(Error(`Local Hermes gateway readiness timed out (${timeoutMs}ms)`)),timeoutMs);
  for(const [name,handler]of listeners)socket.addEventListener(name,handler);
  onEvent('waiting');
 });
}
