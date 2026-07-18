import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openManualPageTab } from "./support/g7b2Ui";
import type { ResumePdfExportSnapshot } from "@/domain/schemas";

const DEBUG_LABELS = [
  "学校：", "专业：", "学位/学历：", "所在地：", "开始日期：", "结束日期：", "至今：", "进行中：",
  "组织：", "职位/角色：", "项目名称：", "角色：", "亮点：", "奖项名称：", "获奖日期：", "技能名称：", "语言："
];

const PDFTOTEXT = [
  "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
  "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
].find(existsSync) ?? "pdftotext";

const outputDir = resolve(process.cwd(), "artifacts", "p38b-after");

test("canonical fixture stays editable while Preview and PDF use formal presentation", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(outputDir, { recursive: true });
  await importCanonicalFixture(page);

  const studio = page.getByTestId("resume-studio-shell");
  const previewStage = page.locator(".resume-preview-stage");
  await expect(studio).toBeVisible();
  await expect(previewStage.getByTestId("resume-a4-page").first()).toBeVisible();

  const previewOutput = previewStage.getByTestId("resume-pagination-measurement-page");
  const previewText = await previewOutput.textContent() ?? "";
  for (const label of DEBUG_LABELS) expect(previewText).not.toContain(label);
  for (const value of ["示例大学", "本科 · 计算机科学", "示例城市", "2024.09–2028.06", "中文", "母语"]) {
    expect(previewText).toContain(value);
  }
  await expect(previewOutput.locator('[data-presentation-item="work"]')).toHaveCount(2);
  await expect(previewOutput.locator('[data-presentation-item="project"]')).toHaveCount(4);
  await expect(previewOutput.locator('[data-presentation-item="awards"]')).toHaveCount(2);
  await expect(previewOutput.locator('[data-presentation-item="skills"]')).toHaveCount(6);
  await expect(previewOutput.locator('[data-presentation-item="languages"]')).toHaveCount(1);
  await expect(previewOutput.locator('[data-render-section="experience"]')).toHaveCount(0);
  expect(await duplicatePresentationItemIds(previewOutput)).toEqual([]);

  const captureViewports = [
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    ...(process.env.P38B_EXTENDED_SCREENSHOTS === "1" ? [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }] : [])
  ];
  for (const viewport of captureViewports) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
    await expect(previewStage.getByTestId("resume-a4-page")).toHaveCount(2, { timeout: 20_000 });
    await page.screenshot({ path: resolve(outputDir, `${viewport.width}x${viewport.height}.png`), fullPage: false });
    const metrics = await previewStage.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { top: rect.top, width: rect.width, display: style.display };
    });
    expect(metrics.top).toBeGreaterThanOrEqual(0);
    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.display).not.toBe("none");
  }

  await page.getByTestId("resume-section-nav").getByRole("button", { name: /教育经历/ }).click();
  const fields = page.getByTestId("resume-active-section-fields");
  await expect(fields.getByLabel("学校名称").first()).toBeVisible();
  await expect(fields.getByLabel("学历").first()).toBeVisible();
  await expect(fields.getByLabel("专业").first()).toBeVisible();

  await openManualPageTab(page);
  let capturedRequest: { snapshot?: ResumePdfExportSnapshot } | undefined;
  page.on("request", (request) => {
    if (request.url().includes("/api/resume-export/pdf")) capturedRequest = request.postDataJSON();
  });
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST");
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "下载 PDF" }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  const pdfPath = resolve(outputDir, "canonical-presentation.pdf");
  await download.saveAs(pdfPath);
  const pdfText = execFileSync(PDFTOTEXT, [pdfPath, "-"], { encoding: "utf8" });
  expect(capturedRequest?.snapshot?.renderModel.schemaVersion).toBe("resume-render-v2");

  for (const label of DEBUG_LABELS) expect(pdfText).not.toContain(label);
  for (const value of ["示例大学", "本科", "计算机科学", "示例城市", "2024.09–2028.06", "工作条目一", "工作条目二", "项目一", "项目二", "项目三", "项目四", "奖项一", "奖项二", "中文", "母语"]) {
    expect(normalizeText(pdfText)).toContain(normalizeText(value));
    expect(normalizeText(previewText)).toContain(normalizeText(value));
  }
  for (const uniqueValue of ["工作条目一", "工作条目二", "项目一", "项目二", "项目三", "项目四", "奖项一", "奖项二"]) {
    expect(countOccurrences(normalizeText(pdfText), normalizeText(uniqueValue))).toBe(1);
  }
});

