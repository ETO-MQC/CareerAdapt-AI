import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openManualPageTab, openManualTypographyTab, openManualTemplateTab } from "./support/g7b2Ui";
import type { ResumePdfExportSnapshot } from "@/domain/schemas";
import { hashExportSnapshot } from "@/services/export/snapshot";

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
  for (const value of ["示例大学", "本科 · 计算机科学", "示例城市", "2024.09–2028.06", "技能1（熟练）", "使用 Kotlin 完成 Android 开发。", "中文母语，英语四级备考中"]) {
    expect(previewText).toContain(value);
  }
  await expect(previewOutput.locator('[data-presentation-item="work"]')).toHaveCount(2);
  await expect(previewOutput.locator('[data-presentation-item="project"]')).toHaveCount(4);
  await expect(previewOutput.locator('[data-presentation-item="awards"]')).toHaveCount(2);
  await expect(previewOutput.locator('[data-presentation-item="skills"]')).toHaveCount(6);
  await expect(previewOutput.locator('[data-presentation-item="languages"]')).toHaveCount(1);
  await expect(previewOutput.locator('[data-render-section="experience"]')).toHaveCount(0);
  expect(await duplicatePresentationItemIds(previewOutput)).toEqual([]);
  const previewPages = previewStage.getByTestId("resume-a4-page");
  await expect(previewPages).toHaveCount(2);
  await expect(previewPages.nth(1)).toContainText("奖项二");
  await expect(previewPages.nth(1)).toContainText("专业技能");
  await expect(previewPages.nth(1)).toContainText("中文母语，英语四级备考中");
  await expect(page.getByTestId("render-coverage-warning")).toHaveCount(0);

  const captureViewports = [
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 }, { width: 1920, height: 1080 }
  ];
  for (const viewport of captureViewports) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
    await expect(previewStage.getByTestId("resume-a4-page")).toHaveCount(2, { timeout: 20_000 });
    await page.screenshot({ path: resolve(outputDir, `${viewport.width}x${viewport.height}.png`), fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const settings = page.getByTestId("resume-layout-inspector");
    if (viewport.width > 1200) {
      await expect(settings).toBeVisible();
      const bounds = await settings.boundingBox();
      const canvas = await previewStage.boundingBox();
      expect(canvas!.x + canvas!.width).toBeLessThanOrEqual(bounds!.x);
      await settings.getByRole("tab", { name: "排版", exact: true }).click();
      await expect(settings.getByLabel("全局字号", { exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(outputDir, `${viewport.width}-typography.png`) });
      await settings.getByRole("tab", { name: "页面", exact: true }).click();
      await expect(settings.getByRole("switch", { name: "多页简历模式", exact: true })).toBeVisible();
      await page.screenshot({ path: resolve(outputDir, `${viewport.width}-page.png`) });
    } else {
      await expect(settings).toBeHidden();
    }
    const visiblePaper = await previewStage.getByTestId("resume-a4-page").first().boundingBox();
    const canvasBounds = await previewStage.boundingBox();
    expect(visiblePaper!.x).toBeGreaterThanOrEqual(canvasBounds!.x);
    expect(visiblePaper!.x + visiblePaper!.width).toBeLessThanOrEqual(canvasBounds!.x + canvasBounds!.width + 1);
    const toolbar = await page.locator(".resume-canvas-toolbar").boundingBox();
    const scroller = await page.getByTestId("resume-document-scroller").boundingBox();
    expect(scroller!.y + scroller!.height).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height);
    expect(toolbar!.y).toBeGreaterThan(scroller!.y);
    const metrics = await previewStage.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { top: rect.top, width: rect.width, display: style.display };
    });
    expect(metrics.top).toBeGreaterThanOrEqual(0);
    expect(metrics.width).toBeGreaterThan(0);
    expect(metrics.display).not.toBe("none");
  }

  await page.getByTestId("resume-section-nav").getByRole("button", { name: "教育经历", exact: true }).click();
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
  for (const value of ["示例大学", "本科", "计算机科学", "示例城市", "2024.09–2028.06", "工作条目一", "工作条目二", "项目一", "项目二", "项目三", "项目四", "奖项一", "奖项二", "技能1（熟练）", "使用 Kotlin 完成 Android 开发。", "中文母语，英语四级备考中"]) {
    expect(normalizeText(pdfText)).toContain(normalizeText(value));
    expect(normalizeText(previewText)).toContain(normalizeText(value));
  }
  for (const uniqueValue of ["工作条目一", "工作条目二", "项目一", "项目二", "项目三", "项目四", "奖项一", "奖项二"]) {
    expect(countOccurrences(normalizeText(pdfText), normalizeText(uniqueValue))).toBe(1);
  }
});

test("one-page and relaxed two-page presets preserve natural order and all content", async ({ page }) => {
  test.setTimeout(120_000);
  await importCanonicalFixture(page);
  const measurement = page.getByTestId("resume-pagination-measurement-page");
  const expectedOrder = ["summary-1", "education-1", "work-1", "work-2", "project-1", "project-2", "project-3", "project-4", "award-1", "award-2", "skill-1", "skill-2", "skill-3", "skill-4", "skill-5", "skill-6", "language-1"];
  const sourceOrder = async () => measurement.locator("[data-pagination-item-id]").evaluateAll((nodes) =>
    nodes.map((node) => ((node as HTMLElement).dataset.paginationItemId ?? "").replace(/^branch-item-import-/, ""))
  );
  expect(await sourceOrder()).toEqual(expectedOrder);
  await expect(page.getByTestId("resume-a4-page")).toHaveCount(2);

  await openManualPageTab(page);
  await page.getByRole("button", { name: "一页优化", exact: true }).click();
  await expect(page.getByTestId("page-policy-selector")).toHaveValue("prefer_one_page");
  await expect(page.getByTestId("resume-a4-page")).toHaveCount(2);
  expect(await sourceOrder()).toEqual(expectedOrder);
  await openManualTypographyTab(page);
  await expect(page.getByLabel("全局字号", { exact: true })).toHaveValue("11.73");
  await expect(page.getByLabel("行间距", { exact: true })).toHaveValue("1.34");

  await openManualPageTab(page);
  await page.getByRole("button", { name: "两页舒展", exact: true }).click();
  await expect(page.getByTestId("page-policy-selector")).toHaveValue("up_to_two_pages");
  await expect(page.getByTestId("resume-a4-page")).toHaveCount(2);
  expect(await sourceOrder()).toEqual(expectedOrder);
  await openManualTypographyTab(page);
  await expect(page.getByLabel("全局字号", { exact: true })).toHaveValue("12.4");
  await expect(page.getByLabel("行间距", { exact: true })).toHaveValue("1.62");
});

