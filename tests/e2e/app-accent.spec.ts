import { expect, test } from "@playwright/test";

test("application accent persists without changing surfaces or geometry", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test", apiKeyConfigured: true })));
  await page.goto("/settings");
  const accent = page.getByLabel("应用强调色", { exact: true });
  await expect(accent).toHaveValue("green");
  const metrics = () => accent.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const css = getComputedStyle(document.documentElement);
    return { width: rect.width, height: rect.height, surface: css.getPropertyValue("--product-surface"), radius: css.getPropertyValue("--product-radius-4"), accent: css.getPropertyValue("--product-accent") };
  });
  const before = await metrics();
  await accent.selectOption("burgundy");
  await expect(page.locator("html")).toHaveAttribute("data-app-accent", "burgundy");
  const after = await metrics();
  expect(after.accent).not.toBe(before.accent);
  expect({ ...after, accent: "" }).toEqual({ ...before, accent: "" });
  await page.reload();
  await expect(accent).toHaveValue("burgundy");
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("主题", { exact: true }).selectOption(theme);
    for (const value of ["green", "burgundy"]) {
      await accent.selectOption(value);
      for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }]) {
        await page.setViewportSize(viewport);
        await expect(accent).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `.tmp/ui-ultimate/settings-${theme}-${value}-${viewport.width}.png`, animations: "disabled" });
      }
    }
  }
});
