import crypto from 'node:crypto';

export const unknownOutcome = 'UNKNOWN：请求执行结果未知，未自动重发。请检查会话状态并核对历史后再继续。';
export const targets = {
  gateway:'apps/desktop/src/app/gateway/hooks/use-gateway-request.ts',
  submit:'apps/desktop/src/app/session/hooks/use-prompt-actions/submit.ts'
};
const lockedNormalizedSha = {
  [targets.gateway]:'79dbd733b73ecc8e867aa556e9dcb739e53db226aaca32e14f264be747b5c7f4',
  [targets.submit]:'b266bfa2f00b953e51c16e48bbebf415438686ca31fa06016b298f93ad322890'
};
const replace = (source, anchor, replacement) => {
  if (source.split(anchor).length !== 2) throw Error('A02 exact anchor changed: '+anchor);
  return source.replace(anchor, replacement);
};
export function reliabilityPatch(source, file) {
  const target = Object.values(targets).find(target => file.endsWith('/'+target));
  if (target && crypto.createHash('sha256').update(source).digest('hex') !== lockedNormalizedSha[target]) throw Error('A02 locked original SHA changed: '+target);
  if (file.endsWith('/'+targets.gateway)) {
    source = replace(source, '      const gateway = gatewayRef.current\n\n      if (!gateway)', '      let gateway = gatewayRef.current\n\n      if (!gateway)');
    source = replace(source, '      try {\n        return await gateway.request<T>(method, params, timeoutMs, signal)', `      // Reconnect before invoking a mutating request, never after its outcome
      // becomes uncertain. connectionState is the native transport getter.
      if (method === 'prompt.submit' && gateway.connectionState !== 'open') {
        const recovered = isActivePrimary() ? await ensureGatewayOpen() : await ensureActiveGatewayOpen()
        if (!recovered) throw new Error('Hermes gateway unavailable; request not sent')
        gateway = recovered
      }

      try {
        return await gateway.request<T>(method, params, timeoutMs, signal)`);
    const anchor = '        if (!/not connected|connection closed/i.test(message)) {';
    return replace(source, anchor, `        // A server error string cannot prove the request was not sent.
        if (method === 'prompt.submit' && /not connected|connection closed|request timed out|aborted/i.test(message)) {
          throw new Error(${JSON.stringify(unknownOutcome)})
        }

${anchor}`);
  }
  if (file.endsWith('/'+targets.submit)) {
    let patched = replace(source,
      '          if ((isSessionNotFoundError(firstErr) || isGatewayTimeoutError(firstErr)) && recoverStoredSessionId) {',
      '          if (isSessionNotFoundError(firstErr) && recoverStoredSessionId) {');
    patched = replace(patched, '  isGatewayTimeoutError,\n', '');
    patched = replace(patched,
      '            // Timeouts recover the same way as "session not found": a starved\n            // backend loop (#55578 symptom d) rejects the submit even though\n            // the stored session is fine — resume + retry instead of erroring\n            // out and losing the session binding.',
      '            // Explicit session-not-found is a refusal before execution.\n            // A timeout or missing ACK never authorizes resubmission.');
    patched = replace(patched, '        const message = inlineErrorMessage(err, copy.promptFailed)',
      `        const rawError = err instanceof Error ? err.message : String(err)
        const unknownExecution = /UNKNOWN|request timed out|connection closed|aborted/i.test(rawError)
        const message = unknownExecution ? ${JSON.stringify(unknownOutcome)} : inlineErrorMessage(err, copy.promptFailed)`);
    patched = replace(patched, '      const guardSessionId = options?.sessionId ?? activeSessionIdRef.current',
      `      const guardSessionId = options?.sessionId ?? activeSessionIdRef.current
      // Keep uncertainty in the existing session transcript, including for
      // queue drains. Do not turn a failed ACK into another automatic send.
      if (guardSessionId && $sessionStates.get()[guardSessionId]?.messages.some(message => message.error?.startsWith('UNKNOWN'))) {
        notify({ kind: 'error', title: 'UNKNOWN', message: ${JSON.stringify(unknownOutcome)} })
        return false
      }`);
    return patched;
  }
  return source;
}
export function patchRecord(file, source, patched) {
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  return {file, originalSha256:hash(source),patchedSha256:hash(patched),upstreamFileWritten:false};
}
