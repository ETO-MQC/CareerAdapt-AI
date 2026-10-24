import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { referenceCampusResume } from "../fixtures/resume-v2/referenceCampus";
import { openManualTemplateTab, openManualPageTab } from "./support/g7b2Ui";

test.use({ actionTimeout: 10_000 });

test("imports full fields, edits training and rank, switches template and exports a readable PDF", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "offline-fixture", apiKeyConfigured: true })));
  await page.goto("/resume");
  await page.getByRole("button", { name: "导入简历", exact: true }).click();
  await page.getByLabel("选择要导入的简历文件").setInputFiles({ name: "anonymous-campus.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(referenceCampusResume())) });
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeVisible();
  await page.getByLabel("创建新人物").check();
  await page.locator('input[name="new-profile-name"]').fill("林同学");
  const structure = page.getByRole("button", { name: "确认全部当前结构", exact: true });
  if (await structure.isVisible()) await structure.click();
  const sources = page.getByRole("button", { name: "核对并保留来源", exact: true });
  while (await sources.count()) await sources.first().click();
  await expect(page.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  const paper = page.locator(".resume-preview-stage").getByTestId("resume-a4-page").first();
  await expect(paper).toContainText("培训经历");
  const emptyTitleDate = await paper.locator('[data-render-section="training"]').evaluate(node => ({
    dateRight: node.querySelector("time")!.getBoundingClientRect().right,
    sectionRight: node.getBoundingClientRect().right
  }));
  expect(Math.abs(emptyTitleDate.dateRight - emptyTitleDate.sectionRight)).toBeLessThan(4);
  mkdirSync(resolve("artifacts"), { recursive: true });
  await page.screenshot({ path: "artifacts/reference-campus-before-1440.png" });

  await page.getByRole("complementary", { name: "简历栏目导航" }).getByRole("button", { name: /培训\s*经历/ }).click();
  await expect(page.getByRole("textbox", { name: "培训机构", exact: true })).toHaveValue("示例培训机构");
  await expect(page.getByRole("textbox", { name: "开始日期", exact: true })).toHaveValue("2026-07-01");
  await page.getByRole("textbox", { name: "培训项目", exact: true }).fill("数据库实操训练（已核对）");
  await page.locator(".canonical-item-fields").getByRole("button", { name: "保存", exact: true }).click();
  const confirmOnly = page.getByRole("button", { name: "仅保存到简历", exact: true });
  if (await confirmOnly.isVisible()) await confirmOnly.click();
  await expect(paper).toContainText("数据库实操训练（已核对）");
  await page.getByRole("complementary", { name: "简历栏目导航" }).getByRole("button", { name: /教育\s*经历/ }).click();
  await expect(page.getByRole("spinbutton", { name: "排名前百分比（%）", exact: true })).toHaveValue("15");
  await page.getByRole("spinbutton", { name: "排名前百分比（%）", exact: true }).fill("14");
  const honors = page.getByRole("textbox", { name: "荣誉", exact: true });
  await honors.press("Control+End");
  await honors.press("Enter");
  await honors.pressSequentially("匿名新增荣誉");
  await expect(honors).toHaveValue(/\n匿名新增荣誉$/u);
  await page.locator(".experience-item-fields").getByRole("button", { name: "保存", exact: true }).click();
  if (await confirmOnly.isVisible()) await confirmOnly.click();
  await expect(paper).toContainText("前 14%");
  await page.reload();
  await expect(paper).toContainText("前 14%");
  await expect(paper).toContainText("数据库实操训练（已核对）");

  await openManualTemplateTab(page);
  await page.getByLabel("模板", { exact: true }).selectOption("campus-reference");
  await expect(paper).toHaveClass(/template-campus-reference/);
  await expect(paper).toContainText("技能与证书");
  await expect(paper).toContainText("Excel");
  await expect(paper).toContainText("CET6");
  await expect(paper.locator('[data-presentation-item="skills"]')).toHaveCount(3);
  await expect(paper.locator('[data-presentation-item="skills"]').filter({ hasText: "Python" })).not.toContainText("熟练");
  const skillWidthRatio = await paper.evaluate(node => node.querySelector(".resume-skill-values")!.getBoundingClientRect().width / node.getBoundingClientRect().width);
  expect(skillWidthRatio).toBeGreaterThan(.6);
  await expect(paper.locator('[data-render-section="campus"] h3').filter({ hasText: "班长" })).toHaveCount(1);
  await expect(paper.locator('[data-render-section="campus"] strong').filter({ hasText: "班长" })).toHaveCount(0);
  await expect(paper.locator('[data-render-section="internship"] .resume-presentation-heading')).toContainText("信息管理科");
  await page.screenshot({ path: "artifacts/reference-campus-after-1440.png" });
  for (const width of [1920, 1366, 1280, 1024]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 800 });
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await expect(paper).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const geometry = await paper.evaluate(node => {
      const sheet = node.getBoundingClientRect(); const stage = node.closest(".resume-preview-stage")!.getBoundingClientRect();
      return { left: sheet.left - stage.left, right: stage.right - sheet.right };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(-1); expect(geometry.right).toBeGreaterThanOrEqual(-1);
    await page.screenshot({ path: `artifacts/reference-campus-after-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await openManualPageTab(page);
  await page.getByLabel("部门位置", { exact: true }).selectOption("stacked");
  await expect(paper.locator('[data-render-section="internship"] .resume-presentation-secondary')).toContainText("信息管理科");
  await page.getByLabel("部门位置", { exact: true }).selectOption("inline");
  await expect(paper.locator('[data-render-section="internship"] .resume-presentation-heading')).toContainText("信息管理科");
  await openManualPageTab(page);
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const file = await download;
  const output = resolve("artifacts/reference-campus-verified.pdf");
  await file.saveAs(output);
  const text = execFileSync("E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", [output, "-"], { encoding: "utf8" }).replace(/\s+/gu, "");
  for (const value of ["培训经历", "示例培训机构", "数据库实操训练（已核对）", "2026.07.01", "2026.09.01", "前14%", "Excel", "CET6", "信息管理科", "Pandas数据清洗", "3.6", "匿名新增荣誉"]) expect(text).toContain(value);
  expect(text).not.toContain("兼容预览");
});