test("settings keep unsaved fields, selection and canvas state without business writes", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await importCanonicalFixture(page);
  const importNotices = page.getByRole("button", { name: /^关闭通知：导入(成功|完成)$/ });
  while (await importNotices.count()) await importNotices.first().click();
  const businessSnapshot = () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = ["profiles", "resumeBranches", "resumeRevisions", "resumeBranchOperations"];
      const transaction = database.transaction(names, "readonly");
      return await Promise.all(names.map(name => new Promise<unknown[]>((resolve, reject) => {
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })));
    } finally { database.close(); }
  });
  const originalData = await businessSnapshot();
  await page.getByTestId("resume-section-nav").getByRole("button", { name: "教育经历", exact: true }).click();
  const fields = page.getByTestId("resume-active-section-fields");
  await fields.getByRole("button", { name: /添加教育经历/ }).click();
  const draft = fields.getByRole("textbox", { name: /^学校名称/ }).last();
  await draft.fill("尚未保存的学校草稿");
  await page.getByTestId("resume-section-nav").getByRole("button", { name: "工作经历", exact: true }).click();
  await page.locator('[data-section-key="education"] .sidebar-section-header').hover();
  await page.getByTestId("resume-section-nav").getByRole("button", { name: "编辑板块：教育经历", exact: true }).click();
  await expect(draft).toHaveValue("尚未保存的学校草稿");
  const settings = page.getByTestId("resume-layout-inspector");
  const scroller = page.getByTestId("resume-document-scroller");
  const selectedIds = () => page.locator('.resume-preview-stage [data-testid="resume-a4-page"] [data-selected="true"][data-source-item-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.sourceItemId));
  const selection = await selectedIds();
  expect(selection.length).toBeGreaterThan(0);
  const editScroll = await fields.evaluate(node => node.scrollTop);
  await page.getByRole("navigation", { name: "编辑模式" }).getByRole("button", { name: "AI优化", exact: true }).click();
  await page.getByRole("navigation", { name: "编辑模式" }).getByRole("button", { name: "编辑", exact: true }).click();
  await expect(draft).toHaveValue("尚未保存的学校草稿");
  await expect.poll(() => fields.evaluate(node => node.scrollTop)).toBe(editScroll);
  expect(await selectedIds()).toEqual(selection);
  for (const width of [1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    await page.getByRole("button", { name: "放大预览", exact: true }).click();
    const zoom = await page.getByRole("group", { name: "画布缩放" }).textContent();
    await scroller.evaluate(node => { node.scrollTop = 100; });
    const scrollTop = await scroller.evaluate(node => node.scrollTop);
    const fieldScroll = await fields.evaluate(node => node.scrollTop);
    if (width === 1024) await page.getByRole("button", { name: "排版设置", exact: true }).click();
    await expect(settings).toBeVisible();
    expect((await settings.boundingBox())!.height).toBeGreaterThan(300);
    await settings.getByRole("tab", { name: "页面", exact: true }).click();
    await expect(settings.getByLabel("上边距", { exact: true })).toBeVisible();
    const settingsBody = settings.locator(".resume-settings-body");
    await settingsBody.evaluate(node => { node.scrollTop = 80; });
    const settingScroll = await settingsBody.evaluate(node => node.scrollTop);
    await settings.getByRole("tab", { name: "排版", exact: true }).click();
    await settings.getByRole("tab", { name: "页面", exact: true }).click();
    await expect.poll(() => settingsBody.evaluate(node => node.scrollTop)).toBe(settingScroll);
    await expect(draft).toHaveValue("尚未保存的学校草稿");
    expect(await fields.evaluate(node => node.scrollTop)).toBe(fieldScroll);
    await page.screenshot({ path: `.tmp/ui-phase3/settings-${width}.png`, animations: "disabled" });
    if (width === 1024) {
      const left = await fields.boundingBox();
      const right = await settings.boundingBox();
      expect(left!.x + left!.width).toBeLessThanOrEqual(right!.x);
      await page.keyboard.press("Escape");
      await expect(settings).toBeHidden();
      await expect(page.getByRole("button", { name: "排版设置", exact: true })).toBeFocused();
      await page.getByRole("button", { name: "排版设置", exact: true }).click();
      await settings.getByRole("button", { name: "返回预览", exact: true }).click();
      await expect(settings).toBeHidden();
    }
    expect(await selectedIds()).toEqual(selection);
    expect(await page.getByRole("group", { name: "画布缩放" }).textContent()).toBe(zoom);
    expect(await scroller.evaluate(node => node.scrollTop)).toBe(scrollTop);
    await page.screenshot({ path: `.tmp/ui-phase3/editor-${width}.png`, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const previewText = await page.getByTestId("resume-pagination-measurement-page").textContent();
  for (const [theme, accent] of [["light", "green"], ["dark", "burgundy"]]) {
    await page.evaluate(({ theme, accent }) => {
      localStorage.setItem("careeradapt.theme", theme);
      localStorage.setItem("careeradapt.appAccent", accent);
      window.dispatchEvent(new Event("careeradapt-preferences-change"));
    }, { theme, accent });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("html")).toHaveAttribute("data-app-accent", accent);
    expect(await page.getByTestId("resume-a4-page").first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(await page.getByTestId("resume-pagination-measurement-page").textContent()).toBe(previewText);
  }
  expect(await businessSnapshot()).toEqual(originalData);
  await expect(page.getByRole("button", { name: "下载 PDF", exact: true })).toHaveCount(1);
  const workbar = page.getByTestId("resume-studio-workbar");
  await workbar.locator(".toolbar-more > summary").click();
  await expect(workbar.getByRole("button", { name: "导入", exact: true })).toBeVisible();
  await expect(workbar.getByRole("button", { name: "从资料库更新简历", exact: true })).toBeVisible();
  await expect(workbar.getByRole("button", { name: "打印 / 保存 PDF", exact: true })).toHaveCount(1);
  await expect(workbar.getByRole("button", { name: "重做展示", exact: true })).toHaveCount(0);
});

test("precision settings persist, resize and collapse while formal PDF keeps all facts", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(resolve("artifacts/ui-phase4"), { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await importCanonicalFixture(page);
  const notices = page.getByRole("button", { name: /^关闭通知：导入(成功|完成)$/ });
  while (await notices.count()) await notices.first().click();
  const settings = page.getByTestId("resume-layout-inspector");
  const measurement = page.getByTestId("resume-pagination-measurement-page");
  await page.evaluate(() => { localStorage.setItem("careeradapt.theme", "light"); localStorage.setItem("careeradapt.appAccent", "burgundy"); window.dispatchEvent(new Event("careeradapt-preferences-change")); });
  const sourceText = await measurement.textContent();
  const facts = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const names = ["profiles", "resumeBranches", "resumeRevisions"];
      const tx = db.transaction(names, "readonly");
      return await Promise.all(names.map(name => new Promise((resolve, reject) => {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      })));
    } finally { db.close(); }
  });
  const originalFacts = await facts();
  await settings.getByLabel("全局字号", { exact: true }).fill("13"); await settings.getByLabel("全局字号", { exact: true }).press("Enter");
  await settings.getByLabel("行间距", { exact: true }).fill("1.3"); await settings.getByLabel("行间距", { exact: true }).press("Enter");
  await settings.getByLabel("字间距", { exact: true }).fill("0.2"); await settings.getByLabel("字间距", { exact: true }).press("Enter");
  await settings.getByLabel("板块间距", { exact: true }).fill("8"); await settings.getByLabel("板块间距", { exact: true }).press("Enter");
  await settings.getByLabel("姓名", { exact: true }).fill("1.55"); await settings.getByLabel("姓名", { exact: true }).press("Enter");
  await settings.getByLabel("板块标题", { exact: true }).fill("1.08"); await settings.getByLabel("板块标题", { exact: true }).press("Enter");
  await settings.getByLabel("联系方式", { exact: true }).fill("0.94"); await settings.getByLabel("联系方式", { exact: true }).press("Enter");
  await settings.getByLabel("正文描述", { exact: true }).fill("1.02"); await settings.getByLabel("正文描述", { exact: true }).press("Enter");
  await settings.getByLabel("经历标题", { exact: true }).fill("1.1"); await settings.getByLabel("经历标题", { exact: true }).press("Enter");
  await settings.getByLabel("求职意向", { exact: true }).fill("1.05"); await settings.getByLabel("求职意向", { exact: true }).press("Enter");
  await settings.getByRole("tab", { name: "样式", exact: true }).click();
  await settings.getByLabel("预设组合").selectOption("serif");
  await expect(settings.getByLabel("英文/数字字体")).toHaveValue("times_new_roman");
  await settings.getByRole("button", { name: "主色：#91353e", exact: true }).click();
  await settings.getByRole("button", { name: "强调色：#397550", exact: true }).click();
  await settings.getByRole("button", { name: "分隔线颜色：#485158", exact: true }).click();
  await settings.locator('[data-style-picker="title"] > summary').click();
  await settings.getByRole("button", { name: "板块标题样式：底线", exact: true }).click();
  await settings.locator('[data-style-picker="entry"] > summary').click();
  await settings.getByRole("button", { name: "经历条目样式：双行", exact: true }).click();
  await settings.getByLabel("正文链接样式").selectOption("accent");
  await settings.getByLabel("列表符号").selectOption("square");
  await settings.getByLabel("符号大小", { exact: true }).fill("1.2"); await settings.getByLabel("符号大小", { exact: true }).press("Enter");
  await settings.getByLabel("下划线宽度", { exact: true }).fill("1.3"); await settings.getByLabel("下划线宽度", { exact: true }).press("Enter");
  await settings.getByRole("switch", { name: "显示板块标题分隔竖杠", exact: true }).click();
  await settings.getByRole("tab", { name: "页面", exact: true }).click();
  for (const [label, value] of [["上边距", "8"], ["右边距", "10"], ["下边距", "9"], ["左边距", "11"]]) { await settings.getByLabel(label, { exact: true }).fill(value); await settings.getByLabel(label, { exact: true }).press("Enter"); }
  await settings.getByRole("button", { name: "居中对齐", exact: true }).click();
  await settings.getByRole("button", { name: "居中", exact: true }).click();
  await settings.getByLabel("信息左右偏移", { exact: true }).fill("3"); await settings.getByLabel("信息左右偏移", { exact: true }).press("Enter");
  await settings.getByLabel("信息上下偏移", { exact: true }).fill("2"); await settings.getByLabel("信息上下偏移", { exact: true }).press("Enter");
  await expect(settings.getByLabel("照片左右偏移", { exact: true })).toBeDisabled();
  await settings.getByLabel("抬头高度", { exact: true }).fill("118"); await settings.getByLabel("抬头高度", { exact: true }).press("Enter");
  await settings.getByLabel("距正文间距", { exact: true }).fill("5"); await settings.getByLabel("距正文间距", { exact: true }).press("Enter");
  await expect.poll(() => measurement.evaluate(node => getComputedStyle(node).getPropertyValue("--resume-header-gap"))).toBe("5px");
  await expect(measurement).toHaveAttribute("data-precision-header", "center");
  expect(await measurement.locator(".resume-template-header h1").evaluate(node => getComputedStyle(node).fontSize)).toBe("20.15px");
  expect(await measurement.locator(".resume-template-section h2").first().evaluate(node => getComputedStyle(node).color)).toBe("rgb(145, 53, 62)");
  expect(parseFloat(await measurement.evaluate(node => getComputedStyle(node).paddingLeft))).toBeCloseTo(11 * 96 / 25.4, 1);
  const separator = page.getByRole("separator", { name: "调整设置栏宽度" });
  const initialWidth = (await settings.boundingBox())!.width;
  const handle = (await separator.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 80);
  await page.mouse.down(); await page.mouse.move(handle.x - 60, handle.y + 80, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await settings.boundingBox())!.width).toBeGreaterThan(initialWidth + 40);
  await separator.focus(); await page.keyboard.press("ArrowRight");
  const resizedWidth = (await settings.boundingBox())!.width;
  const settingsBody = settings.locator(".resume-settings-body");
  await settingsBody.evaluate(node => { node.scrollTop = 200; });
  const scroll = await settingsBody.evaluate(node => node.scrollTop);
  const canvasWidth = (await page.locator(".resume-preview-stage").boundingBox())!.width;
  await settings.getByRole("button", { name: "折叠设置栏", exact: true }).click();
  await expect(settings).toBeHidden();
  expect((await page.locator(".resume-preview-stage").boundingBox())!.width).toBeGreaterThan(canvasWidth);
  await page.getByRole("button", { name: "展开设置栏", exact: true }).click();
  await expect(settings.getByRole("tab", { name: "页面", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => settingsBody.evaluate(node => node.scrollTop)).toBe(scroll);
  await page.reload();
  await expect(settings).toBeVisible();
  await expect.poll(async () => (await settings.boundingBox())!.width).toBe(resizedWidth);
  await settings.getByRole("tab", { name: "排版", exact: true }).click();
  await expect(settings.getByLabel("全局字号", { exact: true })).toHaveValue("13");
  for (const width of [1920, 1366, 1024]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    // Let the responsive grid and its ResizeObserver settle before clicking tabs.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (!await settings.isVisible()) await page.getByRole("button", { name: "排版设置", exact: true }).click();
    for (const tab of ["排版", "样式", "页面", "模板"]) {
      await settings.getByRole("tab", { name: tab, exact: true }).click();
      await settingsBody.evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: resolve(`artifacts/ui-phase4/${width}-${tab}.png`), animations: "disabled" });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await settings.getByRole("button", { name: "折叠设置栏", exact: true }).click();
    await page.screenshot({ path: resolve(`artifacts/ui-phase4/${width}-collapsed.png`), animations: "disabled" });
    await page.getByRole("button", { name: "展开设置栏", exact: true }).click();
  }
  await settings.getByRole("button", { name: "返回预览", exact: true }).click();
  let snapshot: ResumePdfExportSnapshot | undefined;
  page.on("request", request => { if (request.url().includes("/api/resume-export/pdf")) snapshot = request.postDataJSON().snapshot; });
  const responsePromise = page.waitForResponse(response => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST");
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  expect(snapshot!.presentation.precision).toMatchObject({ fontSizePx: 13, nameScale: 1.55, primaryColor: "#91353e", marginLeftMm: 11, headerHeightPx: 118 });
  const pdfPath = resolve("artifacts/ui-phase4/precision.pdf"); await download.saveAs(pdfPath);
  const text = execFileSync(PDFTOTEXT, [pdfPath, "-"], { encoding: "utf8" });
  for (const value of ["示例大学", "工作条目一", "工作条目二", "项目一", "项目四", "奖项二", "技能1", "中文母语"]) expect(normalizeText(text)).toContain(normalizeText(value));
  await page.getByRole("button", { name: "排版设置", exact: true }).click();
  await settings.getByRole("tab", { name: "样式", exact: true }).click();
  await settings.getByRole("switch", { name: "标题跟随主题色", exact: true }).click();
  await expect.poll(() => measurement.locator(".resume-template-section h2").first().evaluate(node => getComputedStyle(node).color)).toBe("rgb(32, 37, 34)");
  await settings.getByRole("switch", { name: "分隔线使用中性灰色", exact: true }).click();
  await expect.poll(() => measurement.evaluate(node => getComputedStyle(node).getPropertyValue("--resume-divider-color"))).toBe("#c9c8c3");
  await settings.getByRole("switch", { name: "显示个人信息标签", exact: true }).click();
  await expect(measurement.locator(".resume-contact-label")).toHaveCount(3);
  await settings.getByRole("switch", { name: "显示个人信息标签", exact: true }).click();
  await expect(measurement.locator(".resume-contact-label")).toHaveCount(0);
  await settings.getByRole("tab", { name: "模板", exact: true }).click();
  await settings.getByRole("button", { name: "恢复此模板默认排版", exact: true }).click();
  await expect.poll(() => measurement.evaluate(node => getComputedStyle(node).getPropertyValue("--resume-header-gap"))).toBe("");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect.poll(() => measurement.evaluate(node => getComputedStyle(node).getPropertyValue("--resume-header-gap"))).toBe("5px");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect.poll(() => measurement.evaluate(node => getComputedStyle(node).getPropertyValue("--resume-header-gap"))).toBe("");
  expect(await measurement.textContent()).toBe(sourceText);
  expect(await facts()).toEqual(originalFacts);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await settings.getByRole("tab", { name: "样式", exact: true }).click();
  await settingsBody.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.screenshot({ path: resolve("artifacts/ui-phase4/1920-style-details.png"), animations: "disabled" });
  await settings.getByRole("tab", { name: "页面", exact: true }).click();
  await settingsBody.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.screenshot({ path: resolve("artifacts/ui-phase4/1920-page-details.png"), animations: "disabled" });
  const paperStyle = await measurement.getAttribute("style");
  for (const [theme, accent] of [["dark", "green"], ["dark", "burgundy"], ["light", "green"]]) {
    await page.evaluate(({ theme, accent }) => {
      localStorage.setItem("careeradapt.theme", theme); localStorage.setItem("careeradapt.appAccent", accent);
      window.dispatchEvent(new Event("careeradapt-preferences-change"));
    }, { theme, accent });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await measurement.getAttribute("style")).toBe(paperStyle);
    expect(await measurement.textContent()).toBe(sourceText);
    expect(await page.getByTestId("resume-a4-page").first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
    await page.screenshot({ path: resolve(`artifacts/ui-phase4/1920-${theme}-${accent}.png`), animations: "disabled" });
  }
});

test("compact editor links preview fields and previews slider frames before one save", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(resolve("artifacts/ui-tune"), { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await importCanonicalFixture(page);
  const sidebar = page.getByRole("complementary", { name: "AI 工作区导航", exact: true });
  await expect(sidebar).toHaveClass(/is-collapsed/);
  await sidebar.getByRole("button", { name: "展开 AI 导航", exact: true }).click();
  await expect(sidebar).not.toHaveClass(/is-collapsed/);
  await sidebar.getByRole("button", { name: "收起 AI 导航", exact: true }).click();
  const paper = page.getByTestId("resume-a4-page").first();
  const fields = page.getByTestId("resume-active-section-fields");
  await paper.locator('[data-source-item-id="profile:name"]').dblclick();
  await expect(fields.getByLabel("全名", { exact: true })).toBeFocused();
  await expect(page.locator(".resume-studio-editor")).toHaveCount(0);
  await paper.locator('[data-presentation-item="work"] h3').first().click();
  await expect(fields.locator("input:focus")).toHaveValue("工作条目一");
  await paper.locator('[data-presentation-item="work"] time').first().click();
  await expect(fields.locator("input:focus")).toHaveValue("2023-01");
  await paper.locator('[data-presentation-item="education"] h3').first().dblclick();
  await expect(fields.locator("input:focus")).toHaveValue("示例大学");
  await paper.locator('[data-presentation-item="education"] strong span span').filter({ hasText: /^计算机科学$/ }).click();
  await expect(fields.locator("input:focus")).toHaveValue("计算机科学");
  await paper.locator('[data-presentation-item="education"] [data-editor-date="end"]').click();
  await expect(fields.locator("input:focus")).toHaveValue("2028-06");
  await paper.locator('[data-section-title-id]').filter({ hasText: "教育经历" }).click();
  await expect(fields.getByLabel("栏目标题", { exact: true })).toBeFocused();
  await expect(page.locator(".resume-studio-editor")).toHaveCount(0);
  const settings = page.getByTestId("resume-layout-inspector");
  await settings.getByRole("tab", { name: "页面", exact: true }).click();
  const revision = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("CareerAdaptDb"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const items = await new Promise<Array<{ value: { schemaVersion?: string; presentationRevision?: number } }>>((resolve, reject) => { const request = db.transaction("appMeta").objectStore("appMeta").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return items.find(item => item.value?.schemaVersion === "resume-presentation-v1")!.value.presentationRevision!;
    } finally { db.close(); }
  });
  const beforeRevision = await revision();
  const range = settings.getByRole("slider", { name: "距正文间距滑杆", exact: true });
  await range.scrollIntoViewIfNeeded();
  await range.evaluate(node => node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  for (const value of [8, 16, 24, 32]) {
    await range.evaluate((node, value) => { const input = node as HTMLInputElement; input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    await expect.poll(() => paper.evaluate(node => node.style.getPropertyValue("--resume-header-gap")), { intervals: [16], timeout: 1000 }).toBe(`${value}px`);
  }
  expect(await revision()).toBe(beforeRevision);
  await range.evaluate(node => node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
  await expect.poll(revision).toBe(beforeRevision + 1);
  await expect(settings.getByLabel("距正文间距", { exact: true })).toHaveValue("32");
  await page.reload();
  await expect(sidebar).toHaveClass(/is-collapsed/);
  await settings.getByRole("tab", { name: "页面", exact: true }).click();
  await expect(settings.getByLabel("距正文间距", { exact: true })).toHaveValue("32");
  for (const width of [1920, 1366, 1024]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    // Let the responsive grid and its ResizeObserver settle before clicking tabs.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (!await settings.isVisible()) await page.getByRole("button", { name: "排版设置", exact: true }).click();
    await settings.getByRole("tab", { name: "排版", exact: true }).click();
    await expect(settings.getByLabel("全局字号", { exact: true })).toBeVisible();
    await page.screenshot({ path: resolve(`artifacts/ui-tune/${width}.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await settings.locator(".resume-settings-body").evaluate(node => getComputedStyle(node).scrollbarWidth)).toBe("none");
  }
  await settings.getByRole("button", { name: "返回预览", exact: true }).click();
  let exported: ResumePdfExportSnapshot | undefined;
  page.on("request", request => { if (request.url().includes("/api/resume-export/pdf")) exported = request.postDataJSON().snapshot; });
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  const responsePromise = page.waitForResponse(response => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST");
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const [download, response] = await Promise.all([downloadPromise, responsePromise]);
  expect(response.status()).toBe(200);
  expect(exported!.presentation.precision!.headerGapPx).toBe(32);
  await download.saveAs(resolve("artifacts/ui-tune/slider.pdf"));
});

async function importCanonicalFixture(page: Page, fixture: unknown = canonicalFixture()) {
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test", apiKeyConfigured: true })));
  await page.goto("/resume");
  await page.getByRole("button", { name: /^导入已有简历/ }).click();
  await page.getByTestId("resume-import-dock").locator("summary").filter({ hasText: /^粘贴 JSON$/ }).click();
  await page.locator(".import-json-details textarea").fill(JSON.stringify(fixture));
  await page.locator(".import-json-details button.primary-button").click();
  await page.getByLabel("创建新人物").check();
  if (await page.getByRole("button", { name: "确认新增个人信息", exact: true }).isVisible()) await page.getByRole("button", { name: "确认新增个人信息", exact: true }).click();
  while (await page.getByRole("button", { name: "确认字段映射", exact: true }).count()) {
    await page.getByRole("button", { name: "确认字段映射", exact: true }).first().click();
  }
  while (await page.getByRole("button", { name: "核对并保留来源", exact: true }).count()) {
    await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  }
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
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
    { id: "skills", sectionType: "skills", title: "专业技能", order: 5, visible: true, items: ["AI 与模型", "工程开发", "测试工具", "数据分析", "产品设计", "协作工具"].map((category, index) => ({ ...common, id: `skill-${index + 1}`, sectionType: "skills", name: `技能${index + 1}`, category, ...(index === 0 ? { level: "熟练", description: "使用 Kotlin 完成 Android 开发。" } : {}) })) },
    { id: "languages", sectionType: "languages", title: "语言能力", order: 6, visible: true, items: [{ ...common, id: "language-1", sectionType: "languages", language: "中文母语，英语四级备考中" }] }
  ] };
}


test("content section keyboard sorting persists in the shared preview", async ({ page }) => {
  test.setTimeout(120_000);
  await importCanonicalFixture(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  const nav = page.getByTestId("resume-section-nav");
  const handles = nav.locator(".content-drag-handle");
  const before = await handles.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
  await handles.nth(1).focus();
  await handles.nth(1).press("Alt+ArrowUp");
  await expect.poll(() => handles.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")))).not.toEqual(before);
  const after = await handles.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
  await page.reload();
  await expect.poll(() => handles.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")))).toEqual(after);
  let snapshot: ResumePdfExportSnapshot | undefined;
  page.on("request", request => { if (request.url().includes("/api/resume-export/pdf")) snapshot = request.postDataJSON().snapshot; });
  const responsePromise = page.waitForResponse(response => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST");
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  expect(snapshot!.presentation.canonicalSectionOrder?.slice(0, 2)).toEqual(["education", "summary"]);
  const model = snapshot!.renderModel;
  expect(model.schemaVersion).toBe("resume-render-v2");
  if (model.schemaVersion !== "resume-render-v2") throw new Error("expected v2 model");
  expect(model.structuredSections.slice(0, 2).map(section => section.sectionId)).toEqual(["education", "summary"]);
  const pdfPath = resolve(outputDir, "content-order.pdf");
  await download.saveAs(pdfPath);
  const text = execFileSync(PDFTOTEXT, [pdfPath, "-"], { encoding: "utf8" });
  expect(text.indexOf("示例大学")).toBeLessThan(text.indexOf("关注可靠工程交付"));
  for (const width of [1366, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    await page.screenshot({ path: resolve(outputDir, `content-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await handles.nth(1).dragTo(handles.nth(0));
  await expect.poll(() => handles.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")))).not.toEqual(after);
  const dragged = await handles.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
  await page.reload();
  await expect.poll(() => handles.evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")))).toEqual(dragged);

});

test("editor closure: photo upload, templates, order, persistence and actual PDF images", async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const dir = resolve(process.cwd(), "artifacts/editor-closure");
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  const baseFixture = canonicalFixture();
  await importCanonicalFixture(page, { ...baseFixture, sections: [...baseFixture.sections, { id: "custom-closure", sectionType: "custom", title: "自定义栏目", order: 7, visible: true, items: [{ id: "custom-closure-1", sectionType: "custom", title: "独立内容", description: "自定义正文完整保留。", highlights: ["自定义要点"], customFields: [] }] }] });
  console.log("closure: imported");
  const measurement = page.getByTestId("resume-pagination-measurement-page");
  const sectionOrder = () => measurement.locator("[data-render-section-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-render-section-id")));
  const handles = page.getByTestId("resume-section-nav").locator(".content-drag-handle");
  await expect(page.getByRole("button", { name: "下载 PDF", exact: true })).toBeEnabled();
  await handles.nth(1).focus();
  await handles.nth(1).press("Alt+ArrowUp");
  await expect.poll(sectionOrder).toEqual(["education", "summary", "work", "project", "awards", "skills", "languages", "custom"]);
  if (await page.getByRole("button", { name: "基本信息", exact: true }).getAttribute("aria-expanded") !== "true") await page.getByRole("button", { name: "基本信息", exact: true }).click();
  await expect(page.getByRole("button", { name: "添加照片", exact: true })).toBeVisible();
  await page.getByLabel("目标职位", { exact: true }).fill("前端工程师");
  await page.getByLabel("全名", { exact: true }).focus();
  await expect(measurement).toContainText("前端工程师");
  await page.screenshot({ path: resolve(dir, "before-upload-1366.png") });
  const photo = async (color: string) => page.evaluate(color => {
    const canvas = document.createElement("canvas"); canvas.width = 1800; canvas.height = 2400;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f5dfc4"; ctx.beginPath(); ctx.arc(900, 850, 400, 0, Math.PI * 2); ctx.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  }, color);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "添加照片", exact: true }).click();
  await (await chooser).setFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(page.locator(".resume-photo-input").getByRole("alert")).toContainText("无法读取图片");
  await page.getByLabel("上传简历照片").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(await photo("#a63c49"), "base64") });
  await expect(page.getByAltText("已保存的简历照片")).toBeVisible();
  const firstPhoto = await page.getByAltText("已保存的简历照片").getAttribute("src");
  expect(firstPhoto).toMatch(/^data:image\/jpeg;base64,/);
  console.log("closure: uploaded");
  await openManualPageTab(page);
  await expect(page.getByRole("switch", { name: "显示照片", exact: true })).toBeChecked();
  await expect(measurement.locator(".resume-candidate-photo")).toHaveCount(1);
  await page.getByTestId("resume-layout-inspector").getByRole("tab", { name: "样式", exact: true }).click();
  await page.getByLabel("预设组合").selectOption("serif");
  let snapshot: ResumePdfExportSnapshot | undefined;
  page.on("request", request => { if (request.url().includes("/api/resume-export/pdf")) snapshot = request.postDataJSON().snapshot; });
  async function download(name: string, hasImage: boolean) {
    const responsePromise = page.waitForResponse(response => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST", { timeout: 120_000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
    downloadPromise.catch(() => {});
    const response = await responsePromise;
    console.log(`closure: ${name} PDF HTTP ${response.status()}`);
    expect(response.status(), response.status() === 200 ? "" : await response.text()).toBe(200);
    const file = await downloadPromise;
    const path = resolve(dir, `${name}.pdf`); await file.saveAs(path);
    const text = execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" });
    for (const value of ["示例大学", "演示候选人", "前端工程师", "candidate@example.com", "工作条目一", "工作条目二", "项目一", "项目四", "奖项一", "奖项二", "中文母语，英语四级备考中", "独立内容", "自定义正文完整保留。", "自定义要点"]) expect(normalizeText(text)).toContain(normalizeText(value));
    expect(text.indexOf("示例大学")).toBeLessThan(text.indexOf("关注可靠工程交付"));
    const imageList = execFileSync(PDFTOTEXT.replace("pdftotext", "pdfimages"), ["-list", path], { encoding: "utf8" });
    const imageRows = imageList.split("\n").filter(line => /^\s*\d+\s+\d+\s+image\s/.test(line));
    expect(imageRows.length > 0).toBe(hasImage);
    if (hasImage) expect(imageRows[0]).toMatch(/450\s+600/);
    expect(snapshot!.presentation.canonicalSectionOrder?.slice(0, 2)).toEqual(["education", "summary"]);
    return path;
  }
  await openManualTemplateTab(page);
  for (const id of ["campus-reference", "modern-operations", "business-consulting", "campus-clean", "professional-classic", "classic-technical", "ats-minimal"]) {
    console.log(`closure: template ${id}`);
    await page.getByLabel("模板", { exact: true }).selectOption(id);
    await expect(measurement).toHaveClass(new RegExp(`template-${id}`));
    await expect(page.getByLabel("模板", { exact: true })).toBeEnabled();
    await expect(page.getByTestId("resume-autosave-status")).toHaveText("已保存");
    await expect(measurement.locator(".resume-candidate-photo")).toHaveCount(id === "ats-minimal" ? 0 : 1);
    expect(await sectionOrder()).toEqual(["education", "summary", "work", "project", "awards", "skills", "languages", "custom"]);
    const path = await download(id, id !== "ats-minimal");
    expect(snapshot!.templateId).toBe(id);
    expect(snapshot!.presentation.typography.chineseFont).toBe("source_han_serif");
    expect(snapshot!.renderModel.candidate.photo).toBe(firstPhoto);
    if (id === "campus-reference") {
      execFileSync(PDFTOTEXT.replace("pdftotext", "pdftoppm"), ["-f", "1", "-singlefile", "-scale-to", "1400", "-png", path, resolve(dir, "photo-pdf-page")]);
      await page.emulateMedia({ media: "print" });
      const printPath = resolve(dir, "browser-print.pdf");
      await page.pdf({ path: printPath, format: "A4", printBackground: true, preferCSSPageSize: true });
      await page.emulateMedia({ media: "screen" });
      const printed = execFileSync(PDFTOTEXT, [printPath, "-"], { encoding: "utf8" });
      expect(printed).toContain("演示候选人");
      expect(printed).toContain("前端工程师");
      expect(printed.indexOf("示例大学")).toBeLessThan(printed.indexOf("关注可靠工程交付"));
      expect(printed).toContain("工作条目二");
      expect(printed).toContain("中文母语，英语四级备考中");
      expect(printed).toContain("自定义正文完整保留。");
      expect(execFileSync(PDFTOTEXT.replace("pdftotext", "pdfimages"), ["-list", printPath], { encoding: "utf8" })).toMatch(/450\s+600/);
    }
    if (id !== "ats-minimal") {
      const bounds = await measurement.locator(".resume-template-header").evaluate(header => {
        const photo = header.querySelector("img")!.getBoundingClientRect();
        const center = (header.getBoundingClientRect().left + header.getBoundingClientRect().right) / 2;
        return Array.from(header.querySelectorAll("h1, address, p")).map(node => { const r = node.getBoundingClientRect(); return r.right <= photo.left && r.bottom <= header.getBoundingClientRect().bottom && Math.abs((r.left + r.right) / 2 - center) < 1 && getComputedStyle(node).textAlign === "center"; });
      });
      expect(bounds.every(Boolean)).toBe(true);
    }
  }
  await openManualPageTab(page);
  await expect(page.getByLabel("显示照片", { exact: true })).toBeDisabled();
  await expect(page.getByText("当前模板不支持照片。", { exact: true })).toBeVisible();
  await openManualTemplateTab(page);
  await page.getByLabel("模板", { exact: true }).selectOption("campus-reference");
  await expect(measurement).toHaveClass(/template-campus-reference/);
  await expect(page.getByLabel("模板", { exact: true })).toBeEnabled();
  await page.reload();
  await expect(measurement.locator(".resume-candidate-photo")).toHaveAttribute("src", firstPhoto!);
  expect(await sectionOrder()).toEqual(["education", "summary", "work", "project", "awards", "skills", "languages", "custom"]);
  if (await page.getByRole("button", { name: "基本信息", exact: true }).getAttribute("aria-expanded") !== "true") await page.getByRole("button", { name: "基本信息", exact: true }).click();
  await expect(page.getByRole("button", { name: "更换照片", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(dir, "after-upload-1366.png") });
  await page.getByLabel("上传简历照片").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: Buffer.from(await photo("#315e8f"), "base64") });
  await expect(measurement.locator(".resume-candidate-photo")).not.toHaveAttribute("src", firstPhoto!);
  await expect(page.getByRole("button", { name: "移除照片", exact: true })).toBeEnabled();
  await download("replacement", true);
  await openManualPageTab(page);
  await page.getByRole("switch", { name: "显示照片", exact: true }).click();
  await expect(measurement.locator(".resume-candidate-photo")).toHaveCount(0);
  await download("hidden", false);
  await page.getByRole("switch", { name: "显示照片", exact: true }).click();
  await page.getByRole("button", { name: "移除照片", exact: true }).click();
  await expect(page.getByRole("button", { name: "添加照片", exact: true })).toBeEnabled();
  await page.reload();
  await expect(measurement.locator(".resume-candidate-photo")).toHaveCount(0);
  await download("removed", false);
  expect(snapshot!.renderModel.candidate.photo).toBeUndefined();
  const corrupt = structuredClone(snapshot!);
  corrupt.renderModel.candidate.photo = "data:image/png;base64,AAAA";
  const { snapshotHash: previousHash, ...unsigned } = corrupt;
  expect(previousHash).toBeTruthy();
  corrupt.snapshotHash = hashExportSnapshot(unsigned);
  const failedPhoto = await page.request.post("/api/resume-export/pdf", { data: { schemaVersion: "resume-direct-pdf-v1", exportId: "closure-corrupt-photo", exportMethod: "direct_pdf", snapshot: corrupt } });
  expect(failedPhoto.status()).toBe(500);
  expect(await failedPhoto.json()).toEqual({ code: "resume_photo_decode_failed", recoveryAttempt: false });
});

test("reference refinement: photo visibility, personal fields, header space, save badge and component styles", async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(20_000);
  const dir = resolve(process.cwd(), "artifacts/editor-refinement"); mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await importCanonicalFixture(page);
  const measure = page.getByTestId("resume-pagination-measurement-page");
  const status = page.getByTestId("resume-autosave-status");
  const basics = page.getByRole("button", { name: "基本信息", exact: true });
  if (await basics.getAttribute("aria-expanded") !== "true") await basics.click();
  await page.getByLabel("目标职位", { exact: true }).fill("前端工程师");
  await expect(status).toHaveAttribute("data-save-state", "dirty");
  await page.getByLabel("全名", { exact: true }).focus();
  await expect(status).toHaveText("已保存");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { restoreResumePut: () => void }).restoreResumePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "resumeBranches") throw new DOMException("Controlled test write failure", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.getByLabel("全名", { exact: true }).fill("未保存的匿名姓名");
  await page.getByLabel("目标职位", { exact: true }).focus();
  await expect(status).toHaveAttribute("data-save-state", "error");
  await expect(page.getByLabel("全名", { exact: true })).toHaveValue("未保存的匿名姓名");
  await page.evaluate(() => (window as unknown as { restoreResumePut: () => void }).restoreResumePut());
  await page.getByLabel("全名", { exact: true }).focus(); await page.getByLabel("目标职位", { exact: true }).focus();
  await expect(status).toHaveText("已保存");
  await page.getByLabel("全名", { exact: true }).fill("演示候选人"); await page.getByLabel("目标职位", { exact: true }).focus();
  await expect(status).toHaveText("已保存");
  await expect(page.getByText("保存失败：版本已变化，请刷新后重试。", { exact: true })).toHaveCount(0);
  await expect(page.locator(".app-notification-success strong").filter({ hasText: /^已保存$/ })).toHaveCount(0);
  const photo = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 300; c.height = 400; const ctx = c.getContext("2d")!; ctx.fillStyle = "#397550"; ctx.fillRect(0, 0, 300, 400); return c.toDataURL("image/png").split(",")[1]; });
  await page.getByLabel("上传简历照片").setInputFiles({ name: "anonymous.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") });
  await expect(page.locator(".resume-preview-pages .resume-candidate-photo").first()).toBeVisible();
  await expect(measure.locator(".resume-candidate-photo")).toHaveCount(1);
  await expect(page.getByLabel("显示简历照片", { exact: true })).toBeChecked();
  await expect(status).toHaveText("已保存");
  await page.getByRole("button", { name: "增加字段", exact: true }).click();
  await page.getByRole("button", { name: "微信", exact: true }).click();
  await page.getByLabel("微信：", { exact: true }).fill("demo-wechat");
  await expect(status).toHaveAttribute("data-save-state", "dirty");
  await page.getByLabel("全名", { exact: true }).focus();
  await expect(measure).toContainText("demo-wechat");
  await page.getByRole("button", { name: "上移个人信息：微信", exact: true }).click();
  await expect(status).toHaveText("已保存");
  await page.getByRole("button", { name: "插入换行", exact: false }).click();
  await expect(measure.locator(".resume-contact-break")).toHaveCount(1);
  await page.getByRole("button", { name: "增加字段", exact: true }).click();
  await page.getByLabel("自定义字段名称").fill("个人说明");
  await page.locator(".personal-custom-field").getByRole("button", { name: "添加", exact: true }).click();
  await page.getByLabel("个人说明：", { exact: true }).fill("用户确认的个人信息");
  await page.getByLabel("全名", { exact: true }).focus();
  await expect(measure).toContainText("用户确认的个人信息");
  await expect(status).toHaveText("已保存");
  await openManualPageTab(page);
  const positions = () => measure.evaluate(root => ({ name: root.querySelector("h1")!.getBoundingClientRect().top, contacts: root.querySelector("address")!.getBoundingClientRect().top, body: root.querySelector("[data-render-section]")!.getBoundingClientRect().top }));
  const before = await positions();
  await page.getByLabel("抬头高度", { exact: true }).fill("40"); await page.getByLabel("抬头高度", { exact: true }).press("Enter");
  await expect(status).toHaveText("已保存");
  await expect.poll(async () => (await positions()).name - before.name).toBeCloseTo(40, 0);
  const after = await positions();
  expect(after.contacts - before.contacts).toBeCloseTo(40, 0); expect(after.body - before.body).toBeCloseTo(40, 0);
  const settings = page.getByTestId("resume-layout-inspector");
  await settings.getByRole("tab", { name: "样式", exact: true }).click();
  await settings.getByRole("switch", { name: "显示个人信息标签", exact: true }).click();
  await expect(measure.locator("address")).toContainText("手机号："); await expect(measure.locator("address")).toContainText("邮箱："); await expect(measure.locator(".resume-contact-icon")).toHaveCount(0);
  for (const [label, key] of [["竖线", "rail"], ["短强调线", "accent_line"], ["圆角浅底", "soft"]]) {
    await settings.locator('[data-style-picker="title"] > summary').click(); await settings.getByRole("button", { name: `板块标题样式：${label}`, exact: true }).click(); await expect(measure).toHaveAttribute("data-precision-title", key);
  }
  await settings.locator('[data-style-picker="entry"] > summary').click();
  await settings.getByRole("button", { name: "经历条目样式：紧凑同行", exact: true }).click();
  await expect(measure.locator(".resume-presentation-heading").first()).toHaveCSS("display", "flex");
  await settings.getByRole("button", { name: /应用参考排版/ }).click();
  await expect(measure).toHaveAttribute("data-precision-title", "underline");
  await expect(settings.getByLabel("预设组合")).toHaveValue("inter-sans");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('12px "CareerAdapt Inter"') && document.fonts.check('12px "CareerAdapt Source Han Sans"'))).toBe(true);
  await expect(status).toHaveText("已保存");
  await page.reload();
  await expect(page.locator(".resume-preview-pages .resume-candidate-photo").first()).toBeVisible();
  await expect(measure.locator(".resume-candidate-photo")).toHaveCount(1);
  await expect(measure).toContainText("demo-wechat"); await expect(measure).toContainText("用户确认的个人信息");
  await expect(measure.locator(".resume-contact-break")).toHaveCount(1); await expect(measure.locator("address")).toContainText("微信：");
  await expect(status).toHaveText("已保存");
  await page.screenshot({ path: resolve(dir, "after-1366.png") });
  if (await basics.getAttribute("aria-expanded") !== "true") await basics.click();
  await page.screenshot({ path: resolve(dir, "personal-1366.png") });
  const response = page.waitForResponse(r => r.url().includes("/api/resume-export/pdf") && r.request().method() === "POST");
  const download = page.waitForEvent("download", { timeout: 120_000 }); download.catch(() => {});
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const result = await response; expect(result.status(), result.status() === 200 ? "" : await result.text()).toBe(200);
  const pdfPath = resolve(dir, "refined.pdf"); await (await download).saveAs(pdfPath);
  const text = execFileSync(PDFTOTEXT, [pdfPath, "-"], { encoding: "utf8" });
  for (const value of ["前端工程师", "demo-wechat", "用户确认的个人信息", "手机号", "邮箱", "工作条目二", "项目四", "中文母语，英语四级备考中"]) expect(normalizeText(text)).toContain(normalizeText(value));
  const fontList = execFileSync(PDFTOTEXT.replace("pdftotext", "pdffonts"), [pdfPath], { encoding: "utf8" });
  expect(fontList).toContain("Inter"); expect(fontList).toContain("SourceHanSans");
  execFileSync(PDFTOTEXT.replace("pdftotext", "pdftoppm"), ["-f", "1", "-singlefile", "-scale-to", "1400", "-png", pdfPath, resolve(dir, "refined-pdf")]);
  for (const width of [1920, 1024]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(dir, `personal-${width}.png`) });
  }
});


test("final annotated polish keeps contacts centered and personal controls compact", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = resolve("artifacts/editor-final-polish"); mkdirSync(dir, { recursive: true });
  await page.addInitScript(() => localStorage.setItem("careeradapt.theme", "light"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await importCanonicalFixture(page);
  await openManualTemplateTab(page);
  await page.getByLabel("模板", { exact: true }).selectOption("campus-reference");
  const measurement = page.getByTestId("resume-pagination-measurement-page");
  await expect(measurement).toHaveClass(/template-campus-reference/);
  const basics = page.getByRole("button", { name: "基本信息", exact: true });
  if (await basics.getAttribute("aria-expanded") !== "true") await basics.click();
  const photo = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 300; c.height = 400; const ctx = c.getContext("2d")!; ctx.fillStyle = "#778694"; ctx.fillRect(0, 0, 300, 400); return c.toDataURL("image/png").split(",")[1]; });
  await page.getByLabel("上传简历照片").setInputFiles({ name: "anonymous.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") });
  const visibility = page.getByLabel("显示简历照片", { exact: true });
  await expect(visibility).toBeChecked();
  await page.screenshot({ path: resolve(dir, `${process.env.EDITOR_POLISH_CAPTURE ?? "after"}-photo.png`) });
  await expect(visibility.locator("..")).toHaveCSS("align-items", "center");
  const checkboxRow = await visibility.locator("..").evaluate(label => {
    const checkbox = label.querySelector("input")!.getBoundingClientRect();
    const text = label.querySelector("span")?.getBoundingClientRect();
    return text ? Math.abs((checkbox.top + checkbox.bottom - text.top - text.bottom) / 2) : 999;
  });
  expect(checkboxRow).toBeLessThan(2);
  const space = await page.locator(".basics-identity-with-photo").evaluate(row => {
    const hint = row.querySelector(".field-input-hint")!.getBoundingClientRect();
    return row.getBoundingClientRect().bottom - hint.bottom;
  });
  expect(space).toBeLessThan(45);
  const phone = page.locator('.personal-contact-row[data-contact-id="phone"]');
  await phone.hover();
  const drag = phone.getByRole("button", { name: "拖动个人信息：手机号", exact: true });
  const down = phone.getByRole("button", { name: "下移个人信息：手机号", exact: true });
  await page.screenshot({ path: resolve(dir, "after-field-controls.png") });
  const dragBounds = await drag.boundingBox(); const downBounds = await down.boundingBox(); const inputBounds = await phone.locator("input").boundingBox();
  expect(dragBounds!.x + dragBounds!.width).toBeLessThan(inputBounds!.x);
  expect(downBounds!.x).toBeGreaterThanOrEqual(inputBounds!.x + inputBounds!.width);
  await down.click();
  await expect(page.getByTestId("resume-autosave-status")).toHaveText("已保存");
  expect(await page.locator(".personal-contact-row").first().getAttribute("data-contact-id")).toBe("email");
  await visibility.click();
  await expect(visibility).not.toBeChecked();
  await expect(measurement.locator(".resume-candidate-photo")).toHaveCount(0);
  await expect(measurement.locator("address")).toHaveCSS("justify-content", "center");
  const centered = () => measurement.locator("header").evaluate(header => {
    const h = header.getBoundingClientRect();
    const contacts = Array.from(header.querySelectorAll("address > span:not(.resume-contact-break)"), node => node.getBoundingClientRect());
    const left = Math.min(...contacts.map(r => r.left)); const right = Math.max(...contacts.map(r => r.right));
    return { centerError: Math.abs((left + right - h.left - h.right) / 2), gap: contacts.length > 1 ? Math.abs(contacts[0].left - contacts[1].right) : 0, width: right - left, headerWidth: h.width };
  });
  const bounds = await centered(); expect(bounds.centerError).toBeLessThan(1); expect(bounds.width).toBeLessThan(bounds.headerWidth - 30);
  await page.screenshot({ path: resolve(dir, "after-no-photo.png") });
  await openManualPageTab(page);
  const settings = page.getByTestId("resume-layout-inspector");
  await settings.getByRole("button", { name: "左对齐", exact: true }).click();
  await expect(measurement.locator("address")).toHaveCSS("justify-content", "flex-start");
  await settings.getByRole("button", { name: "居中对齐", exact: true }).click();
  await expect(measurement.locator("address")).toHaveCSS("justify-content", "center");
  await settings.getByRole("tab", { name: "样式", exact: true }).click();
  await settings.getByRole("button", { name: /应用参考排版/ }).click();
  await expect(measurement).toHaveAttribute("data-precision-title", "underline");
  await expect(measurement.locator(".resume-template-section h2").first()).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(measurement.locator(".resume-template-section h2").first()).toHaveCSS("border-bottom-width", "1px");
  await expect(page.getByTestId("resume-autosave-status")).toHaveText("已保存");
  await page.reload();
  await expect(measurement.locator("address")).toHaveCSS("justify-content", "center");
  const response = page.waitForResponse(r => r.url().includes("/api/resume-export/pdf") && r.request().method() === "POST", { timeout: 120_000 });
  const download = page.waitForEvent("download", { timeout: 120_000 }); download.catch(() => {});
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  expect((await response).status()).toBe(200);
  const path = resolve(dir, "final-polish.pdf"); await (await download).saveAs(path);
  const text = execFileSync(PDFTOTEXT, [path, "-"], { encoding: "utf8" });
  for (const value of ["演示候选人", "13800000000", "candidate@example.com", "工作条目二", "项目四", "中文母语"]) expect(normalizeText(text)).toContain(normalizeText(value));
  execFileSync(PDFTOTEXT.replace("pdftotext", "pdftoppm"), ["-f", "1", "-singlefile", "-scale-to", "1400", "-png", path, resolve(dir, "final-polish-pdf")]);
});


