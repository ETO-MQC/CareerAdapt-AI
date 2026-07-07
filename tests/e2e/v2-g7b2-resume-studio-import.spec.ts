import { expect, test, type Page } from "@playwright/test";

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.getByTestId("run-experience-match").click();
  await expect(page.locator(".match-row").first()).toBeVisible();
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible();

  await page.goto("/resume");
  await page.getByTestId("job-suggestion-draft-select").selectOption({ index: 0 });
  await page.locator("article.panel").first().locator("input").fill(branchName);
  await page.locator("article.panel").first().locator("button.primary-button").click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  await expect(page.getByTestId("resume-a4-page")).toBeVisible();
}

test.describe("V2-G7b.2 Resume Studio and import IA", () => {
  test("separates manual editing tools from AI optimization tools", async ({ page }) => {
    await createBranchFromDraft(page, `G7b2 mode split ${Date.now()}`);

    await expect(page.getByRole("heading", { name: "手动编辑" })).toBeVisible();
    await expect(page.getByRole("button", { name: "内容" })).toBeVisible();
    await expect(page.getByRole("button", { name: "目标岗位" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "版本历史" })).toBeVisible();

    await page.getByRole("button", { name: "AI" }).click();

    await expect(page.getByRole("heading", { name: "AI岗位优化" })).toBeVisible();
    await expect(page.getByRole("button", { name: "目标岗位" })).toBeVisible();
    await expect(page.getByRole("button", { name: "质量检查" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "版本历史" })).toHaveCount(0);
    await expect(page.getByText("正文字号")).toHaveCount(0);
  });

  test("imports structured JSON into the same review flow before confirmation", async ({ page }) => {
    await page.goto("/resume");
    await page.getByText("粘贴结构化 JSON").click();
    await page.locator(".import-json-details textarea").fill(JSON.stringify({
      schemaVersion: "structured-resume-draft-v1",
      basics: {
        name: "陈同学",
        email: "demo.student@example.com",
        summary: "数据分析方向学生。"
      },
      sections: [{
        title: "项目与经历",
        sectionType: "experience",
        items: ["使用 Stata 清洗 31 个省级样本。"]
      }]
    }));
    await page.getByRole("button", { name: "导入JSON" }).click();

    await expect(page.getByTestId("import-quality-report")).toBeVisible();
    await expect(page.getByText("结构化 JSON 已进入核对页")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认导入" })).toBeVisible();
    await expect(page.locator(".import-source-text")).toContainText("陈同学");
  });

  test("exports the active resume as structured JSON", async ({ page }) => {
    await createBranchFromDraft(page, `G7b2 JSON export ${Date.now()}`);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出JSON" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain("structured-resume.json");
    await expect(page.locator(".notice")).toContainText("结构化 JSON 已下载");
  });
});
