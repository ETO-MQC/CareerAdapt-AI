import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readStore } from "../e2e/support/p51CoreWorkflow";
import { openManualPageTab } from "../e2e/support/g7b2Ui";

test("PDF failure preserves the saved revision and retry downloads a PDF", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  const resumes = page.getByRole("link", { name: "我的简历", exact: true });
  await expect(skip).toBeVisible({ timeout: 20_000 });
  await skip.click();
  await resumes.click();
  await page.getByRole("button", { name: /从个人资料库创建/ }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  const branches = await readStore(page, "resumeBranches");
  const branch = branches.find(row => row.branchPurpose === "general" && row.currentRevisionId);
  expect(branch).toBeTruthy();
  await page.route("**/api/resume-export/pdf", route => route.fulfill({ status: 500,
    contentType: "application/json", body: JSON.stringify({ code: "pdf_generation_failed" }) }));
  await openManualPageTab(page);
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "PDF 导出" })).toContainText("直接 PDF 生成失败");
  expect((await readStore(page, "resumeBranches")).find(row => row.id === branch?.id)).toEqual(branch);
  await page.unroute("**/api/resume-export/pdf");
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "重新尝试导出", exact: true }).click();
  const pdf = info.outputPath("pdf-retry.pdf");
  await (await download).saveAs(pdf);
  expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await readStore(page, "resumeBranches")).find(row => row.id === branch?.id)).toEqual(branch);
});
