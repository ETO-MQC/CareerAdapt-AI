import { expect, test } from "@playwright/test";

test.describe("V2-G7b.5 resume editor recovery", () => {
  test("reuses skills and certificates from the profile library with duplicate hints", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从零创建" }).click();
    const sectionNav = page.getByTestId("resume-section-nav");
    await sectionNav.getByRole("button", { name: /技能/ }).click();
    let fields = page.getByTestId("resume-active-section-fields");
    await fields.getByRole("button", { name: "资料库", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: /从资料库选择技能/ });
    await expect(dialog).toContainText("Stata");
    await dialog.locator(".profile-library-item").filter({ hasText: "Stata" }).getByRole("button", { name: "使用", exact: true }).click();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("Stata");

    await fields.getByRole("button", { name: "资料库", exact: true }).click();
    dialog = page.getByRole("dialog", { name: /从资料库选择技能/ });
    await expect(dialog.locator(".profile-library-item").filter({ hasText: "Stata" }).getByRole("button", { name: "已在简历中" })).toBeDisabled();
    await dialog.getByRole("button", { name: "关闭" }).click();

    await sectionNav.getByRole("button", { name: /证书/ }).click();
    fields = page.getByTestId("resume-active-section-fields");
    await fields.getByRole("button", { name: "资料库", exact: true }).click();
    dialog = page.getByRole("dialog", { name: /从资料库选择证书/ });
    await expect(dialog).toContainText("CET-4");
    await dialog.locator(".profile-library-item").filter({ hasText: "CET-4" }).getByRole("button", { name: "使用", exact: true }).click();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("CET-4");
  });

  test("moves a resume through archive, trash, restore and permanent delete", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从零创建" }).click();
    await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "返回", exact: true }).click();
    let card = page.locator(".resume-card").filter({ hasText: "空白简历" }).first();
    await card.locator("summary").click();
    await card.getByRole("button", { name: "归档", exact: true }).click();

    await page.locator(".resume-filter-row").getByRole("button", { name: /归档/ }).click();
    card = page.locator(".resume-card").filter({ hasText: "空白简历" }).first();
    await card.getByRole("button", { name: "移至回收站" }).click();
    await page.locator(".resume-filter-row").getByRole("button", { name: /回收站/ }).click();
    card = page.locator(".resume-card").filter({ hasText: "空白简历" }).first();
    await card.getByRole("button", { name: "恢复到归档" }).click();

    card = page.locator(".resume-card").filter({ hasText: "空白简历" }).first();
    await card.getByRole("button", { name: "移至回收站" }).click();
    await page.locator(".resume-filter-row").getByRole("button", { name: /回收站/ }).click();
    card = page.locator(".resume-card").filter({ hasText: "空白简历" }).first();
    await card.getByRole("button", { name: "永久删除" }).click();
    const dialog = page.getByRole("dialog", { name: "永久删除简历？" });
    await dialog.getByLabel("简历名称").fill("空白简历");
    await dialog.getByRole("button", { name: "永久删除" }).click();
    await expect(page.locator(".resume-card").filter({ hasText: "空白简历" })).toHaveCount(0);
  });

  test("creates a real blank resume, auto-saves independent fields, and restores the active editor", async ({ page }) => {
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

    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作.*经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    await fields.getByLabel("公司 / 组织").fill("星河科技");
    await fields.getByLabel("职位 / 角色").fill("产品经理");
    await fields.getByLabel("工作地点").fill("杭州");
    await fields.locator(".tiptap-prosemirror").fill("负责产品规划与交付");
    await fields.getByRole("button", { name: "保存到简历", exact: true }).click();

    await expect(page.getByText(/新内容已保存到当前简历/)).toBeVisible();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("星河科技");
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("产品经理");
    await expect(page.getByRole("button", { name: "导出PDF", exact: true })).toBeEnabled();

    await fields.getByLabel("公司 / 组织").fill("星河未来科技");
    await expect(page.getByTestId("resume-autosave-status")).toHaveText("已自动保存", { timeout: 10_000 });
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("星河未来科技");
    await fields.getByRole("button", { name: "同步到资料库", exact: true }).click();
    await expect(page.getByText(/该内容已同步到个人资料库/)).toBeVisible();
    await expect(fields.getByText("已关联资料库", { exact: true })).toBeVisible();

    await page.goto("/profile");
    await page.goto("/resume");
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("星河未来科技");

    await page.getByTestId("resume-studio-workbar").getByRole("button", { name: "返回", exact: true }).click();
    await page.goto("/profile");
    await page.goto("/resume");
    await expect(page.getByTestId("resume-studio-shell")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "简历中心", exact: true })).toBeVisible();
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

  test("reuses confirmed profile experience without retyping or changing the profile", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从零创建" }).click();
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作.*经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    await fields.getByRole("button", { name: "资料库", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /从资料库选择工作.*经历/ });
    await expect(dialog).toContainText("某政府部门");
    await dialog.locator(".profile-library-item").filter({ hasText: "某政府部门" }).getByRole("button", { name: "使用", exact: true }).click();
    await expect(page.getByText("已从个人资料库加入当前简历；重复条目不会再次加入。", { exact: true })).toBeVisible();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("某政府部门");
    await fields.getByRole("button", { name: "资料库", exact: true }).click();
    await expect(page.getByRole("dialog", { name: /从资料库选择工作.*经历/ }).locator(".profile-library-item").filter({ hasText: "某政府部门" }).getByRole("button", { name: "已在简历中", exact: true })).toBeDisabled();
  });

  test("turns a blocked profile-backed change into an explicit resume-only choice", async ({ page }) => {
    await page.goto("/resume");
    await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
    await page.getByTestId("resume-section-nav").getByRole("button", { name: /工作.*经历/ }).click();
    const fields = page.getByTestId("resume-active-section-fields");
    await fields.getByLabel("公司 / 组织").first().fill("全新科技公司");
    await fields.getByRole("button", { name: "保存", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "这次修改与资料库内容不同" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "仅保存到简历", exact: true }).click();
    await expect(page.getByText("修改已仅保存到当前简历；个人资料库未被修改。", { exact: true })).toBeVisible();
    await expect(fields.getByText("仅当前简历", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("resume-a4-page").first()).toContainText("全新科技公司");
  });
});
