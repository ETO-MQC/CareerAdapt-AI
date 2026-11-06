import fs from 'node:fs';
import path from 'node:path';
import {write,root} from './p522-host-a02-05-common.mjs';
export const capabilityNames=['text','streaming','tool_calling','vision','structured_json','long_context'];
export const budgets={interactive_text:30000,streaming:45000,long_generation:90000,vision:60000,tool_execution:60000};
const requirements={interactive_text:'text',streaming:'streaming',long_generation:'long_context',vision:'vision',tool_execution:'tool_calling',json:'structured_json'};
export function normalizePool(config){
 if(Array.isArray(config.providers))return config;
 return {version:1,providers:[{id:config.provider_id || 'legacy',base_url:config.base_url,api_key:config.api_key,enabled:true,priority:0,models:[{id:config.model,enabled:true,priority:0,capabilities:Object.fromEntries(capabilityNames.map(c=>[c,'UNKNOWN'])),timeouts:{...budgets},task_types:Object.keys(requirements),fallback_order:0}]}]};
}
export function selectModels(pool,task){
 const required=requirements[task]; if(!required)throw Error('Unknown task type');
 return pool.providers.filter(p=>p.enabled).flatMap(p=>p.models.filter(m=>m.enabled&&m.task_types.includes(task)&&m.capabilities[required]==='VERIFIED').map(m=>({provider:p,model:m}))).sort((a,b)=>(a.provider.priority-b.provider.priority)||(a.model.priority-b.model.priority)||(a.model.fallback_order-b.model.fallback_order));
}
export function safeToFallback({status,code,deltaCount=0,toolExecuted=false,sent=true}){
 if(deltaCount||toolExecuted)return false;
 if([401,403,429].includes(status))return true;
 return !sent&&['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT'].includes(code);
}
export async function runWithPool(pool,task,execute){
 const candidates=selectModels(pool,task),switches=[];
 for(let i=0;i<candidates.length;i++){
  const result=await execute(candidates[i]);
  if(result.ok)return {...result,switches};
  if(!safeToFallback(result)||i===candidates.length-1)return {...result,switches};
  switches.push({from:candidates[i].provider.id,model:candidates[i].model.id,reason:result.status?`HTTP_${result.status}`:result.code,to:candidates[i+1].provider.id});
 }
 return {ok:false,terminal:'NO_VERIFIED_MODEL',switches};
}
export function loadLocalPool(){
 const file=path.join(root,'provider-pool.local.json');
 if(fs.existsSync(file)){
  const pool=normalizePool(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));
  let migrated=false;
  for(const p of pool.providers)if(p.credential_source&&p.api_key&&fs.existsSync(p.credential_source)){
   const source=JSON.parse(fs.readFileSync(p.credential_source,'utf8').replace(/^\uFEFF/,''));
   if(source.api_key===p.api_key){delete p.api_key;migrated=true;}
  }
  if(migrated)fs.writeFileSync(file,JSON.stringify(pool,null,2)+'\n');
  return {file,pool};
 }
 const sources=['artifacts/p522-host-a02-01/provider.local.json','.artifacts/p522-host-a02-01/provider.local.json'].filter(f=>fs.existsSync(f));
 const providers=[];
 for(const [i,source] of sources.entries()){
  const c=JSON.parse(fs.readFileSync(source,'utf8').replace(/^\uFEFF/,''));
  if(!c.base_url||!c.model)continue;
  if(providers.some(p=>p.base_url===c.base_url&&p.models.some(m=>m.id===c.model)))continue;
  const p=normalizePool(c).providers[0];p.id=`local-${i+1}`;p.priority=i;p.enabled=Boolean(c.api_key || c.api_key_env);p.credential_source=source;p.api_key_env=c.api_key_env;
  delete p.api_key; // Reference the original ignored credential, do not duplicate it.
  providers.push(p);
 }
 fs.mkdirSync(root,{recursive:true});const pool={version:1,providers};fs.writeFileSync(file,JSON.stringify(pool,null,2)+'\n');
 return {file,pool};
}
export function credential(p){
 if(p.api_key_env)return process.env[p.api_key_env];
 if(p.api_key)return p.api_key;
 if(p.credential_source)return JSON.parse(fs.readFileSync(p.credential_source,'utf8').replace(/^\uFEFF/,'')).api_key;
 return undefined;
}
if(process.argv.includes('--audit')){
 const {file,pool}=loadLocalPool();
 write('provider-pool-audit',{status:'LOCAL_POOL_CREATED',file,gitIgnored:true,legacyConfigsUnchanged:true,productionDispatchChanged:false,providers:pool.providers.map(p=>({id:p.id,base_url:p.base_url,enabled:p.enabled,priority:p.priority,credentialPresent:Boolean(credential(p)),credentialSource:p.credential_source,models:p.models.map(m=>({id:m.id,capabilities:m.capabilities,timeouts:m.timeouts,task_types:m.task_types,fallback_order:m.fallback_order}))}))});
 console.log(JSON.stringify({providers:pool.providers.length,enabled:pool.providers.filter(p=>p.enabled).length}));
}
