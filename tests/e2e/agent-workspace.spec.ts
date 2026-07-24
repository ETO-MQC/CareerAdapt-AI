import { expect, test } from "@playwright/test";

test.describe("AI workspace shell", () => {
  test("shows six truthful quick starts and remains usable at compact desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/ai-workspace");

    await expect(page.getByRole("heading", { name: "AI 工作台", exact: true })).toBeVisible();
    const cards = page.locator(".agent-quick-card");
    await expect(cards).toHaveCount(6);
    await expect(cards.filter({ hasText: "即将开放" })).toHaveCount(4);
    await expect(page.getByRole("button", { name: /已有简历适配目标岗位/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /从资料库生成岗位简历/ })).toBeEnabled();
    await expect(page.locator(".agent-composer")).toBeVisible();
    await expect(page.locator(".agent-artifact-panel")).toBeVisible();
    expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    expect(await page.locator(".agent-workspace").evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: "artifacts/agent-workspace-1024x768.png", fullPage: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: "artifacts/agent-workspace-1366x768.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: "artifacts/agent-workspace-1440x900.png", fullPage: true });
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
    await page.getByRole("button", { name: /已有简历适配目标岗位/ }).click();
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
    await expect(page.locator(".agent-task-panel")).not.toHaveAttribute("data-workflow-step", "generate_plan", { timeout: 20_000 });
    await expect(page.locator("#agent-question-answer")).toBeVisible({ timeout: 60_000 });
    await page.locator("#agent-question-answer").fill("我参与过 AI 应用项目的需求梳理、原型设计和功能验收。");
    await page.getByRole("button", { name: "提交回答" }).click();
    await expect(page.getByRole("heading", { name: "使用这项补充信息？" })).toBeVisible();
    returnDiffs = true;
    await page.getByRole("button", { name: "确认并继续" }).click();
    await expect(page.getByText("Tailoring Diff").first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "预览将应用的修改" }).click();
    await expect(page.getByRole("heading", { name: "应用这些简历修改？" })).toBeVisible();
    await page.getByRole("button", { name: "确认并继续" }).click();
    await expect(page.getByText("新版本已创建")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: "打开编辑器" }).click();
    await expect(page).toHaveURL(/\/resume\?branchId=/);

    await page.goto("/ai-workspace");
    await expect(page.getByText("新版本已创建")).toBeVisible();
    await page.getByRole("button", { name: /历史记录/ }).click();
    await expect(page.getByRole("dialog", { name: "历史记录" })).toBeVisible();
    await expect(page.locator(".agent-history-list > button")).toHaveCount(1);
  });
});