test("interaction polish: honors width and grouping, deferred numbers, personal identity and reusable presets", async ({ page }) => {
  test.setTimeout(180_000);
  const dir = resolve("artifacts/editor-interaction-polish"); mkdirSync(dir, { recursive: true });
  await page.addInitScript(() => localStorage.setItem("careeradapt.theme", "light"));
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = canonicalFixture();
  const personal = { id: "political-test", label: "政治面貌", valueType: "string", value: "中共预备党员", sensitive: true, order: 0 };
  const customized = { ...fixture, basics: { ...fixture.basics, customFields: [personal] }, sections: fixture.sections.map(section => section.sectionType === "education" ? { ...section, items: section.items.map(item => ({ ...item, honors: ["匿名荣誉甲", "匿名荣誉乙", "匿名荣誉丙"] })) } : section) };
  await importCanonicalFixture(page, customized);
  const measure = page.getByTestId("resume-pagination-measurement-page");
  await expect(measure.locator("address")).toContainText("中共预备党员");
  const contactOrder = await measure.locator("address > span[data-contact-id]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-contact-id")));
  expect(contactOrder.indexOf("custom:political-test")).toBe(contactOrder.indexOf("email") + 1);
  const education = page.getByRole("button", { name: "教育经历", exact: true });
  if (await education.getAttribute("aria-expanded") !== "true") await education.click();
  const list = page.getByLabel("荣誉逐条编辑", { exact: true });
  await list.scrollIntoViewIfNeeded();
  const gap = await list.evaluate(node => { const parent = node.parentElement!.getBoundingClientRect(); const rect = node.getBoundingClientRect(); return parent.right - rect.right; });
  expect(gap).toBeLessThan(2);
  await expect(list.getByRole("textbox")).toHaveCount(3);
  await page.screenshot({ path: resolve(dir, "honors-wide.png") });
  await list.getByRole("button", { name: "合并为一段" }).click();
  await expect(list.getByRole("textbox")).toHaveCount(1);
  await expect(measure).toContainText("匿名荣誉甲；匿名荣誉乙；匿名荣誉丙");
  await page.reload();
  if (await education.getAttribute("aria-expanded") !== "true") await education.click();
  await expect(list.getByRole("textbox")).toHaveCount(1);
  await list.getByRole("button", { name: "拆分为多条" }).click();
  await expect(list.getByRole("textbox")).toHaveCount(3);
  await expect(measure.locator('[data-presentation-item="education"] .resume-presentation-highlights li')).toHaveCount(4);
  await openManualTypographyTab(page);
  const settings = page.getByTestId("resume-layout-inspector");
  const font = settings.getByLabel("全局字号", { exact: true });
  const before = await measure.getAttribute("style");
  await font.fill(""); await font.fill("1"); await expect(font).toHaveValue("1");
  expect(await measure.getAttribute("style")).toBe(before);
  await font.fill("15"); expect(await measure.getAttribute("style")).toBe(before); await font.press("Enter");
  await expect(measure).toHaveAttribute("style", /--resume-body-font-size: 15px/);
  await settings.getByLabel("行间距", { exact: true }).fill("1.56");
  await settings.getByRole("tab", { name: "模板", exact: true }).click();
  await settings.getByLabel("新排版预设名称").fill("我的测试排版"); await settings.getByRole("button", { name: "保存当前排版", exact: true }).click();
  await expect(settings.getByLabel("选择排版预设").locator("option").filter({ hasText: "我的测试排版" })).toHaveCount(1);
  await openManualTypographyTab(page); await font.fill("18"); await font.press("Enter");
  await expect(measure).toHaveAttribute("style", /--resume-body-font-size: 18px/);
  await settings.getByRole("tab", { name: "模板", exact: true }).click();
  await settings.getByRole("button", { name: "应用排版预设", exact: true }).click();
  await expect(measure).toHaveAttribute("style", /--resume-body-font-size: 15px/);
  await page.reload(); await openManualTemplateTab(page);
  const savedOption = settings.getByLabel("选择排版预设").locator("option").filter({ hasText: "我的测试排版" });
  await expect(savedOption).toHaveCount(1);
  await settings.getByLabel("选择排版预设").selectOption("reference"); await settings.getByRole("button", { name: "应用排版预设", exact: true }).click();
  await openManualTypographyTab(page); await expect(settings.getByLabel("行间距", { exact: true })).toHaveValue("1.56"); await expect(settings.getByLabel("姓名", { exact: true })).toHaveValue("1.55");
  await page.screenshot({ path: resolve(dir, "presets-applied.png") });
  const response = page.waitForResponse(r => r.url().includes("/api/resume-export/pdf") && r.request().method() === "POST", { timeout: 120_000 });
  const download = page.waitForEvent("download", { timeout: 120_000 }); download.catch(() => {});
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click(); expect((await response).status()).toBe(200);
  const pdfPath = resolve(dir, "interaction.pdf"); await (await download).saveAs(pdfPath);
  const text = execFileSync(PDFTOTEXT, [pdfPath, "-"], { encoding: "utf8" });
  for (const value of ["匿名荣誉甲", "匿名荣誉乙", "匿名荣誉丙", "中共预备党员", "工作条目二", "项目四"]) expect(normalizeText(text)).toContain(normalizeText(value));
});

