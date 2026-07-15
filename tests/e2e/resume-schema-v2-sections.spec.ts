import { expect, test } from "@playwright/test";

test.describe("Resume Studio v2 section catalog", () => {
  test("keeps defaults compact and manages optional/custom sections accessibly at 1024x768", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从零创建" }).click();

    const nav = page.getByTestId("resume-section-nav");
    await expect(nav.getByRole("button", { name: /基本信息/ })).toBeVisible();
    await expect(nav.getByRole("button", { name: /自我评价/ })).toBeVisible();
    await expect(nav.getByRole("button", { name: /教育经历/ })).toBeVisible();
    await expect(nav.getByRole("button", { name: /工作经历/ })).toBeVisible();
    await expect(nav.getByRole("button", { name: /项目经历/ })).toBeVisible();
    await expect(nav.getByRole("button", { name: /^技能$/ })).toBeVisible();
    await expect(nav.locator(":scope > .resume-section-nav").getByRole("button", { name: "科研经历" })).toHaveCount(0);

    const addButton = nav.getByRole("button", { name: "添加栏目" });
    await addButton.click();
    const menu = page.getByRole("dialog", { name: "添加或管理简历栏目" });
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: /科研/ }).click();
    await expect(nav.locator(":scope > .resume-section-nav").getByRole("button", { name: "科研经历" })).toBeVisible();

    await menu.getByLabel("自定义栏目").fill("开源贡献");
    await menu.getByRole("button", { name: "创建自定义栏目" }).click();
    await expect(nav.getByRole("button", { name: "开源贡献" })).toBeVisible();

    await addButton.click();
    await menu.getByLabel("自定义栏目").fill("开源贡献");
    await menu.getByRole("button", { name: "创建自定义栏目" }).click();
    await expect(menu.getByRole("alert")).toContainText("栏目名称已存在");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(addButton).toBeFocused();

    await addButton.click();
    await menu.getByRole("button", { name: /科研/ }).click();
    await expect(nav.locator(":scope > .resume-section-nav").getByRole("button", { name: "科研经历" })).toHaveCount(0);
    await page.reload();
    await expect(nav.getByRole("button", { name: "开源贡献" })).toBeVisible();
    await expect(nav.locator(":scope > .resume-section-nav").getByRole("button", { name: "科研经历" })).toHaveCount(0);
  });
});
