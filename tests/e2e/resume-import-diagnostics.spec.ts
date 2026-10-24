import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`long failed JSON diagnostics scroll inside the import dialog at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test", apiKeyConfigured: true
    })));
    await page.route("**/api/resume-import/vision", (route) => route.fulfill({ json: { ok: true, text: "个人技能\nPython", provider: "test", model: "test" } }));
    const json = JSON.stringify({ resume: { sections: Array.from({ length: 30 }, () => ({ items: [
      { school: "[文本已脱敏]", gpa: "3.8/4", rankPosition: "3/50" }
    ] })) } }, null, 2);
    await page.route("**/api/ai/structured", (route) => route.fulfill({ status: 422, json: { ok: false,
      error: { code: "model_schema_invalid", message: "Invalid numeric field" }, meta: { provider: "test", model: "test", attempt: 2,
        failedIssues: [{ path: "resume.sections[0].items[0].gpa", code: "invalid_type", expected: "number", received: "string" }],
        responseSnapshots: [1, 2].map((attempt) => ({ attempt, json, truncated: false })) }
    } }));
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入简历", exact: true }).click();
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 100;
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.getByLabel("选择要导入的简历文件").setInputFiles({ name: "anonymous.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    const dialog = page.getByRole("dialog", { name: "导入简历", exact: true });
    await dialog.getByText("查看技术详情", { exact: true }).click();
    await expect(dialog.getByText(/期望 number · 实际 string/)).toBeVisible();
    await dialog.getByText("第 1 次模型返回 JSON（脱敏）", { exact: true }).click();
    await dialog.getByText("第 2 次模型返回 JSON（脱敏）", { exact: true }).click();
    if (process.env.IMPORT_DIAGNOSTICS_SCREENSHOT) await page.screenshot({ path: `artifacts/import-diagnostics-${process.env.IMPORT_DIAGNOSTICS_SCREENSHOT}-${viewport.width}.png`, fullPage: true });
    const textarea = dialog.getByLabel("第 2 次模型返回 JSON（脱敏）");
    await expect(textarea).toHaveValue(json);
    const rect = await dialog.boundingBox();
    expect(rect!.y).toBeGreaterThanOrEqual(0); expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height);
    const body = dialog.locator(".resume-import-modal-body");
    const scroll = await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return { scrollTop: element.scrollTop, overflow: getComputedStyle(element).overflowY };
    });
    expect(scroll.overflow).toMatch(/auto|scroll/); expect(scroll.scrollTop).toBeGreaterThan(0);
    const jsonScroll = await textarea.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return { top: element.scrollTop, height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width };
    });
    expect(jsonScroll.top).toBeGreaterThan(0); expect(jsonScroll.height).toBeLessThan(viewport.height / 2);
    expect(jsonScroll.width).toBeGreaterThan(rect!.width * 0.7);
    await expect(dialog.getByRole("button", { name: "关闭导入窗口" })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  });
}
