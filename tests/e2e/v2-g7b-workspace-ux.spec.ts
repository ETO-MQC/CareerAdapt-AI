import { expect, test } from "@playwright/test";

test.describe("V2-G7b workspace UX", () => {
  test("product shell hides internal probes and exposes stable workspace routes", async ({ page }) => {
    await page.goto("/");

    const nav = page.getByLabel("主导航");
    await expect(nav.getByRole("link", { name: "我的简历" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "个人资料库" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "岗位" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "求职进度" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "设置" })).toBeVisible();

    await expect(page.getByText("A4 探针")).toHaveCount(0);
    await expect(page.getByText("PDF 探针")).toHaveCount(0);
    await expect(page.getByText("阶段A")).toHaveCount(0);
    await expect(page.getByText("Sprint 0")).toHaveCount(0);
    await expect(page.getByText("Repository")).toHaveCount(0);
  });

  test("profile workspace provides first-class editable facts and skill management", async ({ page }) => {
    const skillName = `G7b Skill ${Date.now()}`;

    await page.goto("/profile");
    await expect(page.locator(".profile-manager-grid")).toBeVisible();
    await expect(page.getByRole("heading", { name: "基本信息" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "技能" })).toBeVisible();
    await expect(page.getByText("职业母档案")).toHaveCount(0);

    await page.getByLabel("技能名称").fill(skillName);
    await page.getByLabel("熟练度").selectOption("proficient");
    await page.getByRole("button", { name: "添加技能" }).click();
    await expect.poll(async () => {
      return page.locator(".profile-item-row input").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    }).toContain(skillName);
  });

  test("resume workspace opens with A4 canvas and supports direct profile-field selection", async ({ page }) => {
    const branchName = `G7b Canvas ${Date.now()}`;
    await createJobSuggestionDraft(page);

    await page.goto("/resume");
    await page.locator("label").filter({ hasText: "岗位建议草稿" }).locator("select").selectOption({ index: 0 });
    await page.locator("article.panel").first().locator("input").fill(branchName);
    await page.locator("article.panel").first().locator("button.primary-button").click();

    await expect(page.locator(".resume-preview-layout")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".resume-export-panel")).toBeVisible();
    await expect(page.getByTestId("resume-a4-page").first()).toBeVisible();
    await expect(page.getByText("A4 探针")).toHaveCount(0);

    await page.getByLabel("画布编辑").check();
    await page.getByTestId("resume-a4-page").first().locator("[data-source-item-id='profile:name']").click();
    await expect(page.getByTestId("resume-studio-editor")).toBeVisible();
    await expect(page.getByTestId("resume-studio-editor")).toContainText("基本信息");
  });
});

async function createJobSuggestionDraft(page: import("@playwright/test").Page) {
  await page.goto("/jobs");
  await page.getByRole("button", { name: "运行经历匹配" }).click();
  await expect(page.locator(".match-row").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "创建建议草稿" }).click();
  await expect(page.locator(".notice")).toContainText("简历建议草稿", { timeout: 15_000 });
}
