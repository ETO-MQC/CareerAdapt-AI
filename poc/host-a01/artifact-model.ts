// Projection only: native transcripts and workspace bytes remain authoritative.
export type SourceMessage = {role: string; content?: unknown; text?: unknown; timestamp?: number; tool_call_id?: string | null; tool_calls?: unknown; id?: string | number};
export type SourceSession = {id: string; profile?: string; title?: string | null; cwd?: string | null; last_active?: number; started_at?: number};
export type ArtifactState = 'REFERENCE' | 'RUNNING' | 'STREAMING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';
export type NativeReference = {value: string; kind: string; label: string};
export type Occurrence = {messageLocator: string; messageId: string | null; taskLocator: string; toolCallId: string | null; timestamp: number; writeConfirmed: boolean; failed: boolean};
export type WorkArtifact = {id: string; value: string; label: string; kind: string; sessionId: string; sessionTitle: string; profile?: string; createdAt: number; updatedAt: number; state: ArtifactState; occurrences: Occurrence[]; versionHistory: false};
export type TurnObservation = {taskLocator: string; state: ArtifactState};
const timestampMs=(value: number | undefined)=>value ? value<1e12 ? value*1000 : value : 0;
export function projectArtifacts(session: SourceSession, messages: SourceMessage[], collect: (session: SourceSession, messages: SourceMessage[]) => NativeReference[], observations: TurnObservation[] = []): WorkArtifact[] {
 const found = new Map<string, WorkArtifact>();
 let userIndex = -1;
 let userId: string | number | undefined;
 messages.forEach((message, index) => {
  if (message.role === 'user') {userIndex = index;userId=message.id;}
  if (!['assistant', 'tool'].includes(message.role)) return;
  // Tool arguments are intentions, not generated results.
  const refs = collect(session, [{...message, tool_calls: undefined}]);
  let result: Record<string, unknown> | null = null;
  if (message.role === 'tool' && typeof message.content === 'string') {
   try { const parsed: unknown = JSON.parse(message.content); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result = parsed as Record<string, unknown>; } catch { /* Plain tool output is not structured write evidence. */ }
  }
  const modified = result && Array.isArray(result.files_modified) ? result.files_modified.filter((v): v is string => typeof v === 'string') : [];
  if(result?.error && typeof result.resolved_path==='string' && !refs.some(r=>r.value===result.resolved_path))refs.push({value:result.resolved_path,label:result.resolved_path.split(/[\\/]/).pop() || result.resolved_path,kind:'file'});
  // Native parser omits Windows drive paths; only structured tool results extend it.
  for (const value of modified) if (!refs.some(r => r.value === value)) refs.push({value, label: value.split(/[\\/]/).pop() || value, kind: /\.(png|jpe?g|webp)$/i.test(value) ? 'image' : 'file'});
  const taskLocator = JSON.stringify([session.profile || '', session.id, userId===undefined?'user-position':'user-message', userId??userIndex]);
  const occurrence: Occurrence = {messageLocator: JSON.stringify([session.profile || '', session.id, message.id===undefined?'message-position':'message', message.id??index]), messageId: message.id === undefined ? null : String(message.id), taskLocator, toolCallId: message.tool_call_id || null, timestamp: timestampMs(message.timestamp), writeConfirmed: false, failed: Boolean(result?.error)};
  for (const ref of refs) {
   if (/^https?:/i.test(ref.value)) continue; // External links are references, not local work products.
   const id = JSON.stringify([session.profile || '', session.id, ref.value]);
   const current = found.get(id);
   const source = {...occurrence, writeConfirmed: !result?.error && modified.includes(ref.value)};
   if (current) { if (!current.occurrences.some(o => o.messageLocator === source.messageLocator)) current.occurrences.push(source); current.updatedAt = Math.max(current.updatedAt, source.timestamp); }
   else found.set(id, {id, value: ref.value, label: ref.label, kind: ref.kind, sessionId: session.id, sessionTitle: session.title || session.id, profile: session.profile, createdAt: source.timestamp, updatedAt: source.timestamp, state: 'REFERENCE', occurrences: [source], versionHistory: false});
  }
 });
 for (const item of found.values()) {
  const last = item.occurrences.at(-1)!;
  const observed = observations.findLast(o => o.taskLocator === last.taskLocator);
  // A successful persisted write is durable evidence for the file operation,
  // not a claim that the enclosing assistant task completed.
  const sameTurn=item.occurrences.filter(o=>o.taskLocator===last.taskLocator);
  item.state = observed?.state === 'UNKNOWN' ? 'UNKNOWN' : sameTurn.some(o=>o.failed) ? 'FAILED' : observed && observed.state !== 'COMPLETED' ? observed.state : sameTurn.some(o=>o.writeConfirmed) ? 'COMPLETED' : 'REFERENCE';
 }
 return [...found.values()];
}

export function safeArtifactPath(value: string, cwd?: string | null): string | null {
 if (/^(?:https?:|data:|file:|\\\\)/i.test(value)) return null;
 if (/^[a-z]:[\\/]/i.test(value) || value.startsWith('/')) return value;
 if (!cwd || value.startsWith('~')) return null;
 const separator = cwd.includes('\\') ? '\\' : '/';
 return cwd.replace(/[\\/]$/, '') + separator + value;
}
