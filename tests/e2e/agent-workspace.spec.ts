import { expect, test, type Page, type Request } from "@playwright/test";
import { installHermesRuntimeFixture } from "./support/hermesRuntimeFixture";

test.describe("AI workspace shell", () => {
  test.beforeEach(async ({ page }) => {
    await installHermesRuntimeFixture(page);

    await page.goto("/");
    const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
    const setupVisible = await skipSetup.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
    if (setupVisible) {
      await skipSetup.click();
      await page.waitForURL(/\/$/);
    }

    await page.goto("/ai-workspace");
    const contextTrigger = page.locator(".career-context-trigger");
    await expect(contextTrigger).toBeVisible();
    if ((await contextTrigger.innerText()).includes("选择人物")) {
      await contextTrigger.click();
      await page.getByRole("tab", { name: "新增人物" }).click();
      await page.getByLabel("人物名称").fill("测试人物");
      await page.getByRole("button", { name: "创建人物" }).click();
      await page.getByRole("button", { name: "使用此版本" }).click();
      await expect(contextTrigger).toContainText("测试人物");
    }
  });

  test("starts profile intake with local onboarding and no synthetic user turn", async ({ page }) => {
    let runtimeRequestCount = 0;
    page.on("request", (request) => {
      if (isHermesRunStart(request)) {
        runtimeRequestCount += 1;
      }
    });
    await page.goto("/ai-workspace");
    await page.getByRole("button", { name: /从零整理我的经历/ }).click();

    await expect(page.getByText("可以先从你最熟悉的一段开始。比如：实习 / 工作、课程项目、个人项目、比赛、校园经历、兼职 / 副业、志愿活动。想到哪段先说哪段。", { exact: true })).toBeVisible();
    await expect(page.locator(".agent-message-row.is-user")).toHaveCount(0);
    expect(runtimeRequestCount).toBe(0);
  });

  test("opens the existing composer picker before import work and keeps cancel side-effect free", async ({ page }) => {
    let runtimeRequestCount = 0;
    page.on("request", (request) => {
      if (isHermesRunStart(request)) {
        runtimeRequestCount += 1;
      }
    });

    await page.goto("/ai-workspace");
    const fileChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /导入现有简历/ }).click();
    await fileChooser;

    await expect(page.locator('input[type="file"]')).toHaveCount(1);
    await expect(page.locator(".agent-message-row.is-user")).toHaveCount(0);
    expect(runtimeRequestCount).toBe(0);
  });

  test("sends a normal Chinese turn with streaming UI and message actions", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("你好，请帮我整理项目经历");
    await page.getByRole("button", { name: "发送消息" }).click();

    await expect(page.getByText("你好，请帮我整理项目经历")).toBeVisible();
    await expect(page.locator('[data-message-status="thinking"], [data-message-status="streaming"]').first()).toBeVisible();
    await expect(page.getByText("可以。请先选择一段你确认真实存在的经历")).toBeVisible();
    await expect(page.locator(".agent-message-row.is-assistant").last().getByRole("button", { name: "复制消息" })).toBeVisible();
    await expect(page.locator(".agent-message-row.is-assistant").last().getByRole("button", { name: "重新生成" })).toBeVisible();
    await expect(page.locator(".agent-message-row.is-user").last().getByRole("button", { name: "编辑并重发" })).toBeVisible();
    const assistantRow = page.locator(".agent-message-row.is-assistant").last();
    expect(await assistantRow.evaluate((element) => getComputedStyle(element).contentVisibility)).toBe("visible");
    await assistantRow.getByLabel("更多消息操作").click();
    await expect(assistantRow.getByRole("menu")).toBeVisible();
    const menuBox = await assistantRow.getByRole("menu").boundingBox();
    expect(menuBox?.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: "artifacts/agent-conversation-after-1440x900.png", fullPage: true });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: "artifacts/agent-conversation-after-1024x768.png", fullPage: true });
  });

  test("keeps a new task on the zero state instead of restoring the last session", async ({ page }) => {
    await page.goto("/ai-workspace");
    await expect(page.locator(".career-context-trigger")).toBeVisible();
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();
    await expect(page.locator(".agent-pinned-context")).toContainText("测试人物");
    await page.getByLabel("描述你的求职任务").fill("你好，请帮我整理项目经历");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("可以。请先选择一段你确认真实存在的经历")).toBeVisible();

    await page.goto("/recycle");
    await page.getByRole("button", { name: "新任务" }).click();

    await expect(page).toHaveURL(/\/ai-workspace$/);
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();
    await expect(page.locator(".agent-message-row")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();
    await expect(page.locator(".agent-message-row")).toHaveCount(0);
  });

  test("keeps the active user and thinking messages when navigating away and back", async ({ page }) => {
    test.setTimeout(60_000);
    const runStarts: string[] = [];
    const eventRunIds: string[] = [];
    await page.route("**/api/agent/runtime/hermes/health", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          available: true,
          runtimeId: "hermes",
          model: "test-model",
          providerStatus: "ready",
          mcpConnected: true,
          discoveredToolCount: 0,
          runtimeHealth: {
            runtimeId: "hermes",
            runtimeAvailable: true,
            companionReady: true,
            providerConfigured: true,
            providerReachable: true,
            providerReady: true,
            mcpConnected: true,
            mcpReady: true,
            mcpToolCount: 0,
            toolCallingAvailable: true,
            careerSkillsLoaded: true,
            browserCareerDomainHostConnected: true,
            careerMcpServerReachable: true,
            careerMcpContractCount: 0,
            hermesMcpRegistered: true,
            hermesMcpToolCount: 0,
            hermesCareerFacadeCount: 0,
            requiredCareerFacadesMissing: [],
            careerGatewayContracts: [],
            careerMcpExposedTools: [],
            hermesRegisteredToolsets: ["careeradapt"],
            hermesVisibleTools: [],
            runReady: true,
            lastCheckedAt: new Date().toISOString()
          }
        })
      });
    });
    await page.route("**/api/agent/runtime/hermes", async (route) => {
      const body = route.request().postDataJSON() as { action?: string; runId?: string };
      if (body.action === "run_start") {
        runStarts.push("run-cross-page-1");
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: { runId: "run-cross-page-1", status: "started" } })
        });
        return;
      }
      if (body.action === "run_events") {
        eventRunIds.push(String(body.runId));
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        await route.fulfill({
          contentType: "text/event-stream",
          body: [
            "event: run.completed",
            `data: ${JSON.stringify({ run_id: body.runId, output: "跨页面任务已经正常完成。" })}`,
            "",
            ""
          ].join("\n")
        });
        return;
      }
      if (body.action === "run_status") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: { run_id: body.runId, status: "running" } })
        });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) });
    });

    await page.goto("/ai-workspace");
    await expect(page.locator(".career-context-trigger")).toBeVisible();
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();
    await expect(page.locator(".agent-pinned-context")).toContainText("测试人物");
    await page.getByLabel("描述你的求职任务").fill("请保留这条跨页面消息");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("请保留这条跨页面消息")).toBeVisible();
    await expect(page.locator('[data-message-status="thinking"], [data-message-status="streaming"]').first()).toBeVisible();
    await expect.poll(() => runStarts.length).toBe(1);
    const runningSnapshot = await readActiveSession(page);
    expect(runningSnapshot.hermesRunId).toBe("run-cross-page-1");
    const activeSessionId = runningSnapshot.sessionId;
    expect(activeSessionId).toBeTruthy();

    await page.getByRole("link", { name: "个人资料库" }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await page.getByRole("link", { name: "返回任务" }).click();
    await expect(page).toHaveURL(/\/ai-workspace$/);
    await expect.poll(() => readActiveSession(page)).toMatchObject({ sessionId: activeSessionId, hermesRunId: "run-cross-page-1" });
    await expect(page.getByText("请保留这条跨页面消息")).toBeVisible();
    await expect(page.locator('[data-message-status="thinking"], [data-message-status="streaming"]').first()).toBeVisible();

    await expect(page.getByText("跨页面任务已经正常完成。")).toBeVisible();
    await expect(page.getByText("请保留这条跨页面消息")).toBeVisible();
    expect(runStarts).toEqual(["run-cross-page-1"]);
    expect(eventRunIds.length).toBeGreaterThan(0);
    expect(new Set(eventRunIds)).toEqual(new Set(["run-cross-page-1"]));
  });

  test("keeps unsent composer drafts isolated by task and restores them when returning", async ({ page }) => {
    await page.goto("/ai-workspace");
    const composer = page.getByLabel("描述你的求职任务");
    await composer.fill("请帮我整理项目经历");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("可以。请先选择一段你确认真实存在的经历，我会按背景、职责、成果逐步提问。")).toBeVisible();

    await composer.fill("A 任务里尚未发送的补充内容");
    await page.getByRole("button", { name: "新任务" }).click();
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();
    await expect(composer).toHaveValue("");

    await composer.fill("新任务自己的草稿");
    await page.getByRole("button", { name: /搜索 \/ 历史/ }).click();
    const history = page.getByRole("dialog", { name: "历史记录" });
    await expect(history).toBeVisible();
    await history.getByLabel("搜索历史记录").fill("请帮我整理项目经历");
    await history.locator(".agent-history-list > button").first().click();

    await expect(page.locator(".agent-message-row.is-user").first()).toBeVisible();
    await expect(composer).toHaveValue("A 任务里尚未发送的补充内容");
  });

  test("edits and resends the active user message through Hermes", async ({ page }) => {
    let turnRequestCount = 0;
    page.on("request", (request) => {
      if (isHermesRunStart(request)) {
        turnRequestCount += 1;
      }
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/ai-workspace");
    const composer = page.getByLabel("描述你的求职任务");
    await composer.fill("请帮我整理项目经历");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("可以。请先选择一段你确认真实存在的经历，我会按背景、职责、成果逐步提问。")).toBeVisible();
    await expect(page.getByText("AI 就绪", { exact: true })).toBeVisible();

    const userRow = page.locator(".agent-message-row.is-user").first();
    await userRow.getByRole("button", { name: "编辑并重发" }).click();
    const inlineEditor = userRow.getByRole("textbox", { name: "编辑消息" });
    await expect(inlineEditor).toHaveValue("请帮我整理项目经历");
    await expect(composer).toHaveValue("");

    await inlineEditor.fill("请先帮我整理最近一段项目经历");
    await userRow.getByRole("button", { name: "确认并重发" }).click();
    await expect.poll(() => turnRequestCount).toBe(2);
    await expect(userRow.getByText("请先帮我整理最近一段项目经历")).toBeVisible();

    await userRow.getByRole("button", { name: "编辑并重发" }).click();
    const changedEditor = userRow.getByRole("textbox", { name: "编辑消息" });
    await changedEditor.fill("请帮我整理最近一段项目经历");
    await page.screenshot({ path: "artifacts/agent-inline-editor-after-1366x768.png", fullPage: true });
    await userRow.getByRole("button", { name: "取消" }).click();
    await expect(userRow.getByText("请先帮我整理最近一段项目经历")).toBeVisible();

    await userRow.getByRole("button", { name: "编辑并重发" }).click();
    await userRow.getByRole("textbox", { name: "编辑消息" }).fill("请帮我整理最近一段项目经历");
    await userRow.getByRole("button", { name: "确认并重发" }).click();
    await expect(userRow.getByText("请帮我整理最近一段项目经历")).toBeVisible();
    await expect.poll(() => turnRequestCount).toBe(3);
    await page.screenshot({ path: "artifacts/agent-message-history-after-1366x768.png", fullPage: true });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: "artifacts/agent-message-history-after-1024x768.png", fullPage: true });
  });

  test("regenerates the selected AI reply in place and executes a new turn", async ({ page }) => {
    let turnRequestCount = 0;
    page.on("request", (request) => {
      if (isHermesRunStart(request)) {
        turnRequestCount += 1;
      }
    });
    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("请帮我整理项目经历");
    await page.getByRole("button", { name: "发送消息" }).click();

    const assistantRows = page.locator(".agent-message-row.is-assistant");
    await expect(page.getByText("可以。请先选择一段你确认真实存在的经历，我会按背景、职责、成果逐步提问。")).toBeVisible();
    await expect(assistantRows).toHaveCount(1);
    await expect.poll(() => turnRequestCount).toBe(1);
    const messageId = await assistantRows.first().getAttribute("data-message-id");

    await assistantRows.first().getByRole("button", { name: "重新生成" }).click();
    await expect(assistantRows).toHaveCount(1);
    await expect.poll(() => turnRequestCount).toBe(2);
    await expect(assistantRows.first()).not.toHaveAttribute("data-message-id", "");
    expect(await assistantRows.first().getAttribute("data-message-id")).not.toBe(messageId);
    await expect(assistantRows.first().getByRole("button", { name: "重新生成" })).toBeVisible();
  });

  test("shows the six-card AI-first zero state without fixed artifacts or overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();
    const cards = page.locator(".agent-quick-card");
    await expect(cards).toHaveCount(6);
    await expect(cards.filter({ hasText: "即将开放" })).toHaveCount(0);
    await expect(page.locator(".workspace-topbar")).toHaveCount(0);
    await expect(page.locator(".agent-composer")).toBeVisible();
    await expect(page.locator(".agent-artifact-drawer")).toHaveCount(0);
    expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    expect(await page.locator(".agent-workspace").evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: "artifacts/agent-workspace-1024x768.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: "artifacts/agent-workspace-1440x900.png", fullPage: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedTransitionMs = await cards.first().evaluate((element) => {
      const value = getComputedStyle(element).transitionDuration.split(",")[0]?.trim() ?? "0s";
      return value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
    });
    expect(reducedTransitionMs).toBeLessThanOrEqual(0.02);
  });

  test("starts an explicit advanced workflow, preserves it across an asset page, and handles PDF as partial", async ({ page }) => {
    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("优化已有简历");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page).toHaveURL(/\/ai-workspace$/);
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toHaveCount(0);
    const taskShell = page.locator(".agent-workspace-body");
    await expect(page.getByText("请选择用于岗位定制的通用简历。", { exact: true })).toBeVisible();
    await expect(taskShell).toHaveAttribute("data-agent-workflow-id", "tailor_resume");
    await expect(taskShell).toHaveAttribute("data-agent-task-stage", "choose_resume_source");
    await expect(taskShell).toHaveAttribute("data-agent-completion-status", "waiting_for_user");

    await page.goto("/resume");
    await expect(page.getByText("正在处理")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("正在处理");
    await page.getByRole("link", { name: "返回任务" }).click();
    await expect(page.getByText("请选择用于岗位定制的通用简历。", { exact: true })).toBeVisible();
    await expect(page.locator(".agent-workspace-body")).toHaveAttribute("data-agent-workflow-id", "tailor_resume");

    await page.locator('input[type="file"]').setInputFiles("tests/fixtures/pdf/chinese-resume-reportlab.pdf");
    await expect(page.locator(".agent-artifact-drawer")).toBeVisible();
    await expect(page.getByText(/简历已解析|简历导入|核对/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/ai-workspace$/);
    await page.getByRole("button", { name: "关闭任务产物" }).last().click();
    await expect(page.getByRole("button", { name: /产物 1/ })).toBeVisible();
  });

  test("switches between AI, collaboration, and manual shells without horizontal overflow", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "协作" }).click();
    await expect(page.locator(".agent-dock")).toBeVisible();
    await expect(page.locator(".workspace-topbar")).toBeVisible();

    await page.goto("/");
    await page.getByRole("button", { name: "手动" }).click();
    await expect(page.getByRole("heading", { name: "首页" })).toBeVisible();
    await expect(page.locator(".agent-workspace")).toHaveCount(0);
    expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
  });

  test("keeps the current tailoring facade checkpoint, source selection, and import artifact durable", async ({ page }) => {
    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("优化已有简历");
    await page.getByRole("button", { name: "发送消息" }).click();

    const taskShell = page.locator(".agent-workspace-body");
    await expect(page.getByText("请选择用于岗位定制的通用简历。", { exact: true })).toBeVisible();
    await expect(taskShell).toHaveAttribute("data-agent-workflow-id", "tailor_resume");
    await expect(taskShell).toHaveAttribute("data-agent-task-stage", "choose_resume_source");
    await expect(taskShell).toHaveAttribute("data-agent-completion-status", "waiting_for_user");
    await expect(page.locator('textarea[data-agent-checkpoint-kind="resume_choice"]')).toBeVisible();

    const checkpointInput = page.locator('textarea[data-agent-checkpoint-kind="resume_choice"]');
    await checkpointInput.fill("测试通用简历");
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(taskShell).toHaveAttribute("data-agent-task-stage", "choose_job");
    await expect(page.getByText("测试通用简历", { exact: true }).last()).toBeVisible();

    await page.goto("/resume");
    await expect(page.getByText("正在处理")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("正在处理");
    await page.getByRole("link", { name: "返回任务" }).click();
    await expect(page.getByText("测试通用简历", { exact: true }).last()).toBeVisible();
    await expect(taskShell).toHaveAttribute("data-agent-workflow-id", "tailor_resume");
    await expect(taskShell).toHaveAttribute("data-agent-task-stage", "choose_job");

    await page.locator('input[type="file"]').setInputFiles("tests/fixtures/pdf/chinese-resume-reportlab.pdf");
    await expect(page.locator(".agent-artifact-drawer")).toBeVisible();
    await expect(page.getByText(/简历已解析|简历导入|核对/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/ai-workspace$/);
    await page.getByRole("button", { name: "关闭任务产物" }).last().click();
    await expect(page.getByRole("button", { name: /产物 1/ })).toBeVisible();
  });
});

async function readActiveSession(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
    const activeId = localStorage.getItem("careerad.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeId) ?? sessions.at(-1);
    const hermesRun = session?.hermesRun as Record<string, unknown> | undefined;
    database.close();
    return {
      sessionId: session?.id,
      hermesRunId: hermesRun?.runId,
      activeTurnStatus: (session?.activeTurn as Record<string, unknown> | undefined)?.status
    };
  });
}

function isHermesRunStart(request: Request) {
  if (request.method() !== "POST" || !new URL(request.url()).pathname.endsWith("/api/agent/runtime/hermes")) return false;
  const body = request.postDataJSON() as { action?: string } | null;
  return body?.action === "run_start";
}
