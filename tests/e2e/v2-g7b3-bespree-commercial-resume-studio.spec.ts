import { expect, test, type Page } from "@playwright/test";

test.describe("V2-G7b.3 Bespree-reference commercial Resume Studio", () => {
  test("covers named acceptance checks for resume entry and studio modes", async ({ page }) => {
    const branchName = `G7b3 matrix ${Date.now()}`;

    await test.step("resume-home-primary-actions", async () => {
      await page.goto("/resume");
      await expect(page.getByRole("heading", { name: "我的简历" })).toBeVisible();
      await expect(page.getByTestId("resume-entry-import-primary")).toBeVisible();
      await expect(page.locator(".resume-entry-menu summary")).toContainText("新建");
    });

    await test.step("resume-home-import-supports-pdf-docx-json-ocr", async () => {
      await expect(page.getByRole("button", { name: "PDF", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "DOCX", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "OCR实验", exact: true })).toBeVisible();
    });

    await createBranchFromDraft(page, branchName);

    await test.step("resume-studio-workbar-three-modes", async () => {
      await expect(page.getByTestId("resume-studio-workbar")).toBeVisible();
      await expect(page.locator(".resume-mode-rail button")).toHaveText(["编辑", "AI优化", "样式"]);
      await expect(page.getByRole("button", { name: "导出PDF" })).toBeVisible();
      await expect(page.getByRole("button", { name: "导出JSON" })).toBeVisible();
      await expect(page.locator(".toolbar-more summary")).toContainText("更多");
    });

    await test.step("resume-studio-edit-layout", async () => {
      await page.locator(".resume-mode-rail button").nth(0).click();
      await expect(page.getByTestId("resume-section-nav")).toBeVisible();
      await expect(page.getByTestId("resume-active-section-fields")).toBeVisible();
      await expect(page.getByTestId("resume-a4-page").first()).toBeVisible();
    });

    await test.step("section-nav-full-list", async () => {
      await expect(page.getByTestId("resume-section-nav").locator("button")).toHaveText([
        /个人信息/,
        /自我评价/,
        /工作经历/,
        /教育经历/,
        /项目经历/,
        /校园经历/,
        /技能/,
        /奖项/,
        /证书/,
        /语言/,
        /自定义栏目/,
        /添加栏目/
      ]);
    });

    await test.step("only-active-section-visible-and-structured-fields", async () => {
      await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
      const fields = page.getByTestId("resume-active-section-fields");
      await expect(fields).toContainText("公司 / 组织");
      await expect(fields).toContainText("职位 / 角色");
      await expect(fields).toContainText("开始时间");
      await expect(fields).toContainText("描述要点");
      await expect(fields).not.toContainText("教育经历");
    });

    await test.step("content-copy-delete-restore-create-revisions", async () => {
      const fields = page.getByTestId("resume-active-section-fields");
      const cards = fields.locator(".resume-entry-editor-card");
      const beforeCount = await cards.count();
      expect(beforeCount).toBeGreaterThan(0);

      await fields.getByRole("button", { name: "复制" }).first().click();
      await expect(cards).toHaveCount(beforeCount + 1);

      const activeCard = fields.locator(".resume-entry-editor-card[open]").first();
      await expect(activeCard).toBeVisible();
      await activeCard.getByRole("button", { name: "删除" }).click();
      await expect(activeCard.getByRole("button", { name: "恢复" })).toBeVisible();

      await activeCard.getByRole("button", { name: "恢复" }).click();
      await expect(activeCard.getByRole("button", { name: "删除" })).toBeVisible();
    });

    await test.step("canvas-form-sync-and-inline-edit", async () => {
      await page.getByTestId("resume-section-nav").getByRole("button", { name: /个人信息/ }).click();
      await page.getByTestId("resume-active-section-fields").getByLabel("姓名").focus();
      await expect(page.locator(".resume-template-inline-selected[data-source-item-id='profile:name']")).toBeVisible();
      await expect(page.getByTestId("resume-studio-editor")).toBeVisible();
      await page.getByTestId("resume-studio-editor").getByRole("button", { name: "编辑" }).click();
      await expect(page.getByTestId("resume-studio-editor").locator("textarea")).toBeVisible();
      await page.getByTestId("resume-studio-editor").locator("textarea").press("Escape");
    });

    await test.step("ime-keyboard-contract-and-undo-visible", async () => {
      if (await page.getByTestId("resume-studio-editor").locator("textarea").count() === 0) {
        await page.getByTestId("resume-studio-editor").getByRole("button", { name: "编辑" }).click();
      }
      const editor = page.getByTestId("resume-studio-editor").locator("textarea");
      await expect(editor).toBeVisible();
      await editor.press("Escape");
      await expect(page.getByTestId("resume-studio-workbar").getByRole("button", { name: "撤销" })).toBeVisible();
    });

    await test.step("ai-mode-keeps-a4-and-summary-cards", async () => {
      await page.locator(".resume-mode-rail button").nth(1).click();
      await expect(page.getByTestId("resume-a4-page").first()).toBeVisible();
      await expect(page.getByTestId("resume-ai-summary")).toContainText("内容表达");
      await expect(page.getByTestId("resume-ai-summary")).toContainText("事实安全");
    });

    await test.step("ai-quality-facts-match-record-tabs", async () => {
      const tabs = page.locator(".resume-inspector .inspector-tablist button");
      await expect(tabs).toHaveText(["目标岗位", "建议", "质量检查", "事实缺口", "匹配", "记录"]);
      await tabs.nth(2).click();
      await expect(page.getByTestId("resume-diagnostics-panel")).toBeVisible();
      await tabs.nth(3).click();
      await expect(page.getByTestId("resume-diagnostics-panel")).toBeVisible();
    });

    await test.step("style-mode-layout-and-tabs", async () => {
      await page.locator(".resume-mode-rail button").nth(2).click();
      await expect(page.getByTestId("resume-a4-page").first()).toBeVisible();
      await expect(page.locator(".resume-inspector .inspector-tablist button")).toHaveText(["模板", "颜色", "字体", "页面"]);
    });

    await test.step("style-template-color-font-page-controls", async () => {
      const tabs = page.locator(".resume-inspector .inspector-tablist button");
      await tabs.nth(0).click();
      await expect(page.locator(".resume-inspector select").first()).toContainText("稳重技术");
      await tabs.nth(1).click();
      await expect(page.locator(".color-swatch")).toHaveCount(4);
      await tabs.nth(2).click();
      await expect(page.getByLabel("正文字号")).toBeVisible();
      await expect(page.getByLabel("行距")).toBeVisible();
      await tabs.nth(3).click();
      await expect(page.getByTestId("page-policy-selector")).toBeVisible();
      await expect(page.getByTestId("pagination-summary")).toBeVisible();
    });

    await test.step("resumes-page-cards-primary-actions-more-menu", async () => {
      await page.getByRole("button", { name: "返回" }).click();
      const card = page.locator(".branch-list .match-row").filter({ hasText: branchName }).first();
      await expect(card).toBeVisible();
      await expect(card.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "导出", exact: true })).toBeVisible();
      await card.locator(".resume-card-more summary").click();
      await expect(card.getByRole("button", { name: "归档" })).toBeVisible();
      await card.getByRole("button", { name: "编辑", exact: true }).click();
    });

    await test.step("responsive-1366-and-1024-no-page-overflow", async () => {
      await assertNoHorizontalOverflow(page, 1366, 768);
      await assertNoHorizontalOverflow(page, 1024, 768);
    });

    await test.step("multipage-zoom-export-regression-controls", async () => {
      await page.locator(".resume-mode-rail button").nth(2).click();
      await page.locator(".resume-inspector .inspector-tablist button").nth(3).click();
      await page.getByTestId("page-policy-selector").selectOption("up_to_two_pages");
      await expect(page.getByTestId("pagination-summary")).toContainText("策略上限");
      await expect(page.getByRole("button", { name: "导出PDF" })).toBeVisible();
      await expect(page.getByRole("button", { name: "导出JSON" })).toBeVisible();
    });
  });
});

async function createBranchFromDraft(page: Page, branchName: string) {
  await page.goto("/jobs");
  await page.getByTestId("run-experience-match").click();
  await page.locator(".match-layout .match-list .match-row").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.getByTestId("create-suggestion-draft").click();
  await expect(page.locator(".notice")).toBeVisible({ timeout: 15_000 });

  await page.goto("/resume");
  await page.getByTestId("job-suggestion-draft-select").first().selectOption({ index: 0 });
  await page.getByTestId("new-resume-branch-name").first().fill(branchName);
  await page.getByTestId("create-job-resume").first().click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
}

async function assertNoHorizontalOverflow(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  expect(overflow).toBeLessThanOrEqual(1);
}
