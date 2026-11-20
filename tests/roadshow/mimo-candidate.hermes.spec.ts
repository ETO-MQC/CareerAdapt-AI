import { expect, test } from "@playwright/test";
import { readStore } from "../e2e/support/p51CoreWorkflow";

test("real provider short candidate review from homepage", async ({ page }) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  await page.goto("/");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && Boolean((await response.json()).snapshot?.runReady);
  }, { timeout: 60_000 }).toBe(true);
  await page.locator(".career-context-trigger").click();
  const dialog = page.getByRole("dialog", { name: "人物与版本" });
  await dialog.getByRole("tab", { name: "新增人物" }).click();
  await dialog.getByLabel("人物名称").fill("匿名候选验收");
  await dialog.getByRole("button", { name: "创建人物" }).click();
  await dialog.getByRole("button", { name: /匿名候选验收/ }).first().click();
  await dialog.getByRole("button", { name: "使用此版本" }).click();
  await page.getByRole("button", { name: /从零整理我的经历/ }).click();
  await page.getByLabel("描述你的求职任务").fill("我最近在示例科技做了产品运营实习，时间是2026年7月至9月，主要负责用户反馈整理、竞品分析和产品功能优化。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const intake = page.getByRole("region", { name: "经历候选核对" });
  await expect(intake.getByRole("button", { name: "编辑后采用" })).toBeVisible({ timeout: 90_000 });
  await expect(intake).toContainText("示例科技");
  const profile = (await readStore(page, "profiles")).find(row => row.name === "匿名候选验收");
  expect(JSON.stringify(profile)).not.toContain("示例科技");
});

