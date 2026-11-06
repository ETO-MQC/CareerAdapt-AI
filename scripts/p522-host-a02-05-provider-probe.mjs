import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {loadLocalPool,credential,budgets,capabilityNames} from './p522-host-a02-05-provider-pool.mjs';
import {write} from './p522-host-a02-05-common.mjs';
// No cleanup hooks, filesystem removal, raw responses, or authentication logging.
function png(){
 const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(name,b)=>{const n=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(b.length);sum.writeUInt32BE(crc(Buffer.concat([n,b])));return Buffer.concat([size,n,b,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(32);header.writeUInt32BE(32,4);header[8]=8;header[9]=2;
 const pixels=Buffer.alloc(32*(1+32*3));for(let y=0;y<32;y++)for(let x=0;x<32;x++)pixels[y*97+1+x*3]=255;
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const {file,pool}=loadLocalPool(),records=[];
for(const provider of pool.providers.filter(p=>p.enabled))for(const model of provider.models.filter(m=>m.enabled)){
 for(const capability of capabilityNames){
  const nonce=randomBytes(6).toString('hex'),task=capability==='streaming'?'streaming':capability==='vision'?'vision':capability==='long_context'?'long_generation':capability==='tool_calling'?'tool_execution':'interactive_text';
  const budget=model.timeouts[task] || budgets[task];
  const r={provider:provider.id,model:model.id,capability,budgetMs:budget,startedAt:new Date().toISOString(),deltaCount:0,ttftMs:null,terminal:'UNKNOWN',verified:false};records.push(r);
  let content=`Reply exactly ${nonce}`;
  const body={model:model.id,max_tokens:1024,stream:capability==='streaming',messages:[{role:'user',content}]};
  if(capability==='structured_json'){body.messages[0].content=`Return a JSON object with key nonce and value ${nonce}. No other text.`;body.response_format={type:'json_object'};}
  if(capability==='tool_calling'){body.messages[0].content=`Call qualification_echo with nonce ${nonce}.`;body.tools=[{type:'function',function:{name:'qualification_echo',description:'Synthetic non-executing capability probe',parameters:{type:'object',properties:{nonce:{type:'string'}},required:['nonce']}}}];body.tool_choice='required';}
  if(capability==='vision')body.messages[0].content=[{type:'text',text:'What single color fills this image? Reply only the color name.'},{type:'image_url',image_url:{url:png()}}];
  if(capability==='long_context')body.messages[0].content=`Start marker ${nonce}.\n${'synthetic context padding '.repeat(4000)}\nReturn only the start marker.`;
  const start=Date.now();
  try{
   const response=await fetch(provider.base_url.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential(provider)}`},body:JSON.stringify(body),signal:AbortSignal.timeout(budget)});r.httpStatus=response.status;
   if(!response.ok){await response.body?.cancel();r.terminal=response.status===504?'PROVIDER_HTTP_504_UNKNOWN':`HTTP_${response.status}`;}
   else if(body.stream){
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',text='',done=false;
    while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(raw==='[DONE]'){done=true;continue;}if(!raw)continue;const frame=JSON.parse(raw),delta=frame.choices?.[0]?.delta?.content;if(delta){r.ttftMs??=Date.now()-start;r.deltaCount++;text+=delta;}}}
    r.verified=done&&text.trim()===nonce&&r.deltaCount>0;r.terminal=done?'SSE_DONE':'SSE_INTERRUPTED_UNKNOWN';
   }else{
    const value=await response.json(),message=value.choices?.[0]?.message,text=message?.content || '';r.responseMs=Date.now()-start;
    if(capability==='tool_calling'){const call=message?.tool_calls?.[0];r.verified=call?.function?.name==='qualification_echo'&&JSON.parse(call.function.arguments).nonce===nonce;}
    else if(capability==='structured_json')r.verified=JSON.parse(text).nonce===nonce;
    else if(capability==='vision')r.verified=/^red[.!]?$/i.test(text.trim());
    else r.verified=text.trim()===nonce;
    r.terminal='HTTP_200_COMPLETE';
   }
  }catch(e){r.errorType=e.name;r.transportCode=e.cause?.code;r.terminal=e.name==='TimeoutError'?'CLIENT_TIMEOUT_UNKNOWN':r.deltaCount?'SSE_INTERRUPTED_UNKNOWN':'REQUEST_ERROR_UNKNOWN';}
  r.elapsedMs=Date.now()-start;model.capabilities[capability]=r.verified?'VERIFIED':'UNKNOWN';
  fs.writeFileSync(file,JSON.stringify(pool,null,2)+'\n');write('provider-pool-verification',{status:'CAPABILITIES_INDIVIDUALLY_PROBED',records,automaticRetries:0,automaticFallbacks:0,visionScope:'Single red-color recognition probe only',longContextScope:'4000 repetitions synthetic retrieval probe, not advertised maximum context'});
  console.log(JSON.stringify(r));
 }
}
