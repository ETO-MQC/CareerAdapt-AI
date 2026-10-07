import { expect, test, type Page } from "@playwright/test";

async function skipSetupWizard(page: Page) {
  await page.goto("/jobs");
  const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  const setupVisible = await skipSetup.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (setupVisible) {
    await skipSetup.click();
    await page.goto("/jobs");
  }
}

const PRIMARY_JD = "职责：\n负责后端服务的设计与开发，参与技术方案评审。\n要求：\n3 年以上 Go 开发经验。\n加分：\n熟悉 Kubernetes 与可观测性建设。";
const SHARED_JD = "职责：\n负责数据平台建设。\n要求：\n熟悉 SQL 与数据仓库。";

test.describe("V4-P2-B candidate pipeline end-to-end", () => {
  test("paste JD -> candidate listing -> local/mock analysis -> review -> confirmed conversion -> survives refresh", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    // 模拟 AI 增强不可用：解析回退到本地确定性结果（流程继续，不阻塞）。
    await page.route("**/api/ai/structured", (route) => route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "invalid_json", message: "AI request failed." } })
    }));

    await skipSetupWizard(page);
    await expect(page.locator(".jobs-workspace")).toBeVisible();

    await page.getByTestId("job-title-input").fill("V4P2B 后端工程师");
    await page.getByTestId("job-company-input").fill("候选管道测试公司");
    await page.getByTestId("job-raw-textarea").fill(PRIMARY_JD);

    // 保存：进入候选岗位管道，出现候选岗位状态行；解析任务窗自动打开。
    await page.getByTestId("save-job-raw-input").click();
    await expect(page.getByTestId("candidate-status")).toContainText("local.manual");
    await expect(page.getByTestId("candidate-status")).toContainText("新候选");
    const dialog = page.locator(".job-analysis-dialog");
    await expect(dialog).toBeVisible();

    // 解析：AI 失败回退本地；本地解析仍完成并等待核对。
    await dialog.getByRole("button", { name: "同意脱敏并解析" }).click();
    await expect(page.locator(".app-notification").filter({ hasText: "本地解析已完成" }).first()).toBeVisible();
    await expect(dialog.getByTestId("commit-job")).toBeEnabled();

    // 用户核对：勾选全部要求（未确认要求不得进入正式岗位），排除第一条。
    const requirementRows = dialog.locator(".review-row");
    await expect(requirementRows.first()).toBeVisible();
    const count = await requirementRows.count();
    expect(count).toBeGreaterThan(0);
    const firstCheckbox = requirementRows.first().locator("input[type='checkbox']");
    await firstCheckbox.uncheck();
    for (let index = 1; index < count; index += 1) {
      const checkbox = requirementRows.nth(index).locator("input[type='checkbox']");
      if (!(await checkbox.isChecked())) await checkbox.check();
    }
    await expect(page.locator(".save-status")).toContainText("已保存");
    const excludedText = (await requirementRows.first().locator("strong").textContent())?.trim();

    // 提交：创建转换确认并单事务转换为正式岗位。
    await dialog.getByTestId("commit-job").click();
    await expect(page.locator(".app-notification").filter({ hasText: "岗位已提交" })).toBeVisible();
    await expect(page.getByTestId("conversion-result")).toContainText("正式岗位已创建");
    const savedJobRow = page.locator(".jobs-list-panel .job-card").filter({ hasText: "V4P2B 后端工程师" });
    await expect(savedJobRow).toHaveCount(1);

    // 未确认（被排除）的要求没有进入正式岗位。
    await page.getByRole("tab", { name: "岗位要求" }).click();
    const requirementPanel = page.locator(".job-requirement-cards");
    await expect(requirementPanel).toBeVisible();
    if (excludedText) {
      await expect(requirementPanel).not.toContainText(excludedText);
    }

    // 刷新后：正式岗位仍然可见；候选任务卡不再出现；排除项依旧不在。
    await page.reload();
    await expect(page.locator(".jobs-list-panel .job-card").filter({ hasText: "V4P2B 后端工程师" })).toHaveCount(1);
    await expect(page.getByTestId("candidate-status")).toHaveCount(0);
    await page.getByRole("tab", { name: "岗位要求" }).click();
    if (excludedText) {
      await expect(page.locator(".job-requirement-cards")).not.toContainText(excludedText);
    }
  });

  test("duplicate content under a new title asks the user, and keep-separate stores both candidates", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.on("dialog", (dialog) => void dialog.accept());
    await skipSetupWizard(page);
    await expect(page.locator(".jobs-workspace")).toBeVisible();

    await page.getByTestId("job-title-input").fill("V4P2B 数据平台 A");
    await page.getByTestId("job-company-input").fill("去重测试公司");
    await page.getByTestId("job-raw-textarea").fill(SHARED_JD);
    await page.getByTestId("save-job-raw-input").click();
    await expect(page.getByTestId("candidate-status")).toContainText("local.manual");

    // 弃用当前草稿，腾出入口再粘贴同内容、不同标题的第二条。
    const dialog = page.locator(".job-analysis-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "弃用草稿" }).click();
    await expect(page.getByTestId("candidate-status")).toHaveCount(0);

    await page.getByTestId("job-title-input").fill("V4P2B 数据平台 B");
    await page.getByTestId("job-company-input").fill("去重测试公司");
    await page.getByTestId("job-raw-textarea").fill(SHARED_JD);
    await page.getByTestId("save-job-raw-input").click();

    // 相同内容命中去重候选：UI 必须让用户选择，不能静默合并。
    await expect(page.getByTestId("duplicate-choice")).toBeVisible();
    await page.getByTestId("duplicate-keep-separate").click();
    await expect(page.getByTestId("candidate-status")).toContainText("新候选");
    await expect(page.getByTestId("duplicate-choice")).toHaveCount(0);
  });
});
