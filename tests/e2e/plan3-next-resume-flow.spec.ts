import { expect, test } from "@playwright/test";

test.describe("Plan3 resume flow corrections", () => {
  test("requires an explicit usable resume before showing or running job matches", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await page.goto("/jobs");
    const selector = page.getByLabel("来源通用简历");
    await expect(selector).toHaveValue("");
    await expect(page.getByTestId("run-experience-match")).toBeDisabled();

    await selector.selectOption({ index: 1 });
    await expect(page.getByTestId("run-experience-match")).toBeEnabled();
    await page.getByTestId("run-experience-match").click();
    await page.locator(".job-match-details summary").click();
    await expect(page.locator(".match-layout .match-list .match-row").first()).toBeVisible();
  });

  test("uses the correct personal link label and lets self evaluation sync on demand", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从零创建" }).click();
    await expect(page.getByLabel("个人主页 / LinkedIn")).toBeVisible();

    await page.getByTestId("resume-section-nav").getByRole("button", { name: /自我评价/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    await fields.locator(".tiptap-prosemirror").fill("注重结果，善于协作并持续复盘。");
    await fields.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("自我评价");
    await fields.getByRole("button", { name: "同步到资料库", exact: true }).click();
    await expect(fields.getByText("已同步资料库", { exact: true })).toBeVisible();
  });

  test("renders unsaved and saved experiences with the same collapsible card and keeps education selected", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从零创建" }).click();
    const sectionNav = page.getByTestId("resume-section-nav");
    await sectionNav.getByRole("button", { name: /教育经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    const draftCard = fields.locator(".accordion-item").filter({ hasText: "未保存的教育经历" });
    await expect(draftCard).toBeVisible();
    await draftCard.locator("summary").click();
    await expect(draftCard).not.toHaveAttribute("open", "");
    await draftCard.locator("summary").click();
    await fields.getByLabel("学校名称").fill("测试大学");
    await fields.getByLabel("学历").fill("本科");
    await fields.getByRole("button", { name: "保存到简历", exact: true }).click();

    await sectionNav.getByRole("button", { name: /工作.*经历/ }).click();
    await sectionNav.getByRole("button", { name: /教育经历/ }).click();
    await expect(fields.getByRole("heading", { name: "教育经历", exact: true }).first()).toBeVisible();
    await expect(fields.locator(".accordion-item").filter({ hasText: "测试大学" })).toBeVisible();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("教育经历");
  });

  test("enables developer quick cleanup without bypassing repository deletion rules", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从零创建" }).click();
    await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "返回", exact: true }).click();
    let card = page.locator(".resume-card").filter({ hasText: "空白简历" }).first();
    await card.locator("summary").click();
    await card.getByRole("button", { name: "归档", exact: true }).click();
    await page.locator(".resume-filter-row").getByRole("button", { name: /归档/ }).click();
    card = page.locator(".resume-card").filter({ hasText: "空白简历" }).first();
    await card.getByRole("button", { name: "移至回收站" }).click();

    await page.goto("/settings");
    await page.getByRole("button", { name: /开发者模式/ }).click();
    await page.getByLabel("启用快速清理").check();
    await page.goto("/recycle");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "快速清理", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("永久删除 1 项");
    await expect(page.getByText("共 0 项", { exact: true })).toBeVisible();
  });

  test("separates preview visibility from deletion and places technical skills after awards", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
    const nav = page.getByTestId("resume-section-nav");
    const fields = page.getByTestId("resume-active-section-fields");
    const preview = page.getByTestId("resume-a4-page").first();

    await nav.getByRole("button", { name: /技能/ }).click();
    const skillCard = fields.locator(".accordion-item").filter({ hasText: "Stata" });
    const skillVisibility = skillCard.getByRole("checkbox", { name: /在简历中显示/ });
    await skillVisibility.uncheck();
    await expect(skillVisibility).not.toBeChecked();
    await expect(preview).not.toContainText("Stata");
    await skillVisibility.check();
    await expect(skillVisibility).toBeChecked();
    await expect(preview).toContainText("Stata");

    await nav.getByRole("button", { name: /工作.*经历/ }).click();
    const experienceVisibility = fields.locator(".accordion-item").first().getByRole("checkbox", { name: /在简历中显示/ });
    await experienceVisibility.uncheck();
    await expect(experienceVisibility).not.toBeChecked();
    await experienceVisibility.check();
    await expect(experienceVisibility).toBeChecked();

    await nav.getByRole("button", { name: /奖项/ }).click();
    const addAward = fields.getByRole("button", { name: /添加奖项/ });
    if (await addAward.count()) await addAward.click();
    await fields.getByLabel("奖项名称或说明").fill("技术实践奖");
    await fields.getByRole("button", { name: "保存并确认", exact: true }).click();
    await expect(preview).toContainText("技术实践奖");
    const awardTop = await preview.getByRole("heading", { name: "奖项", exact: true }).boundingBox();
    const skillTop = await preview.getByRole("heading", { name: "技能", exact: true }).boundingBox();
    expect(awardTop).not.toBeNull();
    expect(skillTop).not.toBeNull();
    expect(awardTop!.y).toBeLessThan(skillTop!.y);

    await nav.getByRole("button", { name: /技能/ }).click();
    await skillCard.getByRole("button", { name: "删除", exact: true }).click();
    await expect(fields.locator(".accordion-item").filter({ hasText: "Stata" })).toHaveCount(0);
    await expect(preview).not.toContainText("Stata");
    await expect(page.locator(".app-notification").filter({ hasText: "内容已删除" }).last()).toBeVisible();
  });

  test("creates and switches independent people from personal info and self evaluation", async ({ page }) => {
    await page.goto("/profile");
    const listPanel = page.locator(".profile-list-panel");
    const detailPanel = page.locator(".profile-detail-panel");
    const personSelector = page.getByLabel("选择人物");

    await expect(listPanel.getByRole("button", { name: "新增", exact: true })).toBeVisible();
    await listPanel.getByRole("button", { name: "新增", exact: true }).click();
    await detailPanel.getByLabel("姓名").fill("测试人物甲");
    await detailPanel.getByLabel("职业标题").fill("前端工程师");
    await detailPanel.getByRole("button", { name: "创建人物", exact: true }).click();
    await expect(personSelector.locator("option", { hasText: "测试人物甲" })).toHaveCount(1);
    await expect(personSelector).toHaveValue(/profile-/);

    await page.locator(".profile-category-button").filter({ hasText: "自我评价" }).click();
    await expect(listPanel.getByRole("button", { name: "新增", exact: true })).toBeVisible();
    await listPanel.getByRole("button", { name: "新增", exact: true }).click();
    await detailPanel.getByLabel("姓名").fill("测试人物乙");
    await detailPanel.getByLabel("自我评价").fill("专注工程质量与跨团队协作。");
    await detailPanel.getByRole("button", { name: "创建人物", exact: true }).click();
    await expect(personSelector.locator("option", { hasText: "测试人物乙" })).toHaveCount(1);

    await page.goto("/resume");
    const resumePersonSelector = page.getByTestId("resume-profile-selector");
    await expect(resumePersonSelector.locator("option", { hasText: "测试人物甲" })).toHaveCount(1);
    await expect(resumePersonSelector.locator("option", { hasText: "测试人物乙" })).toHaveCount(1);
    await expect(resumePersonSelector.locator("option:checked")).toHaveText("测试人物乙");
    await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
    const preview = page.getByTestId("resume-a4-page").first();
    await expect(preview.getByRole("heading", { name: "测试人物乙", exact: true })).toBeVisible();
    await expect(preview).toContainText("专注工程质量与跨团队协作。");

    const resumeNav = page.getByTestId("resume-section-nav");
    const resumeFields = page.getByTestId("resume-active-section-fields");
    await resumeNav.getByRole("button", { name: /技能/ }).click();
    await resumeFields.getByLabel("技能名称或说明").fill("React");
    await resumeFields.getByRole("button", { name: "保存并确认", exact: true }).click();
    await resumeNav.getByRole("button", { name: /自我评价/ }).click();
    const summaryVisibility = page.getByTestId("resume-active-section-fields").getByRole("checkbox", { name: "在简历中显示：自我评价" });
    await summaryVisibility.uncheck();
    await expect(summaryVisibility).not.toBeChecked();
    await expect(preview).not.toContainText("专注工程质量与跨团队协作。");
    await summaryVisibility.check();
    await expect(summaryVisibility).toBeChecked();
    await expect(preview).toContainText("专注工程质量与跨团队协作。");
  });
});
