import { expect, test } from "@playwright/test";
import { AgentRuntime } from "../../src/agent/runtime/agentRuntime";
import { installHermesRuntimeFixture } from "./support/hermesRuntimeFixture";

test("UX012 persisted rate-limit recovery preserves input and requires an explicit new request", async ({ page }) => {
  const fixture = await installHermesRuntimeFixture(page);
  await page.goto("/ai-workspace");
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  // Wait for the first-run gate rather than reading its initial render state.
  await expect(skip).toBeVisible();
  await skip.click();
  await page.goto("/ai-workspace");
  await expect(skip).toBeHidden();
  await expect(page.getByRole("button", { name: "新任务", exact: true })).toBeVisible();
  const session = AgentRuntime.createConversationSession();
  const now = new Date().toISOString();
  const text = "请解释如何核对当前任务，保留这条原始输入。";
  session.activeTurn = { id: "ux012-failed-turn", sessionId: session.id, userMessageId: "ux012-user", status: "failed", startedAt: now,
    lastSafeErrorCode: "hermes_provider_http_error", runtimeFailureDiagnostics: { safeErrorCategory: "provider_rate_limit", httpStatus: 429 } };
  session.messages = [{ id: "ux012-user", turnId: session.activeTurn.id, role: "user", content: text, createdAt: now },
    { id: "ux012-failure", turnId: session.activeTurn.id, role: "assistant", kind: "text", status: "complete", content: "服务暂时不可用，原始输入已保留。", createdAt: now }];
  await page.evaluate(async value => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["agentSessions", "agentMessages"], "readwrite");
      transaction.objectStore("agentSessions").put({ ...value, messages: [] });
      value.messages.forEach((message, sequence) => transaction.objectStore("agentMessages").put({ ...message, sequence, sessionId: value.id }));
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
    database.close(); localStorage.setItem("careeradapt.agent.activeSessionId", value.id);
  }, session);
  await page.reload();
  const status = page.getByRole("status", { name: "业务进度" });
  await expect(status).toHaveAttribute("data-business-state", "failed");
  await expect(status).toContainText("不会自动重试或切换模型");
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  expect(fixture.runStarts).toHaveLength(0);
  await page.screenshot({ path: "docs/quality/ux-01.2-logs/recovery-before.png", fullPage: true });
  const composer = page.locator("textarea").last();
  await composer.fill(text);
  await composer.press("Enter");
  await expect.poll(() => fixture.runStarts.length).toBe(1);
  await expect(status).toHaveAttribute("data-business-state", "awaiting_input");
  await expect(status).toContainText("尚无业务完成回执");
  await page.screenshot({ path: "docs/quality/ux-01.2-logs/recovery-after.png", fullPage: true });
  await page.reload();
  await expect(status).toHaveAttribute("data-business-state", "awaiting_input");
  expect(fixture.runStarts).toHaveLength(1);
});
