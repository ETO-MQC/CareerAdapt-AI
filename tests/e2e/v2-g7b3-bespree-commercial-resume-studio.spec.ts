import { expect, test, type Page } from "@playwright/test";

test.describe("V2-G7b.3 Resume Center and Studio usability", () => {
  test("covers resume center entry, Studio modes, direct editing contract, and responsive fit", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await test.step("resume-center-primary-entry", async () => {
      await page.goto("/resume");
      await expect(page.getByRole("heading", { name: "我的简历" })).toBeVisible();
      await expect(page.getByTestId("resume-import-strip")).toBeVisible();
      await expect(page.getByTestId("resume-entry-import-primary")).toBeVisible();
      await expect(page.locator(".resume-support-row")).toContainText("PDF");
      await expect(page.locator(".resume-support-row")).toContainText("DOCX");
      await expect(page.locator(".resume-support-row")).toContainText("JSON");
      await expect(page.locator(".resume-support-row")).toContainText("图片OCR");
      await expect(page.locator(".resume-create-card")).toHaveCount(4);
      await expect(page.locator(".resume-library-panel")).toContainText("简历中心");
    });

    await test.step("json-import-review-confirms-into-studio", async () => {
      await importStructuredResume(page);
      await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("resume-studio-workbar")).toBeVisible();
    });

    await test.step("studio-workbar-is-compact-and-has-three-modes", async () => {
      const workbar = page.getByTestId("resume-studio-workbar");
      await expect(workbar).toBeVisible();
      await expect(page.locator(".resume-mode-rail button")).toHaveText(["编辑", "AI优化", "样式"]);
      await expect(workbar.getByRole("button", { name: "导出PDF" })).toBeVisible();
      await expect(workbar.locator(".toolbar-more summary")).toContainText("更多");
      await workbar.locator(".toolbar-more summary").click();
      await expect(workbar.locator(".toolbar-more-popover")).toContainText("导出 JSON");
      await workbar.locator(".toolbar-more summary").click();
    });

    await test.step("edit-layout-has-section-fields-resize-handle-and-a4-toolbar", async () => {
      await page.locator(".resume-mode-rail button").nth(0).click();
      await expect(page.getByTestId("resume-section-nav")).toBeVisible();
      await expect(page.getByTestId("resume-active-section-fields")).toBeVisible();
      await expect(page.locator(".studio-resize-handle")).toBeVisible();
      await expect(page.locator(".resume-canvas-toolbar")).toBeVisible();
      await expect(page.locator(".resume-preview-stage").getByTestId("resume-a4-page").first()).toBeVisible();
    });

    await test.step("section-nav-list-and-active-fields", async () => {
      const nav = page.getByTestId("resume-section-nav");
      await expect(nav).toContainText("个人信息");
      await expect(nav).toContainText("工作经历");
      await expect(nav).toContainText("技能");
      await nav.getByRole("button", { name: /工作经历/ }).click();
      const fields = page.getByTestId("resume-active-section-fields");
      await expect(fields).toContainText("公司 / 组织");
      await expect(fields).toContainText("职位 / 角色");
      await expect(fields).toContainText("描述要点");
    });

    await test.step("a4-single-click-selects-double-click-edits", async () => {
      await page.getByTestId("resume-section-nav").getByRole("button", { name: /个人信息/ }).click();
      const nameBlock = page.getByRole("heading", { name: "陈同学", exact: true }).first();
      await nameBlock.click();
      await expect(page.getByTestId("resume-studio-editor")).toHaveCount(0);
      await nameBlock.dblclick();
      await expect(page.getByTestId("resume-studio-editor").locator("textarea")).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("resume-studio-editor")).toHaveCount(0);
    });

    await test.step("ai-and-style-modes-keep-a4-preview", async () => {
      await page.locator(".resume-mode-rail button").nth(1).click();
      await expect(page.getByTestId("resume-ai-summary")).toContainText("内容表达");
      await expect(page.locator(".resume-preview-stage").getByTestId("resume-a4-page").first()).toBeVisible();

      await page.locator(".resume-mode-rail button").nth(2).click();
      await expect(page.locator(".resume-inspector .inspector-tablist button")).toHaveText(["模板", "颜色", "字体", "页面"]);
      await page.locator(".resume-inspector .inspector-tablist button").nth(3).click();
      await expect(page.getByTestId("page-policy-selector")).toBeVisible();
      await expect(page.getByTestId("pagination-summary")).toBeVisible();
    });

    await test.step("resume-center-card-actions-return-to-studio", async () => {
      await page.locator(".resume-studio-title-cluster button").first().click();
      await expect(page.getByTestId("resume-import-strip")).toBeVisible();
      const card = page.locator(".branch-list .match-row").first();
      await expect(card).toBeVisible();
      await expect(card.getByRole("button", { name: "打开", exact: true })).toBeVisible();
      await expect(card.getByRole("button", { name: "导出", exact: true })).toBeVisible();
      await card.locator(".resume-card-more summary").click();
      await expect(card.locator(".resume-card-more-popover")).toContainText("历史与页面");
      await expect(card.locator(".resume-card-more-popover")).toContainText("归档");
      await card.getByRole("button", { name: "打开", exact: true }).click();
      await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
    });

    await test.step("responsive-1366-and-1024-fit-a4-without-page-overflow", async () => {
      await assertResponsiveStudio(page, 1366, 768);
      await assertResponsiveStudio(page, 1024, 768);
    });
  });
});

