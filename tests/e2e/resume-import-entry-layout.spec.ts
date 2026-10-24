import { expect, test } from "@playwright/test";
test("import entry keeps targets compact and gives extra height to file drop", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test", apiKeyConfigured: true })));
  await page.goto("/resume");
  await page.locator(".resume-create-card").filter({ hasText: "导入已有简历" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("group", { name: "高级识别路线" }).getByRole("button")).toHaveCount(4);
  await expect(modal.getByRole("button", { name: "自动提取", exact: true })).toBeVisible();
  for (const width of [1920, 1366, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.documentElement.dataset.theme = "light");
    await page.waitForTimeout(300);
    const box = await modal.boundingBox();
    const drop = await modal.locator(".import-dropzone").boundingBox();
    expect(box!.height).toBe(624);
    expect(box!.width).toBeLessThanOrEqual(1184);
    const target = await modal.locator(".import-target-picker").boundingBox();
    const recognition = await modal.locator(".import-recognition-panel").boundingBox();
    expect(Math.abs(target!.width - recognition!.width)).toBeLessThan(2);
    expect(drop!.height).toBeGreaterThanOrEqual(240);
    await page.screenshot({ animations: "disabled", path: `.tmp/import-entry-${width}.png` });
  }
  await modal.getByLabel("创建新人物", { exact: true }).check();
  await expect(modal.locator('input[name="new-profile-name"]')).toBeVisible();
  await modal.getByRole("button", { name: "关闭导入窗口" }).click();
  await expect(modal).toHaveCount(0);
});
