import fs from 'node:fs';
const out='docs/architecture/evidence/p522-host-a02-02';
const c=JSON.parse(fs.readFileSync('artifacts/p522-host-a02-01/provider.local.json','utf8').replace(/^\uFEFF/,''));
const records=[];const save=()=>fs.writeFileSync(out+'/provider-verification.json',JSON.stringify({endpoint:c.base_url,model:c.model,records,automaticRetries:0},null,2)+'\n');
for(const kind of ['text','stream','tool']){
 const tool={type:'function',function:{name:'a02_qualification_echo',description:'Return the fixed synthetic qualification value. Call exactly once when requested.',parameters:{type:'object',properties:{value:{type:'string',enum:['A02_SYNTHETIC']}},required:['value'],additionalProperties:false}}};
 const body={model:c.model,messages:[{role:'user',content:kind==='tool'?'Call a02_qualification_echo exactly once with value A02_SYNTHETIC.':'Reply exactly: A02-PROVIDER-OK.'}],stream:kind==='stream',max_tokens:512,...(kind==='tool'?{tools:[tool],tool_choice:'required'}:{})};
 const r={kind,startedAt:new Date().toISOString()};records.push(r);
 try{const response=await fetch(c.base_url.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.api_key},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});r.httpStatus=response.status;
 const raw=await response.text();if(raw.includes(c.api_key))throw Error('Credential echoed; refusing persistence');
 if(kind==='stream'){const frames=raw.split('\n').filter(l=>l.startsWith('data:')&&!l.includes('[DONE]')).map(l=>JSON.parse(l.slice(5)));r.nonemptyDeltas=frames.filter(f=>f.choices?.[0]?.delta?.content).length;r.returnedModels=[...new Set(frames.map(f=>f.model).filter(Boolean))];r.text=frames.map(f=>f.choices?.[0]?.delta?.content??'').join('');r.pass=response.ok&&r.nonemptyDeltas>0;}
 else{const data=JSON.parse(raw);r.response=data;r.pass=response.ok&&(kind==='tool'?data.choices?.[0]?.message?.tool_calls?.[0]?.function?.name==='a02_qualification_echo':!!data.choices?.[0]?.message?.content);}
 }catch(e){r.error=e.name;r.pass=false;}save();console.log(JSON.stringify({kind,httpStatus:r.httpStatus,pass:r.pass,error:r.error}));if(!r.pass)break;
}
