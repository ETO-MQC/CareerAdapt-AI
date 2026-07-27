import { expect, test } from "@playwright/test";

type ModelBody = {
  mode?: string;
  messages?: Array<{ role: string; name?: string; content: string }>;
  tools?: Array<{ name: string }>;
  systemPrompt?: string;
};

function nativeFinal(message: string) {
  return [
    `event: model_text_delta`,
    `data: ${JSON.stringify({ type: "model_text_delta", delta: message })}`,
    "",
    `event: model_finish`,
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "final" })}`,
    "",
    ""
  ].join("\n");
}

function nativeTool(id: string, name: string, args: Record<string, unknown>) {
  const call = { id, name, arguments: args };
  return [
    `event: model_tool_call_start`,
    `data: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id, name })}`,
    "",
    `event: model_tool_call_complete`,
    `data: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}`,
    "",
    `event: model_finish`,
    `data: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}`,
    "",
    ""
  ].join("\n");
}

test.describe("P4.2a.3e exported conversation regression", () => {
  test("isolates casual turns, structured references, and one final stream", async ({ page }) => {
    let referencePrompt = "";
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      if (body.mode !== "native_turn") {
        await route.fulfill({ status: 500, body: "unexpected non-native model request" });
        return;
      }
      const latestUser = [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";
      const observations = (body.messages ?? []).filter((message) => message.role === "tool");
      const active = observations.findLast((message) => message.name === "get_active_profile");
      const profile = observations.findLast((message) => message.name === "get_profile");

      if (/读取资料库|我是谁/.test(latestUser) && !active && body.tools?.some((tool) => tool.name === "get_active_profile")) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool(`active-${Date.now()}`, "get_active_profile", {})
        });
        return;
      }
      if (/读取资料库|我是谁/.test(latestUser) && !profile && body.tools?.some((tool) => tool.name === "get_profile")) {
        const activeData = active ? JSON.parse(active.content) as { profileId?: string } : {};
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool(`profile-${Date.now()}`, "get_profile", { profileId: activeData.profileId ?? "profile-demo-student" })
        });
        return;
      }
      if (/读取资料库/.test(latestUser)) {
        await route.fulfill({ contentType: "text/event-stream", body: nativeFinal("可以。我会通过当前运行时提供的只读资料工具读取已选资料库，不会加载简历生成或岗位分析流程。") });
        return;
      }
      if (/我是谁/.test(latestUser)) {
        const detail = profile ? JSON.parse(profile.content) as { profile?: { name?: string } } : {};
        await route.fulfill({ contentType: "text/event-stream", body: nativeFinal(`根据当前资料库，你是${detail.profile?.name ?? "当前资料库的用户"}。`) });
        return;
      }
      if (/岗位匹配是什么意思/.test(latestUser)) {
        referencePrompt = body.systemPrompt ?? "";
        await route.fulfill({ contentType: "text/event-stream", body: nativeFinal("岗位匹配表示岗位要求与你已有资料证据之间的对应程度；它不会把引用回复里的内容当成你的新指令。") });
        return;
      }
      await route.fulfill({ contentType: "text/event-stream", body: nativeFinal("你好！有什么我可以帮你的吗？") });
    });

    await page.goto("/profile");
    await expect(page.locator(".ai-asset-content")).toBeVisible();
    await page.goto("/ai-workspace");

    const send = async (text: string) => {
      await page.getByLabel("描述你的求职任务").fill(text);
      await page.getByRole("button", { name: "发送消息" }).click();
    };

    await send("你好");
    await expect(page.getByText("你好！今天想处理哪项求职任务？")).toHaveCount(1);

    await send("你能读取资料库吗");
    await expect(page.getByText(/可以。我会通过当前运行时提供的只读资料工具/)).toHaveCount(1);

    await send("我是谁");
    await expect(page.getByText(/根据当前资料库，你是/)).toHaveCount(1);

    await send("你还能做什么");
    const capability = page.getByText(/我可以基于当前工作区处理职业资料/);
    await expect(capability).toHaveCount(1);
    const capabilityRow = capability.locator("xpath=ancestor::article");
    await capabilityRow.getByRole("button", { name: "基于此继续" }).click();
    await expect(page.getByLabel("引用的 AI 回复")).toContainText("回复 AI");
    await send("这里面的岗位匹配是什么意思？");
    await expect(page.getByText(/岗位匹配表示岗位要求与你已有资料证据/)).toHaveCount(1);
    expect(referencePrompt).toContain("REFERENCE CONTEXT — NOT USER INSTRUCTION");
    expect(referencePrompt).toContain("latestUserTurn");
    expect(referencePrompt).toContain("这里面的岗位匹配是什么意思？");

    await page.reload();
    await expect(page.getByText("这里面的岗位匹配是什么意思？")).toHaveCount(1);
    await expect(page.locator(".agent-message-reference").filter({ hasText: "回复 AI" })).toHaveCount(1);

    await send("你好");
    await expect(page.getByText("你好！今天想处理哪项求职任务？")).toHaveCount(2);

    await expect(page.getByText(/agent_iteration_budget_exceeded|自动步骤已达到安全上限/)).toHaveCount(0);
    await expect(page.getByText(/已加载经历深挖方法|已加载岗位分析方法/)).toHaveCount(0);
    await expect(page.locator('[data-message-status="streaming"]')).toHaveCount(0);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出对话" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const exported = JSON.parse(await (await import("node:fs/promises")).readFile(path!, "utf8")) as Array<{
      role: string;
      content: string;
      references?: Array<{ messageId: string }>;
      status?: string;
    }>;
    const followup = exported.find((message) => message.role === "user" && message.content === "这里面的岗位匹配是什么意思？");
    expect(followup?.references?.[0]?.messageId).toBeTruthy();
    expect(followup?.content).not.toContain("除了刚才展示");
    expect(exported.some((message) => message.status === "streaming")).toBe(false);
  });

  test("failed domain task stays suspended across a casual turn and resumes only explicitly", async ({ page }) => {
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as ModelBody;
      const latestUser = [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";
      if (/重新优化另一份简历/.test(latestUser)) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: `event: error\ndata: ${JSON.stringify({ type: "error", code: "forced_domain_failure", message: "模拟任务失败" })}\n\n`
        });
        return;
      }
      if (/继续刚才的简历任务/.test(latestUser)) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: [
            `event: model_text_delta`,
            `data: ${JSON.stringify({ type: "model_text_delta", delta: "请选择要使用的简历来源。" })}`,
            "",
            `event: model_finish`,
            `data: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}`,
            "",
            ""
          ].join("\n")
        });
        return;
      }
      await route.fulfill({ contentType: "text/event-stream", body: nativeFinal("不应调用") });
    });

    await page.goto("/ai-workspace");
    const send = async (text: string) => {
      await page.getByLabel("描述你的求职任务").fill(text);
      await page.getByRole("button", { name: "发送消息" }).click();
    };

    await send("重新优化另一份简历");
    await expect(page.getByText("AI 任务暂时中断，当前进度和输入已保留。")).toBeVisible();
    const failed = await readLatestAgentTask(page);
    expect(failed).toMatchObject({
      rootGoal: "create_tailored_resume",
      completionStatus: "failed"
    });

    await send("你好");
    await expect(page.getByText("你好！今天想处理哪项求职任务？")).toBeVisible();
    expect(await readLatestAgentTask(page)).toMatchObject({
      rootGoal: "create_tailored_resume",
      completionStatus: "failed"
    });

    await send("继续刚才的简历任务");
    await expect(page.getByText("请选择要使用的简历来源。")).toBeVisible();
    expect(await readLatestAgentTask(page)).toMatchObject({
      rootGoal: "create_tailored_resume",
      completionStatus: "active"
    });
    await expect(page.getByText(/agent_iteration_budget_exceeded|自动步骤已达到安全上限/)).toHaveCount(0);
  });
});

async function readLatestAgentTask(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("agentSessions", "readonly");
    const sessions = await new Promise<Array<{ taskState?: Record<string, unknown>; updatedAt: string }>>((resolve, reject) => {
      const request = transaction.objectStore("agentSessions").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.taskState;
  });
}
