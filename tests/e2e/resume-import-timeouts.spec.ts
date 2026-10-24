import { expect, test } from "@playwright/test";

test("persists independent import timeouts and sends them to each stage", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
    provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "timeout-test", apiKeyConfigured: true
  })));
  await page.goto("/settings?category=document");
  const vision = page.getByLabel("每页图像识别最长等待");
  const mapping = page.getByLabel("每批字段整理最长等待");
  await expect(vision).toHaveValue("8"); await expect(mapping).toHaveValue("10");
  await vision.selectOption("15"); await mapping.selectOption("20");
  await page.reload();
  await expect(vision).toHaveValue("15"); await expect(mapping).toHaveValue("20");
  await page.screenshot({ path: "artifacts/resume-import-timeouts-settings.png", fullPage: true });
  let visionCalls = 0; let mapperCalls = 0;
  await page.route("**/api/resume-import/vision", async (route) => {
    expect(route.request().headers()["x-resume-import-timeout-seconds"]).toBe("900"); visionCalls++;
    await route.fulfill({ json: { ok: true, text: "个人技能\nPython", provider: "test", model: "test" } });
  });
  await page.route("**/api/ai/structured", async (route) => {
    expect(route.request().headers()["x-resume-import-timeout-seconds"]).toBe("1200"); mapperCalls++;
    await route.fulfill({ json: { ok: true, task: "resume-document-mapper", promptVersion: "test", output: {
      resume: { schemaVersion: "careeradapt-resume-v2", basics: {}, sections: [
        { id: "skills", sectionType: "skills", title: "个人技能", order: 0, visible: true,
          items: [{ id: "python", sectionType: "skills", name: "Python" }] }
      ] }, sourceRefs: [{ path: "/sections/0/items/0", blockIds: ["vision:p1:b1"], confidenceLevel: "high", confidenceReason: "原文", needsConfirmation: true }]
    }, meta: { provider: "test", model: "test", latencyMs: 1 } } });
  });
  await page.goto("/resume");
  await page.getByRole("button", { name: "导入简历", exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 100;
    canvas.getContext("2d")!.fillText("Python", 10, 30);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("选择要导入的简历文件").setInputFiles({ name: "anonymous.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.locator(".import-source-text")).toContainText("Python");
  expect(visionCalls).toBe(1); expect(mapperCalls).toBe(1);
});
