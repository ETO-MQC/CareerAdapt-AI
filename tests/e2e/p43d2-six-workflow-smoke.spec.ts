import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const actions = [
  { id: "build_profile_from_scratch", title: "从零整理我的经历", intentFragment: "从零整理", rootGoal: "profile_intake", workflowId: "guided_profile_intake", stage: "resolve_profile_target" },
  { id: "import_existing_resume", title: "导入现有简历", intentFragment: "导入现有简历", rootGoal: "import_resume", workflowId: "resume_import", stage: "select_source" },
  { id: "import_existing_resume", title: "导入现有简历", intentFragment: "导入现有简历", rootGoal: "import_resume", workflowId: "resume_import", stage: "select_source", noProfile: true },
  { id: "tailor_resume_to_job", title: "生成岗位定制简历", intentFragment: "现有简历", rootGoal: "create_tailored_resume", workflowId: "tailor_existing_resume", stage: "choose_resume_source" },
  { id: "build_resume_from_profile", title: "从资料库组装简历", intentFragment: "个人资料库", rootGoal: "create_resume_from_profile", workflowId: "compose_resume", stage: "select_profile_scope" },
  { id: "analyze_job_fit", title: "分析岗位匹配度", intentFragment: "目标岗位", rootGoal: "analyze_job_fit", workflowId: "analyze_job_fit", stage: "select_assets" },
  { id: "repair_and_export_resume", title: "检查并导出简历", intentFragment: "修复并导出", rootGoal: "export_resume", workflowId: "repair_and_export_resume", stage: "select_resume" }
] as const;

test.describe("P4.3d.2 six quick-action deterministic smoke", () => {
  for (const action of actions) {
    test(`${action.id}${"noProfile" in action ? " without Profile" : ""} dispatches a typed task and persists its real boundary`, async ({ page }) => {
      test.setTimeout(60_000);
      const requests: Array<{ tools: string[]; messages: string[] }> = [];
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
        const body = route.request().postDataJSON() as {
          action?: string;
          sessionId?: string;
          turnId?: string;
          runId?: string;
          userMessage?: string;
        };
        if (body.action === "run_start") {
          requests.push({ tools: [], messages: [String(body.userMessage ?? "")] });
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ ok: true, data: { runId: `run-${action.id}`, status: "started" } })
          });
          return;
        }
        if (body.action === "run_events") {
          await route.fulfill({
            contentType: "text/event-stream",
            body: [
              "event: run.completed",
              `data: ${JSON.stringify({ run_id: body.runId, output: `已进入 ${action.title} 流程，请补充下一步所需信息。` })}`,
              "",
              ""
            ].join("\n")
          });
          return;
        }
        if (body.action === "run_status") {
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ ok: true, data: { run_id: body.runId, status: "completed" } })
          });
          return;
        }
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: {} }) });
      });
      await page.goto("/ai-workspace");
      await bypassSetupIfNeeded(page);
      const card = page.getByRole("button", { name: new RegExp(action.title) });
      const cardReady = await card.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
      if (!cardReady) {
        await page.getByRole("button", { name: "新任务", exact: true }).click();
      }
      await expect(card).toBeVisible({ timeout: 20_000 });
      if (action.id === "import_existing_resume") {
        const fileChooser = page.waitForEvent("filechooser");
        await card.click();
        const chooser = await fileChooser;
        await expect(page.locator('input[type="file"]')).toHaveCount(1);
        await expect(page.locator(".agent-message-row.is-user")).toHaveCount(0);
        expect(requests).toHaveLength(0);
        const snapshot = await readActiveSession(page);
        expect(snapshot.rootGoal).toBeUndefined();
        expect(snapshot.userMessage).toBeUndefined();
        if ("noProfile" in action) {
          await page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open("CareerAdaptDb");
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            await new Promise<void>((resolve, reject) => {
              const transaction = db.transaction(["profiles"], "readwrite");
              transaction.objectStore("profiles").clear();
              transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
            });
            db.close();
          });
        }
        await chooser.setFiles(resolve("tests/fixtures/pdf/p47c1-sanitized-resume.pdf"));
        await page.getByRole("button", { name: /本地|不用 AI|仅.*解析/ }).first().click();
        await expect.poll(async () => {
          const state = await readActiveSession(page);
          return state.stage === "import_review" || state.completionStatus === "failed";
        }, { timeout: 30_000 }).toBe(true);
        expect((await readActiveSession(page)).stage).toBe("import_review");
        expect((await readActiveSession(page)).targetSelectionDeferred).toBe("noProfile" in action);
        await expect(page.locator(".import-review-grid")).toBeVisible();
        expect(requests).toHaveLength(0);
        return;
      }
      if (action.id === "build_profile_from_scratch") {
        await card.click();
        await expect(page.getByText("可以先从你最熟悉的一段开始。比如：实习 / 工作、课程项目、个人项目、比赛、校园经历、兼职 / 副业、志愿活动。想到哪段先说哪段。", { exact: true })).toBeVisible();
        await expect(page.locator(".agent-message-row.is-user")).toHaveCount(0);
        expect(requests).toHaveLength(0);
        const snapshot = await readActiveSession(page);
        expect(snapshot.rootGoal).toBe("profile_intake");
        expect(snapshot.workflowId).toBe("guided_profile_intake");
        expect(snapshot.userMessage).toBeUndefined();
        return;
      }
      await card.click();
      await expect(page.locator(".agent-message-row.is-assistant").last()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => readActiveSession(page), { timeout: 30_000 }).toMatchObject({
        rootGoal: action.rootGoal,
        workflowId: action.workflowId
      });

      const expectedBoundary = {
        rootGoal: action.rootGoal,
        workflowId: action.workflowId,
        completionStatus: "waiting_for_user",
        pendingConfirmation: undefined,
        pendingToolCall: undefined,
      };
      await expect.poll(() => readActiveSession(page), { timeout: 30_000 }).toMatchObject(expectedBoundary);
      const snapshot = await readActiveSession(page);
      const usedGeneralFlow = requests.length > 0;
      expect([action.stage, "select_facts", "collect_experience"]).toContain(snapshot.stage);
      expect(snapshot.userMessage).toBeUndefined();
      if (usedGeneralFlow) expect(requests.length).toBeGreaterThan(0);
      else expect(requests).toHaveLength(0);
    });
  }
});

async function bypassSetupIfNeeded(page: Page) {
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await skip.click();
    await page.goto("/ai-workspace");
  }
}
async function readActiveSession(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T,>(storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const [sessions, messages] = await Promise.all([
      read<Record<string, unknown>>("agentSessions"),
      read<Record<string, unknown>>("agentMessages")
    ]);
    const activeId = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeId) ?? sessions.at(-1);
    const task = session?.taskState as Record<string, unknown> | undefined;
    const sessionMessages = messages.filter((message) => message.sessionId === session?.id);
    database.close();
    return {
      rootGoal: task?.rootGoal,
      workflowId: task?.workflowId,
      stage: task?.stage,
      completionStatus: task?.completionStatus,
      targetSelectionDeferred: (task?.knownSlots as Record<string, unknown> | undefined)?.quickActionImportTargetRequired,
      pendingConfirmation: session?.pendingConfirmation,
      pendingToolCall: session?.pendingToolCall,
      activeTurnStatus: (session?.activeTurn as Record<string, unknown> | undefined)?.status,
      userMessage: sessionMessages.findLast((message) => message.role === "user")?.content
    };
  });
}
