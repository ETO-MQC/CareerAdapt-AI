import { expect, test, type Page } from "@playwright/test";

// V4-P0 引入了首次运行向导；本文件先于该向导编写，进入页面前先跳过。
async function skipSetupWizard(page: Page) {
  await page.goto("/jobs");
  const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  const setupVisible = await skipSetup.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (setupVisible) {
    await skipSetup.click();
    await skipSetupWizard(page);
  }
}

test.describe("P3.4a job persistence and immediate refresh", () => {
  test("manual classification saves once, appears without refresh, tabs stay stable, and refresh persists", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await skipSetupWizard(page);
    await expect(page.locator(".jobs-workspace")).toBeVisible();
    const overviewBoxes = await page.locator(".jobs-overview-grid > .panel").evaluateAll((panels) => panels.map((panel) => panel.getBoundingClientRect().toJSON()));
    expect(overviewBoxes).toHaveLength(2);
    expect(overviewBoxes[0].y).toBe(overviewBoxes[1].y);
    expect(overviewBoxes[1].x).toBeGreaterThan(overviewBoxes[0].x + overviewBoxes[0].width);
    await expect(page.locator(".jobs-detail-panel")).toHaveCount(0);
    await expect(page.getByTestId("job-raw-textarea")).toBeVisible();

    await page.getByTestId("job-title-input").fill("P3.4a 数据分析师");
    await page.getByTestId("job-company-input").fill("即时刷新测试公司");
    await page.getByTestId("job-raw-textarea").fill(
      "职责：\n负责业务数据分析与指标体系建设。\n要求：\n熟练使用 SQL 和 Excel。\n能够与产品及运营团队协作推进分析结论落地。\n本科及以上学历。"
    );
    await page.getByTestId("save-job-raw-input").click();
    await expect(page.getByTestId("job-analyze-ai")).toBeVisible();

    await page.getByTestId("job-manual-mode-dialog").click();
    const requirement = page.locator(".review-row").first();
    await expect(requirement).toBeVisible();
    const checkbox = requirement.locator("input[type='checkbox']");

    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await expect(page.locator(".save-status")).toContainText("已保存");
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await expect(page.locator(".save-status")).toContainText("已保存");

    await page.getByTestId("commit-job").click();
    await expect(page.locator(".app-notification").filter({ hasText: "岗位已提交" })).toBeVisible();
    const savedJobRow = page.locator(".jobs-list-panel .job-card").filter({ hasText: "P3.4a 数据分析师" });
    await expect(savedJobRow).toHaveCount(1);
    await expect(savedJobRow).toBeVisible();
    await expect(page.getByTestId("commit-job")).toHaveCount(0);
    await expect(page.getByTestId("job-title-input")).toHaveValue("");
    await expect(page.locator(".app-notification").filter({ hasText: "岗位已提交" })).toBeVisible();

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(page.getByRole("tab", { name: "生成岗位简历" })).toHaveAttribute("aria-selected", "true");
    for (const name of ["生成岗位简历", "岗位信息", "岗位要求", "求职进度"]) {
      const tab = page.getByRole("tab", { name });
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box?.height).toBe(60);
      expect(box?.width).toBeGreaterThanOrEqual(88);
      const styles = await tab.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          minWidth: computed.minWidth,
          paddingLeft: computed.paddingLeft,
          paddingRight: computed.paddingRight
        };
      });
      expect(Number.parseFloat(styles.minWidth)).toBeGreaterThanOrEqual(0);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }

    await page.getByRole("tab", { name: "生成岗位简历" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "岗位信息" })).toBeFocused();

    await page.reload();
    await expect(page.locator(".jobs-list-panel .job-card").filter({ hasText: "P3.4a 数据分析师" })).toHaveCount(1);
    const rootOverflow = await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(rootOverflow).toBe(0);
    const rootVerticalScroll = await page.locator("html").evaluate((node) => node.scrollHeight - node.clientHeight);
    expect(rootVerticalScroll).toBe(0);
  });

  test("invalid AI output falls back locally, commits, and does not restore the committed draft", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.route("**/api/ai/structured", (route) => route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: { code: "invalid_json", message: "AI request failed." } })
    }));
    await skipSetupWizard(page);
    await expect(page.locator(".jobs-workspace-v2")).toBeVisible();
    const overviewBoxes = await page.locator(".jobs-overview-grid > .panel").evaluateAll((panels) => panels.map((panel) => panel.getBoundingClientRect().toJSON()));
    expect(overviewBoxes).toHaveLength(2);
    expect(overviewBoxes[0].y).toBe(overviewBoxes[1].y);
    expect(overviewBoxes[1].x).toBeGreaterThan(overviewBoxes[0].x + overviewBoxes[0].width);
    expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    await page.getByTestId("job-title-input").fill("本地降级测试岗位");
    await page.getByTestId("job-company-input").fill("本地降级测试公司");
    await page.getByTestId("job-raw-textarea").fill("职责：\n负责数据产品规划与交付。\n要求：\n熟练使用 SQL。\n能够使用英语进行工作沟通。\n本科及以上学历。");
    await page.getByTestId("save-job-raw-input").click();
    await page.locator(".job-analysis-dialog").getByRole("button", { name: "同意脱敏并解析" }).click();

    await expect(page.getByRole("heading", { name: "本地岗位语义核对" })).toBeVisible();
    await expect(page.locator(".app-notification").filter({ hasText: "本地解析已完成，AI 增强未完成" })).toBeVisible();

    const checkboxes = page.locator(".review-row input[type='checkbox']:not(:checked):not(:disabled)");
    for (let index = await checkboxes.count() - 1; index >= 0; index -= 1) await checkboxes.nth(index).check();
    await page.getByTestId("commit-job").click();
    await expect(page.locator(".jobs-list-panel .job-card").filter({ hasText: "本地降级测试岗位" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "本地岗位语义核对" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "本地岗位语义核对" })).toHaveCount(0);
    await expect(page.getByTestId("job-title-input")).toHaveValue("");
    await expect(page.locator(".jobs-list-panel .job-card").filter({ hasText: "本地降级测试岗位" })).toBeVisible();
  });
});
