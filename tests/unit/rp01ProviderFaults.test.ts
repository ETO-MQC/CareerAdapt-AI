import { afterEach, expect, it, vi } from 'vitest';
import { OpenAiCompatibleProvider } from '@/ai/providers/openAiCompatibleProvider';
const settings = { provider: 'openai-compatible', baseUrl: 'https://example.test/v1', apiKey: 'synthetic-test-key', model: 'qualification-model' };
const input = { systemPrompt: 'JSON only', userPrompt: 'synthetic', maxOutputChars: 1000 };
afterEach(() => vi.unstubAllGlobals());

it.each([429, 503])('RP01 injected HTTP %s preserves error and performs one request', async status => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":{"message":"qualification fault"}}', { status })); vi.stubGlobal('fetch', fetchMock);
  await expect(new OpenAiCompatibleProvider(settings).invoke(input)).rejects.toMatchObject({ code: `provider_http_${status}` });
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each([
  ['', 'empty_model_output', 'stop'],
  ['{broken', 'model_invalid_json', 'stop'],
  ['{"text":"valid prefix"}', 'model_output_truncated', 'length']
])('RP01 injected content %s is not accepted as structured success', async (content, code, finish_reason) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }] }))));
  await expect(new OpenAiCompatibleProvider(settings).invoke(input)).rejects.toMatchObject({ code });
});
it.each(['TimeoutError', 'AbortError'])('RP01 propagates %s without retry or text fallback', async name => {
  const controller = new AbortController(); if (name === 'AbortError') controller.abort();
  const fetchMock = vi.fn().mockRejectedValue(new DOMException('synthetic interruption', name)); vi.stubGlobal('fetch', fetchMock);
  await expect(new OpenAiCompatibleProvider(settings).invoke({ ...input, signal: controller.signal })).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledOnce();
});
