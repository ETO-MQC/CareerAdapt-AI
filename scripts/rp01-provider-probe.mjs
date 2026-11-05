import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

// Explicit one-shot qualification; no retries or model fallback. Credentials stay in memory.
const attachment = process.env.RP01_CREDENTIAL_ATTACHMENT;
const key = process.env.RP01_API_KEY || (attachment && fs.readFileSync(attachment, 'utf8').match(/sk-or-v1-[a-f0-9]+/)?.[0]);
if (!key) throw new Error('RP01 credentials missing');
const model = 'dots-studio/dots-3-note-preview:free';
const structural = process.argv.includes('--structured');
const output = `docs/quality/rp01-logs/provider-${structural ? 'structured' : 'probe'}.json`;
fs.mkdirSync('docs/quality/rp01-logs', { recursive: true });
if (fs.existsSync(output)) throw new Error('Refusing to overwrite qualification evidence; choose a new collection implementation explicitly');
if (fs.existsSync('docs/quality/rp01-logs/provider-stop.json')) throw new Error('Provider stop marker present; no upstream request authorized by this collection');
const report = { provider: 'OpenRouter', model, startedAt: new Date().toISOString(), policy: { temperature: 0, max_tokens: 8192, timeoutMs: 180000, reasoning: { effort: 'low' }, retries: 0 }, requests: [] };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
async function request(id, payload) {
  const start = performance.now();
  const result = { id, httpStatus: null, headersMs: null, firstByteMs: null, totalMs: null, finishReasons: [], usage: null, errorCategory: null };
  report.requests.push(result);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0, max_tokens: 8192, reasoning: { effort: 'low' }, ...payload }), signal: AbortSignal.timeout(180000) });
    result.httpStatus = response.status;
    result.headersMs = Math.round(performance.now() - start);
    let raw = ''; const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      result.firstByteMs ??= Math.round(performance.now() - start);
      raw += decoder.decode(chunk, { stream: true });
    }
    if (raw.includes(key)) throw new Error('credential echoed; response withheld');
    result.body = raw;
    if (!response.ok) result.errorCategory = response.status === 429 ? 'rate_limited' : response.status === 401 ? 'authentication' : 'provider_http_error';
    else if (payload.stream) {
      result.done = raw.includes('data: [DONE]');
      for (const line of raw.split('\n').filter(line => line.startsWith('data: {'))) {
        const data = JSON.parse(line.slice(6));
        if (data.usage) result.usage = data.usage;
        for (const choice of data.choices || []) if (choice.finish_reason) result.finishReasons.push(choice.finish_reason);
      }
    } else {
      const data = JSON.parse(raw);
      result.finishReasons = (data.choices || []).map(choice => choice.finish_reason);
      result.usage = data.usage ?? null;
      result.message = data.choices?.[0]?.message;
      if (data.error) result.errorCategory = 'provider_body_error';
      else if (!result.message?.content && !result.message?.tool_calls?.length) result.errorCategory = 'empty_output';
      else if (result.finishReasons.includes('length')) result.errorCategory = 'truncated';
    }
  } catch (error) { result.errorCategory = error.name === 'TimeoutError' ? 'timeout' : 'transport_or_parse'; result.error = String(error.message).replaceAll(key, '[REDACTED]'); }
  result.totalMs = Math.round(performance.now() - start);
  save();
  console.log(JSON.stringify({ id, httpStatus: result.httpStatus, totalMs: result.totalMs, finishReasons: result.finishReasons, errorCategory: result.errorCategory }));
  return result;
}
if (structural) {
  const tools = ['lookup_profile', 'lookup_job'].map(name => ({ type: 'function', function: { name, description: name === 'lookup_job' ? 'Read a job by id' : 'Read a profile by id', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } } }));
  const call = await request('multi-tool-selection', { tools, tool_choice: 'auto', messages: [{ role: 'user', content: 'Call lookup_job with id synthetic-jd-01. Do not call lookup_profile.' }] });
  if (!call.errorCategory) await request('json-schema', { response_format: { type: 'json_schema', json_schema: { name: 'qualification', strict: true, schema: { type: 'object', properties: { must: { type: 'array', items: { type: 'string' } }, preferred: { type: 'array', items: { type: 'string' } }, pythonEvidence: { type: 'string', enum: ['unknown'] } }, required: ['must', 'preferred', 'pythonEvidence'], additionalProperties: false } } }, messages: [{ role: 'user', content: '岗位必须SQL，Python优先。用户用Excel整理过课程数据，Python证据未知。按schema分类。' }] });
} else {
const first = await request('text', { messages: [{ role: 'user', content: 'Reply with OK only.' }] });
if (first.errorCategory) process.exitCode = 1;
else {
  const stream = await request('stream', { stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: 'Reply with STREAM OK only.' }] });
  if (stream.errorCategory) process.exitCode = 1;
  else {
    const second = await request('two-turn-context', { messages: [{ role: 'user', content: 'Remember synthetic marker RP01-731.' }, { role: 'assistant', content: 'I remember RP01-731.' }, { role: 'user', content: 'Return only the marker.' }] });
    if (second.errorCategory) process.exitCode = 1;
  }
}
}
