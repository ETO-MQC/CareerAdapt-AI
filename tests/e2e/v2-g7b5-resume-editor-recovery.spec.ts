import { expect, test } from "@playwright/test";

test.describe("V2-G7b.5 resume editor recovery", () => {
  test("creates a real blank resume, persists independent fields, and returns to Resume Center on reload", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/resume");

    await expect(page.getByRole("heading", { name: "我的简历", exact: true })).toBeVisible();
    await expect(page.getByTestId("resume-import-dock")).toHaveCount(0);
    await page.getByRole("button").filter({ hasText: "从零创建" }).click();

    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await expect(page.getByText("当前简历不能进入正式模板预览。", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("resume-a4-page").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "导出PDF", exact: true })).toBeDisabled();

    await page.locator("#basics-name").fill("空白简历用户");
    await page.locator("#basics-name").press("Tab");
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("空白简历用户");

    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    await fields.locator("#new-experience-organization").fill("星河科技");
    await fields.locator("#new-experience-role").fill("产品经理");
    await fields.locator("#new-experience-location").fill("杭州");
    await fields.locator(".tiptap-prosemirror").fill("负责产品规划与交付");
    await fields.getByRole("button", { name: "保存并确认", exact: true }).click();

    await expect(page.getByText("新内容已确认并加入简历与个人事实库。", { exact: true })).toBeVisible();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("星河科技");
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("产品经理");
    await expect(page.getByRole("button", { name: "导出PDF", exact: true })).toBeEnabled();

    await page.reload();
    await expect(page.getByRole("heading", { name: "我的简历", exact: true })).toBeVisible();
    await expect(page.getByTestId("resume-studio-shell")).toHaveCount(0);
  });

  test("copies profile data on demand and resolves differences per field", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await expect(page.locator("#basics-email")).toHaveValue("demo.student@example.com");

    await page.locator("#basics-email").fill("resume-only@example.com");
    await page.locator("#basics-email").press("Tab");
    await expect(page.locator("#basics-email")).toHaveValue("resume-only@example.com");

    await page.getByRole("button", { name: "从资料库同步", exact: true }).click();
    const emailConflict = page.locator(".sync-conflict-card").filter({ hasText: "邮箱" });
    await expect(emailConflict).toBeVisible();
    await emailConflict.getByRole("button").filter({ hasText: "资料库版本" }).click();
    await page.getByRole("button", { name: "应用选择", exact: true }).click();

    await expect(page.locator("#basics-email")).toHaveValue("demo.student@example.com");
    await expect(page.getByText("已按你的选择处理资料库差异；个人资料库未被修改。", { exact: true })).toBeVisible();
  });
});
