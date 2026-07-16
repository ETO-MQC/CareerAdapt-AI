import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const realPdfPath = process.env.P36E_REAL_PDF;
const pdfPath = realPdfPath ?? resolve("tests/fixtures/pdf/chinese-resume-edge.pdf");
const expectedRealBasics = {
  name: process.env.P36E_EXPECTED_NAME,
  location: process.env.P36E_EXPECTED_LOCATION,
  phone: process.env.P36E_EXPECTED_PHONE,
  email: process.env.P36E_EXPECTED_EMAIL
};

test("uploads a PDF through the real resume import entry and binds fields to items", async ({ page }) => {
  await page.goto("/resume");
  await page.getByTestId("resume-entry-import-primary").click();
  const dialog = page.getByRole("dialog", { name: "导入简历" });
  await dialog.getByLabel("选择要导入的简历文件").setInputFiles(pdfPath);
  await expect(dialog.locator(".import-review-grid")).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByRole("button", { name: "确认导入" })).toBeVisible();

  if (!realPdfPath) {
    await expect(dialog.locator(".import-source-text")).not.toBeEmpty();
    await expect(dialog.locator(".import-structure-panel .review-row").first()).toBeVisible();
    return;
  }

  for (const [key, value] of Object.entries(expectedRealBasics)) {
    expect(value, `P36E_EXPECTED_${key.toUpperCase()} is required with P36E_REAL_PDF`).toBeTruthy();
    await expect(dialog.locator(`input[name="import-basic-${key}"]`)).toHaveValue(value!);
  }
  await expect(dialog.locator(".import-trace-summary")).toContainText("0 个未识别来源");

  const counts: Array<[string, number]> = [
    ["教育经历", 1],
    ["工作与实习经历", 2],
    ["项目成果", 4],
    ["奖项", 2],
    ["技能", 6],
    ["语言", 1]
  ];
  for (const [title, count] of counts) {
    const section = dialog.getByLabel(title, { exact: true }).locator("xpath=ancestor::article");
    await expect(section).toBeVisible();
    await expect(section.locator(".import-item-row")).toHaveCount(count);
  }

  const dateCandidates = dialog.locator(".import-field-candidate").filter({ hasText: /开始日期|结束日期|进行中|至今/ });
  await expect(dateCandidates).toHaveCount(14);
  for (let index = 0; index < await dateCandidates.count(); index += 1) {
    await expect(dateCandidates.nth(index).locator(".import-field-candidate-source > small").first()).not.toHaveText("待确认条目");
  }
  await expect(dialog.locator(".import-field-candidate-list")).toContainText("2028-06");
  await expect(dialog.locator(".import-field-candidate-list")).not.toContainText("2028-06-27");
  await expect(dialog.locator(".import-field-candidate-list")).not.toContainText("2024-09-01");

  const sectionTitles = await dialog.locator("article.review-row .section-heading label").allTextContents();
  expect(sectionTitles.map((title) => title.trim())).not.toContain("经历");
  await expect(dialog.locator(".import-unclassified-blocks")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "确认导入" })).toBeDisabled();
});
