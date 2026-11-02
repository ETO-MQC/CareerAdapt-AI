import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { _electron } from 'playwright-core';
const hermes = process.env.HERMES_SOURCE_DIR || path.join(process.env.LOCALAPPDATA, 'hermes/hermes-agent');
const desktop = path.join(hermes, 'apps/desktop');
const req = createRequire(path.join(desktop, 'package.json'));
const root = path.resolve('.artifacts/p520b2b1-' + Date.now());
const home = path.join(root, 'home');
const id = 'careeradapt-transport-poc';
const front = path.join(home, 'desktop-plugins', id);
const back = path.join(home, 'plugins', id, 'dashboard');
fs.mkdirSync(front, { recursive: true }); fs.mkdirSync(back, { recursive: true });
fs.copyFileSync('poc/host-transport/plugin.mjs', path.join(front, 'plugin.js'));
for (const file of ['plugin_api.py', 'fake_service.py']) fs.copyFileSync('poc/host-transport/' + file, path.join(back, file));
fs.writeFileSync(path.join(back, 'manifest.json'), JSON.stringify({ name: id, label: 'Fixture', api: 'plugin_api.py', hidden: true }));
fs.writeFileSync(path.join(home, 'config.yaml'), 'model:\n  default: poc-offline\n  provider: custom\n  base_url: http://127.0.0.1:9/v1\n  api_key: poc-not-a-secret\nplugins:\n  enabled: [careeradapt-transport-poc]\n');
fs.writeFileSync(path.join(home, '.env'), '');
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value && !/(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_BASE_URL)$/.test(key) && !key.startsWith('HERMES') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, { HERMES_HOME: home, HERMES_DESKTOP_USER_DATA_DIR: path.join(root, 'user-data'), HERMES_DESKTOP_IGNORE_EXISTING: '1', HERMES_DESKTOP_HERMES_ROOT: hermes, HERMES_DESKTOP_APP_NAME: 'CareerTransportPoC-' + Date.now(), HERMES_DESKTOP_DEV_SERVER: 'http://127.0.0.1:5174' });
const evidence = { root, host: 'real locked Desktop; unmodified main/preload/renderer; isolated home; offline', observations: [], errors: [] };
let app;
async function launch() {
  app = await _electron.launch({ executablePath: req('electron'), args: [desktop, '--disable-gpu', '--no-sandbox'], env, cwd: desktop, timeout: 30000 });
  const page = await app.firstWindow({ timeout: 30000 });
  page.on('pageerror', e => evidence.errors.push(e.message));
  await page.getByText('Transport Fixture', { exact: true }).first().waitFor({ timeout: 60000 });
  await page.getByText('Transport Fixture', { exact: true }).first().click();
  return page;
}
async function api(page, route, body = {}) {
  return page.evaluate(async ({ route, body, id }) => {
    const { createPluginContext } = await import('/src/contrib/plugin.ts');
    return createPluginContext(id).rest(route, { method: 'POST', body, timeoutMs: 5000 });
  }, { route, body, id });
}
const envelope = (method, epoch, payload = {}, scope = { workspaceId: 'fixture-workspace', profileId: 'fixture-profile' }) => ({ apiVersion: 1, requestId: crypto.randomUUID(), method, scope, expectedServiceEpoch: epoch, payload });
try {
  let page = await launch();
  await page.getByRole('button', { name: 'Connect fixture' }).click();
  await page.waitForFunction(() => document.querySelector('article[aria-label="Transport fixture"] pre')?.textContent.includes('serviceEpoch'), { timeout: 15000 });
  const hello = JSON.parse(await page.locator('article[aria-label="Transport fixture"] pre').innerText());
  assert.equal(hello.requestId, 'ui-hello');
  let epoch = hello.result.serviceEpoch;
  evidence.observations.push({ name: 'renderer_button_sdk_backend_stdio', hello });
  const requests = ['health', 'profile.get', 'branch.list', 'branch.get', 'operation.getStatus'].map(method => envelope(method, epoch, method === 'branch.get' ? { branchId: 'fixture-general' } : method === 'operation.getStatus' ? { operationId: 'fixture-operation' } : {}));
  const results = await Promise.all(requests.map(r => api(page, '/rpc', r)));
  results.forEach((r, i) => { assert.equal(r.requestId, requests[i].requestId); assert.ok(r.result); });
  evidence.observations.push({ name: 'five_methods_concurrent_correlation', results });
  const negatives = [
    [{ ...envelope('health', epoch), apiVersion: 2 }, 'UNSUPPORTED_VERSION'],
    [envelope('health', epoch, {}, { workspaceId: 'fixture-workspace', profileId: 'other-profile' }), 'FORBIDDEN'],
    [envelope('branch.get', epoch, { branchId: 'other-branch' }), 'NOT_FOUND'],
    [envelope('rawSQL', epoch), 'INVALID_REQUEST'],
    [{ ...envelope('health', epoch), confirmed: true }, 'INVALID_REQUEST']
  ];
  for (const [request, code] of negatives) { const response = await api(page, '/rpc', request); assert.equal(response.error.code, code); evidence.observations.push({ name: 'rejection', expected: code, response }); }
  evidence.observations.push({ name: 'host_sdk_surface', keys: await page.evaluate(async () => Object.keys((await import('/src/sdk/index.ts')).host)) });
  for (const payload of [{ confirmed: true }, { proposalHash: 'wrong' }, { profileId: 'other-profile' }, { receipt: 'replay' }, { revision: -1 }, { cancelled: true }]) {
    const response = await api(page, '/rpc', envelope('proposal.confirm', epoch, payload));
    assert.equal(response.error.code, 'INVALID_REQUEST');
    evidence.observations.push({ name: 'unsupported_confirmation_rejected_not_receipt_validation', payload, response });
  }
  // Harness observes the actual loader and retains the actual ctx.rest closure; no SDK mock.
  await page.evaluate(async id => { const { createPluginContext } = await import('/src/contrib/plugin.ts'); window.__fixtureSavedRest = createPluginContext(id).rest; const store = await import('/src/contrib/plugins-store.ts'); await store.setPluginEnabled(id, false); }, id);
  const afterDisable = await page.evaluate(async request => window.__fixtureSavedRest('/rpc', { method: 'POST', body: request, timeoutMs: 5000 }), envelope('health', epoch));
  evidence.observations.push({ name: 'renderer_disabled_old_closure', response: afterDisable, expectedRevoked: true, actualRevoked: !afterDisable.result });
  await page.evaluate(async id => (await import('/src/contrib/plugins-store.ts')).setPluginEnabled(id, true), id);
  evidence.observations.push({ name: 'renderer_reenabled', response: await api(page, '/rpc', envelope('health', epoch)) });
  // Backend disable is a distinct config gate. Change only the isolated fixture config.
  const config = fs.readFileSync(path.join(home, 'config.yaml'), 'utf8');
  fs.writeFileSync(path.join(home, 'config.yaml'), config + '  disabled: [careeradapt-transport-poc]\n');
  let disabledError;
  try { await api(page, '/rpc', envelope('health', epoch)); } catch (error) { disabledError = String(error); }
  assert.ok(disabledError, 'backend disable must reject');
  evidence.observations.push({ name: 'backend_disabled', error: disabledError });
  fs.writeFileSync(path.join(home, 'config.yaml'), config);
  evidence.observations.push({ name: 'backend_reenabled', response: await api(page, '/rpc', envelope('health', epoch)) });
  evidence.observations.push({ name: 'broker_close', response: await api(page, '/close') });
  let disconnected;
  try { await api(page, '/rpc', envelope('health', epoch)); } catch (error) { disconnected = String(error); }
  assert.ok(disconnected);
  evidence.observations.push({ name: 'disconnected_no_success', error: disconnected });
  evidence.observations.push({ name: 'broker_open', response: await api(page, '/open') });
  const newHello = await api(page, '/rpc', envelope('hello', null));
  assert.notEqual(newHello.serviceEpoch, epoch);
  const stale = await api(page, '/rpc', envelope('health', epoch)); assert.equal(stale.error.code, 'SERVICE_RESTARTED');
  evidence.observations.push({ name: 'service_restart_old_epoch', hello: newHello, stale });
  epoch = newHello.serviceEpoch;
  const closeBeforeCrash = await api(page, '/close');
  const crashTarget = await api(page, '/open');
  process.kill(crashTarget.pid);
  let crashed;
  try { await api(page, '/rpc', envelope('health', epoch)); } catch (error) { crashed = String(error); }
  assert.ok(crashed);
  const failedClose = await api(page, '/close');
  evidence.observations.push({ name: 'service_crash_no_success', closeBeforeCrash, error: crashed, failedClose });
  await page.screenshot({ path: path.join(root, 'real-host.png') });
  await app.close(); app = null;
  page = await launch();
  await api(page, '/open');
  const restarted = await api(page, '/rpc', envelope('hello', null));
  assert.notEqual(restarted.serviceEpoch, epoch);
  evidence.observations.push({ name: 'host_restart', hello: restarted });
  evidence.observations.push({ name: 'final_close', response: await api(page, '/close') });
  evidence.status = 'PARTIAL';
  evidence.blocker = 'Renderer disable does not revoke ctx.rest; Backend disable gates requests but does not close broker/process. Trusted confirmation absent.';
} catch (error) { evidence.status = 'FAIL'; evidence.failure = String(error); process.exitCode = 1; }
finally {
  if (app) await app.close().catch(error => { evidence.shutdownError = String(error); });
  fs.mkdirSync('docs/architecture/evidence', { recursive: true });
  const file = 'docs/architecture/evidence/p520b2b1-host-' + Date.now() + '.json';
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ file, ...evidence }, null, 2));
}
