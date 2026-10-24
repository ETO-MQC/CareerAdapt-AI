import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

test("scanned PDF defaults to model vision, then confirms canonical skills into a general resume", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
    provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "vision-test", apiKeyConfigured: true
  })));
  let visionCalls = 0;
  let mapperCalls = 0;
  await page.route("**/api/resume-import/vision", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.pageNumber).toBe(1);
    expect(body.image).toMatch(/^data:image\/jpeg;base64,/);
    visionCalls++;
    await route.fulfill({ json: { ok: true, text: "个人技能\nPython", provider: "openrouter", model: "vision-test" } });
  });
  await page.route("**/api/ai/structured", async (route) => {
    expect(route.request().postDataJSON().task).toBe("resume-document-mapper");
    mapperCalls++;
    await route.fulfill({ json: { ok: true, task: "resume-document-mapper", promptVersion: "test", output: {
      resume: { schemaVersion: "careeradapt-resume-v2", basics: {}, sections: [
        { id: "skills", sectionType: "skills", title: "个人技能", order: 0, visible: true,
          items: [{ id: "python", sectionType: "skills", name: "Python" }] }
      ] }, sourceRefs: [{ path: "/sections/0/items/0", blockIds: ["vision:p1:b1"], confidenceLevel: "high", confidenceReason: "原页可读", needsConfirmation: true }]
    }, meta: { provider: "openrouter", model: "vision-test", latencyMs: 1 } } });
  });
  await page.goto("/resume");
  await page.getByRole("button", { name: "导入简历", exact: true }).click();
  await expect(page.getByRole("button", { name: "使用 AI 智能识别", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Raster content only: exercise the real PDF.js no-text detection and page renderer.
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 300;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "white"; context.fillRect(0, 0, 600, 300);
    context.fillStyle = "black"; context.font = "32px sans-serif"; context.fillText("Skills: Python", 40, 80);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(Buffer.from(image, "base64"));
  pdf.addPage([600, 300]).drawImage(png, { x: 0, y: 0, width: 600, height: 300 });
  await page.getByLabel("选择要导入的简历文件").setInputFiles({ name: "anonymous-scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator(".import-source-text")).toContainText("Python", { timeout: 20_000 });
  expect(visionCalls).toBe(1); expect(mapperCalls).toBe(1);
  await page.getByLabel("创建新人物").check();
  await page.locator('input[name="new-profile-name"]').fill("匿名视觉导入测试");
  const confirmStructure = page.getByRole("button", { name: "确认全部当前结构", exact: true });
  if (await confirmStructure.isVisible()) await confirmStructure.click();
  const confirmFields = page.getByRole("button", { name: "确认此字段", exact: true });
  while (await confirmFields.count()) await confirmFields.first().click();
  const keepSources = page.getByRole("button", { name: "核对并保留来源", exact: true });
  while (await keepSources.count()) await keepSources.first().click();
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByText("已进入导入生成的通用简历，可继续编辑、换模板、调整分页并下载 PDF。")).toBeVisible();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
});

for (const action of ["直接核对已识别内容", "重试字段整理"] as const) {
  test(`retains successful vision text after mapper timeout: ${action}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "vision-test", apiKeyConfigured: true
    })));
    let visionCalls = 0; let mapperCalls = 0;
    await page.route("**/api/resume-import/vision", async (route) => {
      visionCalls++;
      await route.fulfill({ json: { ok: true, text: "个人技能\nPython", provider: "test", model: "vision-test" } });
    });
    await page.route("**/api/ai/structured", async (route) => {
      mapperCalls++;
      if (mapperCalls === 1) {
        await route.fulfill({ status: 504, json: { ok: false, error: { code: "provider_timeout", message: "Timeout" },
          meta: { provider: "test", model: "vision-test", latencyMs: 180007, safeErrorCode: "provider_timeout" } } });
        return;
      }
      await route.fulfill({ json: { ok: true, task: "resume-document-mapper", promptVersion: "test", output: {
        resume: { schemaVersion: "careeradapt-resume-v2", basics: {}, sections: [
          { id: "skills", sectionType: "skills", title: "个人技能", order: 0, visible: true,
            items: [{ id: "python", sectionType: "skills", name: "Python" }] }
        ] }, sourceRefs: [{ path: "/sections/0/items/0", blockIds: ["vision:p1:b1"], confidenceLevel: "high", confidenceReason: "原页可读", needsConfirmation: true }]
      }, meta: { provider: "test", model: "vision-test", latencyMs: 1 } } });
    });
    await page.goto("/resume");
    await page.getByRole("button", { name: "导入简历", exact: true }).click();
    const png = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 100;
      const context = canvas.getContext("2d")!; context.fillText("Python", 10, 30);
      return canvas.toDataURL("image/png").split(",")[1];
    }), "base64");
    await page.getByLabel("选择要导入的简历文件").setInputFiles({ name: "anonymous.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("● AI 图像识别已完成，字段整理未完成", { exact: true })).toBeVisible();
    await expect(page.getByText(/AI 已读出的文字已保留，无需重新识图/)).toBeVisible();
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.locator(".import-source-text")).toContainText("Python");
    expect(visionCalls).toBe(1);
    expect(mapperCalls).toBe(action === "重试字段整理" ? 2 : 1);
    await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeVisible();
    await expect(page.getByText("● AI 图像识别已完成，字段整理未完成", { exact: true })).toHaveCount(0);
  });
}
