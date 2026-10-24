import { expect, test } from "@playwright/test";
import { normalizeResumeMapperBoundaryOutput } from "../../src/ai/tasks/resumeDocumentMapperOutput";

test("reviews scan semantics, explicitly excludes unmapped content and opens a strict preview", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
    provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "vision-test", apiKeyConfigured: true
  })));
  const training = "示例机构 2026.07—2026.09 完成数据库实操培训";
  const text = ["匿名同学", "中共预备党员", "校园经历", "班长", "对接35名同学", "培训经历", training, "技能与证书", "CET6", "额外备注：仅供核对"].join("\n");
  await page.route("**/api/resume-import/vision", route => route.fulfill({ json: { ok: true, text, provider: "test", model: "vision-test" } }));
  await page.route("**/api/ai/structured", async route => {
    const blocks = JSON.parse(route.request().postDataJSON().input.rawText) as Array<{ id: string; text: string }>;
    const ref = (path: string, texts: string[]) => ({ path, blockIds: blocks.filter(b => texts.includes(b.text)).map(b => b.id), confidenceLevel: "high", needsConfirmation: true });
    const output = normalizeResumeMapperBoundaryOutput({ resume: { schemaVersion: "careeradapt-resume-v2", basics: { name: blocks[0].text, headline: "中共预备党员" }, sections: [
      { sectionType: "campus", title: "校园经历", items: [{ role: "班长", description: "对接35名同学" }] },
      { sectionType: "other", title: "培训经历", items: [{ title: "示例机构", description: training }] },
      { sectionType: "certificates", title: "证书", items: [{ name: "CET6" }] }
    ] }, sourceRefs: [ref("/basics/name", [blocks[0].text]), ref("/basics/headline", ["中共预备党员"]), ref("/sections/0/items/0", ["班长", "对接35名同学"]), ref("/sections/1/items/0", [training]), ref("/sections/2/items/0", ["CET6"])] }, blocks);
    await route.fulfill({ json: { ok: true, task: "resume-document-mapper", promptVersion: "test", output, meta: { provider: "test", model: "vision-test", latencyMs: 1 } } });
  });
  await page.goto("/resume");
  await page.getByRole("button", { name: "导入简历", exact: true }).click();
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 100;
    canvas.getContext("2d")!.fillText("Anonymous", 10, 30);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  await page.getByLabel("选择要导入的简历文件").setInputFiles({ name: "anonymous-semantics.png", mimeType: "image/png", buffer: png });
  await expect(page.locator(".import-source-text")).toContainText("CET6");
  await expect(page.getByRole("textbox", { name: "求职意向", exact: true })).toHaveValue("");
  await page.getByLabel("创建新人物").check();
  await page.locator('input[name="new-profile-name"]').fill("匿名结构测试");
  const extras = page.locator(".import-unclassified-item");
  await expect(extras.filter({ hasText: "技能与证书" })).toHaveCount(0);
  await expect(extras.filter({ hasText: "培训经历" })).toHaveCount(0);
  await extras.filter({ hasText: "额外备注" }).getByRole("button", { name: "不导入此内容", exact: true }).click();
  await expect(extras.filter({ hasText: "额外备注" })).toHaveCount(0);
  await expect(page.locator(".import-source-text")).toContainText("额外备注");
  const structure = page.getByRole("button", { name: "确认全部当前结构", exact: true });
  if (await structure.isVisible()) await structure.click();
  const candidates = page.locator(".import-field-candidates");
  if (await candidates.count()) {
    await candidates.locator("summary").click();
    const adopt = candidates.getByRole("button", { name: "采用", exact: true });
    while (await adopt.count()) await adopt.first().click();
  }
  const fields = page.getByRole("button", { name: "确认字段映射", exact: true });
  while (await fields.count()) await fields.first().click();
  const sources = page.getByRole("button", { name: "核对并保留来源", exact: true });
  while (await sources.count()) await sources.first().click();
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  await expect(page.getByText("已进入导入生成的通用简历，可继续编辑、换模板、调整分页并下载 PDF。")).toBeVisible();
  await expect(page.getByText("兼容预览", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/部分结构化字段未能重建/)).toHaveCount(0);
});
