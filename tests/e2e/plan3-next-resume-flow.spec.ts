import { expect, test } from "@playwright/test";

test.describe("Plan3 resume flow corrections", () => {
  test("requires an explicit usable resume before showing or running job matches", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await page.goto("/jobs");
    const selector = page.getByLabel("用于诊断的基础简历");
    await expect(selector).toHaveValue("");
    await expect(page.getByTestId("run-experience-match")).toBeDisabled();

    await selector.selectOption({ index: 1 });
    await expect(page.getByTestId("run-experience-match")).toBeEnabled();
    await page.getByTestId("run-experience-match").click();
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
});
