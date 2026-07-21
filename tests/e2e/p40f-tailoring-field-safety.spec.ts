import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openManualPageTab } from "./support/g7b2Ui";
import { stableHashText } from "@/services/security/text";

const INTERNAL_LABELS = ["组织：", "职位/角色：", "项目名称：", "开始日期：", "结束日期：", "进行中：", "亮点："];
const PDFTOTEXT = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
const PDFINFO = ["E:/Pycharm/Lib/poppler/Library/bin/pdfinfo.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdfinfo.exe"].find(existsSync) ?? "pdfinfo";

test("P4.0f claim confirmation keeps the decision context visible", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { derivedId } = await openTailoringSuggestions(page);
  const branchBefore = await readStore<DbBranch>(page, "resumeBranches", derivedId);
  const presentationBefore = await readStore<{ value: unknown }>(page, "appMeta", `resumePresentationConfig:${derivedId}`);
  const presentationHashBefore = stableHashText(JSON.stringify(presentationSettings(presentationBefore?.value)));
  const panel = page.getByTestId("job-optimization-panel");
  await panel.getByRole("button", { name: "确认并应用" }).last().click();
  await expect(panel.getByTestId("tailoring-apply")).toBeVisible();
  const cards = panel.locator(".tailoring-confirmation-card");
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(cards.first()).toContainText("最终写入句");
  await expect(cards.first()).toContainText("来源经历");
  await expect(cards.first()).toContainText("对应岗位要求");
  const titles = await cards.locator(":scope > strong").allTextContents();
  expect(titles.every((title) => title.length < 50 && !title.includes("项目名称：") && !title.endsWith("..."))).toBe(true);
  const proficiencyCards = cards.filter({ has: page.getByRole("button", { name: "了解", exact: true }) });
  for (let index = 0; index < await proficiencyCards.count(); index += 1) {
    const card = proficiencyCards.nth(index);
    if ((await card.innerText()).includes("Cursor")) {
      await card.getByRole("button", { name: "不添加", exact: true }).click();
      continue;
    }
    await card.getByRole("button", { name: "了解", exact: true }).click();
    await expect(card.getByText("最终写入句").locator("..")).toContainText("了解");
    await expect(card.getByText("最终写入句").locator("..")).not.toContainText(/熟练|精通|深度使用/);
  }
  const reframeCards = cards.filter({ has: page.getByRole("button", { name: "确认采用", exact: true }) });
  for (let index = 0; index < await reframeCards.count(); index += 1) await reframeCards.nth(index).getByRole("button", { name: "确认采用", exact: true }).click();

  if (process.env.P40F_CAPTURE_BEFORE === "1") {
    for (const viewport of [{ width: 1024, height: 768 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `artifacts/p40f-before/${viewport.width}x${viewport.height}.png`, fullPage: true });
    }
  }
  if (process.env.P40F_CAPTURE_AFTER === "1") {
    for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `artifacts/p40f-after/${viewport.width}x${viewport.height}.png`, fullPage: true });
    }
  }
  await panel.getByRole("button", { name: "应用选择并保存新版本" }).click();
  await expect.poll(async () => {
    const revision = (await readStore<DbBranch>(page, "resumeBranches", derivedId))?.revision;
    if (revision === branchBefore?.revision) {
      const notice = await page.locator(".app-notification").last().textContent().catch(() => "");
      if (notice && !notice.includes("岗位简历已创建")) throw new Error(`tailoring apply notice: ${notice}`);
    }
    return revision;
  }).toBe((branchBefore?.revision ?? 0) + 1);
  const fitDeltaText = await panel.locator(".tailoring-fit-delta").innerText();
  await testInfo.attach("fit-delta", { contentType: "text/plain", body: fitDeltaText });
  const branchAfter = await readStore<DbBranch>(page, "resumeBranches", derivedId);
  expect(JSON.stringify(branchAfter)).not.toContain("Cursor");
  expect(changedStructuredText(branchBefore, branchAfter)).not.toMatch(/熟练|精通|深度使用/);
  expect(internalLabelCount(branchAfter)).toBeLessThanOrEqual(internalLabelCount(branchBefore));
  expect(immutableMetadata(branchAfter)).toEqual(immutableMetadata(branchBefore));
  const presentationAfter = await readStore<{ value: unknown }>(page, "appMeta", `resumePresentationConfig:${derivedId}`);
  const presentationHashAfter = stableHashText(JSON.stringify(presentationSettings(presentationAfter?.value)));
  expect(presentationSettings(presentationAfter?.value)).toEqual(presentationSettings(presentationBefore?.value));
  expect(presentationHashAfter).toBe(presentationHashBefore);
  await testInfo.attach("presentation-hash", { contentType: "application/json", body: JSON.stringify({ before: presentationHashBefore, after: presentationHashAfter }) });
  const verificationDir = resolve(process.cwd(), "artifacts", "p40f-after");
  mkdirSync(verificationDir, { recursive: true });
  writeFileSync(resolve(verificationDir, "verification.json"), JSON.stringify({ presentationHashBefore, presentationHashAfter, fitDeltaText }, null, 2), "utf8");
});

