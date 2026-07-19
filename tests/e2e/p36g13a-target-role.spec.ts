import { expect, test, type Page } from "@playwright/test";

test.describe("P3.6g1.3a resume name and target role", () => {
  test("renames the resume independently from its target role", async ({ page }) => {
    await openProfileBackedResume(page);
    const targetRole = page.getByLabel("目标职位");
    await targetRole.fill("开发工程师");
    await targetRole.blur();
    await expect(page.locator('[data-profile-field-id="branch:targetRole"]').first()).toHaveText("开发工程师");

    await page.locator(".resume-studio-title-cluster button").first().click();
    const card = page.locator(".resume-card").first();
    await card.getByRole("button", { name: "重命名简历" }).click();
    const renameInput = card.getByLabel("简历名称");
    await renameInput.fill("2026校招主投版");
    await renameInput.press("Enter");
    await expect(card.locator("strong")).toHaveText("2026校招主投版（开发工程师）");
    await expect(card.locator(".resume-card-target-role")).toHaveText("（开发工程师）");

    await card.getByRole("button", { name: "打开", exact: true }).click();
    await expect(page.locator('[data-profile-field-id="branch:targetRole"]').first()).toHaveText("开发工程师");
    await expect(page.getByTestId("resume-a4-page").first()).not.toContainText("2026校招主投版");
  });

  test("clears the target role without blocking preview or PDF", async ({ page }) => {
    await openProfileBackedResume(page);
    const targetRole = page.getByLabel("目标职位");
    await targetRole.fill("");
    await targetRole.blur();

    await expect(page.getByTestId("resume-a4-page").first()).toBeVisible();
    await expect(page.locator('[data-profile-field-id="branch:targetRole"]')).toHaveCount(0);
    await expect(page.getByTestId("resume-a4-page").first()).not.toContainText("通用简历");
    await expect(page.getByTestId("render-coverage-warning")).toHaveCount(0);

    await page.locator(".resume-mode-rail button").nth(2).click();
    await page.locator(".resume-inspector .inspector-tablist button").nth(3).click();
    await expect(page.getByTestId("pdf-export-controls").locator("button").first()).toBeEnabled();
  });
});

async function openProfileBackedResume(page: Page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/resume");
  await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
}
