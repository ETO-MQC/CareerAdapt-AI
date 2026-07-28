import { expect, test } from "@playwright/test";

function nativeFinal(message: string) {
  return `event: model_text_delta\ndata: ${JSON.stringify({ type: "model_text_delta", delta: message })}\n\nevent: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "final" })}\n\n`;
}

function nativeAskUser(message: string) {
  return `event: model_text_delta\ndata: ${JSON.stringify({ type: "model_text_delta", delta: message })}\n\nevent: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "ask_user" })}\n\n`;
}

function nativeTool(call: { id: string; name: string; arguments: Record<string, unknown> }) {
  return [
    `event: model_tool_call_start\ndata: ${JSON.stringify({ type: "model_tool_call_start", index: 0, id: call.id, name: call.name })}\n\n`,
    `event: model_tool_call_complete\ndata: ${JSON.stringify({ type: "model_tool_call_complete", index: 0, call })}\n\n`,
    `event: model_finish\ndata: ${JSON.stringify({ type: "model_finish", stopReason: "tool_calls" })}\n\n`
  ].join("");
}

test.describe("P4.2a.1 Agent reliability", () => {
  test("answers a greeting deterministically with zero model/domain calls", async ({ page }) => {
    let modelRequests = 0;
    await page.route("**/api/agent/stream", async (route) => {
      modelRequests += 1;
      await route.fulfill({
        contentType: "text/event-stream",
        body: nativeFinal("你好！今天想处理哪项求职任务？")
      });
    });

    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("你好");
    await page.getByRole("button", { name: "发送消息" }).click();

    await expect(page.getByText("你好！今天想处理哪项求职任务？")).toBeVisible();
    expect(modelRequests).toBe(0);
    await expect(page.locator(".agent-tool-status-row")).toHaveCount(0);
  });

  test("CASE A — ingest-only commits the job and does not enter Route B", async ({ page }) => {
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
    const observedToolNames: string[] = [];

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
        observedToolNames.push("commit_job");
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeFinal("岗位已保存，录入任务已完成。")
        });
        return;
      }
      const parsed = body.messages?.findLast((message) => message.role === "tool" && message.name === "parse_job_description");
      const latestUser = body.messages?.findLast((message) => message.role === "user")?.content ?? "";
      if (!parsed && latestUser === "录入这个岗位") {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeAskUser("请粘贴完整岗位描述。")
        });
        return;
      }
      if (!parsed) {
        observedToolNames.push("parse_job_description");
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
    await page.getByLabel("描述你的求职任务").fill("录入这个岗位");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("请粘贴完整岗位描述。")).toBeVisible();
    await page.getByLabel("描述你的求职任务").fill(jd);
    await page.getByRole("button", { name: "发送消息" }).click();

    await expect(page.getByRole("region", { name: "确认保存岗位" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "确认", exact: true }).dispatchEvent("click");
    await expect(page.getByText("岗位已保存，录入任务已完成。")).toBeVisible();
    expect(observedToolNames).toEqual(["parse_job_description", "commit_job"]);
    expect(observedToolNames).not.toContain("analyze_job_fit");
    expect(observedToolNames).not.toContain("create_tailoring_session");
    const revisionCount = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("CareerAdaptDb");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction("resumeRevisions", "readonly");
      const count = await new Promise<number>((resolve, reject) => {
        const request = transaction.objectStore("resumeRevisions").count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return count;
    });
    expect(revisionCount).toBe(0);
  });

  test("CASE B — apply-to-new-job resumes automatically after commit and creates an independent Revision", async ({ page }) => {
    test.setTimeout(90_000);
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
    let sourceRevisionId = "";
    let tailoredBranchId = "";
    let applyObservation: unknown;
    let createObservation: unknown;

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
              target: {
                sectionId: body.input.target.sectionId,
                itemId: body.input.target.itemId,
                fieldPath: body.input.target.fieldPath
              },
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
      const observed = observation ? readToolObservation(observation.content) : undefined;

      if (!observation && latestUser === "我想应聘这个岗位") {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeAskUser("请粘贴这个岗位的完整 JD。")
        });
        return;
      }
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
        sourceRevisionId = String((observed?.resume as Record<string, unknown> | undefined)?.currentRevisionId ?? "");
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({ id: "e2e-recommend-source-route", name: "recommend_resume_source", arguments: { profileId, jobId } })
        });
        return;
      }
      if (observation.name === "recommend_resume_source") {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeAskUser("资料库证据更丰富，但你也有成熟的现有简历。请选择路线 A 或路线 B；你可以覆盖我的建议。")
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
        createObservation = observed;
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
        applyObservation = observed;
        finalRevisionId = String(observed?.revisionId ?? (observed?.revision as Record<string, unknown> | undefined)?.id ?? "");
        tailoredBranchId = String(observed?.branchId ?? (observed?.branch as Record<string, unknown> | undefined)?.id ?? "");
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
    await page.getByLabel("描述你的求职任务").fill("我想应聘这个岗位");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("请粘贴这个岗位的完整 JD。")).toBeVisible();
    await page.getByLabel("描述你的求职任务").fill(jd);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    const routeDecision = page.getByText(/请选择路线 A 或路线 B/);
    const runtimeFailure = page.getByText("AI 任务暂时中断，当前进度和输入已保留。").first();
    await Promise.race([
      routeDecision.waitFor({ state: "visible", timeout: 20_000 }),
      runtimeFailure.waitFor({ state: "visible", timeout: 20_000 })
    ]);
    if (await runtimeFailure.isVisible()) {
      throw new Error(`CASE B runtime failed: ${JSON.stringify(await readAgentDiagnostic(page))}`);
    }
    await expect(routeDecision).toBeVisible();
    await page.reload();
    const routeState = await readLatestAgentTask(page);
    expect(routeState).toMatchObject({
      rootGoal: "apply_to_job",
      activeGoal: "resolve_resume_source",
      stage: "choose_resume_source",
      selectedEntities: { jobId },
      pendingDecision: {
        type: "resume_source_route",
        options: ["profile", "existing_resume"]
      }
    });
    await expect(page.getByRole("button", { name: "使用现有简历" })).toBeVisible();

    await page.getByRole("button", { name: "使用现有简历" }).click();
    const applyConfirmation = page.getByRole("button", { name: "确认", exact: true });
    await Promise.race([
      applyConfirmation.waitFor({ state: "visible", timeout: 60_000 }),
      runtimeFailure.waitFor({ state: "visible", timeout: 60_000 })
    ]);
    if (await runtimeFailure.isVisible()) {
      throw new Error(`CASE B tailoring failed: ${JSON.stringify(await readAgentDiagnostic(page))}`);
    }
    await expect(applyConfirmation).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("岗位定制版本已创建，并已完成事实与版本边界核对。")).toBeVisible({ timeout: 20_000 });
    if (!finalRevisionId) {
      throw new Error(`CASE B apply returned no revision: ${JSON.stringify({
        create: createObservation,
        apply: applyObservation
      })}`);
    }
    expect(finalRevisionId).not.toBe("");
    expect(tailoredBranchId).not.toBe(resumeId);
    const sourceAfter = await readIndexedRecord(page, "resumeBranches", resumeId);
    expect(sourceAfter?.currentRevisionId).toBe(sourceRevisionId);
    const tailoredAfter = await readIndexedRecord(page, "resumeBranches", tailoredBranchId);
    expect(tailoredAfter?.jobId).toBe(jobId);
    expect(tailoredAfter?.currentRevisionId).toBe(finalRevisionId);
  });

  test("CASE C — existing job plus latest general resume completes Route B without changing its source", async ({ page }) => {
    test.setTimeout(90_000);
    const jd = [
      "岗位职责：负责 AI 训练任务设计、数据质量验收和迭代复盘。",
      "建立可追溯的评分标准、验证流程和交付记录。",
      "任职要求：熟悉 AI 应用、数据分析、TypeScript 与自动化测试。",
      "能够基于真实项目证据说明方案权衡和验收结果。"
    ].join("\n");

    await page.goto("/resume");
    await page.getByRole("button", { name: /从个人资料库创建/ }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
    await page.goto("/jobs");
    await page.getByLabel("岗位名称").fill("AI训练师");
    await page.getByLabel("公司名称").fill("目标科技");
    await page.getByLabel("岗位描述").fill(jd);
    await page.getByRole("button", { name: "保存并分析岗位" }).click();
    const jobDialog = page.getByRole("dialog", { name: "AI训练师" });
    await expect(jobDialog).toBeVisible();
    await jobDialog.getByTestId("job-manual-mode-dialog").click();
    await expect(jobDialog.locator(".review-row").first()).toBeVisible();
    await jobDialog.getByTestId("commit-job").click();
    await expect(jobDialog).toBeHidden();

    let profileId = "";
    let resumeId = "";
    let jobId = "";
    let sourceRevision = 0;
    let tailoringSession: unknown;
    let selectedDiffs: unknown[] = [];
    let tailoredBranchId = "";
    let clarificationQuestion: Record<string, unknown> | undefined;

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
          promptVersion: "agent-route-b-existing.v1",
          output: {
            diffs: [{
              target: {
                sectionId: body.input.target.sectionId,
                itemId: body.input.target.itemId,
                fieldPath: body.input.target.fieldPath
              },
              operation: "replace",
              original,
              value,
              reason: "基于现有证据突出岗位相关交付。",
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
      const latestUser = body.messages?.findLast((message) => message.role === "user")?.content ?? "";
      const observation = body.messages?.findLast((message) => message.role === "tool");
      const observed = observation ? readToolObservation(observation.content) : undefined;
      let call: { id: string; name: string; arguments: Record<string, unknown> };

      if (!observation && clarificationQuestion && latestUser.includes("真实项目")) {
        call = {
          id: "case-c-answer",
          name: "answer_tailoring_question",
          arguments: {
            session: tailoringSession,
            questionId: clarificationQuestion.id,
            answer: latestUser
          }
        };
      } else if (!observation) {
        call = { id: "case-c-profile", name: "get_active_profile", arguments: {} };
      } else if (observation.name === "get_active_profile") {
        profileId = String(observed?.profileId ?? "");
        call = { id: "case-c-resumes", name: "list_resumes", arguments: {} };
      } else if (observation.name === "list_resumes") {
        const source = (observed?.resumes as Array<{ id: string; revision: number }> | undefined)?.[0];
        resumeId = String(source?.id ?? "");
        sourceRevision = Number(source?.revision ?? 0);
        call = { id: "case-c-jobs", name: "list_jobs", arguments: {} };
      } else if (observation.name === "list_jobs") {
        jobId = String((observed?.jobs as Array<{ id: string; title: string }> | undefined)?.find((job) => job.title === "AI训练师")?.id ?? "");
        call = { id: "case-c-fit", name: "analyze_job_fit", arguments: { profileId, resumeId, jobId } };
      } else if (observation.name === "analyze_job_fit") {
        call = { id: "case-c-plan", name: "create_tailoring_session", arguments: { profileId, resumeId, jobId, intensity: "balanced" } };
      } else if (observation.name === "create_tailoring_session") {
        tailoringSession = observed?.session;
        selectedDiffs = observed?.appliedDiffs as unknown[] ?? [];
        const plan = (tailoringSession as { plan?: { clarificationQuestions?: Record<string, unknown>[] } } | undefined)?.plan;
        clarificationQuestion = plan?.clarificationQuestions?.[0];
        if (clarificationQuestion) {
          await route.fulfill({
            contentType: "text/event-stream",
            body: nativeAskUser("请补充并确认一个真实项目中的相关交付案例。")
          });
          return;
        }
        call = {
          id: "case-c-preview",
          name: "preview_tailoring_changes",
          arguments: { session: tailoringSession, selectedDiffs, confirmedRequirementIds: [] }
        };
      } else if (observation.name === "answer_tailoring_question") {
        tailoringSession = observed?.session;
        selectedDiffs = observed?.appliedDiffs as unknown[] ?? selectedDiffs;
        clarificationQuestion = undefined;
        call = {
          id: "case-c-preview-after-answer",
          name: "preview_tailoring_changes",
          arguments: { session: tailoringSession, selectedDiffs, confirmedRequirementIds: [] }
        };
      } else if (observation.name === "preview_tailoring_changes") {
        call = {
          id: "case-c-apply",
          name: "apply_tailoring_changes",
          arguments: { session: tailoringSession, selectedDiffs, confirmedRequirementIds: [] }
        };
      } else if (observation.name === "apply_tailoring_changes") {
        tailoredBranchId = String((observed?.branch as Record<string, unknown> | undefined)?.id ?? "");
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeFinal("AI训练师岗位定制简历已完成。")
        });
        return;
      } else {
        throw new Error(`Unexpected CASE C observation: ${observation.name}`);
      }
      await route.fulfill({ contentType: "text/event-stream", body: nativeTool(call) });
    });

    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("用最新的通用简历，针对AI训练师做一份定制简历");
    await page.getByRole("button", { name: "发送消息" }).click();
    const clarification = page.getByText("请补充并确认一个真实项目中的相关交付案例。");
    if (await clarification.isVisible({ timeout: 30_000 }).catch(() => false)) {
      await page.reload();
      await expect(clarification).toBeVisible();
      await page.getByLabel("描述你的求职任务").fill("我在真实项目中负责 AI 任务设计、质量验收和迭代复盘。");
      await page.getByRole("button", { name: "发送消息" }).click();
      await expect(page.getByRole("heading", { name: "使用这项补充信息？" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "确认", exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.reload();
    const persisted = await readLatestAgentTask(page);
    expect(persisted).toMatchObject({
      rootGoal: "create_tailored_resume",
      activeGoal: "create_tailored_resume",
      stage: "confirm_apply",
      selectedEntities: {
        resumeId,
        jobId
      }
    });
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("AI训练师岗位定制简历已完成。")).toBeVisible({ timeout: 20_000 });

    expect(tailoredBranchId).not.toBe("");
    expect(tailoredBranchId).not.toBe(resumeId);
    const sourceAfter = await readIndexedRecord(page, "resumeBranches", resumeId);
    expect(sourceAfter?.revision).toBe(sourceRevision);
    const tailoredAfter = await readIndexedRecord(page, "resumeBranches", tailoredBranchId);
    expect(tailoredAfter?.jobId).toBe(jobId);
  });

  test("continuation after fit keeps the same root task and selected entities", async ({ page }) => {
    test.setTimeout(90_000);
    const jd = [
      "岗位职责：负责 AI 训练任务设计、数据质量验收和迭代复盘。",
      "建立可追溯的评分标准、验证流程和交付记录。",
      "任职要求：熟悉 AI 应用、数据分析与自动化测试。",
      "能够基于真实项目证据说明方案权衡和验收结果。"
    ].join("\n");

    await page.goto("/resume");
    await page.getByRole("button", { name: /从个人资料库创建/ }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
    await page.goto("/jobs");
    await page.getByLabel("岗位名称").fill("AI训练师");
    await page.getByLabel("公司名称").fill("目标科技");
    await page.getByLabel("岗位描述").fill(jd);
    await page.getByRole("button", { name: "保存并分析岗位" }).click();
    const jobDialog = page.getByRole("dialog", { name: "AI训练师" });
    await expect(jobDialog).toBeVisible();
    await jobDialog.getByTestId("job-manual-mode-dialog").click();
    await expect(jobDialog.locator(".review-row").first()).toBeVisible();
    await jobDialog.getByTestId("commit-job").click();
    await expect(jobDialog).toBeHidden();

    let profileId = "";
    let resumeId = "";
    let jobId = "";
    let tailoringSession: unknown;
    let selectedDiffs: unknown[] = [];
    let clarificationQuestion: Record<string, unknown> | undefined;
    let tailoredBranchId = "";
    let listResumeCalls = 0;
    let listJobCalls = 0;

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
          promptVersion: "agent-continuation-e2e.v1",
          output: {
            diffs: [{
              target: {
                sectionId: body.input.target.sectionId,
                itemId: body.input.target.itemId,
                fieldPath: body.input.target.fieldPath
              },
              operation: "replace",
              original,
              value,
              reason: "基于现有证据突出岗位相关交付。",
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
      const latestUser = body.messages?.findLast((message) => message.role === "user")?.content ?? "";
      const observation = body.messages?.findLast((message) => message.role === "tool");
      const observed = observation ? readToolObservation(observation.content) : undefined;
      let call: { id: string; name: string; arguments: Record<string, unknown> };

      if (
        latestUser.includes("基于这些建议创建一份新的定制简历")
        && (!observation || observation.name === "analyze_job_fit")
      ) {
        call = {
          id: "continuation-plan",
          name: "create_tailoring_session",
          arguments: { profileId, resumeId, jobId, intensity: "balanced" }
        };
      } else if (
        clarificationQuestion
        && latestUser.includes("真实项目")
        && (!observation || observation.name === "create_tailoring_session")
      ) {
        call = {
          id: "continuation-answer",
          name: "answer_tailoring_question",
          arguments: {
            session: tailoringSession,
            questionId: clarificationQuestion.id,
            answer: latestUser
          }
        };
      } else if (!observation) {
        call = { id: "continuation-profile", name: "get_active_profile", arguments: {} };
      } else if (observation.name === "get_active_profile") {
        profileId = String(observed?.profileId ?? "");
        listResumeCalls += 1;
        call = { id: "continuation-resumes", name: "list_resumes", arguments: {} };
      } else if (observation.name === "list_resumes") {
        resumeId = String((observed?.resumes as Array<{ id: string }> | undefined)?.[0]?.id ?? "");
        listJobCalls += 1;
        call = { id: "continuation-jobs", name: "list_jobs", arguments: {} };
      } else if (observation.name === "list_jobs") {
        const jobs = observed?.jobs as Array<{ id: string; title: string }> | undefined;
        jobId = String(jobs?.find((job) => job.title === "AI训练师")?.id ?? jobs?.[0]?.id ?? "");
        call = { id: "continuation-job", name: "get_job", arguments: { jobId } };
      } else if (observation.name === "get_job") {
        call = { id: "continuation-fit", name: "analyze_job_fit", arguments: { profileId, resumeId, jobId } };
      } else if (observation.name === "analyze_job_fit") {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeAskUser("匹配分析和建议已生成。你可以基于这些建议继续创建定制简历。")
        });
        return;
      } else if (observation.name === "create_tailoring_session") {
        tailoringSession = observed?.session;
        selectedDiffs = observed?.appliedDiffs as unknown[] ?? [];
        const plan = (tailoringSession as { plan?: { clarificationQuestions?: Record<string, unknown>[] } } | undefined)?.plan;
        clarificationQuestion = plan?.clarificationQuestions?.[0];
        if (clarificationQuestion) {
          await route.fulfill({
            contentType: "text/event-stream",
            body: nativeAskUser("请补充并确认一个真实项目中的相关交付案例。")
          });
          return;
        }
        call = {
          id: "continuation-preview",
          name: "preview_tailoring_changes",
          arguments: { session: tailoringSession, selectedDiffs, confirmedRequirementIds: [] }
        };
      } else if (observation.name === "answer_tailoring_question") {
        tailoringSession = observed?.session;
        selectedDiffs = observed?.appliedDiffs as unknown[] ?? selectedDiffs;
        clarificationQuestion = undefined;
        call = {
          id: "continuation-preview-after-answer",
          name: "preview_tailoring_changes",
          arguments: { session: tailoringSession, selectedDiffs, confirmedRequirementIds: [] }
        };
      } else if (observation.name === "preview_tailoring_changes") {
        call = {
          id: "continuation-apply",
          name: "apply_tailoring_changes",
          arguments: { session: tailoringSession, selectedDiffs, confirmedRequirementIds: [] }
        };
      } else if (observation.name === "apply_tailoring_changes") {
        tailoredBranchId = String(observed?.branchId ?? (observed?.branch as Record<string, unknown> | undefined)?.id ?? "");
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeFinal("已基于同一份匹配建议创建岗位定制版本。")
        });
        return;
      } else {
        throw new Error(`Unexpected continuation observation: ${observation.name}`);
      }
      await route.fulfill({ contentType: "text/event-stream", body: nativeTool(call) });
    });

    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("用最新通用简历给AI训练师岗位做定制简历，先分析匹配建议");
    await page.getByRole("button", { name: "发送消息" }).click();
    const fitSuggestions = page.getByText("匹配分析和建议已生成。你可以基于这些建议继续创建定制简历。");
    const runtimeFailure = page.getByText("AI 任务暂时中断，当前进度和输入已保留。").first();
    try {
      await Promise.race([
        fitSuggestions.waitFor({ state: "visible", timeout: 30_000 }),
        runtimeFailure.waitFor({ state: "visible", timeout: 30_000 })
      ]);
    } catch {
      throw new Error(`Continuation fit timed out: ${JSON.stringify(await readAgentDiagnostic(page))}`);
    }
    if (await runtimeFailure.isVisible()) {
      throw new Error(`Continuation fit failed: ${JSON.stringify(await readAgentDiagnostic(page))}`);
    }
    await expect(fitSuggestions).toBeVisible();
    const before = await readLatestAgentTask(page);
    expect(before).toMatchObject({
      rootGoal: "create_tailored_resume",
      activeGoal: "create_tailored_resume",
      stage: "generate_plan",
      selectedEntities: { profileId, resumeId, jobId }
    });

    await page.getByLabel("描述你的求职任务").fill("基于这些建议创建一份新的定制简历");
    await page.getByRole("button", { name: "发送消息" }).click();
    const clarification = page.getByText("请补充并确认一个真实项目中的相关交付案例。");
    if (await clarification.isVisible({ timeout: 30_000 }).catch(() => false)) {
      await page.getByLabel("描述你的求职任务").fill("我在真实项目中负责 AI 任务设计、质量验收和迭代复盘。");
      await page.getByRole("button", { name: "发送消息" }).click();
      await expect(page.getByRole("heading", { name: "使用这项补充信息？" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "确认", exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible({ timeout: 60_000 });
    const atConfirmation = await readLatestAgentTask(page);
    expect(atConfirmation).toMatchObject({
      rootGoal: "create_tailored_resume",
      stage: "confirm_apply",
      selectedEntities: { profileId, resumeId, jobId }
    });
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("已基于同一份匹配建议创建岗位定制版本。")).toBeVisible({ timeout: 20_000 });

    const after = await readLatestAgentTask(page);
    expect(after).toMatchObject({
      rootGoal: "create_tailored_resume",
      selectedEntities: { profileId, resumeId: tailoredBranchId, jobId }
    });
    expect(listResumeCalls).toBe(1);
    expect(listJobCalls).toBe(1);
    expect(tailoredBranchId).not.toBe("");
    expect(tailoredBranchId).not.toBe(resumeId);
  });

  test("archive_resume and restore_resume keep repository lifecycle authoritative", async ({ page }) => {
    let resumeId = "";
    let resumeName = "";
    let expectedRevision = 0;

    await page.goto("/resume");
    await page.getByRole("button", { name: /从个人资料库创建/ }).click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });

    await page.route("**/api/agent/stream", async (route) => {
      const body = route.request().postDataJSON() as {
        messages?: Array<{ role: string; name?: string; content: string }>;
      };
      const latestUser = body.messages?.findLast((message) => message.role === "user")?.content ?? "";
      const observation = body.messages?.findLast((message) => message.role === "tool");
      const observed = observation ? readToolObservation(observation.content) : undefined;

      if (observation?.name === "archive_resume") {
        expectedRevision = Number(observed?.revision ?? expectedRevision + 1);
        await route.fulfill({ contentType: "text/event-stream", body: nativeFinal("简历已归档。") });
        return;
      }
      if (observation?.name === "restore_resume") {
        await route.fulfill({ contentType: "text/event-stream", body: nativeFinal("简历已恢复为活跃状态。") });
        return;
      }
      if (latestUser.includes("恢复")) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({
            id: "restore-resume-e2e",
            name: "restore_resume",
            arguments: { resumeId, expectedRevision }
          })
        });
        return;
      }
      if (!observation) {
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({ id: "list-resume-archive-e2e", name: "list_resumes", arguments: {} })
        });
        return;
      }
      if (observation.name === "list_resumes") {
        const resume = (observed?.resumes as Array<{ id: string; name: string; revision: number }> | undefined)?.[0];
        resumeId = String(resume?.id ?? "");
        resumeName = String(resume?.name ?? "");
        expectedRevision = Number(resume?.revision ?? 0);
        await route.fulfill({
          contentType: "text/event-stream",
          body: nativeTool({
            id: "archive-resume-e2e",
            name: "archive_resume",
            arguments: { resumeId, expectedRevision }
          })
        });
        return;
      }
      throw new Error(`Unexpected archive lifecycle observation: ${observation.name}`);
    });

    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("归档最新的通用简历");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("heading", { name: "确认归档简历" })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("简历已归档。")).toBeVisible();
    await expect(page).toHaveURL(/\/ai-workspace/);
    expect((await readIndexedRecord(page, "resumeBranches", resumeId))?.lifecycleStatus).toBe("archived");
    await page.goto("/resume");
    await expect(page.locator(".resume-card").filter({ hasText: resumeName })).toHaveCount(0);

    await page.goto("/ai-workspace");
    await page.getByLabel("描述你的求职任务").fill("恢复刚才归档的简历");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("heading", { name: "确认恢复简历" })).toBeVisible();
    await page.getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.getByText("简历已恢复为活跃状态。")).toBeVisible();
    await expect(page).toHaveURL(/\/ai-workspace/);
    expect((await readIndexedRecord(page, "resumeBranches", resumeId))?.lifecycleStatus).toBe("active");
  });
});

