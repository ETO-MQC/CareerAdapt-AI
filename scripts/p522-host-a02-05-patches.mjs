import {createHash} from 'node:crypto';
export function artifactPatch(source,file){
 if(!file.endsWith('/src/app/artifacts/index.tsx'))return source;
 if(createHash('sha256').update(source).digest('hex')!=='095e7b06d10b7d02f653ba87f89c06b65010b982d519d9ad26f3e4e0e3826d0d')throw Error('Unqualified native Artifact source SHA');
 if(!source.includes('export function ArtifactsView(')||!source.includes('collectArtifactsForSession'))throw Error('Native Artifact composition anchor changed');
 return `import {useNavigate} from 'react-router-dom';
import {CareerArtifacts} from 'virtual:careeradapt-host/navigation';
import {getSessionMessages,listAllProfileSessions} from '@/hermes';
import {collectArtifactsForSession} from './artifact-utils';
import {readDesktopFileText,readDesktopFileDataUrl} from '@/lib/desktop-fs';
import {Button} from '@/components/ui/button';
import {sessionRoute} from '../routes';
import type {SessionInfo,SessionMessage} from '@/types/hermes';
import {$selectedStoredSessionId,$messages,$busy,$awaitingResponse,$connection} from '@/store/session';
import {readInFlightTurnJournal} from '@/lib/inflight-turn-journal';
type P=Parameters<typeof CareerArtifacts>[0];
const list=()=>listAllProfileSessions(100,1,'exclude','recent',$connection.get()?.profile || 'default');
const collect=(s: Parameters<Parameters<typeof CareerArtifacts>[0]['collect']>[0],m: Parameters<Parameters<typeof CareerArtifacts>[0]['collect']>[1])=>collectArtifactsForSession(s as SessionInfo,m as SessionMessage[]);
const observe:P['observe']=(s,history)=>{
 const index=history.findLastIndex(m=>m.role==='user');
 if(index<0)return [];
 const user=history[index];
 const taskLocator=JSON.stringify([s.profile || '',s.id,user.id===undefined?'user-position':'user-message',user.id??index]);
 const journal=readInFlightTurnJournal(s.id);
 if(journal?.messages.some(m=>m.error?.startsWith('UNKNOWN')))return [{taskLocator,state:'UNKNOWN'}];
 if($selectedStoredSessionId.get()!==s.id)return [];
 const current=$messages.get();const tail=current.slice(current.findLastIndex(m=>m.role==='user')+1);const error=tail.findLast(m=>m.role==='assistant'&&m.error)?.error;
 if(error?.startsWith('UNKNOWN'))return [{taskLocator,state:'UNKNOWN'}];
 if($busy.get()||$awaitingResponse.get())return [{taskLocator,state:current.some(m=>m.role==='assistant'&&m.pending)?'STREAMING':'RUNNING'}];
 if(error)return [{taskLocator,state:'FAILED'}];
 return [];
};
export function ArtifactsView(_props: {setStatusbarItemGroup?: unknown}){
 const navigate=useNavigate();
 return <CareerArtifacts list={list} messages={getSessionMessages} collect={collect} observe={observe} read={readDesktopFileText} data={readDesktopFileDataUrl} Button={Button} openSession={(id)=>navigate(sessionRoute(id))}/>;
}
`;
}
