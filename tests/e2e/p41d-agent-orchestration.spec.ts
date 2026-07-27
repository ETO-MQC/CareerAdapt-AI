import { expect, test } from "@playwright/test";

function sse(message: string) {
  return [
    "event: turn_ack",
    "data: {\"type\":\"turn_ack\"}",
    "",
    "event: assistant_start",
    "data: {\"type\":\"assistant_start\"}",
    "",
    `event: assistant_delta`,
    `data: ${JSON.stringify({ type: "assistant_delta", delta: message.slice(0, 4) })}`,
    "",
    `event: assistant_delta`,
    `data: ${JSON.stringify({ type: "assistant_delta", delta: message.slice(4) })}`,
    "",
    "event: done",
    `data: ${JSON.stringify({ type: "done", message })}`,
    "",
    ""
  ].join("\n");
}

test.describe("P4.1d agent orchestration and AI surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as { mode?: string; draft?: string };
      if (body.mode === "decision") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ stopReason: "final", text: "我已收到。请继续补充真实材料，我会按当前任务一步步和你核对。" }) });
        return;
      }
      await route.fulfill({ contentType: "text/event-stream", body: sse(body.draft ?? "我已收到。请继续补充真实材料，我会按当前任务一步步和你核对。") });
    });
  });

  test("streams assistant deltas into one message", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
        baseUrl: "https://example.test/v1",
        apiKey: "test-key",
        model: "test-model",
        provider: "openai-compatible"
      }));
    });
    let sawAiConfigHeader = false;
    await page.unroute("**/api/agent/stream");
    await page.route("**/api/agent/stream", async (route) => {
      sawAiConfigHeader = Boolean(route.request().headers()["x-ai-config"]);
      const body = route.request().postDataJSON() as { mode?: string; draft?: string };
      if (body.mode === "decision") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ stopReason: "final", text: "我已收到。请继续补充真实材料，我会按当前任务一步步和你核对。" }) });
        return;
      }
      await route.fulfill({ contentType: "text/event-stream", body: sse(body.draft ?? "我已收到。请继续补充真实材料，我会按当前任务一步步和你核对。") });
    });
    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("你好，请帮我整理项目经历");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.locator('[data-message-status="streaming"], [data-message-status="complete"]').last()).toBeVisible();
    await expect(page.getByText("我已收到。请继续补充真实材料")).toBeVisible();
    await expect(page.getByText(/provide action JSON|repair the action|planner issue|schema correction/i)).toHaveCount(0);
    expect(sawAiConfigHeader).toBe(true);
  });

  test("composer shortcuts open floating surfaces", async ({ page }) => {
    await page.goto("/ai-workspace");
    await page.getByRole("button", { name: "选择简历" }).click();
    await expect(page.getByRole("dialog", { name: "选择简历" })).toBeVisible();
    await page.getByRole("button", { name: "关闭" }).click();
    await page.getByRole("button", { name: "导入岗位" }).click();
    await expect(page.getByRole("dialog", { name: "导入岗位" })).toBeVisible();
    await expect(page.getByLabel("岗位名称")).toHaveAttribute("placeholder", "例如：高级产品经理");
    await expect(page.getByLabel("公司")).toHaveAttribute("placeholder", "例如：CareerAdapt AI");
    await expect(page.getByLabel("岗位描述")).toHaveAttribute("placeholder", "粘贴完整岗位描述，AI 会提取职责与要求…");
    await page.getByRole("button", { name: "关闭" }).click();
    await page.getByRole("button", { name: "工具" }).click();
    await expect(page.getByRole("dialog", { name: "可用工具" })).toBeVisible();
  });

  test("routes job ingestion and local cancellation without user cancel message", async ({ page }) => {
    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("我的资料库中的经历丰富吗");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("dialog", { name: "从资料库选择" })).toHaveCount(0);
    await page.getByLabel("描述你的求职任务").fill("我要录入岗位");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("dialog", { name: "导入岗位" })).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.locator(".agent-message-row.is-user").filter({ hasText: /^cancel$/i })).toHaveCount(0);
  });

  for (const path of ["/resume", "/profile", "/jobs", "/recycle"]) {
    test(`keeps ${path} usable at 1024 and 1440 without root horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.goto(path);
      await expect(page.locator(".ai-asset-content")).toBeVisible();
      expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
      await page.setViewportSize({ width: 1440, height: 900 });
      expect(await page.locator("html").evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
    });
  }

  test("keeps recycle filters in a compact 60px menu row", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/recycle");
    const filterRow = page.locator(".recycle-panel > .resume-filter-row");
    await expect(filterRow).toBeVisible();
    expect((await filterRow.boundingBox())?.height).toBeCloseTo(60, 0);
    const buttonHeights = await filterRow.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height)
    );
    expect(buttonHeights.every((height) => height <= 36)).toBe(true);
  });
});