test("attachment-shaped final resume keeps canonical counts, complete summary, and clean 1-2 page PDF", async ({ page }) => {
  test.setTimeout(180_000);
  await importFinalFixture(page);
  const pages = page.getByTestId("resume-a4-page");
  await expect.poll(async () => pages.count()).toBeGreaterThanOrEqual(1);
  const previewText = (await pages.allInnerTexts()).join("\n");
  for (const label of INTERNAL_LABELS) expect(previewText).not.toContain(label);
  expect(previewText).toContain("建立风险操作约束与回归验证闭环。");
  await expect(pages.locator('[data-presentation-item="education"]')).toHaveCount(1);
  await expect(pages.locator('[data-presentation-item="work"]')).toHaveCount(2);
  await expect(pages.locator('[data-presentation-item="project"]')).toHaveCount(3);
  await expect(pages.locator('[data-presentation-item="skills"]')).toHaveCount(4);
  await expect(pages.locator('[data-render-section="experience"]')).toHaveCount(0);
  await expect(page.getByTestId("render-coverage-warning")).toHaveCount(0);
  const pageCount = await pages.count();
  expect(pageCount).toBeGreaterThanOrEqual(1);
  expect(pageCount).toBeLessThanOrEqual(2);
  if (pageCount === 2) expect((await pages.nth(1).innerText()).split(/\n/).filter((line) => line.trim()).length).toBeGreaterThan(4);

  await openManualPageTab(page);
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST");
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "下载 PDF" }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  const outputDir = resolve(process.cwd(), "artifacts", "p40f-after");
  mkdirSync(outputDir, { recursive: true });
  const pdfPath = resolve(outputDir, "p40f-attachment-shaped.pdf");
  await download.saveAs(pdfPath);
  const pdfText = execFileSync(PDFTOTEXT, [pdfPath, "-"], { encoding: "utf8" });
  for (const label of INTERNAL_LABELS) expect(pdfText).not.toContain(label);
  expect(normalize(pdfText)).toContain(normalize("建立风险操作约束与回归验证闭环。"));
  for (const value of ["示例公司甲", "示例公司乙", "示例任务系统", "示例学习助手", "内容可信度分析系统"]) expect(count(normalize(pdfText), normalize(value))).toBe(1);
  const info = execFileSync(PDFINFO, [pdfPath], { encoding: "utf8" });
  const exportedPages = Number(info.match(/Pages:\s+(\d+)/)?.[1] ?? 0);
  expect(exportedPages).toBeGreaterThanOrEqual(1);
  expect(exportedPages).toBeLessThanOrEqual(2);
});

type DbBranch = { revision: number; structuredContentItems?: Array<{ id: string; data: Record<string, unknown> }> };

