import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { deriveAgentTurnLifecycle, derivePendingInteraction } from "@/agent/runtime/agentTurnLifecycle";
import { installCoreWritingProvider, readStore } from "./support/p51CoreWorkflow";

test("H4A-Q2 selected assets, fit, next action, stop and fork", async ({ page, context }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const bridgeResults: Array<Record<string, unknown>> = [];
  const ownership: Array<{ bridgeId: string | null; sessionId?: string; turnId?: string; name: string }> = [];
  page.on("response", async response => {
    if (response.request().method() !== "GET" || !response.url().includes("/api/agent/mcp?bridge=1")) return;
    const url = new URL(response.url());
    const payload = await response.json().catch(() => undefined) as { requests?: Array<{ name: string; agentSessionId?: string; logicalTurnId?: string }> } | undefined;
    for (const request of payload?.requests ?? []) ownership.push({ bridgeId: url.searchParams.get("bridgeId"), sessionId: request.agentSessionId, turnId: request.logicalTurnId, name: request.name });
    if (process.env.H3_EVIDENCE_DIR) writeFileSync(path.join(process.env.H3_EVIDENCE_DIR, "bridge-ownership.json"), JSON.stringify(ownership, null, 2));
  });
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
    const body = request.postDataJSON() as { action?: string; result?: Record<string, unknown> };
    if (body.action === "result" && body.result) bridgeResults.push(body.result);
  });
  await page.addInitScript(({ baseUrl }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true })), { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  await page.goto("/h3-fixture");
  await page.getByRole("button", { name: "Seed confirmed Profile" }).click();
  await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
  const branches = await readStore(page, "resumeBranches");
  const general = branches.find(branch => branch.branchPurpose === "general")!;
  expect(general.currentRevisionId).toBeTruthy();
  await installCoreWritingProvider(page);
  await page.goto("/ai-workspace");
  await expect.poll(async () => {
    const state = (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot;
    return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady && state?.toolSurfaceReady;
  }, { timeout: 60_000 }).toBe(true);
  const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  const previous = new Set((await sessions()).map(session => session.id));
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect.poll(async () => (await sessions()).filter(session => !previous.has(session.id)).length).toBe(1);
  const sessionId = (await sessions()).find(session => !previous.has(session.id))!.id;
  const current = async () => {
    const session = (await sessions()).find(item => item.id === sessionId)!;
    const records = await readStore(page, "agentMessages");
    const messages = records.filter(record => record.sessionId === sessionId)
      .sort((a, b) => Number(a.sequence) - Number(b.sequence))
      .map(({ sessionId: _sessionId, sequence: _sequence, ...message }) => {
        void _sessionId; void _sequence;
        return message;
      });
    return { ...session, messages } as AgentSession;
  };
  await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  const send = async (text: string) => {
    await page.getByLabel("描述你的求职任务").fill(text);
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
  };
  await send("我要投华为那个AI岗位");
  await expect.poll(async () => (await current())?.taskState?.workflowUserInputCheckpoint?.kind, { timeout: 45_000 }).toBe("job_choice");
  await expect(page.getByRole("button", { name: "AI大模型应用开发工程师 · 华为" })).toBeVisible();
  await send("AI大模型应用开发工程师");
  await expect.poll(async () => (await current())?.taskState?.selectedEntities.jobId, { timeout: 20_000 }).toBe("h3-job-ai");
  const inspector = await context.newPage();
  try {
    await inspector.goto("/h3-fixture");
    await inspector.getByLabel("Session ID").fill(sessionId);
    await inspector.getByRole("button", { name: "Inspect context" }).click();
    await expect.poll(async () => (await inspector.getByTestId("context-result").textContent()) ?? "").toContain('"jobId":"h3-job-ai"');
  } finally { await inspector.close(); }
  await send("帮我分析匹配度");
  await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 60_000 }).toBe("analyze_job_fit");
  await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 20_000 }).toBe("completed");
  await expect.poll(async () => derivePendingInteraction(await current())?.kind, { timeout: 20_000 }).toBe("next_action");
  const fit = await current();
  expect(fit.taskState?.workflowId).toBe("analyze_job_fit");
  expect(fit.activeTurn?.status).toBe("completed");
  expect(deriveAgentTurnLifecycle(fit)).toBe("COMPLETED");
  expect(derivePendingInteraction(fit)?.kind).toBe("next_action");
  expect(fit.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id, revisionId: general.currentRevisionId });
  const receipt = (name: string) => bridgeResults.some(result => result.ok === true && (result.receipt as { toolName?: string } | undefined)?.toolName === name);
  expect(receipt("career.job.get")).toBe(true);
  expect(receipt("career.resume.get")).toBe(true);
  expect(receipt("career.workflow.job_fit")).toBe(true);
  const detailNames = ["career.job.get", "career.resume.get", "career.workflow.job_fit"];
  await expect.poll(() => detailNames.every(name => ownership.some(item => item.name === name))).toBe(true);
  const detailOwnership = detailNames.map(name => ownership.findLast(item => item.name === name)!);
  expect(detailOwnership.every(item => item.sessionId === sessionId && item.turnId === fit.activeTurn?.id && item.bridgeId === detailOwnership[0].bridgeId && item.bridgeId)).toBe(true);
  expect(bridgeResults.some(result => {
    const data = result.data as { job?: { id?: string; rawText?: string; requirementGraph?: unknown } } | undefined;
    return result.ok === true && data?.job?.id === "h3-job-ai" && data.job.rawText?.includes("必须熟悉 Python") && Boolean(data.job.requirementGraph);
  })).toBe(true);
  const fitArtifact = fit.artifactRefs.find(artifact => artifact.kind === "job_fit_overview")!;
  expect(fitArtifact.binding).toMatchObject({ sessionId, branchId: fit.activeBranchId, workflowId: "analyze_job_fit", jobId: "h3-job-ai", resumeBranchId: general.id, revisionId: general.currentRevisionId });
  await expect(page.getByRole("button", { name: "生成岗位简历", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看详细匹配", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "暂时不用", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看匹配分析" }).click();
  await expect(page.getByRole("complementary", { name: "任务产物" }).getByRole("list", { name: "岗位要求与证据" })).toBeVisible();
  await send("好");
  await expect(page.getByText("你想继续哪一步？", { exact: true })).toBeVisible();
  expect((await current()).taskState?.completionStatus).toBe("completed");
  expect((await current()).taskState?.selectedEntities.jobId).toBe("h3-job-ai");
  await send("生成岗位简历");
  await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 20_000 }).toBe("tailor_existing_resume");
  await expect(page.getByRole("button", { name: "停止运行", exact: true })).toBeEnabled();
  await expect.poll(async () => Boolean((await current())?.hermesRun?.runId), { timeout: 15_000 }).toBe(true);
  const running = await current();
  const oldBranch = running.activeBranchId;
  const oldTurn = running.activeTurn!.id;
  expect(running.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id });
  await page.getByRole("button", { name: "停止运行", exact: true }).click();
  await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 20_000 }).toBe("aborted");
  const row = page.locator(".agent-message-row.is-user").filter({ hasText: "生成岗位简历" }).last();
  await row.getByRole("button", { name: "编辑并重发" }).click();
  await row.getByRole("textbox", { name: "编辑消息" }).fill("查看详细匹配");
  await row.getByRole("button", { name: "确认并重发" }).click();
  await expect.poll(async () => (await current())?.activeBranchId, { timeout: 20_000 }).not.toBe(oldBranch);
  await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 25_000 }).not.toBe("running");
  const fork = await current();
  expect(fork.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id, revisionId: general.currentRevisionId });
  expect(fork.artifactRefs.filter(artifact => artifact.kind === "job_fit_overview" && artifact.binding?.branchId === fork.activeBranchId)).toHaveLength(0);
  expect(fork.taskState?.knownSlots.resumeCompositionProposal).toBeUndefined();
  expect(fork.activeTurn?.id).not.toBe(oldTurn);
  await expect(page.getByText("没有目标岗位", { exact: false })).toHaveCount(0);
});