async function importStructuredResume(page: Page) {
  await page.locator(".import-json-details summary").click();
  await page.locator(".import-json-details textarea").fill(JSON.stringify(sampleStructuredResumeJson(), null, 2));
  await page.locator(".import-json-details button.primary-button").click();
  await expect(page.getByTestId("import-quality-report")).toBeVisible({ timeout: 15_000 });
  await page.locator(".import-structure-panel .section-heading button.primary-button").click();
}

async function assertResponsiveStudio(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(350);
  const metrics = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".resume-preview-stage");
    const pageEl = document.querySelector<HTMLElement>(".resume-preview-stage [data-testid='resume-a4-page']");
    const workbar = document.querySelector<HTMLElement>("[data-testid='resume-studio-workbar']");
    const app = document.querySelector<HTMLElement>(".app-shell");
    const stageRect = stage?.getBoundingClientRect();
    const pageRect = pageEl?.getBoundingClientRect();
    const workbarRect = workbar?.getBoundingClientRect();
    return {
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      stageWidth: stageRect?.width ?? 0,
      pageWidth: pageRect?.width ?? 0,
      workbarHeight: workbarRect?.height ?? 0,
      sidebarCollapsed: app?.classList.contains("app-shell-sidebar-collapsed") ?? false
    };
  });

  expect(metrics.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.stageWidth + 1);
  expect(metrics.workbarHeight).toBeLessThanOrEqual(72);
  if (width <= 1400) {
    expect(metrics.sidebarCollapsed).toBe(true);
  }
}

function sampleStructuredResumeJson() {
  return {
    schemaVersion: "structured-resume-draft-v1",
    basics: {
      name: "陈同学",
      email: "demo.student@example.com",
      phone: "13800000000",
      location: "上海",
      summary: "数据分析方向学生，熟悉 Excel、Stata 和业务分析。"
    },
    sections: [
      {
        title: "项目与经历",
        sectionType: "experience",
        items: [
          "使用 Stata 清洗 31 个省级样本，并完成描述统计、相关分析与区域差异分析。",
          "使用 Excel 整理表格数据和基础分析结果。"
        ]
      },
      {
        title: "技能",
        sectionType: "skills",
        items: ["Excel", "Stata", "数据清洗", "描述统计"]
      }
    ]
  };
}
