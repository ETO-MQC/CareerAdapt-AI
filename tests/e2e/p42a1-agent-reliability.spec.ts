import { expect, test } from "@playwright/test";

function nativeFinal(message: string) {
  return `event: model_text_delta\ndata: ${JSON.stringify({ type: "model_text_delta", delta: message })}\n\nevent: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "final" })}\n\n`;
}

function nativeTool(call: { id: string; name: string; arguments: Record<string, unknown> }) {
  return [
    `event: model_tool_call_start\ndata: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id: call.id, name: call.name })}\n\n`,
    `event: model_tool_call_complete\ndata: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}\n\n`,
    `event: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}\n\n`
  ].join("");
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
      exposedTools = body.tools?.map((tool) => tool.name);
      await route.fulfill({
        contentType: "text/event-stream",
        body: nativeFinal("你好！今天想处理哪项求职任务？")
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
      const continuation = body.messages?.find((message) =>
        message.role === "tool"
        && message.name === "commit_job"
        && message.content.includes('"reason":"tool_observation"')
      );
      if (continuation) {
        continuationObserved = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeFinal("岗位已保存。我会继续为你选择资料来源并准备匹配分析。")
        });
        return;
      }
      const parsed = body.messages?.findLast((message) => message.role === "tool" && message.name === "parse_job_description");
      if (!parsed) {
        expect(body.tools?.map((tool) => tool.name)).toEqual(["parse_job_description"]);
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({ id: "e2e-parse-vibe-jd", name: "parse_job_description", arguments: { rawText: jd } })
        });
        return;
      }
      parseObservation = JSON.parse(parsed.content) as typeof parseObservation;
      await route.fulfill({
        contentType: "text/event-stream",
        body: nativeTool({
          id: "e2e-confirm-vibe-job",
          name: "commit_job",
          arguments: {
            title: parseObservation?.candidateTitle ?? "Vibe Coding、AI Coding 任务设计专家",
            company: parseObservation?.candidateCompany ?? "可靠智能实验室",
            rawText: jd,
            graph: parseObservation?.graph
          }
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
    await page.getByRole("link", { name: "个人资料库" }).click();
    await expect(page.locator(".ai-context-bar")).toBeVisible();
    await page.waitForTimeout(800);
    await page.getByRole("link", { name: "AI 助手" }).click();
    await expect(page.getByText("岗位已保存。我会继续为你选择资料来源并准备匹配分析。")).toBeVisible();
    expect(continuationObserved).toBe(true);
  });

  test("completes an autonomous existing-resume application path into an independent revision", async ({ page }) => {
    const jd = `岗位：AI 产品经理
公司：目标科技
岗位职责：
负责 AI 应用的需求分析、原型设计、跨团队交付和质量验收，持续跟踪用户反馈并形成可验证的产品迭代。
与工程团队协作设计自动化工作流，拆解复杂任务，建立明确的验收标准和稳定的回归测试。
维护从需求评审、开发联调到上线复盘的完整记录，并将关键风险、决策依据和验收结果沉淀为可追溯材料。
任职要求：
具备产品设计、数据分析与项目交付经验，熟悉 TypeScript、自动化测试或 AI Coding 工具。
能够基于真实项目证据说明问题定义、方案权衡、实施过程和可量化结果，不得虚构项目事实。
具备清晰的书面沟通能力，能够在事实边界内总结复杂项目，并说明数据来源、限制条件和仍待确认的问题。`;
    let profileId = "";
    let resumeId = "";
    let jobId = "";
    let tailoringSession: unknown;
    let selectedDiffs: unknown[] = [];
    let finalRevisionId = "";

    await page.route("**/api/ai/structured", async (route) => {
      const body = route.request().postDataJSON() as {
        task: string;
        input?: {
          target?: { sectionId: string; itemId: string; fieldPath: string };
          currentContent?: { fieldValue: string | string[] };
          relevantRequirements?: Array<{ requirementId: string; keywords: string[] }>;
          allowedEvidenceRefs?: unknown[];
        };
      };
      if (body.task !== "resume-tailor-diff" || !body.input?.target) {
        await route.continue();
        return;
      }
      const original = body.input.currentContent?.fieldValue ?? "";
      const value = Array.isArray(original)
        ? [`${original[0] ?? "负责相关工作"}。`, ...original.slice(1)]
        : `${original}。`;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: body.task,
          promptVersion: "agent-autonomy-e2e.v1",
          output: {
            diffs: [{
              target: body.input.target,
              operation: "replace",
              original,
              value,
              reason: "基于现有证据突出与岗位相关的交付重点。",
              requirementIds: (body.input.relevantRequirements ?? []).map((item) => item.requirementId).slice(0, 2),
              targetKeywords: (body.input.relevantRequirements ?? []).flatMap((item) => item.keywords).slice(0, 3),
              evidenceRefs: body.input.allowedEvidenceRefs ?? [],
              supportLevel: "verified"
            }],
            clarifications: []
          },
          meta: { provider: "fixture", model: "agent-e2e", inputLength: 1, outputLength: 1, latencyMs: 1 }
        })
      });
    });

    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as {
        messages?: Array<{ role: string; name?: string; content: string }>;
      };
      const messages = body.messages ?? [];
      const latestUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
      const observation = [...messages].reverse().find((message) => message.role === "tool");
      const data = observation ? JSON.parse(observation.content) as Record<string, unknown> : undefined;
      const observed = data && "observation" in data ? data.observation as Record<string, unknown> : data;

      if (!observation && latestUser.includes("路线 B")) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({
            id: "e2e-analyze-fit",
            name: "analyze_job_fit",
            arguments: { profileId, resumeId, jobId }
          })
        });
        return;
      }
      if (!observation) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({ id: "e2e-parse-full-application", name: "parse_job_description", arguments: { rawText: jd } })
        });
        return;
      }
      if (observation.name === "parse_job_description") {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({
            id: "e2e-commit-full-application",
            name: "commit_job",
            arguments: {
              title: String(observed?.candidateTitle ?? "AI 产品经理"),
              company: String(observed?.candidateCompany ?? "目标科技"),
              rawText: jd,
              graph: observed?.graph
            }
          })
        });
        return;
      }
      if (observation.name === "commit_job") {
        jobId = String(observed?.jobId ?? "");
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({ id: "e2e-read-active-profile", name: "get_active_profile", arguments: {} })
        });
        return;
      }
      if (observation.name === "get_active_profile") {
        profileId = String(observed?.profileId ?? "");
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({ id: "e2e-list-resume-sources", name: "list_resumes", arguments: {} })
        });
        return;
      }
      if (observation.name === "list_resumes") {
        resumeId = String((observed?.resumes as Array<{ id: string }> | undefined)?.[0]?.id ?? "");
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({ id: "e2e-read-source-resume", name: "get_resume", arguments: { resumeId } })
        });
        return;
      }
      if (observation.name === "get_resume") {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({ id: "e2e-recommend-source-route", name: "recommend_resume_source", arguments: { profileId, jobId } })
        });
        return;
      }
      if (observation.name === "recommend_resume_source") {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeFinal("资料库证据更丰富，但你也有成熟的现有简历。请选择路线 A 或路线 B；你可以覆盖我的建议。")
        });
        return;
      }
      if (observation.name === "analyze_job_fit") {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({
            id: "e2e-create-tailoring-plan",
            name: "create_tailoring_session",
            arguments: { profileId, resumeId, jobId, intensity: "balanced" }
          })
        });
        return;
      }
      if (observation.name === "create_tailoring_session") {
        tailoringSession = observed?.session;
        selectedDiffs = observed?.appliedDiffs as unknown[] ?? [];
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({
            id: "e2e-preview-tailoring-plan",
            name: "preview_tailoring_changes",
            arguments: { session: tailoringSession, selectedDiffs, confirmedRequirementIds: [] }
          })
        });
        return;
      }
      if (observation.name === "preview_tailoring_changes") {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({
            id: "e2e-apply-tailoring-plan",
            name: "apply_tailoring_changes",
            arguments: { session: tailoringSession, selectedDiffs, confirmedRequirementIds: [] }
          })
        });
        return;
      }
      if (observation.name === "apply_tailoring_changes") {
        finalRevisionId = String(observed?.revisionId ?? "");
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeFinal("岗位定制版本已创建，并已完成事实与版本边界核对。")
        });
        return;
      }
      throw new Error(`Unexpected autonomous observation: ${observation.name}`);
    });

    await page.goto("/resume");
    await page.getByRole("button", { name: /从个人资料库创建/ }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });

    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill(jd);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("button", { name: "确认并继续" })).toBeVisible();
    await page.getByRole("button", { name: "确认并继续" }).click();
    await expect(page.getByText(/请选择路线 A 或路线 B/)).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("描述你的求职任务").fill("采用路线 B，基于现有简历继续");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("button", { name: "确认并继续" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "确认并继续" }).click();
    await expect(page.getByText("岗位定制版本已创建，并已完成事实与版本边界核对。")).toBeVisible({ timeout: 20_000 });
    expect(finalRevisionId).not.toBe("");
  });
});
