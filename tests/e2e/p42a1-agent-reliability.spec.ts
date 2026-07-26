import { expect, test } from "@playwright/test";

function narration(message: string) {
  return `event: assistant_delta\ndata: ${JSON.stringify({ type: "assistant_delta", delta: message })}\n\nevent: done\ndata: ${JSON.stringify({ type: "done", message })}\n\n`;
}

test.describe("P4.2a.1 Agent reliability", () => {
  test("answers a greeting with zero domain tools", async ({ page }) => {
    let exposedTools: string[] | undefined;
    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as {
        mode?: string;
        draft?: string;
        tools?: Array<{ name: string }>;
      };
      if (body.mode === "narration") {
        await route.fulfill({ contentType: "text/event-stream", body: narration(body.draft ?? "") });
        return;
      }
      exposedTools = body.tools?.map((tool) => tool.name);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ stopReason: "final", text: "你好！今天想处理哪项求职任务？" })
      });
    });

    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("你好");
    await page.getByRole("button", { name: "发送消息" }).click();

    await expect(page.getByText("你好！今天想处理哪项求职任务？")).toBeVisible();
    expect(exposedTools).toEqual([]);
    await expect(page.locator(".agent-tool-status-row")).toHaveCount(0);
  });

  test("parses a pasted JD, confirms the write, continues in background, and restores", async ({ page }) => {
    const jd = `岗位：Vibe Coding、AI Coding 任务设计专家
公司：可靠智能实验室
岗位职责：
使用真实开发工作流持续测试 Cursor、Claude Code 和 Codex，在多步骤开发、跨文件修改和真实环境调试中发现可复现失败。
将失败场景标准化为任务包，明确背景、目标、约束、ground-truth、评分逻辑和可自动执行的 verifier。
任职要求：
熟悉 coding agent，能够提供真实使用记录；具备代码阅读、调试、工程化、测试设计与 reward hacking 检测经验。
能够清晰描述至少一个真实开发场景下的 agent badcase，并提供复现方式、环境说明和关键失败原因。`;
    let parseObservation:
      | { graph: unknown; candidateTitle?: string; candidateCompany?: string }
      | undefined;
    let continuationObserved = false;

    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as {
        mode?: string;
        draft?: string;
        messages?: Array<{ role: string; name?: string; content: string }>;
        tools?: Array<{ name: string }>;
      };
      if (body.mode === "narration") {
        await route.fulfill({ contentType: "text/event-stream", body: narration(body.draft ?? "") });
        return;
      }
      const latest = body.messages?.at(-1)?.content ?? "";
      if (latest.includes("[AUTHORITATIVE_TOOL_OBSERVATION]")) {
        continuationObserved = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ stopReason: "final", text: "岗位已保存。我会继续为你选择资料来源并准备匹配分析。" })
        });
        return;
      }
      const parsed = body.messages?.findLast((message) => message.role === "tool" && message.name === "parse_job_description");
      if (!parsed) {
        expect(body.tools?.map((tool) => tool.name)).toEqual(["parse_job_description", "commit_job"]);
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            stopReason: "tool_calls",
            toolCalls: [{ id: "e2e-parse-vibe-jd", name: "parse_job_description", arguments: { rawText: jd } }]
          })
        });
        return;
      }
      parseObservation = JSON.parse(parsed.content) as typeof parseObservation;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          stopReason: "tool_calls",
          toolCalls: [{
            id: "e2e-confirm-vibe-job",
            name: "commit_job",
            arguments: {
              title: parseObservation?.candidateTitle ?? "Vibe Coding、AI Coding 任务设计专家",
              company: parseObservation?.candidateCompany ?? "可靠智能实验室",
              rawText: jd,
              graph: parseObservation?.graph
            }
          }]
        })
      });
    });

    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill(jd);
    await page.getByRole("button", { name: "发送消息" }).click();

    await expect(page.getByRole("tab", { name: "岗位语义核对" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认并继续" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "确认并继续" }).dispatchEvent("click");
    await page.goto("/profile");
    await expect(page.locator(".ai-context-bar")).toBeVisible();
    await page.waitForTimeout(800);
    await page.goto("/ai-workspace");
    await expect(page.getByText("岗位已保存。我会继续为你选择资料来源并准备匹配分析。")).toBeVisible();
    expect(continuationObserved).toBe(true);
  });
});
