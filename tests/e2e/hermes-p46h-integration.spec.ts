import { expect, test, type Page } from "@playwright/test";
import { completeCoreResumeWorkflow, prepareCoreSourceResume } from "./support/p51CoreWorkflow";

test.describe.serial("P4.6h hermetic Web + browser MCP integration", () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (!testInfo.title.startsWith("CASE I")) return;
    const sessions = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const result = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
        result.onerror = () => reject(result.error);
        result.onsuccess = () => {
          database.close();
          resolve(result.result.map(session => ({
            sessionId: session.id, activeTurn: session.activeTurn,
            pendingConfirmation: session.pendingConfirmation ? { operationId: session.pendingConfirmation.operationId, turnId: session.pendingConfirmation.turnId } : null,
            task: session.taskState ? { workflowId: session.taskState.workflowId, stage: session.taskState.stage, completionStatus: session.taskState.completionStatus, selectedEntities: session.taskState.selectedEntities } : null,
            messages: session.messages?.map((message: { id: string; role: string; turnId?: string; status?: string }) => ({ id: message.id, role: message.role, turnId: message.turnId, status: message.status }))
          })));
        };
      };
    }));
    await testInfo.attach("host-confirmation-receipt", { body: JSON.stringify(sessions, null, 2), contentType: "application/json" });
  });
  test("CASE A — ordinary greeting completes through official Hermes Runs", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await send(page, "你好");
    await expectAssistant(page, "你好，Hermes hermetic runtime 已就绪。");
    expect(trace.runtimeActions.filter((action) => action === "run_start")).toHaveLength(1);
    expect(trace.runtimeActions.filter((action) => action === "run_events")).toHaveLength(1);
    expect(trace.toolRequests).toHaveLength(0);
  });

  test("CASE B — general career advice stays tool-free", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await send(page, "大学生找工作应该怎么准备？");
    await expectAssistant(page, "你好，Hermes hermetic runtime 已就绪。");
    expect(trace.toolRequests).toHaveLength(0);
  });

  test("CASE C — personal career questions use a read-only Career tool", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await resetHermesForCase(page);
    await send(page, "根据我的经历，你觉得我适合哪些岗位？");
    await expectAssistant(page, "当前示例资料包含 2 个项目经历。");
    await expectToolNames(trace, ["career.profile.get"]);
    expect(trace.resultActions).toContain("result");
    expect(trace.toolRequests.every((request) => request.name.startsWith("career.") && !request.name.includes("workflow"))).toBe(true);
  });

  test("CASE D — building from zero starts Profile Intake through a facade", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await resetHermesForCase(page);
    await send(page, "我没有简历，从零开始帮我做一份。");
    await expectAssistant(page, "已进入 Profile Intake，并停在下一步资料补充边界。");
    await expectToolNames(trace, ["career.workflow.profile_intake_turn"]);
  });

  test("CASE E — general Resume review uses compose update_existing", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await resetHermesForCase(page);
    await send(page, "帮我看看这份简历有什么问题");
    await expectAssistant(page, "已完成通用简历检查，并停在用户确认边界。");
    await expectToolNames(trace, ["career.workflow.compose_resume"]);
    expect(trace.toolRequests[0]?.input).toMatchObject({ mode: "general", generalResumeMode: "update_existing" });
  });

  test("CASE F — pasted JD tailoring uses the canonical workflow facade", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await resetHermesForCase(page);
    await send(page, "根据这个 JD 帮我生成岗位简历");
    await expectAssistant(page, "已读取当前示例岗位，并停在用户确认边界。");
    await expectToolNames(trace, ["career.workflow.tailor_resume"]);
    expect(trace.toolRequests[0]?.input).toMatchObject({ targetText: expect.any(String) });
    expect(trace.toolRequests.some((request) => request.name.startsWith("career.tailoring."))).toBe(false);
    expect(trace.resultActions).toContain("result");
  });

  test("CASE G — Job Fit stays a comparison workflow", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await resetHermesForCase(page);
    await send(page, "分析一下我和这个岗位匹不匹配");
    await expectAssistant(page, "已完成岗位匹配比较，并保留证据缺口。");
    await expectToolNames(trace, ["career.workflow.job_fit"]);
  });

  test("CASE H — export uses the dedicated export facade", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await resetHermesForCase(page);
    await send(page, "导出这份简历");
    await expectAssistant(page, "已准备简历导出产物。");
    await expectToolNames(trace, ["career.workflow.resume_export"]);
  });

  test("CASE I — pasted JD crosses real Hermes and MCP, then one Host confirmation saves the Job", async ({ page }) => {
    test.setTimeout(240_000);
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await prepareCoreSourceResume(page);
    await page.goto("/ai-workspace");
    await resetHermesForCase(page);
    await send(page, "保存这个岗位 CORE-JD：公司 Core Test，数据分析实习生，负责数据清洗，要求了解 Python 或 SQL。");
    await expectAssistant(page, "岗位解析已完成，请核对后保存。");
    await expectToolNames(trace, ["career.workflow.job_intake"]);
    await expect(page.locator(".agent-confirmation")).toContainText("确认执行 Career 操作");
    await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
    await expectAssistant(page, "已按你的确认完成当前 Career 工作流。");
    expect(trace.runtimeActions.filter(action => action === "run_start")).toHaveLength(1);
    expect(trace.resultActions).toContain("result");
    const jobs = await page.evaluate(() => new Promise<Array<{ id: string; title: string; rawText: string }>>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const result = database.transaction("jobDescriptions", "readonly").objectStore("jobDescriptions").getAll();
        result.onerror = () => reject(result.error);
        result.onsuccess = () => { database.close(); resolve(result.result); };
      };
    }));
    const saved = jobs.filter(job => job.title.includes("CORE-JD"));
    expect(saved).toHaveLength(1);
    expect(saved[0].rawText).toContain("Python 或 SQL");
    await completeCoreResumeWorkflow(page, saved[0].id);
  });
});

