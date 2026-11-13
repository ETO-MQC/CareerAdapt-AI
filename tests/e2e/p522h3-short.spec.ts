import { expect, test } from "@playwright/test";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { installCoreWritingProvider, readStore } from "./support/p51CoreWorkflow";

test("H3 saved job selection and match", async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const bridgeResults: Record<string, unknown>[] = [];
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
    const body = request.postDataJSON() as { action?: string; result?: Record<string, unknown> };
    if (body.action === "result" && body.result) bridgeResults.push(body.result);
  });
  await page.addInitScript(({ baseUrl }) => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true }));
  }, { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  await page.goto("/h3-fixture");
  await page.getByRole("button", { name: "Seed confirmed Profile" }).click();
  await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
  await installCoreWritingProvider(page);
  await page.goto("/ai-workspace");
  await expect.poll(async () => {
    const state = (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot;
    return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady && state?.toolSurfaceReady;
  }, { timeout: 90_000 }).toBe(true);
  const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  const previous = new Set((await sessions()).map(session => session.id));
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect.poll(async () => (await sessions()).filter(session => !previous.has(session.id)).length).toBe(1);
  const sessionId = (await sessions()).find(session => !previous.has(session.id))!.id;
  const current = async () => (await sessions()).find(session => session.id === sessionId)!;
  await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  const send = async (text: string) => {
    await page.getByLabel("描述你的求职任务").fill(text);
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
  };
  await send("我想应聘岗位里面那个华为岗位");
  await expect.poll(async () => (await current())?.taskState?.workflowUserInputCheckpoint?.kind, { timeout: 60_000 }).toBe("job_choice");
  await expect(page.getByRole("button", { name: "AI大模型应用开发工程师 · 华为" })).toBeVisible();
  await send("AI大模型应用开发工程师");
  await expect.poll(async () => (await current())?.taskState?.selectedEntities.jobId, { timeout: 30_000 }).toBe("h3-job-ai");
  expect((await current()).activeJobId).toBe("h3-job-ai");
  await send("帮我分析匹配度");
  await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 60_000 }).toBe("analyze_job_fit");
  await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  expect((await current()).taskState?.selectedEntities.jobId).toBe("h3-job-ai");
  expect(bridgeResults.some(result => {
    const data = result.data as { job?: { id?: string; rawText?: string; requirementGraph?: unknown } } | undefined;
    return result.ok === true && data?.job?.id === "h3-job-ai" && data.job.rawText?.includes("必须熟悉 Python") && Boolean(data.job.requirementGraph);
  })).toBe(true);
  await page.getByRole("button", { name: "查看匹配分析" }).click();
  const drawer = page.getByRole("complementary", { name: "任务产物" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("list", { name: "岗位要求与证据" })).toBeVisible();
});
