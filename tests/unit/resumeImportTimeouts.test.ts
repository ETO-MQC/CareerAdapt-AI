import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { invokeStructuredAi } from "@/ai/client";
import { DocumentRecognitionPreferencesSchema } from "@/domain/schemas";
import { DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES, migrateDocumentRecognitionPreferences,
  readDocumentRecognitionPreferences, writeDocumentRecognitionPreferences } from "@/services/preferences/documentRecognition";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
it("adds independent defaults to old settings and persists manual budgets", () => {
  const legacy = { ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES };
  delete legacy.visionTimeoutSeconds; delete legacy.mappingTimeoutSeconds;
  expect(migrateDocumentRecognitionPreferences(legacy)).toMatchObject({ visionTimeoutSeconds: 480, mappingTimeoutSeconds: 600 });
  writeDocumentRecognitionPreferences({ ...legacy, visionTimeoutSeconds: 900, mappingTimeoutSeconds: 1200 });
  expect(readDocumentRecognitionPreferences()).toMatchObject({ visionTimeoutSeconds: 900, mappingTimeoutSeconds: 1200 });
  expect(DocumentRecognitionPreferencesSchema.safeParse({ ...legacy, mappingTimeoutSeconds: 1801 }).success).toBe(false);
});
it("sends the updated budget on mapper retries and does not change unrelated tasks", async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true, task: "resume-document-mapper", promptVersion: "test",
    output: { ok: true }, meta: { provider: "test", model: "test", latencyMs: 1, inputLength: 1, outputLength: 1 } })));
  vi.stubGlobal("fetch", fetchMock);
  for (const seconds of [600, 1200]) {
    writeDocumentRecognitionPreferences({ ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES, mappingTimeoutSeconds: seconds });
    await invokeStructuredAi({ task: "resume-document-mapper", businessInput: {}, outputSchema: z.object({ ok: z.boolean() }) });
    expect((fetchMock.mock.lastCall?.[1] as RequestInit).headers).toMatchObject({ "x-resume-import-timeout-seconds": String(seconds) });
  }
  await invokeStructuredAi({ task: "jd-analyzer", businessInput: {}, outputSchema: z.object({ ok: z.boolean() }) });
  expect((fetchMock.mock.lastCall?.[1] as RequestInit).headers).not.toHaveProperty("x-resume-import-timeout-seconds");
});
