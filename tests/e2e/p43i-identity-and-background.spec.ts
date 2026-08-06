import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

test.describe("P4.3i identity and background execution", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
    if (await skipSetup.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
      await skipSetup.click();
      await page.waitForURL(/\/$/);
    }
  });

  test("keeps the selected person/version consistent across Profile and AI", async ({ page }) => {
    await page.goto("/ai-workspace");
    await expect(page.locator(".career-context-trigger")).toBeVisible();

    await createPerson(page, "张三");
    await page.locator(".career-context-trigger").click();
    await page.getByRole("button", { name: "基于当前新建版本" }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("张三 · V2");
    await page.getByRole("button", { name: "关闭人物与版本选择器" }).click();
    await page.locator(".career-context-trigger").click();
    await page.getByRole("button", { name: "新建人物" }).click();
    await page.getByLabel("人物名称").fill("张三");
    await page.getByRole("button", { name: "创建并使用" }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("张三 · V1");
    await page.getByRole("button", { name: "关闭人物与版本选择器" }).click();

    await page.locator(".career-context-trigger").click();
    const sameNamePersons = page.locator(".career-context-person").filter({
      has: page.getByRole("heading", { name: "张三", exact: true })
    });
    await expect(sameNamePersons).toHaveCount(2);
    await expect(sameNamePersons.nth(0).getByRole("button", { name: /V1/ })).toContainText("项资料");
    await expect(sameNamePersons.nth(0).getByRole("button", { name: /V2/ })).toContainText("项资料");
    await expect(sameNamePersons.nth(1).getByRole("button", { name: /V1/ })).toContainText("项资料");
    await sameNamePersons.nth(0).getByRole("button", { name: /V1/ }).click();

    await page.goto("/profile");
    await expect(page.locator(".career-context-trigger")).toContainText("张三 · V1");
    await page.getByRole("link", { name: "返回任务" }).click();
    await expect(page).toHaveURL(/\/ai-workspace$/);
    await expect(page.locator(".career-context-trigger")).toContainText("张三 · V1");
  });

  test("keeps Task A pinned while Task B runs and A completes in background", async ({ page }) => {
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as { messages?: Array<{ role: string; content: string }> };
      const prompt = [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";
      const isTaskA = prompt.includes("A后台任务");
      await new Promise((resolve) => setTimeout(resolve, isTaskA ? 1_800 : 150));
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          "event: model_text_delta",
          `data: ${JSON.stringify({ type: "model_text_delta", delta: isTaskA ? "A任务已完成。" : "B任务已完成。" })}`,
          "",
          "event: model_finish",
          "data: {\"type\":\"model_finish\",\"stopReason\":\"final\"}",
          "",
          ""
        ].join("\n")
      });
    });

    await page.goto("/ai-workspace");
    await createPerson(page, "人物A");
    await page.locator(".career-context-trigger").click();
    await page.getByRole("button", { name: "新建人物" }).click();
    await page.getByLabel("人物名称").fill("人物B");
    await page.getByRole("button", { name: "创建并使用" }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("人物B · V1");
    await page.getByRole("button", { name: "关闭人物与版本选择器" }).click();

    await page.locator(".career-context-trigger").click();
    await page.locator(".career-context-person").filter({ hasText: "人物A" }).getByRole("button", { name: /V1/ }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("人物A · V1");

    await page.getByRole("button", { name: "新任务" }).click();
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();
    await page.getByLabel("描述你的求职任务").fill("A后台任务");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("A后台任务")).toBeVisible();
    await expect(page.locator('[data-message-status="thinking"], [data-message-status="streaming"]').first()).toBeVisible();

    await page.locator(".career-context-trigger").click();
    await page.locator(".career-context-person").filter({ hasText: "人物B" }).getByRole("button", { name: /V1/ }).click();
    await expect(page.getByRole("dialog", { name: "当前任务已固定人物与版本" })).toBeVisible();
    await page.getByRole("button", { name: "新建任务使用此人物" }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("人物B · V1");
    await expect(page.locator(".agent-pinned-context")).toContainText("人物B · V1");
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();

    await page.getByLabel("描述你的求职任务").fill("B前台任务");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("B任务已完成。")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".notification-viewport")).toContainText("后台任务已完成", { timeout: 20_000 });

    await page.getByRole("button", { name: "打开历史记录" }).click();
    const history = page.getByRole("dialog", { name: "历史记录" });
    await expect(history).toBeVisible();
    await history.getByLabel("搜索历史记录").fill("A后台任务");
    await history.locator(".agent-history-list > button").first().click();
    await expect(page.locator(".agent-pinned-context")).toContainText("人物A · V1");
    await expect(page.getByText("A任务已完成。")).toBeVisible();
    await expect(page.getByText("任务已中断，可重试")).toHaveCount(0);
  });

  test("resolves the target before extracting a directly uploaded resume", async ({ page }) => {
    await page.goto("/ai-workspace");
    await createPerson(page, "直传人物");
    await page.evaluate(() => localStorage.setItem("careeradapt.resumeImportAiPreference", "local"));

    const file = page.locator(".agent-composer input[type='file']");
    await file.setInputFiles(resolve(process.cwd(), "tests/fixtures/resume-import/ordinary.docx"));
    const consent = page.getByTestId("agent-import-ai-consent");
    await expect(consent).toBeVisible();
    await consent.getByRole("button", { name: "仅本地解析", exact: true }).click();
    await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("准备导入到");
    await expect(page.getByRole("button", { name: /合并到当前 V1/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "产物 1", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /合并到当前 V1/ }).click();
    await expect(page.locator(".agent-message-row.is-assistant").filter({ hasText: "已更新导入目标" })).toBeVisible();
    await expect(page.getByText("开始将简历导入到直传人物 · V1")).toBeVisible();
    await expect(page.getByRole("button", { name: /合并到当前 V1/ })).toHaveCount(0);
  });
});

async function createPerson(page: Page, name: string) {
  await page.locator(".career-context-trigger").click();
  await page.getByRole("button", { name: "新建人物" }).click();
  await page.getByLabel("人物名称").fill(name);
  await page.getByRole("button", { name: "创建并使用" }).click();
  await expect(page.locator(".career-context-trigger")).toContainText(`${name} · V1`);
  await page.getByRole("button", { name: "关闭人物与版本选择器" }).click();
}
