import { expect, test } from "@playwright/test";

test.describe("P3.4a job persistence and immediate refresh", () => {
  test("manual classification saves once, appears without refresh, tabs stay stable, and refresh persists", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/jobs");
    await expect(page.locator(".jobs-workspace")).toBeVisible();

    await page.locator(".job-create-disclosure").getByText("新增或更新岗位", { exact: true }).click();
    await page.getByTestId("job-title-input").fill("P3.4a 数据分析师");
    await page.getByTestId("job-company-input").fill("即时刷新测试公司");
    await page.getByTestId("job-raw-textarea").fill(
      "负责业务数据分析与指标体系建设；要求熟练使用 SQL 和 Excel；能够与产品及运营团队协作推进分析结论落地。"
    );
    await page.getByTestId("save-job-raw-input").click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();

    await page.getByTestId("job-manual-mode").click();
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
    await expect(page.getByText("已写入正式岗位数据", { exact: false })).toBeVisible();
    const savedJobRow = page.locator(".jobs-list-panel .match-row").filter({ hasText: "即时刷新测试公司 / P3.4a 数据分析师" });
    await expect(savedJobRow).toHaveCount(1);
    await expect(savedJobRow).toBeVisible();
    await expect(page.getByTestId("commit-job")).toHaveCount(0);
    await expect(page.getByTestId("job-title-input")).toHaveValue("");
    await expect(page.locator(".app-notification")).toContainText("岗位已提交");

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    for (const name of ["岗位信息", "岗位要求", "关联简历", "求职进度"]) {
      const tab = page.getByRole("tab", { name });
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box?.height).toBe(36);
      expect(box?.width).toBeGreaterThanOrEqual(88);
      const styles = await tab.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          minWidth: computed.minWidth,
          paddingLeft: computed.paddingLeft,
          paddingRight: computed.paddingRight
        };
      });
      expect(styles).toEqual({
        minWidth: "88px",
        paddingLeft: "16px",
        paddingRight: "16px"
      });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }

    await page.getByRole("tab", { name: "岗位信息" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "岗位要求" })).toBeFocused();

    await page.reload();
    await expect(page.locator(".jobs-list-panel .match-row").filter({ hasText: "即时刷新测试公司 / P3.4a 数据分析师" })).toHaveCount(1);
    const rootOverflow = await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(rootOverflow).toBe(0);
  });
});
