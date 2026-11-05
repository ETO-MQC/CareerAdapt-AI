import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import companion from '../electron/hermesCompanion.js';
import { assertRp01RuntimeParity, careerSkillNames } from './rp01-preflight.mjs';
import { startFakeOpenAiProvider } from '../tests/support/fake-openai-compatible-provider.mjs';

const projectRoot = process.cwd();
const runtimeRoot = path.resolve(process.env.HERMES_RUNTIME_ROOT || '.electron-build/hermes-runtime-rp011');
const parity = assertRp01RuntimeParity(projectRoot, runtimeRoot); // before any Provider/server setup
const directory = path.resolve('docs/quality/rp011-logs');
fs.mkdirSync(directory, { recursive: true });
const evidenceFile = path.join(directory, 'runtime-probe.json');
if (fs.existsSync(evidenceFile)) throw new Error('Refusing to overwrite runtime evidence');
const evidence = { status: 'UNKNOWN', provider: 'local scripted mock; not model semantic quality', parity, endpoints: {}, runs: [], requests: [] };
const save = () => fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
const provider = await startFakeOpenAiProvider({ responseForRequest: ({ messages }) => {
  const marker = messages.filter(m => m.role === 'user' && typeof m.content === 'string').at(-1)?.content || '';
  const skill = careerSkillNames.find(name => marker.includes(`RP011:${name}`));
  if (!skill) return { content: 'Mock background review: no changes.' };
  const loaded = messages.some(m => m.role === 'tool' && String(m.content).includes('# '));
  return loaded ? { content: `RP011 loaded ${skill}; probe only, no business write.` }
    : { toolCall: { name: 'skill_view', arguments: JSON.stringify({ name: skill }) } };
} });
const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rp011-hermes-'));
// Official supported test-only configuration. Production settings are untouched.
fs.writeFileSync(path.join(hermesHome, 'config.yaml'), 'skills:\n  creation_nudge_interval: 0\nmemory:\n  nudge_interval: 0\ncurator:\n  enabled: false\n');
const port = await companion.findAvailablePort({ host: '127.0.0.1', preferredPort: 29842, maxAttempts: 100 });
if (!port) throw new Error('No isolated port');
const url = `http://127.0.0.1:${port}`;
const key = 'rp011-synthetic-control';
const environment = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
  PATH: process.env.PATH, Path: process.env.Path, LOCALAPPDATA: process.env.LOCALAPPDATA, USERPROFILE: process.env.USERPROFILE,
  NODE_ENV: 'test', HERMES_RUNTIME_ROOT: runtimeRoot, HERMES_RUNTIME_URL: url, API_SERVER_KEY: key,
  HERMES_PROVIDER: 'openai-compatible', HERMES_BASE_URL: provider.baseUrl, HERMES_MODEL: 'careeradapt-test',
  HERMES_CUSTOM_CAREERADAPT_API_KEY: provider.apiKey, HERMES_HOME: hermesHome, CAREERADAPT_BASE_URL: 'http://127.0.0.1:1' };
let handle;
async function request(endpoint, body) {
  const response = await fetch(url + endpoint, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}
try {
  handle = await companion.startHermesCompanion({ projectRoot, environment, runtimeControlKey: key, hermesHome,
    hermesRuntimeRoot: runtimeRoot, requireBundledRuntime: true, reuseExistingRuntime: false, watchMcpBridge: false,
    includeCareerAdaptMcp: false, logPath: path.join(directory, 'runtime.log'), timeoutMs: 60000 });
  if (!handle.ok) throw new Error(`Startup failed: ${handle.reason}`);
  evidence.isolation = { hermesHome, runtimeRoot, port, requireBundledRuntime: true, reuseExistingRuntime: false,
    backgroundReview: 'disabled only in this isolated probe; curator excluded', careerAdaptMcp: 'excluded in this standalone probe, verify separately' };
  for (const endpoint of ['/health', '/v1/skills', '/v1/toolsets']) evidence.endpoints[endpoint] = await request(endpoint);
  for (const name of careerSkillNames) {
    if (!JSON.stringify(evidence.endpoints['/v1/skills']).includes(name)) throw new Error(`Runtime Skill missing: ${name}`);
    const started = await request('/v1/runs', { input: `RP011:${name} Load the selected Skill for this foreground probe. Do not write facts.`, model: 'careeradapt-test' });
    const response = await fetch(`${url}/v1/runs/${started.run_id}/events`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(60000) });
    const raw = await response.text();
    const events = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).flatMap(line => {
      const value = line.slice(5).trim(); return value && value !== '[DONE]' ? [JSON.parse(value)] : [];
    });
    const completed = events.find(event => event.event === 'run.completed');
    const readback = provider.requests.flatMap(row => row.messages).filter(message => message.role === 'tool' && message.name === 'skill_view')
      .map(message => JSON.parse(message.content)).find(result => result.name === name && result.success === true);
    const digest = value => createHash('sha256').update(value).digest('hex');
    const sourceSha256 = digest(fs.readFileSync(path.join(projectRoot, 'skills/career', name, 'SKILL.md')));
    const loadedSha256 = readback ? digest(readback.content) : undefined;
    evidence.runs.push({ name, runId: started.run_id, sourceSha256, loadedSha256, events }); save();
    if (sourceSha256 !== loadedSha256) throw new Error(`Loaded Skill content mismatch: ${name}`);
    if (!completed || !String(completed.output).includes(`RP011 loaded ${name}`)) throw new Error(`Foreground Skill load failed: ${name}`);
  }
  evidence.status = 'PASS';
} catch (error) { evidence.status = 'BLOCKED'; evidence.error = String(error); process.exitCode = 1; }
finally {
  evidence.requests = provider.requests.map(row => ({ messages: row.messages, tools: row.toolNames, response: row.response }));
  save();
  if (handle) await companion.stopHermesCompanion(handle);
  await provider.close();
}
console.log(`RP011 standalone Hermes probe ${evidence.status}`);
