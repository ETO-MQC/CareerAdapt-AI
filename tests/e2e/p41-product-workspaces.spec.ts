import { expect, test, type Page } from "@playwright/test";

const assetRoutes = [
  { route: "/resume", title: "我的简历", slug: "resume" },
  { route: "/profile", title: "个人资料库", slug: "profile" },
  { route: "/jobs", title: "岗位", slug: "jobs" },
  { route: "/applications", title: "求职进度", slug: "applications" },
  { route: "/recycle", title: "回收站", slug: "recycle" },
  { route: "/settings", title: "设置", slug: "settings" }
] as const;

async function ensureWorkspaceReady(page: Page) {
  await page.goto("/");
  const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  const setupVisible = await skipSetup.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (setupVisible) {
    await skipSetup.click();
    await page.waitForURL(/\/$/);
  }
}

async function assertTwoEndedTopbar(page: Page) {
  const topbar = page.locator(".product-topbar");
  const topbarBox = await topbar.boundingBox();
  const titleBox = await topbar.locator(".product-topbar-heading").boundingBox();
  if (!topbarBox || !titleBox) throw new Error("ProductTopbar title is not measurable");
  expect(titleBox.x - topbarBox.x).toBeLessThanOrEqual(30);
  const actions = topbar.locator(".product-topbar-actions");
  if (await actions.count()) {
    const actionBox = await actions.boundingBox();
    if (!actionBox) throw new Error("ProductTopbar actions are not measurable");
    expect(actionBox.x + actionBox.width).toBeGreaterThanOrEqual(topbarBox.x + topbarBox.width - 30);
  }
}

test("asset workspaces use compact product topbars without root overflow", async ({ page }) => {
  await ensureWorkspaceReady(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const target of assetRoutes) {
    await page.goto(target.route);
    const topbar = page.locator(".product-topbar");
    await expect(topbar.getByRole("heading", { name: target.title })).toBeVisible();
    expect((await topbar.boundingBox())?.height).toBeLessThanOrEqual(57);
    await assertTwoEndedTopbar(page);
    expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    if (target.route === "/profile") {
      expect(await page.locator(".profile-workspace").evaluate((node) => node.scrollHeight - node.clientHeight)).toBe(80);
      await expect(page.locator(".profile-category-panel")).toBeVisible();
      await expect(page.locator(".profile-category-button").first()).toContainText(/\d+/);
    }
    await page.screenshot({ path: `artifacts/p41/${target.slug}-dark-1440x900.png`, fullPage: false });
  }
  await page.getByLabel("主题").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "artifacts/p41/settings-light-1440x900.png", fullPage: false });
});

test("product workspaces remain usable at 1024 and in dark theme", async ({ page }) => {
  await ensureWorkspaceReady(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/settings");
  await page.getByLabel("主题").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await assertTwoEndedTopbar(page);
  expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
  await page.screenshot({ path: "artifacts/p41/settings-dark-1024x768.png", fullPage: false });

  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "暂无投递记录" })).toBeVisible();
  await expect(page.getByRole("link", { name: "选择岗位简历" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回 AI 助手" })).toBeVisible();
  await expect(page.locator(".application-filters")).toHaveCount(0);

  await page.goto("/profile");
  await expect(page.locator(".profile-category-panel")).toBeVisible();
  await assertTwoEndedTopbar(page);
  const categories = page.locator(".profile-category-button");
  await expect(categories).toHaveCount(18);
  for (const category of await categories.all()) {
    await expect(category).toContainText(/\d+/);
  }
  expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
  await page.screenshot({ path: "artifacts/p43i-profile-1024x768.png", fullPage: false });
});
