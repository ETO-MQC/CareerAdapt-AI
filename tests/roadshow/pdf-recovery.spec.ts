import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readStore } from "../e2e/support/p51CoreWorkflow";
import { openManualPageTab } from "../e2e/support/g7b2Ui";

test("homepage-created resume survives PDF failure and retry", async ({ page }, info) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const providerUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL || process.env.HERMES_INTEGRATION_REAL_PROVIDER_URL;
  if (!providerUrl) throw new Error("hermes_provider_required");
  const model = process.env.HERMES_INTEGRATION_REAL_PROVIDER_MODEL || "careeradapt-test";
  await page.addInitScript(({ baseUrl, model }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
    baseUrl, model, provider: "openai-compatible", apiKeyConfigured: true
  })), { baseUrl: providerUrl, model });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  await expect(skip.or(page.locator(".career-context-trigger"))).toBeVisible({ timeout: 15_000 });
  if (await skip.isVisible()) await skip.click();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && Boolean((await response.json()).snapshot?.runReady);
  }, { timeout: 60_000 }).toBe(true);
  await page.locator(".career-context-trigger").click();
  const dialog = page.getByRole("dialog", { name: "人物与版本" });
  await dialog.getByRole("tab", { name: "新增人物" }).click();
  await dialog.getByLabel("人物名称").fill("路演验收人物");
  await dialog.getByRole("button", { name: "创建人物" }).click();
  await dialog.getByRole("button", { name: /路演验收人物/ }).first().click();
  await dialog.getByRole("button", { name: "使用此版本" }).click();
  const start = page.getByRole("button", { name: /从零整理我的经历/ });
  await expect(start).toBeEnabled();
  await start.click();
  await page.getByLabel("描述你的求职任务").fill("我最近在示例科技做了产品运营实习，时间是2026年7月至9月，主要负责用户反馈整理、竞品分析和产品功能优化。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const intake = page.getByRole("region", { name: "经历候选核对" });
  await expect(intake.getByRole("button", { name: "编辑后采用" })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => {
    const sessionId = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === sessionId);
    return (session?.hermesRun as { status?: string } | undefined)?.status;
  }, { timeout: 60_000 }).toBe("completed");
  await intake.getByRole("button", { name: "编辑后采用" }).click();
  await intake.getByLabel("角色", { exact: true }).fill("产品运营实习生");
  await intake.getByRole("button", { name: "保存并采用", exact: true }).click();
  await page.getByLabel("描述你的求职任务").fill("完成整理");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const review = page.getByRole("region", { name: "最终资料草稿审核" });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await review.getByRole("button", { name: "全部采用" }).click();
  await review.getByRole("button", { name: "确认并写入个人资料库" }).click();
  await expect.poll(async () => {
    const sessionId = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === sessionId);
    return (session?.taskState as { knownSlots?: { profileIntakeCommitOutcome?: { status?: string } } })?.knownSlots?.profileIntakeCommitOutcome?.status;
  }, { timeout: 30_000 }).toBe("COMMITTED_VERIFIED");
  const profiles = await readStore(page, "profiles");
  const profile = profiles.find(row => row.name === "路演验收人物");
  expect(profile).toBeTruthy();
  await page.getByRole("link", { name: "个人资料库", exact: true }).click();
  await expect(page.getByText("示例科技").first()).toBeVisible();
  await page.getByRole("link", { name: "我的简历", exact: true }).click();
  await page.getByRole("button", { name: /从个人资料库创建/ }).click();
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  const preview = page.getByTestId("resume-a4-page").first();
  await expect(preview).toContainText("示例科技");
  await expect(preview).not.toContainText(/operationId|workflow|diagnostic/iu);
  const branches = await readStore(page, "resumeBranches");
  expect(branches.some(row => row.profileId === profile?.id && row.branchPurpose === "general" && row.currentRevisionId)).toBe(true);
  expect(await readStore(page, "profiles")).toEqual(profiles);
  const branch = branches.find(row => row.profileId === profile?.id && row.branchPurpose === "general" && row.currentRevisionId)!;
  await page.route("**/api/resume-export/pdf", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "pdf_generation_failed" }) }));
  await openManualPageTab(page);
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "PDF 导出" })).toContainText("直接 PDF 生成失败");
  expect((await readStore(page, "resumeBranches")).find(row => row.id === branch.id)).toEqual(branch);
  await page.unroute("**/api/resume-export/pdf");
  const downloaded = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  const pdf = info.outputPath("pdf-retry.pdf");
  await (await downloaded).saveAs(pdf);
  expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await readStore(page, "resumeBranches")).find(row => row.id === branch.id)).toEqual(branch);

});

