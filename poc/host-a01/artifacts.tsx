import {useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode} from 'react';
import {projectArtifacts, safeArtifactPath, type NativeReference, type SourceMessage, type SourceSession, type WorkArtifact, type TurnObservation} from './artifact-model';
import './artifacts.css';

type Props = {
 list: () => Promise<{sessions: SourceSession[]}>;
 messages: (id: string, profile?: string) => Promise<{messages: SourceMessage[]}>;
 collect: (session: SourceSession, messages: SourceMessage[]) => NativeReference[];
 observe: (session: SourceSession, messages: SourceMessage[]) => TurnObservation[];
 read: (path: string) => Promise<{text: string; binary?: boolean; truncated?: boolean}>;
 data: (path: string) => Promise<string>;
 openSession: (id: string, profile?: string) => void;
 Button: ComponentType<{children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'outline' | 'default'; 'aria-label'?: string}>;
};
const labels = {REFERENCE: '待核实引用', RUNNING: '执行中', STREAMING: '生成中', COMPLETED: '文件写入已确认', FAILED: '失败', CANCELLED: '已中断', UNKNOWN: '结果未知'};
// This Vite/Electron surface displays authenticated local data URLs; Next's image server is not present.
/* eslint-disable @next/next/no-img-element */
export function CareerArtifacts({list, messages, collect, observe, read, data, openSession, Button}: Props) {
 const [items, setItems] = useState<WorkArtifact[]>([]), [selected, setSelected] = useState<string | null>(null);
 const [sessions, setSessions] = useState<SourceSession[]>([]), [filter, setFilter] = useState(''), [query, setQuery] = useState('');
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loadedPreview, setPreview] = useState<{id?: string; text?: string; image?: string; error?: string; truncated?: boolean}>({});
 const generation = useRef(0);
 const refresh = useCallback(async () => {
  const token = ++generation.current; setBusy(true); setError('');
  try {
   const result = await list();
   const rows = await Promise.allSettled(result.sessions.map(async s => {const history=(await messages(s.id,s.profile)).messages;return projectArtifacts(s,history,collect,observe(s,history));}));
   if (token !== generation.current) return;
   setSessions(result.sessions); setItems(rows.flatMap(r => r.status === 'fulfilled' ? r.value : []).sort((a,b) => b.updatedAt-a.updatedAt));
   if (rows.some(r => r.status === 'rejected')) setError('部分会话读取失败，列表不完整。请刷新重试。');
  } catch (e) { if(token===generation.current) {setItems([]); setError(String(e));} }
  finally {if(token===generation.current) setBusy(false);}
 }, [list, messages, collect, observe]);
 useEffect(() => {let disposed=false;const counter=generation;void Promise.resolve().then(()=>{if(!disposed)return refresh();});return () => {disposed=true;counter.current++;};}, [refresh]);
 const visible = items.filter(a => (!filter || JSON.stringify([a.profile || '',a.sessionId])===filter) && `${a.label} ${a.sessionTitle}`.toLowerCase().includes(query.toLowerCase()));
 const active = visible.find(a => a.id===selected);
 const session = active && sessions.find(s => s.id===active.sessionId && s.profile===active.profile);
 const filePath = active ? safeArtifactPath(active.value,session?.cwd) : null;
 const preview=loadedPreview.id===active?.id ? loadedPreview : {};
 useEffect(() => {
  let disposed=false;
  if(!active || !filePath) return;
  const operation = active.kind==='image' ? data(filePath).then(image=>({image})) : read(filePath).then(v=>v.binary ? {error:'此文件为二进制格式，请下载后查看。'} : {text:v.text,truncated:v.truncated});
  void operation.then(value=>{if(!disposed)setPreview({...value,id:active.id});},e=>{if(!disposed)setPreview({id:active.id,error:`文件不可读：${String(e)}`});});
  return () => {disposed=true;};
 }, [active, filePath, read, data]);
 const download = async () => {
  if(!active || !filePath) return;
  try {const result=await data(filePath); const response=await fetch(result); const url=URL.createObjectURL(await response.blob()); const a=document.createElement('a'); a.href=url; a.download=active.label; a.rel='noopener noreferrer';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  catch(e) {setError(`下载失败：${String(e)}`);}
 };
 return <main className="ca-artifacts" aria-label="工作成果">
  <header><div><h1>工作成果</h1><p>从原生会话追溯文件、来源与写入记录。</p></div><Button onClick={()=>void refresh()} disabled={busy}>{busy?'读取中…':'刷新成果'}</Button></header>
  <div className="ca-artifact-filters"><input aria-label="搜索成果" placeholder="搜索文件或会话" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="来源会话" value={filter} onChange={e=>{setFilter(e.target.value);setSelected(null);}}><option value="">全部会话（最近 100 条）</option>{sessions.map(s=><option key={JSON.stringify([s.profile,s.id])} value={JSON.stringify([s.profile || '',s.id])}>{s.title || s.id}</option>)}</select><span>{visible.length} 项</span></div>
  {error && <p role="alert">{error}</p>}
  <div className="ca-artifact-workspace"><section aria-label="成果列表" className="ca-artifact-list">{!visible.length && <p className="ca-artifact-empty">{busy?'正在读取原生历史…':'暂无工作成果。请在 AI 工作台明确要求生成文件。'}</p>}{visible.map(a=><button key={a.id} aria-pressed={a.id===active?.id} onClick={()=>setSelected(a.id)}><strong>{a.label}</strong><span>{a.kind} · {labels[a.state]}</span><small>{a.sessionTitle}</small></button>)}</section>
  <section aria-label="成果详情" className="ca-artifact-detail">{active ? <><h2>{active.label}</h2><span className="ca-artifact-status">{labels[active.state]}</span><dl><dt>来源会话</dt><dd>{active.sessionTitle}</dd><dt>创建 / 更新</dt><dd>{active.createdAt ? new Date(active.createdAt).toLocaleString() : '原生历史未提供时间'} / {active.updatedAt ? new Date(active.updatedAt).toLocaleString() : '未知'}</dd><dt>来源</dt><dd>{active.occurrences.length} 条消息引用 · {active.occurrences.filter(o=>o.writeConfirmed).length} 次确认写入</dd><dt>任务关联</dt><dd>原生用户消息 / 轮次（非后端 Task ID）</dd><dt>版本</dt><dd>原生不保留文件快照；当前文件可能已被覆盖。</dd></dl><div className="ca-artifact-actions"><Button variant="outline" onClick={()=>openSession(active.sessionId,active.profile)}>打开来源会话</Button><Button disabled={!filePath} onClick={()=>void download()}>下载文件</Button></div><details><summary>来源定位与路径</summary><p>{active.value}</p>{active.occurrences.map(o=><p key={o.messageLocator}>{o.messageId ? `Message ${o.messageId}` : o.messageLocator}<br/>{o.toolCallId && `Tool Call ${o.toolCallId}`}</p>)}</details><div className="ca-artifact-preview">{!filePath ? <p>此路径暂不支持安全预览与下载。</p> : preview.error ? <p role="alert">{preview.error}</p> : preview.image ? <img src={preview.image} alt={active.label}/> : preview.text!==undefined ? <><pre>{preview.text}</pre>{preview.truncated && <p>预览已截断，下载查看完整内容。</p>}</> : <p>正在读取文件…</p>}</div></> : <p className="ca-artifact-empty">选择一项成果查看内容与来源。</p>}</section></div>
  <footer>“文件写入已确认”来自原生工具结果，不代表整个任务成功。历史终态无法确定时不自动重发。</footer>
 </main>;
}
