import path from "node:path";
import { expect, test } from "@playwright/test";

const chinesePdf = path.resolve("tests/fixtures/pdf/chinese-resume-edge.pdf");
const twoColumnPdf = path.resolve("tests/fixtures/pdf/two-column-edge.pdf");

test.describe("Stage E1 PDF import", () => {
  test("E1a extracts external-tool Chinese PDF and creates privacy-bound draft", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.locator(".profile-workspace")).toBeVisible();

    await page.getByTestId("profile-import-pdf-mode").click();
    await page.locator("#resume-pdf-upload").setInputFiles(chinesePdf);

    await expect(page.getByTestId("profile-start-pdf-draft")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("陈同学");

    await page.getByTestId("profile-start-pdf-draft").click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();
    await expect(page.getByText("本次识别文本指纹")).toBeVisible();
    await page.reload();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();
    await expect(page.locator(".timeline article").filter({ hasText: "第 1 页" })).toContainText("陈同学");

    const aiInput = page.locator("textarea").last();
    await aiInput.fill(`${await aiInput.inputValue()}\n用户补充：这是一段需要重新确认的文本。`);
    await expect(page.locator(".notice")).toContainText("重新保存草稿并完成隐私确认");

    await page.getByTestId("profile-start-pdf-draft").click();
    await expect(page.getByText("外部模型与隐私说明")).toBeVisible();
  });

  test("E1a warns for external-tool two-column PDF layout", async ({ page }) => {
    await page.goto("/profile");
    await page.getByTestId("profile-import-pdf-mode").click();
    await page.locator("#resume-pdf-upload").setInputFiles(twoColumnPdf);

    await expect(page.getByTestId("profile-start-pdf-draft")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".warning-box")).toContainText("版面复杂");
  });

  test("E1b keeps PDF draft when an existing CareerProfile is present", async ({ page }) => {
    await page.goto("/profile");
    await page.getByTestId("profile-import-pdf-mode").click();
    await page.locator("#resume-pdf-upload").setInputFiles(chinesePdf);

    await expect(page.getByTestId("profile-start-pdf-draft")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("profile-start-pdf-draft").click();
    await page.getByTestId("profile-manual-mode").click();
    await expect(page.getByText("解析草稿与原文依据")).toBeVisible();

    await page.getByTestId("commit-profile").click();
    await expect(page.locator(".notice")).toContainText("已有个人资料");
    await expect(page.locator(".notice")).not.toContainText("已写入个人资料");
  });
});
