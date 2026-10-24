import { expect, test } from "@playwright/test";

test("resume center uses a creation rail and compact library across desktop sizes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test", apiKeyConfigured: true })));
  await page.goto("/resume");
  const rail = page.locator(".resume-create-card-grid");
  const library = page.locator(".resume-library-panel");
  await expect(rail.locator("button")).toHaveCount(4);
  for (const width of [1920, 1440, 1366, 1280, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    const left = await rail.boundingBox();
    const right = await library.boundingBox();
    expect(left!.x + left!.width).toBeLessThan(right!.x);
    expect(Math.abs(left!.y - right!.y)).toBeLessThan(2);
    expect(Math.abs(left!.y + left!.height - right!.y - right!.height)).toBeLessThan(2);
    expect(768 - right!.y - right!.height).toBeLessThanOrEqual(12);
    await expect(page.locator(".resume-create-placeholder")).toContainText("敬请期待");
    await expect(page.locator(".career-context-entry-actions").getByRole("button", { name: "新建简历", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.waitForTimeout(350);
      await page.screenshot({ animations: "disabled", path: `.tmp/resume-center-${theme}-${width}.png` });
    }
  }
  for (let index = 0; index < 2; index++) {
    await rail.getByRole("button", { name: /从零创建/ }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await page.locator(".resume-studio-title-cluster button").first().click();
    await expect(library).toBeVisible();
  }
  await page.getByRole("tab", { name: /全部/ }).click();
  const cards = library.locator(".resume-card");
  await expect(cards).toHaveCount(2);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
    expect(first!.x + first!.width).toBeLessThan(second!.x);
    await expect(cards.nth(0).getByRole("button", { name: "打开", exact: true })).toBeVisible();
    for (const card of await cards.all()) {
      const content = await card.locator(".resume-card-main").boundingBox();
      const actions = await card.locator(".resume-card-actions").boundingBox();
      expect(actions!.x).toBeGreaterThanOrEqual(content!.x + content!.width);
      expect(actions!.y).toBeLessThan(content!.y + content!.height);
      const open = await card.getByRole("button", { name: "打开", exact: true }).boundingBox();
      const more = await card.locator(".resume-card-more summary").boundingBox();
      expect(Math.abs(open!.y - more!.y)).toBeLessThan(2);
      expect(open!.height).toBeGreaterThanOrEqual(32);
    }
    await page.screenshot({ animations: "disabled", path: `.tmp/resume-center-cards-${width}.png` });
  }
  await cards.first().locator(".resume-card-more summary").click();
  const rename = cards.first().getByRole("button", { name: "重命名简历" });
  const renameBox = await rename.boundingBox();
  expect(renameBox!.width).toBeGreaterThan(100);
  expect(renameBox!.height).toBeLessThan(50);
  await page.screenshot({ path: ".tmp/resume-more-menu-fixed.png", animations: "disabled" });
  await cards.first().getByRole("button", { name: "重命名简历" }).click();
  await cards.first().getByRole("textbox", { name: "简历名称" }).fill("布局验收简历");
  await cards.first().getByRole("textbox", { name: "简历名称" }).press("Enter");
  await expect(cards.first().locator(".resume-card-title")).toContainText("布局验收简历");
  await expect(page.locator(".resume-library-heading")).toContainText("（");
  await page.getByRole("tab", { name: /归档/ }).click();
  await expect(page.getByRole("tab", { name: /归档/ })).toHaveAttribute("aria-selected", "true");
  await rail.getByRole("button", { name: /导入已有简历/ }).click();
  await expect(page.getByLabel("选择要导入的简历文件")).toBeAttached();
  await page.keyboard.press("Escape");
  for (const route of ["/resume", "/profile", "/jobs", "/applications", "/recycle"]) {
    await page.goto(route);
    await expect(page.locator(".ai-shell-main")).toBeVisible();
    await expect(page.locator(".ai-context-bar")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "返回任务" })).toHaveCount(0);
  }
});