test("animated drag crosses the halfway point before previewing order and persists only on drop", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = resolve("artifacts/editor-interaction-polish"); mkdirSync(dir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { const original = IDBObjectStore.prototype.put; (window as unknown as { presentationWrites: number }).presentationWrites = 0; IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) { if (this.name === "appMeta" && args[0]?.value?.schemaVersion === "resume-presentation-v1") (window as unknown as { presentationWrites: number }).presentationWrites++; return original.apply(this, args); }; });
  await importCanonicalFixture(page);
  await page.getByRole("button", { name: "收起全部", exact: true }).click();
  const nav = page.getByTestId("resume-section-nav");
  const rows = nav.locator(".sidebar-section-card[data-sort-id]");
  const visualOrder = () => rows.evaluateAll(nodes => [...nodes].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(node => node.getAttribute("data-sort-id")));
  const initial = await visualOrder();
  const source = rows.nth(0); const target = rows.nth(1);
  const from = await source.locator(".content-drag-handle").boundingBox(); const to = await target.boundingBox();
  const writes = await page.evaluate(() => (window as unknown as { presentationWrites: number }).presentationWrites);
  await page.mouse.move(from!.x + 8, from!.y + 8); await page.mouse.down();
  await page.mouse.move(to!.x + 20, to!.y + to!.height * 0.25, { steps: 10 });
  await expect(source).toHaveAttribute("data-sort-dragging", "true");
  expect(await visualOrder()).toEqual(initial);
  await page.mouse.move(to!.x + 20, to!.y + to!.height * 0.8, { steps: 6 });
  const moved = [initial[1], initial[0], ...initial.slice(2)];
  await expect.poll(visualOrder).toEqual(moved);
  expect(await page.evaluate(() => (window as unknown as { presentationWrites: number }).presentationWrites)).toBe(writes);
  await page.screenshot({ path: resolve(dir, "drag-halfway.png") });
  await page.mouse.up();
  await expect(nav.locator('[data-sort-dragging="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { presentationWrites: number }).presentationWrites)).toBe(writes + 1);
  await page.reload(); await expect.poll(visualOrder).toEqual(moved);
});
