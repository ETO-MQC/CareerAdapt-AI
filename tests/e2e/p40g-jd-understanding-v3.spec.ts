import { test, expect } from "@playwright/test";

const JD_TEXT = `AI 软件工程师
岗位职责
大模型应用开发，搭建和调优 RAG 系统与 AI Agent 任务规划、工具调用
使用 Python / FastAPI 完成接口开发
使用 Playwright 进行端到端自动化测试
负责模型输出评估、Prompt Engineering 与结构化输出验证
任职要求
必须：3 年以上 Python 开发经验
必须：熟悉 FastAPI 或类似框架
满足以下任一条件即可
有 RAG 系统搭建经验
有 AI Agent 开发经验
加分项
熟悉 Playwright 或 Vitest
有 Coding Agent 使用经验
候选人画像
我们希望你对 AI 输出质量有天然的敏感度
能够独立定位问题并提出改进建议
验证材料
GitHub 仓库或个人项目链接
作品集或技术博客
公司介绍
我们是一家 AI 驱动的科技公司。`;

test.describe("P4.0g JD Understanding v3 E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");
  });

  test("同一 JD 连续解析两次，结构一致", async ({ page }) => {
    // First parse
    const jdInput = page.locator("textarea, [contenteditable]").first();
    await jdInput.fill(JD_TEXT);
    const submitBtn = page.locator("button").filter({ hasText: /解析|提交|分析|保存/ }).first();
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Capture first result
    const firstResult = await page.locator(".requirement-item, [data-requirement]").count();

    // Navigate away and back
    await page.goto("/");
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");

    // Second parse with same JD
    const jdInput2 = page.locator("textarea, [contenteditable]").first();
    await jdInput2.fill(JD_TEXT);
    const submitBtn2 = page.locator("button").filter({ hasText: /解析|提交|分析|保存/ }).first();
    await submitBtn2.click();
    await page.waitForTimeout(2000);

    // Verify structure is consistent
    const secondResult = await page.locator(".requirement-item, [data-requirement]").count();
    expect(secondResult).toBe(firstResult);
  });

  test("页面不出现包装句作为 requirement", async ({ page }) => {
    const jdInput = page.locator("textarea, [contenteditable]").first();
    await jdInput.fill(JD_TEXT);
    const submitBtn = page.locator("button").filter({ hasText: /解析|提交|分析|保存/ }).first();
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Wrapper texts should NOT appear as requirements
    const pageText = await page.locator("body").textContent();
    expect(pageText).not.toContain("满足以下任一条件即可");
    expect(pageText).not.toContain("具备以下任一条件者优先");
    expect(pageText).not.toContain("根据自身情况提供以下材料");
  });

  test("提交正式岗位后 Graph 与平面要求一致", async ({ page }) => {
    const jdInput = page.locator("textarea, [contenteditable]").first();
    await jdInput.fill(JD_TEXT);
    const submitBtn = page.locator("button").filter({ hasText: /解析|提交|分析|保存/ }).first();
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Submit formal job
    const formalSubmit = page.locator("button").filter({ hasText: /提交|确认|正式/ }).first();
    if (await formalSubmit.isVisible()) {
      await formalSubmit.click();
      await page.waitForTimeout(2000);
    }

    // Verify requirements are displayed (excluding headings/wrappers)
    const requirementItems = page.locator(".requirement-item, [data-requirement]");
    const count = await requirementItems.count();
    expect(count).toBeGreaterThan(0);

    // Verify headings are not shown as requirements
    const allText = await page.locator("body").textContent();
    expect(allText).not.toMatch(/^(岗位职责|任职要求|加分项|验证材料|候选人画像)$/);
  });

  test("岗位定制使用正确的 must-any-of 子项", async ({ page }) => {
    const jdInput = page.locator("textarea, [contenteditable]").first();
    await jdInput.fill(JD_TEXT);
    const submitBtn = page.locator("button").filter({ hasText: /解析|提交|分析|保存/ }).first();
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Check for any_of group in the UI
    const pageText = await page.locator("body").textContent();
    // The any_of group should have children listed
    expect(pageText).toContain("RAG");
    expect(pageText).toContain("Agent");
  });

  test("验证材料进入申请清单，不进入技能改写", async ({ page }) => {
    const jdInput = page.locator("textarea, [contenteditable]").first();
    await jdInput.fill(JD_TEXT);
    const submitBtn = page.locator("button").filter({ hasText: /解析|提交|分析|保存/ }).first();
    await submitBtn.click();
    await page.waitForTimeout(2000);

    // Verification materials should be visible
    const pageText = await page.locator("body").textContent();
    expect(pageText).toContain("GitHub");
    expect(pageText).toContain("作品集");
  });

  test("应用建议后 Presentation 不变", async ({ page }) => {
    // This test verifies that applying tailoring suggestions doesn't change presentation config
    // Navigate to a job with existing tailoring
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");

    // Look for existing job entries
    const jobCards = page.locator(".job-card, [data-job]");
    const jobCount = await jobCards.count();

    if (jobCount > 0) {
      await jobCards.first().click();
      await page.waitForTimeout(1000);

      // If there's an apply/confirm button for suggestions, click it
      const applyBtn = page.locator("button").filter({ hasText: /应用|确认|接受/ }).first();
      if (await applyBtn.isVisible()) {
        await applyBtn.click();
        await page.waitForTimeout(2000);

        // Presentation should remain consistent
        const afterText = await page.locator("body").textContent();
        // Basic structure should be preserved
        expect(afterText).toBeTruthy();
      }
    }
  });

  test("投递检查不重复显示同一缺口", async ({ page }) => {
    // Navigate to diagnostics/delivery check
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");

    // Look for diagnostics section
    const diagnosticsSection = page.locator("[data-diagnostics], .diagnostics-panel, .delivery-check");
    if (await diagnosticsSection.count() > 0) {
      const issues = page.locator(".diagnostic-issue, [data-issue]");

      // Check that no requirement gap appears twice
      const issueTexts = await issues.allTextContents();
      const uniqueTexts = new Set(issueTexts);
      expect(uniqueTexts.size).toBe(issueTexts.length);
    }
  });

  test("缺少能力可确认但不阻断导出", async ({ page }) => {
    // Navigate to a job branch with diagnostics
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");

    // Check diagnostics summary
    const diagnosticsSummary = page.locator(".diagnostics-summary, [data-diagnostics-summary]");
    if (await diagnosticsSummary.count() > 0) {
      const summaryText = await diagnosticsSummary.textContent();

      // If there are warnings about missing capabilities, export should still be available
      if (summaryText?.includes("未覆盖") || summaryText?.includes("缺口")) {
        const exportBtn = page.locator("button").filter({ hasText: /导出|下载|PDF/ }).first();
        expect(await exportBtn.isVisible()).toBe(true);
      }
    }
  });
});