async function openWorkspace(page: Page) {
  const providerBaseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  const providerApiKey = process.env.HERMES_INTEGRATION_PROVIDER_KEY;
  if (!providerBaseUrl || !providerApiKey) throw new Error("hermes_integration_provider_settings_missing");
  await page.addInitScript(({ baseUrl, apiKey }) => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl,
      apiKey,
      model: "careeradapt-test",
      provider: "openai-compatible",
      credentialAction: "replace"
    }));
  }, { baseUrl: providerBaseUrl, apiKey: providerApiKey });
  await page.goto("/ai-workspace");
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 90_000 });
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/mcp");
    const payload = await response.json() as { status?: { connected?: boolean; discoveredToolCount?: number } };
    return payload.status;
  }, { timeout: 60_000, intervals: [250, 500, 1_000] }).toMatchObject({ connected: true, discoveredToolCount: expect.any(Number) });
}

async function send(page: Page, message: string) {
  await page.getByLabel("描述你的求职任务").fill(message);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function resetHermesForCase(page: Page) {
  const response = await page.request.post("/api/agent/runtime/hermes/control", {
    headers: { Origin: new URL(page.url()).origin },
    data: { action: "restart" }
  });
  expect(response.ok()).toBe(true);
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 90_000 });
}

async function expectAssistant(page: Page, text: string) {
  await expect.poll(async () => {
    const messages = page.locator('[data-message-role="assistant"]');
    return await messages.last().textContent();
  }, { timeout: 90_000, intervals: [250, 500, 1_000] }).toContain(text);
}

async function expectToolNames(trace: ReturnType<typeof observeRuntimeAndBridge>, names: string[]) {
  await expect.poll(() => trace.toolRequests.map((request) => request.name), {
    timeout: 10_000,
    intervals: [100, 250, 500]
  }).toEqual(names);
}

function observeRuntimeAndBridge(page: Page) {
  const runtimeActions: string[] = [];
  const resultActions: string[] = [];
  const toolRequests: Array<{ name: string; input: unknown }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/agent/runtime/hermes")) {
      const body = parseJson(request.postData());
      if (typeof body?.action === "string") runtimeActions.push(body.action);
      return;
    }
    if (url.pathname.endsWith("/api/agent/mcp") && url.searchParams.get("bridge") === "1") {
      const body = parseJson(request.postData());
      if (body?.action === "result") resultActions.push("result");
    }
  });
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith("/api/agent/mcp") || url.searchParams.get("bridge") !== "1" || response.request().method() !== "GET") return;
    const payload = await response.json().catch(() => undefined) as { requests?: Array<{ name?: string; input?: unknown }> } | undefined;
    for (const request of payload?.requests ?? []) {
      if (typeof request.name === "string") toolRequests.push({ name: request.name, input: request.input });
    }
  });
  return { runtimeActions, resultActions, toolRequests };
}

function parseJson(value: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
