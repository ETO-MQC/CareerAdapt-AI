import {sha} from './p522-host-a02-04-common.mjs';
export const journalTarget='apps/desktop/src/lib/inflight-turn-journal.ts';
export function sessionPersistencePatch(source,file){
 if(file.endsWith('/apps/desktop/src/app/session/hooks/use-prompt-actions/submit.ts')){
  if(sha(source)!=='745791cce6fab653a0c325757aa63fea6ba7e7d1bef475b972f35af79755ea50')throw Error('A04 requires exact locked A02 reliability submit overlay');
  const guard="$sessionStates.get()[guardSessionId]?.messages.some(message => message.error?.startsWith('UNKNOWN'))";
  if(source.split(guard).length!==2)throw Error('UNKNOWN guard anchor changed');
  return "import { readInFlightTurnJournal } from '@/lib/inflight-turn-journal'\n"+source.replace(guard,"("+guard+" || readInFlightTurnJournal($sessionStates.get()[guardSessionId]?.storedSessionId ?? null)?.messages.some(message => message.error?.startsWith('UNKNOWN')))");
 }
 if(!file.endsWith('/'+journalTarget))return source;
 if(sha(source)!=='f24fb72b525936bf30a7cb328fc03b0388f51eb6e5be3fdac94cf21e6bf3a5c1')throw Error('Locked native journal SHA changed');
 const anchor='  if (!state.busy && !state.awaitingResponse && !state.streamId) {';
 if(source.split(anchor).length!==2)throw Error('Native journal idle anchor changed');
 return source.replace(anchor,`  // An uncertain submit is settled in the UI, but its outcome is still unknown.
  // Reuse the native recovery journal and flush immediately before pagehide.
  // Keep the existing session-scoped transcript guard across reload/restart.
  if (state.messages.some(message => message.error?.startsWith('UNKNOWN'))) {
    const timer = persistTimers.get(storedSessionId)
    if (timer) clearTimeout(timer)
    persistTimers.delete(storedSessionId)
    persistLatest.delete(storedSessionId)
    writeSnapshot(storedSessionId, state)
    return
  }

${anchor}
    // Resume initializes an empty idle projection before it merges disk history.
    // That bootstrap commit cannot settle an already journaled uncertain turn.
    // Only the native authoritative-history merge may clear it as caught up.
    if (readInFlightTurnJournal(storedSessionId)?.messages.some(message => message.error?.startsWith('UNKNOWN'))) {
      return
    }`);
}
export const sessionPatchRecord=(source,patched)=>({file:journalTarget,originalSha256:sha(source),patchedSha256:sha(patched),upstreamWritten:false});