async function importCanonicalFixture(page: Page) {
  await page.goto("/resume");
  await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  await page.locator(".import-json-details textarea").fill(JSON.stringify(canonicalFixture()));
  await page.locator(".import-json-details button.primary-button").click();
  await page.getByLabel("创建新人物").check();
  while (await page.getByRole("button", { name: "确认此字段", exact: true }).count()) {
    await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  }
  while (await page.getByRole("button", { name: "核对并保留来源", exact: true }).count()) {
    await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  }
  await page.locator(".import-review-footer button.primary-button").click();
  const openButton = page.getByRole("button", { name: "打开", exact: true });
  if (await openButton.isVisible()) await openButton.click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
}

async function duplicatePresentationItemIds(stage: ReturnType<Page["locator"]>) {
  return stage.locator("[data-presentation-item]").evaluateAll((nodes) => {
    const ids = nodes.map((node) => (node as HTMLElement).dataset.sourceItemId ?? "");
    return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  });
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function countOccurrences(value: string, target: string) {
  return value.split(target).length - 1;
}

function canonicalFixture() {
  const base = { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { name: "演示候选人", targetRole: "软件工程师", phone: "13800000000", email: "candidate@example.com", location: "示例城市", portfolioLinks: [], otherLinks: [], customFields: [] }, unclassifiedBlocks: [] };
  const common = { customFields: [] };
  return { ...base, sections: [
    { id: "summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ ...common, id: "summary-1", sectionType: "summary", text: "关注可靠工程交付。" }] },
    { id: "education", sectionType: "education", title: "教育经历", order: 1, visible: true, items: [{ ...common, id: "education-1", sectionType: "education", school: "示例大学", degree: "本科", major: "计算机科学", location: "示例城市", startDate: "2024-09", endDate: "2028-06", current: false, courses: [], honors: [], highlights: ["教育亮点"] }] },
    { id: "work", sectionType: "work", title: "工作经历", order: 2, visible: true, items: ["一", "二"].map((suffix, index) => ({ ...common, id: `work-${index + 1}`, sectionType: "work", organization: `工作条目${suffix}`, role: "工程师", location: "示例城市", startDate: `202${index + 3}-01`, current: true, highlights: [`工作亮点${suffix}`] })) },
    { id: "project", sectionType: "project", title: "项目经历", order: 3, visible: true, items: ["一", "二", "三", "四"].map((suffix, index) => ({ ...common, id: `project-${index + 1}`, sectionType: "project", title: `项目${suffix}/版本—${index + 1}`, role: "项目角色", organization: "示例团队", location: "示例城市", startDate: `2025-0${index + 1}`, current: true, url: `https://example.com/project-${index + 1}`, tools: ["React", "TypeScript"], highlights: [`项目亮点${suffix}`, `项目成果${suffix}`], outcomes: [] })) },
    { id: "awards", sectionType: "awards", title: "奖项荣誉", order: 4, visible: true, items: ["一", "二"].map((suffix, index) => ({ ...common, id: `award-${index + 1}`, sectionType: "awards", name: `奖项${suffix}`, issuer: "示例机构", awardedAt: `2025-0${index + 3}` })) },
    { id: "skills", sectionType: "skills", title: "专业技能", order: 5, visible: true, items: ["AI 与模型", "工程开发", "测试工具", "数据分析", "产品设计", "协作工具"].map((category, index) => ({ ...common, id: `skill-${index + 1}`, sectionType: "skills", name: `技能${index + 1}`, category })) },
    { id: "languages", sectionType: "languages", title: "语言能力", order: 6, visible: true, items: [{ ...common, id: "language-1", sectionType: "languages", language: "中文", level: "母语" }] }
  ] };
}
