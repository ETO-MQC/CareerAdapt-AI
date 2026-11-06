import crypto from 'node:crypto';
const target='apps/desktop/src/app/session/hooks/use-prompt-actions/index.ts';
export function attachmentPatch(source,file){
 if(!file.endsWith('/'+target))return source;
 if(crypto.createHash('sha256').update(source).digest('hex')!=='157e72c6c68463347adc318191ba925de275bad6c2f241c445cfdb518b9bcd25')throw Error('Locked attachment source SHA changed');
 const expected='    name: label,\n    path,\n    session_id: sessionId,';
 if(source.split(expected).length!==2)throw Error('Locked attachment path anchor changed');
 return source.replace(expected,`    name: label,
    // The gateway also accepts CLI-style "path + prose". Preserve a Windows
    // picker path as one token so a missing file cannot resolve its prefix.
    path: /^[A-Za-z]:[\\\\/]/.test(path) ? '\\"' + path + '\\"' : path,
    session_id: sessionId,`);
}
export function attachmentPatchRecord(source,patched){const hash=s=>crypto.createHash('sha256').update(s).digest('hex');return {file:target,originalSha256:hash(source),patchedSha256:hash(patched),upstreamWritten:false};}
