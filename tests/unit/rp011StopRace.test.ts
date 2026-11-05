import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/agent/runtime/hermes/route';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function stop(status: string, id = 'original', statusHttp = 200) {
  vi.stubEnv('HERMES_RUNTIME_URL', 'http://127.0.0.1:19001');
  vi.stubEnv('API_SERVER_KEY', 'synthetic-control');
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'run_not_found' } }, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ run_id: id, status, output: 'original result' }, { status: statusHttp }));
  vi.stubGlobal('fetch', fetch);
  const response = await POST(new NextRequest('http://localhost/api/agent/runtime/hermes', {
    method: 'POST', body: JSON.stringify({ action: 'run_stop', runId: 'original' })
  }));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toBe('http://127.0.0.1:19001/v1/runs/original');
  return { response, payload: await response.json() };
}
it.each(['completed', 'failed', 'cancelled'])('reconciles stop racing authoritative %s without inventing cancellation', async status => {
  const { response, payload } = await stop(status);
  expect(response.status).toBe(200);
  expect(payload.data).toMatchObject({ status, run_id: 'original' });
});
it.each([['running', 'original', 200], ['completed', 'different', 200], ['failed', 'original', 404]] as const)
  ('preserves 404 when readback is %s / %s / %i', async (status, id, http) => {
    const { response, payload } = await stop(status, id, http);
    expect(response.status).toBe(404);
    expect(payload.ok).toBe(false);
  });
