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

it("Core-02 fixture discovers bounded summaries when previous Run tool payloads are absent", async () => {
  const { startFakeOpenAiProvider } = await import("../support/fake-openai-compatible-provider.mjs");
  const provider = await startFakeOpenAiProvider({ mode: "integration" });
  const names = ["career.resume.list", "career.job.list", "career.workflow.job_fit"].map(name => `mcp__careeradapt__${name.replaceAll(".", "_")}`);
  const messages: Array<Record<string, unknown>> = [{ role: "user", content: "P51-C02-FIT 这个岗位适合我吗？" }];
  const next = async () => {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "careeradapt-test", messages, tools: names.map(name => ({ type: "function", function: { name } })) }) });
    return (await response.json()).choices[0].message;
  };
  try {
    expect((await next()).tool_calls[0].function.name).toBe(names[0]);
    messages.push({ role: "tool", name: names[0], content: JSON.stringify({ resumes: [{ id: "source-anonymous", profileId: "profile-anonymous", purpose: "general" }] }) });
    expect((await next()).tool_calls[0].function.name).toBe(names[1]);
    messages.push({ role: "tool", name: names[1], content: JSON.stringify({ jobs: [{ id: "job-anonymous", title: "CORE-JD" }] }) });
    expect(JSON.parse((await next()).tool_calls[0].function.arguments)).toEqual({ profileId: "profile-anonymous", resumeId: "source-anonymous", jobId: "job-anonymous" });
    messages.push({ role: "tool", name: names[2], content: JSON.stringify({ ok: true }) });
    expect((await next()).content).toContain("C02_FIT_COMPLETE");
  } finally { await provider.close(); }
});
