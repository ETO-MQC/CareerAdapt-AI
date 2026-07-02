import path from "node:path";
import { expect, test } from "@playwright/test";

const chinesePdf = path.resolve("tests/fixtures/pdf/chinese-resume-edge.pdf");
const twoColumnPdf = path.resolve("tests/fixtures/pdf/two-column-edge.pdf");

test.describe("Stage E1 PDF import", () => {
  test("E1a extracts external-tool Chinese PDF and creates privacy-bound draft", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "职业母档案导入" })).toBeVisible();

    await page.getByRole("button", { name: "导入文本型 PDF" }).click();
    await page.locator("#resume-pdf-upload").setInputFiles(chinesePdf);

    await expect(page.locator(".notice")).toContainText("PDF 文本提取完成", { timeout: 20_000 });
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("陈同学");

    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();
    await expect(page.getByText("本次 AI 输入 hash")).toBeVisible();
    await page.reload();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("陈同学");

    const aiInput = page.locator("textarea").last();
    await aiInput.fill(`${await aiInput.inputValue()}\n用户补充：这是一段需要重新确认的文本。`);
    await expect(page.locator(".notice")).toContainText("重新保存草稿并完成隐私确认");

    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();
  });

  test("E1a warns for external-tool two-column PDF layout", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "导入文本型 PDF" }).click();
    await page.locator("#resume-pdf-upload").setInputFiles(twoColumnPdf);

    await expect(page.locator(".notice")).toContainText("PDF 文本提取完成", { timeout: 20_000 });
    await expect(page.locator(".warning-box")).toContainText("版面复杂");
  });

  test("E1b keeps PDF draft when an existing CareerProfile is present", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "导入文本型 PDF" }).click();
    await page.locator("#resume-pdf-upload").setInputFiles(chinesePdf);

    await expect(page.locator(".notice")).toContainText("PDF 文本提取完成", { timeout: 20_000 });
    await page.getByRole("button", { name: "使用提取文本创建草稿" }).click();
    await page.getByRole("button", { name: "拒绝，手动分类" }).click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();

    await page.getByRole("button", { name: "提交正式母档案" }).click();
    await expect(page.locator(".notice")).toContainText("已有正式 Profile");
    await expect(page.locator(".notice")).not.toContainText("已写入正式职业母档案");
  });
});
