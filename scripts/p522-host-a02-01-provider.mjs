import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const out='docs/architecture/evidence/p522-host-a02-01';
const config=JSON.parse(fs.readFileSync('.artifacts/p522-host-a02-01/provider.local.json','utf8').replace(/^\uFEFF/,''));
assert.equal(config.base_url,'https://openrouter.ai/api/v1');
assert.equal(config.model,'dots-studio/dots-3-note-preview:free');
assert.ok(config.api_key?.trim(),'Local credential missing');
const records=[];
const mode=process.argv.includes('--vision')?'vision':'connection';
const write=()=>fs.writeFileSync(`${out}/${mode==='vision'?'vision-api':'provider-verification'}.json`,JSON.stringify({at:new Date().toISOString(),endpoint:config.base_url,requestedModel:config.model,status:records.length&&records.every(r=>r.status==='PASS')?'PASS':'NOT_QUALIFIED',records,automaticRetries:0,credentialLogged:false},null,2)+'\n');
async function probe(label,stream=false,image) {
  const prompt=image?'请准确识别图片中央显示的唯一字符串。':`A02-OPENROUTER-CONNECTION-TEST ${label}. Reply with exactly A02-CONNECTION-OK.`;
  const content=image?[{type:'text',text:prompt},{type:'image_url',image_url:{url:'data:image/png;base64,'+image.toString('base64')}}]:prompt;
  const record={label,stream,startedAt:new Date().toISOString(),status:'RUNNING'};records.push(record);
  const start=performance.now();
  try {
    const response=await fetch(config.base_url+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.api_key},body:JSON.stringify({model:config.model,messages:[{role:'user',content}],stream,max_tokens:1024}),signal:AbortSignal.timeout(45000)});
    record.httpStatus=response.status;
    if(!response.ok){record.status='EXTERNAL_FAILURE';record.category=response.status===401||response.status===403?'AUTHENTICATION_OR_PERMISSION':response.status===429?'RATE_LIMIT':response.status===404?'MODEL_NOT_FOUND':response.status>=500?'UPSTREAM_UNAVAILABLE':'PROVIDER_REJECTION';await response.body?.cancel();return false;}
    if(!stream){const data=await response.json();record.returnedModel=data.model;record.text=data.choices?.[0]?.message?.content??'';record.finishReason=data.choices?.[0]?.finish_reason;}
    else {
      let buffer='',text='',frames=0,done=false;const decoder=new TextDecoder();
      for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let index;
        while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);if(!line.startsWith('data:'))continue;const value=line.slice(5).trim();if(value==='[DONE]'){done=true;continue;}const data=JSON.parse(value);record.returnedModel=data.model??record.returnedModel;const delta=data.choices?.[0]?.delta?.content;if(delta){if(!frames)record.ttftMs=performance.now()-start;frames++;text+=delta;}if(data.choices?.[0]?.finish_reason)record.finishReason=data.choices[0].finish_reason;}
      }
      record.text=text;record.contentDeltaFrames=frames;record.done=done;
    }
    record.modelMatches=record.returnedModel?.replace(/:free$/,'')===config.model.replace(/:free$/,'');
    if(image){const metadata=JSON.parse(fs.readFileSync('.artifacts/p522-host-a02-01/vision-fixture.json','utf8'));record.expectedMarker=metadata.marker;record.correct=record.text.includes(metadata.marker);record.image={bytes:image.length,sha256:crypto.createHash('sha256').update(image).digest('hex')};}
    record.status=record.modelMatches&&Boolean(record.text.trim())&&(!image||record.correct)&&(!stream||record.done&&record.contentDeltaFrames>1)?'PASS':'FAIL';return record.status==='PASS';
  }catch(error){record.status='EXTERNAL_FAILURE';record.category=error.name==='TimeoutError'?'NETWORK_TIMEOUT_UNKNOWN':'NETWORK_FAILURE_UNKNOWN';return false;}
  finally{record.totalMs=performance.now()-start;write();console.log(JSON.stringify({label,status:record.status,httpStatus:record.httpStatus,category:record.category,totalMs:record.totalMs}));}
}
fs.mkdirSync(out,{recursive:true});
if(mode==='vision')await probe('vision-api',false,fs.readFileSync('.artifacts/p522-host-a02-01/vision.png'));
else if(await probe('sequential-1'))if(await probe('sequential-2'))await probe('stream',true);
write();
if(records.some(r=>r.status!=='PASS'))process.exitCode=1;
