import { expect, it } from "vitest";
import { createResumeMapperResponseSnapshot, summarizeSchemaIssues } from "@/ai/resumeDocumentMapperDiagnostics";
import { invokeStructuredAi } from "@/ai/client";
import { z } from "zod";
import { afterEach, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
it("keeps numeric field types and values while masking resume prose and personal details", () => {
  const snapshot = createResumeMapperResponseSnapshot({ resume: { basics: { name: "PRIVATE_NAME", phone: "13800000000" },
    sections: [{ items: [{ school: "PRIVATE_SCHOOL", gpa: "3.8/4", rankPosition: "前10%", email: "private@example.com" }] }] } }, 2);
  expect(snapshot.attempt).toBe(2); expect(snapshot.truncated).toBe(false);
  expect(JSON.parse(snapshot.json).resume.sections[0].items[0]).toMatchObject({ gpa: "3.8/4", rankPosition: "前10%" });
  expect(snapshot.json).not.toMatch(/PRIVATE|13800000000|private@example/);
});
it("reports expected and actual types using the failed JSON without exposing the value", () => {
  const issues = summarizeSchemaIssues({ issues: [{ path: ["resume", "gpa"], code: "invalid_type", expected: "number" }] }, { resume: { gpa: "private text" } });
  expect(issues).toEqual([{ path: "resume.gpa", code: "invalid_type", expected: "number", received: "string" }]);
  expect(JSON.stringify(issues)).not.toContain("private text");
});
it("carries snapshots to the UI diagnostics but never into persistent AI logs", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "model_schema_invalid" },
    meta: { responseSnapshots: [{ attempt: 2, json: '{"gpa":"3.8/4"}', truncated: false }] }
  }), { status: 422 })));
  const result = await invokeStructuredAi({ task: "resume-document-mapper", businessInput: {}, outputSchema: z.object({}) });
  expect(result.diagnostics).toHaveProperty("responseSnapshots");
  expect(JSON.stringify(result.log)).not.toContain("responseSnapshots");
});