async function readIndexedRecord(
  page: import("@playwright/test").Page,
  storeName: string,
  key: string
) {
  return page.evaluate(async ({ storeName, key }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(storeName, "readonly");
    const value = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value;
  }, { storeName, key });
}

function readToolObservation(content: string) {
  try {
    const envelope = JSON.parse(content) as Record<string, unknown>;
    return "observation" in envelope
      ? envelope.observation as Record<string, unknown>
      : envelope;
  } catch {
    const result: Record<string, unknown> = {};
    for (const key of ["jobId", "resumeId", "profileId"]) {
      const match = new RegExp(`"${key}":"([^"]+)"`).exec(content);
      if (match?.[1]) result[key] = match[1];
    }
    return result;
  }
}

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

async function readAgentDiagnostic(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessionTransaction = database.transaction("agentSessions", "readonly");
    const sessions = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = sessionTransaction.objectStore("agentSessions").getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
      request.onerror = () => reject(request.error);
    });
    const latest = sessions.sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt))
    )[0];
    const messageTransaction = database.transaction("agentMessages", "readonly");
    const messages = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const request = messageTransaction.objectStore("agentMessages").getAll();
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const taskState = latest?.taskState as Record<string, unknown> | undefined;
    return {
      taskState: taskState ? {
        rootGoal: taskState.rootGoal,
        activeGoal: taskState.activeGoal,
        workflowId: taskState.workflowId,
        stage: taskState.stage,
        completionStatus: taskState.completionStatus,
        selectedEntities: taskState.selectedEntities
      } : undefined,
      trajectory: latest?.trajectory,
      activeTurn: latest?.activeTurn,
      pendingConfirmation: latest?.pendingConfirmation,
      errors: messages.filter((message) =>
        message.sessionId === latest?.id && (message.errorCode || message.status === "failed")
      )
    };
  });
}
