import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readStore } from "../e2e/support/p51CoreWorkflow";
import { openManualPageTab } from "../e2e/support/g7b2Ui";

test("DeepSeek generates evidence-bound tailoring in the official job workspace", async ({ page }, info) => {
  test.setTimeout(180_000);
  const structuredTasks: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && request.url().includes("/api/ai/structured")) {
      const body = request.postDataJSON() as { task?: string };
      if (body.task) structuredTasks.push(body.task);
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
  await page.getByRole("link", { name: "我的简历", exact: true }).click();
  await page.getByRole("button", { name: /从个人资料库创建/ }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  const general = (await readStore(page, "resumeBranches")).find(row => row.branchPurpose === "general" && row.currentRevisionId)!;
  const job = (await readStore(page, "jobDescriptions")).find(row => String(row.title).includes("数据分析"))!;
  expect(general).toBeTruthy();
  expect(job).toBeTruthy();
  await page.goto(`/jobs?jobId=${encodeURIComponent(String(job.id))}`);
  await page.getByRole("radio", { name: /优化已有简历/ }).click();
  await page.getByLabel("来源通用简历").selectOption(String(general.id));
  await page.getByTestId("analyze-and-generate-job-resume").click();
  await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 25_000 });
  const branchId = new URL(page.url()).searchParams.get("branchId")!;
  const before = (await readStore(page, "resumeBranches")).find(row => row.id === branchId)!;
  const revisionsBefore = await readStore(page, "resumeRevisions");
  const panel = page.getByTestId("job-optimization-panel");
  await panel.getByRole("button", { name: "生成改写建议", exact: true }).click();
  const clarification = panel.getByLabel("你的回答");
  const no = panel.getByRole("button", { name: "没有", exact: true });
  const proceed = panel.getByRole("button", { name: "继续生成改写建议", exact: true });
  await expect.poll(async () => await clarification.isVisible() || await no.isVisible()
    || await panel.getByLabel("采用建议").first().isVisible(), { timeout: 60_000 }).toBe(true);
  if (await clarification.isVisible() || await no.isVisible()) {
    for (let index = 0; index < 8 && !(await proceed.isEnabled()); index++) {
      if (await clarification.isVisible()) await clarification.fill("没有");
      else await no.click();
      await panel.getByRole("button", { name: "提交回答", exact: true }).click();
    }
    await expect(proceed).toBeEnabled();
    await panel.getByRole("button", { name: "继续生成改写建议", exact: true }).click();
  }
  await expect(panel.getByLabel("采用建议").first()).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0, { timeout: 90_000 });
  expect(structuredTasks.filter(task => task === "resume-tailor-batch").length).toBeLessThanOrEqual(2);
  expect((await readStore(page, "resumeBranches")).find(row => row.id === branchId)).toEqual(before);
  expect(await readStore(page, "resumeRevisions")).toEqual(revisionsBefore);
  expect((await readStore(page, "resumeBranches")).find(row => row.id === general.id)).toEqual(general);
  const choices = panel.getByLabel("采用建议");
  for (let index = 0; index < await choices.count(); index++) {
    if (await choices.nth(index).isEnabled()) await choices.nth(index).uncheck();
  }
  const direct = panel.locator(".tailoring-suggestion-card").filter({ hasText: "可直接采用" }).first().getByLabel("采用建议");
  const excel = panel.locator(".tailoring-suggestion-card").filter({ hasText: "确认 Excel" }).first().getByLabel("采用建议");
  const choice = await direct.count() ? direct : excel;
  await expect(choice).toBeEnabled();
  await choice.check();
  await panel.getByRole("button", { name: "确认并应用", exact: true }).click();
  expect((await readStore(page, "resumeBranches")).find(row => row.id === branchId)).toEqual(before);
  const confirmation = panel.locator(".tailoring-confirmation-card");
  if (await confirmation.count()) {
    const editor = confirmation.getByLabel("编辑最终句");
    if (await editor.isVisible()) {
      await editor.fill("能使用 Excel 整理表格数据和基础分析结果。");
      await confirmation.getByRole("button", { name: "编辑后采用", exact: true }).click();
    } else {
      await confirmation.getByRole("button", { name: "熟悉基础", exact: true }).click();
    }
  }
  await panel.getByRole("button", { name: "应用选择并保存新版本", exact: true }).click();
  await expect.poll(async () => (await readStore(page, "resumeBranches")).find(row => row.id === branchId)?.revision, { timeout: 30_000 }).toBe(Number(before.revision) + 1);
  const after = (await readStore(page, "resumeBranches")).find(row => row.id === branchId)!;
  const revisionsAfter = await readStore(page, "resumeRevisions");
  expect(revisionsAfter).toHaveLength(revisionsBefore.length + 1);
  expect(revisionsAfter.find(row => row.id === before.currentRevisionId)).toEqual(revisionsBefore.find(row => row.id === before.currentRevisionId));
  expect(after.currentRevisionId).not.toBe(before.currentRevisionId);
  expect((await readStore(page, "resumeBranches")).find(row => row.id === general.id)).toEqual(general);
  await openManualPageTab(page);
  const request = page.waitForRequest(item => item.url().includes("/api/resume-export/pdf") && item.method() === "POST");
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ snapshot: { branchId, currentRevisionId: after.currentRevisionId } });
  const pdf = info.outputPath("deepseek-tailored.pdf");
  await (await download).saveAs(pdf);
  expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
  expect(execFileSync(binary, [pdf, "-"], { encoding: "utf8" })).toContain("Excel");
});
