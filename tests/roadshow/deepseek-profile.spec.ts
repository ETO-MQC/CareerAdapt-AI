import { expect, test } from "@playwright/test";
import { readStore } from "../e2e/support/p51CoreWorkflow";

test("DeepSeek homepage intake confirms a Profile and rereads it in a new session", async ({ page }) => {
  test.setTimeout(210_000);
  page.setDefaultTimeout(15_000);
  const receipts: string[] = [];
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
    const body = request.postDataJSON() as { action?: string; result?: { ok?: boolean; receipt?: { toolName?: string } } };
    if (body.action === "result" && body.result?.ok && body.result.receipt?.toolName) receipts.push(body.result.receipt.toolName);
  });
  await page.goto("/");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/runtime/hermes/control");
    return response.ok() && Boolean((await response.json()).snapshot?.runReady);
  }, { timeout: 60_000 }).toBe(true);
  const health = await (await page.request.get("/api/agent/runtime/hermes/health")).json();
  expect(JSON.stringify(health)).toContain("deepseek-flash");
  await page.locator(".career-context-trigger").click();
  const dialog = page.getByRole("dialog", { name: "人物与版本" });
  await dialog.getByRole("tab", { name: "新增人物" }).click();
  await dialog.getByLabel("人物名称").fill("深度验收人物");
  await dialog.getByRole("button", { name: "创建人物" }).click();
  await dialog.getByRole("button", { name: /深度验收人物/ }).first().click();
  await dialog.getByRole("button", { name: "使用此版本" }).click();
  await page.getByRole("button", { name: /从零整理我的经历/ }).click();
  const send = async (text: string) => {
    await page.getByLabel("描述你的求职任务").fill(text);
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
  };
  await send("我最近在示例科技做了产品运营实习，时间是2026年7月至9月，主要负责用户反馈整理、竞品分析和产品功能优化。");
  const intake = page.getByRole("region", { name: "经历候选核对" });
  await expect(intake.getByRole("button", { name: "编辑后采用" })).toBeVisible({ timeout: 60_000 });
  const profileBefore = (await readStore(page, "profiles")).find(row => row.name === "深度验收人物");
  expect(JSON.stringify(profileBefore)).not.toContain("示例科技");
  await expect.poll(async () => {
    const sessionId = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === sessionId);
    return (session?.hermesRun as { status?: string } | undefined)?.status;
  }, { timeout: 60_000 }).toBe("completed");
  await intake.getByRole("button", { name: "编辑后采用" }).click();
  await intake.getByLabel("角色", { exact: true }).fill("产品运营实习生");
  await intake.getByRole("button", { name: "保存并采用", exact: true }).click();
  await send("完成整理");
  const review = page.getByRole("region", { name: "最终资料草稿审核" });
  await expect(review).toBeVisible({ timeout: 45_000 });
  await review.getByRole("button", { name: "全部采用" }).click();
  await review.getByRole("button", { name: "确认并写入个人资料库" }).click();
  await expect.poll(async () => {
    const person = (await readStore(page, "profiles")).find(row => row.id === profileBefore?.id);
    return JSON.stringify(person).includes("示例科技");
  }, { timeout: 30_000 }).toBe(true);
  const priorSession = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"))).not.toBe(priorSession);
  receipts.length = 0;
  await send("请读取当前人物已经确认的个人资料，概括其中的实习经历；没有证据的内容请不要编造。");
  await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("示例科技", { timeout: 60_000 });
  await expect.poll(() => receipts.some(name => ["career.profile.get", "career.context.retrieve"].includes(name)), { timeout: 15_000 }).toBe(true);
});
