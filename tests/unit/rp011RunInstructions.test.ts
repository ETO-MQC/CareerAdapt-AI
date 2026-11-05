import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/agent/runtime/hermes/route';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('forwards six Skill routes and evidence/target/loop boundaries to the foreground Run', async () => {
  vi.stubEnv('HERMES_RUNTIME_URL', 'http://127.0.0.1:19001');
  vi.stubEnv('API_SERVER_KEY', 'synthetic-control');
  vi.stubEnv('HERMES_RUNTIME_PROTOCOL', 'official');
  let body: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return Response.json({ run_id: 'synthetic-run', status: 'queued' });
  }));
  const response = await POST(new NextRequest('http://localhost/api/agent/runtime/hermes', {
    method: 'POST', body: JSON.stringify({ action: 'run_start', sessionId: 'synthetic-session', userMessage: '整理资料库' })
  }));
  expect(response.status).toBe(200);
  for (const skill of ['candidate-profile-interview', 'career-story-mining', 'job-fit-analysis', 'resume-tailoring', 'resume-review', 'resume-composition']) expect(body.instructions).toContain(skill);
  for (const text of ['profile_intake_turn', 'persistence=analyze_only', 'reviewOnly=true', 'sourceTurn', 'resume_only', 'Unknown when evidence is missing', 'unchanged incomplete call', 'Background skill/memory maintenance is not foreground']) expect(body.instructions).toContain(text);
});
