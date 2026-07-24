import { expect, test } from "@playwright/test";

const assetRoutes = [
  { route: "/resume", title: "我的简历", slug: "resume" },
  { route: "/profile", title: "个人资料库", slug: "profile" },
  { route: "/jobs", title: "岗位", slug: "jobs" },
  { route: "/applications", title: "求职进度", slug: "applications" },
  { route: "/recycle", title: "回收站", slug: "recycle" },
  { route: "/settings", title: "设置", slug: "settings" }
] as const;

test("asset workspaces use compact product topbars without root overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const target of assetRoutes) {
    await page.goto(target.route);
    const topbar = page.locator(".product-topbar");
    await expect(topbar.getByRole("heading", { name: target.title })).toBeVisible();
    expect((await topbar.boundingBox())?.height).toBeLessThanOrEqual(56);
    expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    if (target.route === "/profile") {
      expect(await page.locator(".profile-workspace").evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: `artifacts/p41/${target.slug}-dark-1440x900.png`, fullPage: false });
  }
  await page.getByLabel("主题").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "artifacts/p41/settings-light-1440x900.png", fullPage: false });
});

test("product workspaces remain usable at 1024 and in dark theme", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/settings");
  await page.getByLabel("主题").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
  await page.screenshot({ path: "artifacts/p41/settings-dark-1024x768.png", fullPage: false });

  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "暂无投递记录" })).toBeVisible();
  await expect(page.getByRole("link", { name: "选择岗位简历" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回 AI 助手" })).toBeVisible();
  await expect(page.locator(".application-filters")).toHaveCount(0);
});