async function openTailoringSuggestions(page: Page) {
  await page.goto("/resume");
  await page.getByRole("button", { name: /从个人资料库创建/ }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
  await page.goto("/jobs");
  await page.getByRole("radio", { name: /优化已有简历/ }).click();
  await page.getByLabel("来源通用简历").selectOption({ index: 1 });
  await page.getByTestId("analyze-and-generate-job-resume").click();
  await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
  const panel = page.getByTestId("job-optimization-panel");
  await page.route("**/api/ai/structured", async (route) => {
    const body = route.request().postDataJSON() as { task: string; input: Record<string, unknown> };
    const meta = { provider: "fixture", model: "p40f", inputLength: 1, outputLength: 1, latencyMs: 1 };
    if (body.task === "resume-optimization-planner") {
      const sections = (body.input.sections ?? []) as Array<{ itemId: string }>;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "p40f-planner", output: { assessments: sections.map((section) => ({ itemId: section.itemId, action: "rewrite_from_evidence", reason: "对应岗位验证要求", suggestedKeywords: ["Cursor"], relatedRequirementIds: [], clarificationQuestions: [] })) }, meta }) });
      return;
    }
    if (body.task === "resume-tailor-batch") {
      const input = body.input as unknown as { intensity: string; targets: Array<{ itemId: string; sectionType: string; sectionId: string; fieldPath: string; before: string | string[]; relevantRequirements: Array<{ requirementId: string }>; allowedEvidenceRefs: unknown[] }> };
      const targets = input.targets.filter((target) => target.sectionType !== "summary").slice(0, 4);
      const suggestions = targets.map((target) => {
        const isCursor = (Array.isArray(target.before) ? target.before.join(" ") : target.before).includes("Stata");
        const sentence = isCursor ? "了解 Cursor 等 AI Coding 工具的基本工作方式。" : "复现 Coding Agent 输出问题，定位原因并验证修复结果。";
        const after = Array.isArray(target.before) ? [sentence, ...target.before.slice(1)] : sentence;
        return { id: `p40f-${target.itemId}`, intensity: input.intensity, operation: "rewrite", targetSectionType: target.sectionType, targetSectionId: target.sectionId, targetItemId: target.itemId, targetFieldPath: target.fieldPath, before: target.before, after, changedFields: [target.fieldPath.split(".").at(-1)], requirementIds: target.relevantRequirements.map((item) => item.requirementId).slice(0, 2), targetKeywords: isCursor ? ["Cursor"] : ["badcase", "verifier"], coveredKeywordsBefore: [], coveredKeywordsAfter: [], claimSupportLevel: "user_declared", evidenceRefs: target.allowedEvidenceRefs, rationale: isCursor ? "对应 Cursor 工具要求并需用户确认。" : "对应 badcase 与 verifier 岗位要求并需用户确认。", riskLevel: "medium", metrics: { textChangeRatio: 0.5, keywordGain: 1 }, status: "requires_confirmation" };
      });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "p40f-tailor", output: { suggestions }, meta }) });
      return;
    }
    await route.continue();
  });
  await panel.getByRole("button", { name: "生成改写建议" }).click();
  await expect(panel.getByTestId("tailoring-suggestions")).toBeVisible({ timeout: 60_000 });
  return { derivedId: new URL(page.url()).searchParams.get("branchId")! };
}

