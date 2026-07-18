import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { wenmoPairedJsonFixture } from "../fixtures/resume-import/wenmo-paired";

const realPdfPath = process.env.P36G1_WENMO_PDF;
const pdfPath = realPdfPath ?? resolve("tests/fixtures/pdf/chinese-resume-edge.pdf");
const jsonPayload = process.env.P36G1_WENMO_JSON
  ? readFileSync(process.env.P36G1_WENMO_JSON, "utf8")
  : JSON.stringify(wenmoPairedJsonFixture);

test.describe("P3.6g1 paired resume understanding", () => {
  test("external Wenmo JSON maps to canonical v2 and keeps abnormal phone for review", async ({ page }) => {
    const dialog = await openImport(page);
    await dialog.getByLabel("选择要导入的简历文件").setInputFiles({
      name: "wenmo-resume.json",
      mimeType: "application/json",
      buffer: Buffer.from(jsonPayload)
    });
    await expect(dialog.locator(".import-review-grid")).toBeVisible({ timeout: 60_000 });
    await expect(dialog.locator('input[name="import-basic-phone"]')).toHaveValue("138001380000");
    await expectCounts(dialog, { summary: 1, education: 1, internship: 2, project: 3, skills: 4, certificates: 0, experience: 0 });
    await expect(dialog.locator(".import-field-candidate-list")).toContainText("138001380000");
    await expect(dialog.locator(".import-field-candidate-list")).toContainText("待确认");
    await expect(dialog.locator(".import-structure-panel")).toContainText("示例大学");
    await expect(dialog.locator(".import-structure-panel")).toContainText("计算机相关专业");
    await expect(dialog.locator(".import-structure-panel")).toContainText("本科");
  });

  test("PDF layout graph separates Wenmo sections, project roles and bullet bodies", async ({ page }) => {
    const dialog = await openImport(page);
    await dialog.getByLabel("选择要导入的简历文件").setInputFiles(pdfPath);
    await expect(dialog.locator(".import-review-grid")).toBeVisible({ timeout: 60_000 });
    if (!realPdfPath) {
      await expect(dialog.locator("article.review-row").first()).toBeVisible();
      await expect(dialog.locator(".import-source-text")).not.toBeEmpty();
      return;
    }

    await expectCounts(dialog, { summary: 1, education: 1, internship: 2, project: 3, skills: 4, certificates: 0, experience: 0 });
    await expect(dialog.locator('input[name="import-basic-phone"]')).toHaveValue("138001380000");
    const fields = await structuredFields(dialog);
    expect(fields.education?.[0]).toEqual(expect.arrayContaining([
      { term: "学校", value: "示例大学" }, { term: "学历", value: "本科" }, { term: "专业", value: "计算机相关专业" }
    ]));
    expect(fields.project?.map((item) => item.find((field) => field.term === "标题")?.value)).toEqual([
      "示例任务系统 — AI驱动桌面任务与学习规划系统",
      "示例学习助手 — RAG学习助手复刻与增强",
      "示例内容分析系统"
    ]);
    expect(fields.project?.map((item) => item.find((field) => field.term === "角色")?.value)).toEqual(["全栈开发", "独立开发者", "独立开发"]);
    const bodyValues = await dialog.locator(".import-item-row textarea").evaluateAll((inputs) => inputs.map((input) => (input as HTMLTextAreaElement).value));
    expect(bodyValues.every((value) => !value.includes("•"))).toBe(true);
    await expect(dialog.locator(".import-trace-summary")).not.toContainText("0 项待处理");
  });
});

async function openImport(page: Page): Promise<Locator> {
  await page.goto("/resume");
  await page.getByTestId("resume-entry-import-primary").click();
  return page.getByRole("dialog", { name: "导入简历" });
}

async function expectCounts(dialog: Locator, expected: Record<string, number>) {
  const counts = await dialog.locator("article.review-row").evaluateAll((sections) => Object.fromEntries(
    ["summary", "education", "internship", "project", "skills", "certificates", "experience"].map((type) => [type, sections
      .filter((section) => (section.querySelector("select[name^='import-section-'][name$='-type']") as HTMLSelectElement | null)?.value === type)
      .reduce((sum, section) => sum + section.querySelectorAll(".import-item-row").length, 0)])
  ));
  expect(counts).toEqual(expected);
}

async function structuredFields(dialog: Locator) {
  const entries = await dialog.locator("article.review-row").evaluateAll((sections) => sections.map((section) => ({
    type: (section.querySelector("select[name^='import-section-'][name$='-type']") as HTMLSelectElement | null)?.value ?? "unknown",
    items: Array.from(section.querySelectorAll(".import-item-structured-fields")).map((fields) => Array.from(fields.querySelectorAll("div")).map((row) => ({
      term: row.querySelector("dt")?.textContent?.trim() ?? "",
      value: row.querySelector("dd")?.textContent?.trim() ?? ""
    })))
  })));
  return Object.fromEntries(entries.map((entry) => [entry.type, entry.items])) as Record<string, Array<Array<{ term: string; value: string }>>>;
}
