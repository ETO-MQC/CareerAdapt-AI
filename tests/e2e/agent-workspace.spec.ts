import { expect, test } from "@playwright/test";

test.describe("AI workspace shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/agent/turn", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          type: "ask_user",
          message: "好的。请先提供这项任务需要的真实材料，我会逐步与你核对。"
        })
      });
    });
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

  test("starts a quick workflow, preserves it across an asset page, and handles PDF as partial", async ({ page }) => {
    await page.goto("/ai-workspace");
    await page.getByRole("button", { name: /生成岗位定制简历/ }).click();
    await expect(page).toHaveURL(/\/ai-workspace$/);
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "生成岗位定制简历" })).toBeVisible();

    await page.goto("/resume");
    await expect(page.getByText("正在处理")).toBeVisible();
    await expect(page.getByRole("status").getByText("生成岗位定制简历")).toBeVisible();
    await page.getByRole("link", { name: "返回任务" }).click();
    await expect(page.getByRole("heading", { name: "生成岗位定制简历" })).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles("tests/fixtures/pdf/chinese-resume-reportlab.pdf");
    await expect(page.locator(".agent-artifact-drawer")).toBeVisible();
    await expect(page.getByText(/当前 Agent Tool 需要已有 PDF 导入流程/)).toBeVisible();
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

  test("tailors an existing resume, confirms a new revision, and restores the completed session", async ({ page }) => {
    let returnDiffs = false;
    await page.route("**/api/ai/structured", async (route) => {
      const body = route.request().postDataJSON() as {
        task: string;
        input: {
          target?: { sectionId: string; itemId: string; fieldPath: string };
          currentContent?: { fieldValue: string | string[] };
          relevantRequirements?: Array<{ requirementId: string; keywords: string[] }>;
          allowedEvidenceRefs?: unknown[];
          allowedFacts?: Array<{ value: string; evidenceRefs: unknown[] }>;
        };
      };
      if (body.task !== "resume-tailor-diff") {
        await route.continue();
        return;
      }
      const input = body.input;
      const evidenceRefs = input.allowedEvidenceRefs ?? [];
      const requirementIds = (input.relevantRequirements ?? []).map((item) => item.requirementId).slice(0, 2);
      const original = input.currentContent?.fieldValue ?? "";
      const rewrite = (text: string) => text.trim().endsWith("。")
        ? `${text.trim().slice(0, -1)}；`
        : `${text.trim()}。`;
      const value = Array.isArray(original)
        ? [rewrite(original[0] ?? "负责相关工作"), ...original.slice(1)]
        : rewrite(original);
      const output = returnDiffs && input.target && JSON.stringify(value) !== JSON.stringify(original)
        ? {
            diffs: [{
              target: {
                sectionId: input.target.sectionId,
                itemId: input.target.itemId,
                fieldPath: input.target.fieldPath
              },
              operation: "replace",
              original,
              value,
              reason: "基于现有证据突出与岗位相关的交付重点。",
              requirementIds,
              targetKeywords: (input.relevantRequirements ?? []).flatMap((item) => item.keywords).slice(0, 3),
              evidenceRefs,
              supportLevel: evidenceRefs.length ? "verified" : "user_declared"
            }],
            clarifications: []
          }
        : {
            diffs: [],
            clarifications: [{
              question: "请补充一个你能确认的相关交付案例。",
              requirementIds: requirementIds.length ? requirementIds : ["requirement-fallback"],
              answerType: "text"
            }]
          };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: body.task,
          promptVersion: "agent-e2e-diff.v1",
          output,
          meta: { provider: "fixture", model: "agent-e2e", inputLength: 1, outputLength: 1, latencyMs: 1 }
        })
      });
    });

    await page.goto("/resume");
    await page.getByRole("button", { name: /从个人资料库创建/ }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });

    await page.goto("/ai-workspace");
    await page.getByRole("button", { name: /生成岗位定制简历/ }).click();
    await page.getByLabel("选择已有简历").selectOption({ index: 1 });
    await page.getByRole("button", { name: "使用这份简历" }).click();
    await page.getByLabel("岗位名称").fill("高级产品经理");
    await page.getByLabel("公司").fill("目标科技");
    await page.getByLabel("岗位描述").fill([
      "工作职责",
      "1. 参与 AI 应用项目的需求梳理、原型设计和功能验收。",
      "2. 使用 Stata 清洗业务数据并完成统计分析。",
      "岗位要求",
      "1. 熟悉 TypeScript 与自动化测试。",
      "2. 具备跨团队沟通与交付能力。"
    ].join("\n"));
    await page.getByRole("button", { name: "解析岗位" }).click();
    await expect(page.getByText(/岗位语义核对/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "保存这个岗位？" })).toBeVisible();
    await page.getByRole("button", { name: "确认并继续" }).click();
    await page.getByRole("button", { name: "分析匹配并生成建议" }).click();
    await expect(page.locator(".agent-interactive-card")).not.toHaveAttribute("data-workflow-step", "generate_plan", { timeout: 20_000 });
    await expect(page.locator("#agent-question-answer")).toBeVisible({ timeout: 60_000 });
    await page.locator("#agent-question-answer").fill("我参与过 AI 应用项目的需求梳理、原型设计和功能验收。");
    await page.getByRole("button", { name: "提交回答" }).click();
    await expect(page.getByRole("heading", { name: "使用这项补充信息？" })).toBeVisible();
    returnDiffs = true;
    await page.getByRole("button", { name: "确认并继续" }).click();
    await expect(page.getByText("定制修改").first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "预览将应用的修改" }).click();
    await expect(page.getByRole("heading", { name: "应用这些简历修改？" })).toBeVisible();
    await page.getByRole("button", { name: "确认并继续" }).click();
    await expect(page.getByText("新版本已创建")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: "打开简历编辑器" }).click();
    await expect(page).toHaveURL(/\/resume\?branchId=/);

    await page.goto("/ai-workspace");
    await expect(page.getByText("新版本已创建")).toBeVisible();
    await page.getByRole("button", { name: /历史记录/ }).click();
    await expect(page.getByRole("dialog", { name: "历史记录" })).toBeVisible();
    await expect(page.locator(".agent-history-list > button")).toHaveCount(1);
  });
});
