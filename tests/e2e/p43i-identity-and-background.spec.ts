import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

test.describe("P4.3i identity and background execution", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/setup");
    await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("keeps the selected person/version consistent across Profile and AI", async ({ page }) => {
    await page.goto("/ai-workspace");
    await expect(page.locator(".career-context-trigger")).toBeVisible();

    await createPerson(page, "张三");
    await page.locator(".career-context-trigger").click();
    const firstManager = page.getByRole("dialog", { name: "人物与版本" });
    await firstManager.getByRole("button", { name: "新建版本", exact: true }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("张三 · V1");
    const firstPerson = firstManager.locator(".person-version-manager-person").filter({ hasText: /张三/ }).last();
    await firstPerson.getByRole("option", { name: /V1/ }).click();
    await expect(firstManager.getByRole("heading", { level: 3 })).toContainText("V1");
    await expect(page.locator(".career-context-trigger")).toContainText("张三 · V1");
    await firstPerson.getByRole("option", { name: /V2/ }).click();
    await firstManager.getByRole("button", { name: "使用此版本", exact: true }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("张三 · V2");
    await page.locator(".career-context-trigger").click();
    const secondManager = page.getByRole("dialog", { name: "人物与版本" });
    await secondManager.getByRole("tab", { name: "新增人物" }).click();
    await secondManager.getByLabel("人物名称").fill("张三");
    await secondManager.getByRole("button", { name: "创建人物", exact: true }).click();
    const sameNamePersons = secondManager.locator(".person-version-manager-person").filter({ hasText: /张三 · 人物/ });
    await expect(sameNamePersons).toHaveCount(2);
    await expect(sameNamePersons.nth(0).getByRole("option", { name: /V1/ })).toContainText("条经历");
    await expect(sameNamePersons.nth(0).getByRole("option", { name: /V2/ })).toContainText("条经历");
    await expect(sameNamePersons.nth(1).getByRole("option", { name: /V1/ })).toContainText("条经历");
    await sameNamePersons.nth(0).getByRole("option", { name: /V1/ }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("张三 · V2");
    await secondManager.getByRole("button", { name: "使用此版本", exact: true }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("张三 · V1");

    await page.goto("/profile");
    await expect(page.locator(".career-context-entry-bar")).toContainText("张三");
    await expect(page.locator(".career-context-entry-bar")).toContainText("V1");
    await page.getByRole("button", { name: "管理人物与版本" }).click();
    await expect(page.getByRole("dialog", { name: "人物与版本" })).toBeVisible();
    await page.getByRole("button", { name: "关闭人物与版本选择器" }).click();
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
    const createManager = page.getByRole("dialog", { name: "人物与版本" });
    await createManager.getByRole("tab", { name: "新增人物" }).click();
    await createManager.getByLabel("人物名称").fill("人物B");
    await createManager.getByRole("button", { name: "创建人物", exact: true }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("人物A · V1");
    await page.getByRole("button", { name: "关闭人物与版本选择器" }).click();

    await page.locator(".career-context-trigger").click();
    const manager = page.getByRole("dialog", { name: "人物与版本" });
    await manager.locator(".person-version-manager-person").filter({ hasText: "人物A" }).getByRole("option", { name: /V1/ }).click();
    await expect(page.locator(".career-context-trigger")).toContainText("人物A · V1");
    await manager.getByRole("button", { name: "关闭人物与版本选择器" }).click();

    await page.getByRole("button", { name: "新任务" }).click();
    await expect(page.getByRole("heading", { name: "今天想从哪一步开始？" })).toBeVisible();
    await page.getByLabel("描述你的求职任务").fill("A后台任务");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("A后台任务")).toBeVisible();
    await expect(page.locator('[data-message-status="thinking"], [data-message-status="streaming"]').first()).toBeVisible();

    await page.locator(".career-context-trigger").click();
    const runningManager = page.getByRole("dialog", { name: "人物与版本" });
    await runningManager.locator(".person-version-manager-person").filter({ hasText: "人物B" }).getByRole("option", { name: /V1/ }).click();
    await runningManager.getByRole("button", { name: "使用此版本", exact: true }).click();
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

    const file = page.locator(".agent-composer input[type='file']");
    await file.setInputFiles(resolve(process.cwd(), "tests/fixtures/resume-import/ordinary.docx"));
    const consent = page.getByTestId("agent-import-ai-consent");
    await expect(consent).toHaveCount(0);
    await expect(page.getByText("待发送")).toBeVisible();
    await page.getByLabel("描述你的求职任务").fill("这是我的技术简历，请合并到当前人物。");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByLabel("描述你的求职任务")).toHaveValue("");
    const sentUserMessage = page.locator(".agent-message-row.is-user").filter({ hasText: "这是我的技术简历，请合并到当前人物。" });
    await expect(sentUserMessage).toHaveCount(1);
    await expect(sentUserMessage).toContainText("ordinary.docx");
    await expect(consent).toBeVisible();
    await consent.getByRole("button", { name: "仅本地解析", exact: true }).click();
    await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("准备导入到");
    await expect(page.getByRole("button", { name: /合并到当前 V1/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "产物 1", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /合并到当前 V1/ }).click();
    await expect(page.locator(".agent-message-row.is-assistant").filter({ hasText: "已更新导入目标" })).toBeVisible();
    await expect(page.getByText("开始将简历导入到直传人物 · V1")).toHaveCount(0);
    await expect(sentUserMessage).toHaveCount(1);
    await expect(page.getByRole("button", { name: /合并到当前 V1/ })).toHaveCount(0);
  });
});

async function createPerson(page: Page, name: string) {
  await page.locator(".career-context-trigger").click();
  const manager = page.getByRole("dialog", { name: "人物与版本" });
  await manager.getByRole("tab", { name: "新增人物" }).click();
  await manager.getByLabel("人物名称").fill(name);
  await manager.getByRole("button", { name: "创建人物", exact: true }).click();
  const person = manager.locator(".person-version-manager-person").filter({ hasText: name }).last();
  await expect(person).toBeVisible();
  await person.getByRole("option", { name: /V1/ }).click();
  await manager.getByRole("button", { name: "使用此版本", exact: true }).click();
  await expect(page.locator(".career-context-trigger")).toContainText(`${name} · V1`);
}
