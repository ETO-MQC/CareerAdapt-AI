import { expect, test, type Page } from "@playwright/test";

const actions = [
  { id: "build_profile_from_scratch", title: "从零整理我的经历", intentFragment: "从零整理", rootGoal: "profile_intake", workflowId: "guided_profile_intake", stage: "resolve_profile_target" },
  { id: "import_existing_resume", title: "导入现有简历", intentFragment: "导入现有简历", rootGoal: "import_resume", workflowId: "resume_import", stage: "select_source" },
  { id: "tailor_resume_to_job", title: "生成岗位定制简历", intentFragment: "现有简历", rootGoal: "create_tailored_resume", workflowId: "tailor_existing_resume", stage: "choose_resume_source" },
  { id: "build_resume_from_profile", title: "从资料库组装简历", intentFragment: "个人资料库", rootGoal: "create_resume_from_profile", workflowId: "build_resume_from_profile", stage: "select_profile_scope" },
  { id: "analyze_job_fit", title: "分析岗位匹配度", intentFragment: "目标岗位", rootGoal: "analyze_job_fit", workflowId: "analyze_job_fit", stage: "select_assets" },
  { id: "repair_and_export_resume", title: "检查并导出简历", intentFragment: "修复并导出", rootGoal: "export_resume", workflowId: "repair_and_export_resume", stage: "select_resume" }
] as const;

test.describe("P4.3d.2 six quick-action deterministic smoke", () => {
  for (const action of actions) {
    test(`${action.id} dispatches a typed task and persists its real boundary`, async ({ page }) => {
      test.setTimeout(60_000);
      const requests: Array<{ tools: string[]; messages: string[] }> = [];
      await page.route("**/api/agent/stream", async (route) => {
        const body = route.request().postDataJSON() as {
          tools?: Array<{ name?: string }>;
          messages?: Array<{ role?: string; content?: string }>;
        };
        requests.push({
          tools: (body.tools ?? []).map((tool) => String(tool.name)),
          messages: (body.messages ?? []).map((message) => String(message.content ?? ""))
        });
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeAsk(`已进入 ${action.title} 流程，请补充下一步所需信息。`)
        });
      });

      await page.goto("/ai-workspace");
      await bypassSetupIfNeeded(page);
      const card = page.getByRole("button", { name: new RegExp(action.title) });
      if (!(await card.isVisible().catch(() => false))) {
        await page.getByRole("button", { name: "新任务", exact: true }).click();
      }
      await expect(card).toBeVisible({ timeout: 20_000 });
      await card.click();
      const generalFlowResponse = page.getByText(`已进入 ${action.title} 流程，请补充下一步所需信息。`);
      await expect(page.locator(".agent-message-row.is-assistant").last()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => readActiveSession(page), { timeout: 30_000 }).toMatchObject({
        rootGoal: action.rootGoal,
        workflowId: action.workflowId
      });
      const usedGeneralFlow = requests.length > 0;
      if (usedGeneralFlow) await expect(generalFlowResponse).toBeVisible({ timeout: 30_000 });

      const expectedBoundary = {
        rootGoal: action.rootGoal,
        workflowId: action.workflowId,
        completionStatus: usedGeneralFlow ? "active" : "waiting_for_user",
        pendingConfirmation: undefined,
        pendingToolCall: undefined,
        activeTurnStatus: usedGeneralFlow ? "waiting_for_user" : undefined
      };
      await expect.poll(() => readActiveSession(page), { timeout: 30_000 }).toMatchObject(expectedBoundary);
      const snapshot = await readActiveSession(page);
      expect([action.stage, "select_facts", "collect_experience"]).toContain(snapshot.stage);
      expect(snapshot.userMessage).toContain(action.intentFragment);
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
      pendingConfirmation: session?.pendingConfirmation,
      pendingToolCall: session?.pendingToolCall,
      activeTurnStatus: (session?.activeTurn as Record<string, unknown> | undefined)?.status,
      userMessage: sessionMessages.findLast((message) => message.role === "user")?.content
    };
  });
}

function nativeAsk(message: string) {
  return [
    `event: model_text_delta\ndata: ${JSON.stringify({ type: "model_text_delta", delta: message })}\n\n`,
    `event: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}\n\n`
  ].join("");
}
