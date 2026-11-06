import http from 'node:http';
import {config,sha,write} from './p522-host-a02-03-common.mjs';
// Test-only transparent forwarder: no retries, no body/header logging, no tools.
// Stores hashes of image bytes and synthetic text only, before writing evidence.
export async function providerObserver(){
 const ledger=[];
 const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'){
   try{const response=await fetch(config.base_url.replace(/\/$/,'')+req.url.replace(/^\/v1/,''),{headers:{Authorization:`Bearer ${config.api_key}`},signal:AbortSignal.timeout(15000)});res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());}catch{res.writeHead(502);res.end('{}');}return;
  }
  const chunks=[];for await(const c of req)chunks.push(c);
  const bytes=Buffer.concat(chunks);let body;
  try{body=JSON.parse(bytes.toString());}catch{res.writeHead(400);res.end('{"error":"Invalid JSON"}');return;}
  const record={at:Date.now(),configuredModel:body.model,endpoint:config.base_url,requestBytes:bytes.length,messages:(body.messages??[]).map(m=>({role:m.role,content:typeof m.content==='string'?m.content:(m.content??[]).map(p=>{
   if(p.type!=='image_url')return p;
   const url=p.image_url?.url??'',data=url.startsWith('data:')?Buffer.from(url.slice(url.indexOf(',')+1),'base64'):null;
   return {type:'image_url',mime:/^data:([^;]+)/.exec(url)?.[1],rawBytes:data?.length,sha256:data?sha(data):null,base64Characters:url.length-url.indexOf(',')-1};
  })}))};ledger.push(record);
  try{
   const target=config.base_url.replace(/\/$/,'')+req.url.replace(/^\/v1/,'');
   const response=await fetch(target,{method:req.method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.api_key}`},body:bytes,signal:AbortSignal.timeout(180000)});
   record.httpStatus=response.status;record.forwardedAt=Date.now();res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/json'});
   const decoder=new TextDecoder();let pending='';
   for await(const chunk of response.body){res.write(chunk);pending+=decoder.decode(chunk,{stream:true});let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);if(line.startsWith('data: {')){const event=JSON.parse(line.slice(6));if(event.model)record.returnedModel=event.model;}}}
   record.completedAt=Date.now();res.end();
  }catch(error){record.error=String(error);if(!res.headersSent)res.writeHead(502);res.end();}
  write('provider-payload-ledger',{level:'L4_REAL_UPSTREAM_VIA_TEST_ONLY_TRANSPARENT_OBSERVER',rawBase64Saved:false,headersSaved:false,retries:0,records:ledger});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}/v1`,ledger,close:()=>server.close()};
}
