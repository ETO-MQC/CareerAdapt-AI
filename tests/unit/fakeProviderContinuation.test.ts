import { expect, it } from "vitest";

it("recognizes the confirmed MCP receipt inside the locked Hermes untrusted-tool envelope", async () => {
  const { startFakeOpenAiProvider } = await import("../support/fake-openai-compatible-provider.mjs");
  const provider = await startFakeOpenAiProvider({ mode: "integration" });
  try {
    const payload = { ok: true, data: { status: "completed", workflowCheckpoint: { kind: "job_intake", jobId: "job-confirmed-fixture" } } };
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "careeradapt-test", messages: [{ role: "tool", name: "mcp__careeradapt__career_workflow_job_intake",
        tool_call_id: "original-tool-call", content: `<untrusted_tool_result source="mcp">\n${JSON.stringify({ result: JSON.stringify(payload), structuredContent: payload })}\n</untrusted_tool_result>` }] })
    });
    expect((await response.json()).choices[0].message.content).toBe("已按你的确认完成当前 Career 工作流。");
    const evidence = await fetch(`${provider.baseUrl}/integration-evidence`, { headers: { Authorization: `Bearer ${provider.apiKey}` } });
    expect((await evidence.json()).requests[0].toolResults).toEqual([{ toolCallId: "original-tool-call", jobId: "job-confirmed-fixture" }]);
  } finally { await provider.close(); }
});
