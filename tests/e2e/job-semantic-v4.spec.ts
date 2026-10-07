import { expect, test, type Page } from "@playwright/test";
import { AI_TRAINER_JD_V4 } from "../fixtures/aiTrainerJdV4";


// V4-P0 引入了首次运行向导；以下用例先于该向导编写，进入岗位页前先跳过。
async function skipSetupWizard(page: Page) {
  await page.goto("/jobs");
  const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  const setupVisible = await skipSetup.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (setupVisible) {
    await skipSetup.click();
    await page.waitForURL(/\/$/, { timeout: 10_000 }).catch(() => undefined);
    await page.goto("/jobs");
  }
  await page.goto("/jobs");
}


test("AI 训练师 JD 编译为 3 条职责、1 个三项方向组并提示来源矛盾", async ({ page }) => {
  await skipSetupWizard(page);
  await expect(page.locator(".jobs-workspace")).toBeVisible();
  await page.getByLabel("岗位名称").fill("AI 训练师");
  await page.getByLabel("公司名称").fill("脱敏测试公司");
  await page.getByLabel("岗位描述").fill(AI_TRAINER_JD_V4);
  await page.getByRole("button", { name: "保存并分析岗位" }).click();

  const dialog = page.getByRole("dialog", { name: "AI 训练师" });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("job-manual-mode-dialog").click();
  const responsibilities = dialog.locator(".job-draft-section").filter({ has: page.getByRole("heading", { name: "工作职责", exact: true }) });
  await expect(responsibilities.locator(".review-row")).toHaveCount(3);
  const context = dialog.locator(".context-groups");
  await expect(context).toContainText("复杂多轮指令");
  await expect(context).toContainText("复杂任务规划");
  await expect(context).toContainText("搜索任务");
  await expect(context.locator("li")).toHaveCount(3);
  await expect(dialog.getByRole("status")).toContainText("来源");
  await expect(dialog).not.toContainText("33 条");
});
