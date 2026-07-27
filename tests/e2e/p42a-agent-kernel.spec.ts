import { expect, test } from "@playwright/test";

function modelFinal(message: string) {
  return `event: model_text_delta\ndata: ${JSON.stringify({ type: "model_text_delta", delta: message })}\n\nevent: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "final" })}\n\n`;
}

function modelTool(id: string, name: string, args: Record<string, unknown>) {
  const call = { id, name, arguments: args };
  return `event: model_tool_call_start\ndata: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id, name })}\n\nevent: model_tool_call_complete\ndata: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}\n\nevent: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}\n\n`;
}

test.describe("P4.2a Agent Kernel", () => {
  test("reads the selected profile through a multi-tool loop before answering", async ({ page }) => {
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as {
        mode?: string;
        draft?: string;
        messages?: Array<{ role: string; name?: string; content: string }>;
        tools?: Array<{ name: string }>;
        systemPrompt?: string;
      };
      expect(body.mode).toBe("native_turn");
      const observations = body.messages?.filter((message) => message.role === "tool") ?? [];
      const active = observations.findLast((message) => message.name === "get_active_profile");
      const profile = observations.findLast((message) => message.name === "get_profile");
      if (!active && !profile && body.tools?.some((tool) => tool.name === "get_active_profile")) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: modelTool("e2e-active-profile", "get_active_profile", {})
        });
        return;
      }
      if (!profile) {
        const activeData = active
          ? JSON.parse(active.content) as { profileId?: string | null; availableProfiles?: Array<{ id: string }> }
          : undefined;
        const pointedProfileId = /activeProfileId:([^"\\]+)/.exec(body.systemPrompt ?? "")?.[1];
        await route.fulfill({
          contentType: "text/event-stream",
          body: modelTool("e2e-profile-detail", "get_profile", {
            profileId: activeData?.profileId
              ?? activeData?.availableProfiles?.[0]?.id
              ?? pointedProfileId
              ?? "profile-demo-student"
          })
        });
        return;
      }
      const detail = JSON.parse(profile.content) as { profile: { name: string; sectionCounts: Record<string, number> } };
      const total = Object.values(detail.profile.sectionCounts).reduce((sum, count) => sum + count, 0);
      await route.fulfill({
        contentType: "text/event-stream",
        body: modelFinal(`你当前选择的是“${detail.profile.name}”资料库，共有 ${total} 项已保存内容。`)
      });
    });

    await page.goto("/profile");
    await expect(page.locator(".ai-asset-content")).toBeVisible();
    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("你知道我是谁吗");
    await page.getByRole("button", { name: "发送消息" }).click();

    await expect(page.getByText(/你当前选择的是“.+”资料库，共有 \d+ 项已保存内容/)).toBeVisible();
    await expect(page.getByText(/已读取资料库中的 \d+ 项内容/)).toHaveCount(1);
    await expect(page.locator(".agent-tool-status-row:not([open])")).toHaveCount(1);
    expect(await page.locator(".agent-tool-activity-list li").count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByText(/get_active_profile|get_profile|operationId|tool schema/i)).toHaveCount(0);
  });
});
