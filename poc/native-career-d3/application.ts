import Dexie from 'dexie';
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {CareerAdaptDb} from '../../src/services/storage/db';
import {WorkspaceRepository} from '../../src/services/storage/repositories';
import {CareerProfileSchema} from '../../src/domain/schemas/profile';
import {ProfileQueryService} from '../../src/services/profile/profileQueryService';
import {ProfileReadAdapter, type ProfileReadAuthorityContext} from '../../src/agent/tools/ProfileReadAdapter';

type Request = ProfileReadAuthorityContext & {tool:string;args:unknown;testDelayMs?:number};
type Bridge = {attach:()=>Promise<unknown>;started:(id:string)=>Promise<unknown>;lifecycle:(enabled:boolean)=>Promise<unknown>;verify:(id:string)=>Promise<boolean>;complete:(payload:unknown)=>Promise<unknown>;onRead:(fn:(r:Request)=>void)=>()=>void};
const bridge=(window as unknown as {careerD3:Bridge}).careerD3;
export const diagnostics={ready:false,markers:{A:crypto.randomUUID(),B:crypto.randomUUID()},calls:[] as {requestId:string;profileId:string;executions:number}[],zeroWrites:false};
// An in-memory test backend of the EXISTING database/schema/Repository, never
// the default IndexedDB or a new business database. Dependency swap is strictly
// synchronous during construction; the browser/global dependencies are restored.
const original={...Dexie.dependencies};
let db:CareerAdaptDb;
try{Dexie.dependencies.indexedDB=new IDBFactory();Dexie.dependencies.IDBKeyRange=IDBKeyRange;db=new CareerAdaptDb('D3_SYNTHETIC_MEMORY_ONLY');}
finally{Object.assign(Dexie.dependencies,original);}
const repository=new WorkspaceRepository(db);
const workspace='d3-synthetic-application';
const timestamp='2026-11-06T09:00:00.000Z';
async function snapshot(){return JSON.stringify(await Promise.all(db.tables.map(async t=>({name:t.name,rows:await t.toArray()}))));}
async function init(){
 for(const id of ['A','B','empty'] as const){
  const profile=CareerProfileSchema.parse({id,personId:`person-${id}`,name:`D3 ${id}`,schemaVersion:'career-profile-v2',profileVersionNumber:1,versionCreatedReason:'initial',isCurrent:true,version:1,createdAt:timestamp,updatedAt:timestamp,basics:{name:'Synthetic'},preference:{},experiences:[],evidences:[],structuredFacts:id==='empty'?[]:[{data:{id:`project-${id}`,sectionType:'project',title:`Synthetic project ${id}`,highlights:[`P522_A05_SYNTHETIC_PROFILE_${id}_${diagnostics.markers[id]}`]},factIds:[],sourceBlockIds:[],sourceRanges:[],provenance:[]}]});
  await db.profiles.put(profile);
  await db.appMeta.put({key:`careerPerson:v1:person-${id}`,updatedAt:timestamp,value:{id:`person-${id}`,displayName:'D3 synthetic',currentProfileId:id,createdAt:timestamp,updatedAt:timestamp}});
 }
 const before=await snapshot();
 bridge.onRead(async request=>{
  const entry={requestId:request.requestId,profileId:request.profileId,executions:0};
  try{
   if(request.workspaceId!==workspace||!['A','B','empty'].includes(request.profileId)||request.personId!==`person-${request.profileId}`)throw Error('UNBOUND_APPLICATION_SCOPE');
   diagnostics.calls.push(entry);
   const service=new ProfileQueryService(repository),query=service.query.bind(service);
   service.query=async(...args)=>{entry.executions++;await bridge.started(request.requestId);if(request.testDelayMs)await new Promise(resolve=>setTimeout(resolve,request.testDelayMs));return query(...args);};
   const context:ProfileReadAuthorityContext={workspaceId:request.workspaceId,personId:request.personId,profileId:request.profileId,sessionId:request.sessionId,grantId:request.grantId,epoch:request.epoch,leaseExpiry:request.leaseExpiry,requestId:request.requestId,profileVersionNumber:request.profileVersionNumber,profileRevision:request.profileRevision};
   const adapter=new ProfileReadAdapter(service,{context:async()=>context,verify:async()=>bridge.verify(request.requestId)});
   const result=await adapter.execute(request.tool,request.args);
   diagnostics.zeroWrites=(await snapshot())===before;
   await bridge.complete({requestId:request.requestId,result:{...result,applicationExecutions:entry.executions,zeroWrites:diagnostics.zeroWrites}});
  }catch(error){await bridge.complete({requestId:request.requestId,result:{ok:false,error:{code:error instanceof Error?error.message:'SERVICE_UNAVAILABLE'},applicationExecutions:entry.executions}});}
 });
 await bridge.attach();diagnostics.ready=true;
}
export const ready=init();
