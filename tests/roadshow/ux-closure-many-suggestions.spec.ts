import { expect, test } from "@playwright/test";
import { installCoreWritingProvider, readStore } from "../e2e/support/p51CoreWorkflow";

test("all generated suggestions can be individually reviewed in the resume workspace", async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
  await page.goto("/resume");
  await page.getByRole("button", { name: /导入已有简历/ }).click();
  const dialog = page.getByRole("dialog", { name: "导入简历" });
  await dialog.getByText("粘贴 JSON", { exact: true }).click();
  const projects = ["订单", "库存", "客户", "物流", "报表", "权限"].map((name, index) => ({
    id: `ux-project-${index}`, sectionType: "project", title: `${name}系统`, role: "项目成员",
    startDate: "2025-01", endDate: "2025-06", current: false,
    description: `完成${name}系统的需求梳理、原型设计和功能验收。`,
    highlights: [`完成${name}系统的需求梳理、原型设计和功能验收。`], tools: [], outcomes: [], customFields: []
  }));
  await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
    basics: { name: "匿名测试", portfolioLinks: [], otherLinks: [], customFields: [] },
    sections: [{ id: "project", sectionType: "project", title: "项目经历", order: 0, visible: true, items: projects }], unclassifiedBlocks: [] }));
  await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
  for (let index = 0; index < 80 && await dialog.getByRole("button", { name: "确认此字段", exact: true }).count(); index++) {
    await dialog.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  }
  for (let index = 0; index < 80 && await dialog.getByRole("button", { name: "核对并保留来源", exact: true }).count(); index++) {
    await dialog.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  }
  await dialog.locator(".import-review-footer button.primary-button").click();
  const open = page.getByRole("button", { name: "打开", exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  const general = (await readStore(page, "resumeBranches")).find(row => row.branchPurpose === "general" && row.currentRevisionId)!;
  const job = (await readStore(page, "jobDescriptions"))[0];
  expect(general).toBeTruthy();
  expect(job).toBeTruthy();
  await installCoreWritingProvider(page);
  await page.route("**/api/ai/structured", async route => {
    const request = route.request().postDataJSON() as { task: string; input: { intensity: string; targets?: Array<{
      itemId: string; sectionType: string; sectionId: string; fieldPath: string; before: string | string[];
      relevantRequirements: Array<{ requirementId: string }>; allowedEvidenceRefs: unknown[] }> } };
    if (request.task !== "resume-tailor-batch") return route.fallback();
    const rephrase = (text: string) => text.replace("需求梳理、原型设计和功能验收", "功能验收、需求梳理和原型设计");
    const suggestions = (request.input.targets ?? []).filter(target => JSON.stringify(target.before).includes("需求梳理、原型设计和功能验收"))
      .map(target => ({ id: `ux-${target.itemId}-${target.fieldPath}`, intensity: request.input.intensity, operation: "rewrite",
        targetSectionType: target.sectionType, targetSectionId: target.sectionId, targetItemId: target.itemId, targetFieldPath: target.fieldPath,
        before: target.before, after: Array.isArray(target.before) ? target.before.map(rephrase) : rephrase(target.before),
        changedFields: [target.fieldPath.split(".").at(-1)], requirementIds: target.relevantRequirements.map(item => item.requirementId),
        targetKeywords: [], coveredKeywordsBefore: [], coveredKeywordsAfter: [], claimSupportLevel: "verified", evidenceRefs: target.allowedEvidenceRefs,
        rationale: "调整已确认的项目职责顺序", riskLevel: "low", metrics: { textChangeRatio: 0.1, keywordGain: 0 }, status: "ready" }));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: request.task,
      promptVersion: "ux-closure-test", output: { suggestions }, meta: { provider: "deterministic", model: "ux-closure-test", inputLength: 1, outputLength: 1, latencyMs: 1 } }) });
  });
  await page.goto(`/jobs?jobId=${encodeURIComponent(String(job.id))}`);
  await page.getByRole("radio", { name: /优化已有简历/ }).click();
  await page.getByLabel("来源通用简历").selectOption(String(general.id));
  await page.getByTestId("analyze-and-generate-job-resume").click();
  const panel = page.getByTestId("job-optimization-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByRole("button", { name: "生成改写建议", exact: true }).click();
  await expect.poll(async () => await panel.getByRole("button", { name: "没有", exact: true }).isVisible()
    || await panel.getByLabel("采用建议").count() > 0, { timeout: 60_000 }).toBe(true);
  if (await panel.getByRole("button", { name: "没有", exact: true }).isVisible()) {
    await panel.getByRole("button", { name: "没有", exact: true }).click();
    await panel.getByRole("button", { name: "提交回答", exact: true }).click();
    await panel.getByRole("button", { name: "继续生成改写建议", exact: true }).click();
  }
  await expect(panel.getByTestId("tailoring-suggestions")).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0, { timeout: 60_000 });
  await info.attach("suggestions-before", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  const choices = panel.getByLabel("采用建议");
  await expect(choices).toHaveCount(6);
  await expect(choices.nth(5)).toBeEnabled();
  await choices.nth(5).uncheck();
  await expect(choices.nth(5)).not.toBeChecked();
  await choices.nth(5).check();
  await expect(choices.nth(5)).toBeChecked();
  await info.attach("suggestions-after", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