async function importFinalFixture(page: Page) {
  await page.goto("/resume");
  await page.getByRole("button", { name: "粘贴 JSON", exact: true }).click();
  await page.locator(".import-json-details textarea").fill(JSON.stringify(finalFixture()));
  await page.locator(".import-json-details button.primary-button").click();
  await page.getByLabel("创建新人物").check();
  while (await page.getByRole("button", { name: "确认此字段", exact: true }).count()) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  while (await page.getByRole("button", { name: "核对并保留来源", exact: true }).count()) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  await page.locator(".import-review-footer button.primary-button").click();
  const open = page.getByRole("button", { name: "打开", exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("resume-a4-page").first()).toBeVisible({ timeout: 20_000 });
}

function finalFixture() {
  const common = { customFields: [] };
  return { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { name: "演示候选人", targetRole: "AI Coding 任务设计专家", phone: "13800000000", email: "candidate@example.com", location: "示例城市", portfolioLinks: [], otherLinks: [], customFields: [] }, unclassifiedBlocks: [], sections: [
    { id: "summary", sectionType: "summary", title: "自我评价", order: 0, visible: true, items: [{ ...common, id: "summary-1", sectionType: "summary", text: "持续实践 AI Coding，能够拆解复杂任务、复现错误、定位原因、验证模型输出，并建立风险操作约束与回归验证闭环。" }] },
    { id: "education", sectionType: "education", title: "教育经历", order: 1, visible: true, items: [{ ...common, id: "education-1", sectionType: "education", school: "示例大学", degree: "本科", major: "计算机科学", startDate: "2024-09", endDate: "2028-06", current: false, courses: [], honors: [], highlights: [] }] },
    { id: "work", sectionType: "work", title: "工作经历", order: 2, visible: true, items: [
      { ...common, id: "work-1", sectionType: "work", organization: "示例公司甲", role: "AI 指令评估", startDate: "2024-09", endDate: "2026-02", current: false, highlights: ["拆解复杂需求，核对模型输出事实与逻辑，记录 badcase 并迭代指令。"] },
      { ...common, id: "work-2", sectionType: "work", organization: "示例公司乙", role: "AI 输出审核", startDate: "2026-02", current: true, highlights: ["评测生成报告，定位字段缺失与依据不足问题，沉淀可复用检查规则。"] }
    ] },
    { id: "project", sectionType: "project", title: "项目经历", order: 3, visible: true, items: [
      { ...common, id: "smartfocus", sectionType: "project", title: "示例任务系统", role: "全栈开发", startDate: "2026-02", current: true, tools: ["TypeScript", "Playwright", "Vitest"], highlights: ["复现模型在模糊指令下过度执行的问题，设计二次确认与预提交保护机制。", "使用 Playwright 与 Vitest 验证多文件修改和回归路径。"], outcomes: [] },
      { ...common, id: "learnkata", sectionType: "project", title: "示例学习助手", role: "独立开发", startDate: "2026-03", current: true, tools: ["RAG", "Python"], highlights: ["复现 RAG 依据不足时的幻觉，增加拒答边界与本地降级验证。", "构建检索、分片与输出校验流程。"], outcomes: [] },
      { ...common, id: "trust-analysis", sectionType: "project", title: "内容可信度分析系统", role: "独立开发", startDate: "2026-02", current: true, tools: ["FastAPI"], highlights: ["拆分可信度评测维度，输出结构化分数并用反例约束广告识别 badcase。", "开发异步任务与重试流程，验证失败边界。"], outcomes: [] }
    ] },
    { id: "skills", sectionType: "skills", title: "专业技能", order: 4, visible: true, items: [
      { ...common, id: "skill-1", sectionType: "skills", name: "AI 输出评测", description: "复现、定位并验证模型输出问题" },
      { ...common, id: "skill-2", sectionType: "skills", name: "自动化测试", description: "Playwright、Vitest" },
      { ...common, id: "skill-3", sectionType: "skills", name: "全栈开发", description: "React、Next.js、TypeScript、FastAPI" },
      { ...common, id: "skill-4", sectionType: "skills", name: "RAG", description: "检索、幻觉修正与拒答边界" }
    ] }
  ] };
}

function normalize(value: string) { return value.replace(/\s+/g, ""); }
function count(value: string, target: string) { return value.split(target).length - 1; }
function immutableMetadata(branch?: DbBranch) {
  return branch?.structuredContentItems?.map((item) => ({ id: item.id, sectionType: item.data.sectionType, organization: item.data.organization, role: item.data.role, title: item.data.title, startDate: item.data.startDate, endDate: item.data.endDate, current: item.data.current, location: item.data.location }));
}
function presentationSettings(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const settings = { ...value } as Record<string, unknown>;
  delete settings.contentRevision;
  delete settings.updatedAt;
  return settings;
}
function internalLabelCount(branch?: DbBranch) { return INTERNAL_LABELS.reduce((total, label) => total + count(JSON.stringify(branch?.structuredContentItems ?? []), label), 0); }
function changedStructuredText(before?: DbBranch, after?: DbBranch) {
  const previous = new Map(before?.structuredContentItems?.map((item) => [item.id, JSON.stringify(item.data)]) ?? []);
  return after?.structuredContentItems?.filter((item) => previous.get(item.id) !== JSON.stringify(item.data)).map((item) => JSON.stringify(item.data)).join("\n") ?? "";
}
async function readStore<T>(page: Page, storeName: string, key: string): Promise<T | undefined> {
  return page.evaluate(({ storeName, key }) => new Promise<T | undefined>((resolveValue, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; const get = db.transaction(storeName, "readonly").objectStore(storeName).get(key); get.onerror = () => reject(get.error); get.onsuccess = () => { resolveValue(get.result as T | undefined); db.close(); }; };
  }), { storeName, key });
}
