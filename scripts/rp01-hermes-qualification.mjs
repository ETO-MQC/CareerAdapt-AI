import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertRp01RuntimeParity } from './rp01-preflight.mjs';

assertRp01RuntimeParity(process.cwd(), process.env.HERMES_RUNTIME_ROOT);
const key = fs.readFileSync(process.env.RP01_CREDENTIAL_ATTACHMENT, 'utf8').match(/sk-or-v1-[a-f0-9]+/)?.[0];
if (!key) throw new Error('credential missing');
const root = process.env.RP01_QUALIFIED_ROOT || process.cwd();
const batch = process.env.RP01_BATCH || 'probe';
const evidence = path.resolve(`docs/quality/rp01-logs/hermes-provider-${batch}.json`);
if (fs.existsSync(evidence)) throw new Error('Refusing to overwrite existing collection evidence');
if (fs.existsSync('docs/quality/rp01-logs/provider-stop.json')) throw new Error('Provider stop marker present; do not retry upstream');
const report = { provider: 'OpenRouter', model: 'dots-studio/dots-3-note-preview:free', policy: { max_tokens: 8192, temperature: 0, reasoning: { effort: 'low' }, timeoutMs: 180000, maxRequests: 45, automaticRetries: 0 }, requests: [], stopped: false };
const save = () => fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n');
const server = http.createServer(async (req, res) => {
  if (req.url === '/rp01/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ stopped: report.stopped, requests: report.requests.length })); return; }
  if (report.stopped || report.requests.filter(row => row.request).length >= 45) { report.stopped = true; save(); res.writeHead(429); res.end('{"error":{"message":"RP01 stopped; no further upstream requests"}}'); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  let body = raw ? JSON.parse(raw) : undefined;
  if (body) body = { ...body, max_tokens: 8192, temperature: 0, reasoning: { effort: 'low' } };
  const row = { sequence: report.requests.length + 1, path: req.url, start: new Date().toISOString(), request: body && JSON.parse(JSON.stringify(body, (name, value) => name === 'image_url' ? { sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex'), present: true } : value)) };
  report.requests.push(row); save(); const start = performance.now();
  try {
    const upstream = await fetch(`https://openrouter.ai${req.url.replace(/^\/v1/, '/api/v1')}`, { method: req.method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180000) });
    row.httpStatus = upstream.status; row.headersMs = Math.round(performance.now() - start);
    if (upstream.status === 429 || upstream.status >= 500) {
      report.stopped = true;
      fs.writeFileSync('docs/quality/rp01-logs/provider-stop.json', JSON.stringify({ httpStatus: upstream.status, batch, recordedAt: new Date().toISOString(), action: 'No further upstream requests' }, null, 2) + '\n');
    }
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    let response = ''; const decoder = new TextDecoder();
    for await (const chunk of upstream.body) { row.firstByteMs ??= Math.round(performance.now() - start); response += decoder.decode(chunk, { stream: true }); if (!res.destroyed) res.write(chunk); }
    row.response = response.replaceAll(key, '[REDACTED]');
    if (req.url.endsWith('/models') && upstream.ok) {
      const metadata = JSON.parse(row.response);
      row.response = JSON.stringify({ data: metadata.data.filter(entry => entry.id === report.model), omittedOtherModels: true });
    }
    res.end();
  } catch (error) { row.error = String(error.message).replaceAll(key, '[REDACTED]'); report.stopped = true; if (!res.headersSent) res.writeHead(502); res.end(); }
  row.totalMs = Math.round(performance.now() - start); save();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const proxyUrl = `http://127.0.0.1:${server.address().port}/v1`;
const env = { ...process.env, CAREER_AGENT_REAL_BASE_URL: proxyUrl, CAREER_AGENT_REAL_API_KEY: 'rp01-local-forwarder-only', CAREER_AGENT_REAL_MODEL: report.model, HERMES_RUNTIME_ROOT: process.env.HERMES_RUNTIME_ROOT, RP01_PROXY_STATUS: proxyUrl.replace('/v1', '/rp01/status') };
delete env.RP01_CREDENTIAL_ATTACHMENT;
const child = spawn(process.execPath, ['scripts/hermes-integration.mjs', 'career-agent-real', '--config=playwright.rp01.config.ts'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const log = fs.createWriteStream(`docs/quality/rp01-logs/hermes-run-${batch}.log`);
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { const safe = chunk.toString().replaceAll(key, '[REDACTED]'); log.write(safe); process.stdout.write(safe); });
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
report.exitCode = code; save(); server.close(); log.end(); process.exitCode = code ?? 1;
