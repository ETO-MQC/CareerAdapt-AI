import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openManualPageTab } from "./support/g7b2Ui";

test.use({ trace: "on", video: "on", screenshot: "on" });

test("P4.3d.2 migrates a legacy tailoring session and completes the current journey", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: "https://example.test/v1",
      apiKey: "e2e-key",
      model: "e2e-model",
      provider: "openai-compatible"
    }));
  });
  await page.goto("/resume");
  await bypassSetupIfNeeded(page);
  const createGeneralResume = page.getByRole("button", { name: /从个人资料库创建/ });
  if (await createGeneralResume.isVisible().catch(() => false)) {
    await createGeneralResume.click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
    await page.goto("/resume");
  }
  const entities = await readAuthoritativeEntities(page);
  const fixture = await seedLegacySession(page, entities);
  const modelToolNames: string[] = [];
  let structuredRequestCount = 0;
  let currentTailoringSession: Record<string, unknown> | undefined;
  let activeQuestion: Record<string, unknown> | undefined;
  let analysisDone = false;

  await page.route("**/api/ai/structured", async (route) => {
    const body = route.request().postDataJSON() as { task?: string; input?: Record<string, unknown> };
    if (body.task === "resume-tailor-batch" && Array.isArray(body.input?.targets)) {
      structuredRequestCount += 1;
      const targets = body.input.targets as Array<Record<string, unknown>>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: body.task,
          promptVersion: "p43d2-migrated-fixture.v1",
          output: {
            suggestions: targets.slice(0, 3).map((target, index) => ({
              itemId: String(target.itemId),
              after: Array.isArray(target.before)
                ? [`${String(target.before[0] ?? "保留已确认事实")}；突出岗位相关交付 ${index + 1}。`, ...(target.before as unknown[]).slice(1)]
                : `${String(target.before ?? "保留已确认事实")}；突出岗位相关交付 ${index + 1}。`,
              rationale: "仅基于当前简历和岗位证据生成建议。",
              requirementIds: [],
              targetKeywords: [],
              claimSupportLevel: "verified"
            }))
          },
          meta: { provider: "fixture", model: "p43d2", inputLength: 1, outputLength: 1, latencyMs: 1 }
        })
      });
      return;
    }
    if (body.task === "resume-tailor-diff" && body.input?.target) {
      structuredRequestCount += 1;
      const target = body.input.target as Record<string, unknown>;
      const original = body.input.currentContent && typeof body.input.currentContent === "object"
        ? (body.input.currentContent as Record<string, unknown>).fieldValue
        : "保留已确认事实";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          task: body.task,
          promptVersion: "p43d2-migrated-fixture.diff.v1",
          output: {
            diffs: [{
              target: {
                sectionId: String(target.sectionId),
                itemId: String(target.itemId),
                fieldPath: String(target.fieldPath)
              },
              operation: "replace",
              original,
              value: Array.isArray(original) ? [...original, "突出岗位相关交付。"] : `${String(original)}；突出岗位相关交付。`,
              reason: "仅基于当前简历和岗位证据生成建议。",
              requirementIds: [],
              targetKeywords: [],
              evidenceRefs: [],
              supportLevel: "verified"
            }],
            clarifications: []
          },
          meta: { provider: "fixture", model: "p43d2", inputLength: 1, outputLength: 1, latencyMs: 1 }
        })
      });
      return;
    }
    await route.continue();
  });

  await page.route("**/api/agent/stream", async (route) => {
    const body = route.request().postDataJSON() as ModelBody;
    const observations = toolObservations(body);
    const latestUser = latestUserMessage(body);
    const observation = observations.at(-1);
    if (!observation) {
      if (currentTailoringSession && activeQuestion) {
        modelToolNames.push("answer_tailoring_question");
        await route.fulfill({ contentType: "text/event-stream", body: nativeTool("migrated-answer", "answer_tailoring_question", {
          session: currentTailoringSession,
          questionId: String(activeQuestion.id),
          answer: latestUser || "跳过"
        }) });
        return;
      }
      if (!analysisDone) {
        modelToolNames.push("analyze_job_fit");
        await route.fulfill({ contentType: "text/event-stream", body: nativeTool("migrated-fit", "analyze_job_fit", {
          profileId: entities.profileId,
          resumeId: entities.resumeId,
          jobId: entities.jobId
        }) });
        return;
      }
      modelToolNames.push("create_tailoring_session");
      await route.fulfill({ contentType: "text/event-stream", body: nativeTool("migrated-plan", "create_tailoring_session", {
        profileId: entities.profileId,
        resumeId: entities.resumeId,
        jobId: entities.jobId,
        intensity: "balanced"
      }) });
      return;
    }
    const observed = readToolObservation(observation.content);
    if (observation.name === "analyze_job_fit") {
      analysisDone = true;
      modelToolNames.push("create_tailoring_session");
      await route.fulfill({ contentType: "text/event-stream", body: nativeTool("migrated-plan", "create_tailoring_session", {
        profileId: entities.profileId,
        resumeId: entities.resumeId,
        jobId: entities.jobId,
        intensity: "balanced"
      }) });
      return;
    }
    if (observation.name === "create_tailoring_session") {
      currentTailoringSession = recordValue(observed?.session);
      activeQuestion = currentQuestion(currentTailoringSession);
      if (activeQuestion) {
        await route.fulfill({ contentType: "text/event-stream", body: nativeAsk("请补充一项真实经历，或回复“跳过”。") });
        return;
      }
      modelToolNames.push("generate_tailoring_changes");
      await route.fulfill({ contentType: "text/event-stream", body: nativeTool("migrated-generate", "generate_tailoring_changes", { session: currentTailoringSession }) });
      return;
    }
    if (observation.name === "answer_tailoring_question") {
      currentTailoringSession = recordValue(observed?.session);
      activeQuestion = currentQuestion(currentTailoringSession);
      if (activeQuestion) {
        await route.fulfill({ contentType: "text/event-stream", body: nativeAsk("请继续补充，或回复“跳过”。") });
        return;
      }
      modelToolNames.push("generate_tailoring_changes");
      await route.fulfill({ contentType: "text/event-stream", body: nativeTool("migrated-generate", "generate_tailoring_changes", { session: currentTailoringSession }) });
      return;
    }
    if (observation.name === "generate_tailoring_changes") {
      await route.fulfill({ contentType: "text/event-stream", body: nativeFinal("当前修改建议已生成，请在任务产物中逐项核对。") });
      return;
    }
    if (observation.name === "apply_tailoring_changes") {
      await route.fulfill({ contentType: "text/event-stream", body: nativeFinal("迁移后的岗位定制简历已完成。") });
      return;
    }
    await route.fulfill({ contentType: "text/event-stream", body: nativeFinal("当前任务已安全恢复，请继续核对任务产物。") });
  });

  await page.goto("/ai-workspace");
  await page.waitForTimeout(1_000);
  const initialProjection = await readSessionProjection(page);
  if (initialProjection.agentSessionSchemaVersion !== 2 || initialProjection.migrationNoticeCount !== 1 || initialProjection.staleActivityState !== "recovered") {
    throw new Error(`legacy session did not persist migration: ${JSON.stringify(initialProjection)}`);
  }
  expect(initialProjection).toMatchObject({
    agentSessionSchemaVersion: 2,
    selectedProfileId: entities.profileId,
    selectedResumeId: entities.resumeId,
    selectedJobId: entities.jobId,
    stage: "analyze_fit",
    pendingConfirmation: undefined,
    pendingToolCall: undefined,
    migrationNoticeCount: 1,
    staleActivityState: "recovered",
    staleUserExecutionState: "complete"
  });
  await expect(page.getByText(/问题 39\/39|问题 59\/59/)).toHaveCount(0);
  await expect(page.getByText("旧确认")).toHaveCount(0);

  const oldAssistant = page.locator('[data-message-id="assistant-old"]');
  await expect(oldAssistant).toBeVisible();
  await oldAssistant.getByRole("button", { name: "重新生成" }).click();
  await expect.poll(() => readSessionProjection(page)).toMatchObject({
    regenerationBlocked: "legacy_domain_checkpoint_missing"
  });
  await page.getByLabel("描述你的求职任务").fill("继续恢复当前岗位定制任务");
  await page.getByRole("button", { name: "发送消息" }).click();

  for (let index = 0; index < 5; index += 1) {
    const current = await readSessionProjection(page);
    if (["generate_changes", "preview_changes", "confirm_apply"].includes(String(current.stage)) || await page.locator(".agent-diff-list > article").count() > 0) break;
    const question = page.getByText(/问题 \d+\/\d+/).last();
    const diff = page.locator(".agent-diff-list > article").first();
    const nextBoundary = await Promise.any([
      question.waitFor({ state: "visible", timeout: 30_000 }).then(() => "question" as const),
      diff.waitFor({ state: "visible", timeout: 30_000 }).then(() => "diff" as const)
    ]);
    if (nextBoundary === "diff") break;
    const previousQuestionId = current.activeQuestionId;
    await page.getByLabel("描述你的求职任务").fill("跳过");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect.poll(() => readSessionProjection(page), { timeout: 30_000 }).not.toMatchObject({ activeQuestionId: previousQuestionId });
  }
  await expect.poll(async () => {
    const projection = await readSessionProjection(page);
    return {
      rootGoal: projection.rootGoal,
      stageReady: ["generate_changes", "preview_changes", "confirm_apply"].includes(String(projection.stage))
    };
  }, { timeout: 60_000 }).toMatchObject({
    rootGoal: "create_tailored_resume",
    stageReady: true
  });
  const drawer = page.getByRole("complementary", { name: "任务产物" });
  await expect(drawer).toBeVisible({ timeout: 60_000 });
  const diffArticles = page.locator(".agent-diff-list > article");
  await expect(diffArticles.first()).toBeVisible({ timeout: 60_000 });
  const sourceBranchBefore = await readBranch(page, entities.resumeId);
  const modelCallsBeforeReview = modelToolNames.length;
  const structuredBeforeReview = structuredRequestCount;
  for (;;) {
    const accept = page.locator(".agent-diff-list").getByRole("button", { name: "采用", exact: true }).first();
    if (!(await accept.isVisible().catch(() => false))) break;
    await accept.click();
  }
  await expect.poll(() => modelToolNames.length).toBe(modelCallsBeforeReview);
  await expect.poll(() => structuredRequestCount).toBe(structuredBeforeReview);
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(async () => {
    const result = await readMigratedResult(page, entities, fixture.sessionId) as {
      newJobBranch?: { id?: string };
      session?: {
        activeTurn?: { status?: string };
        taskState?: { stage?: string; completionStatus?: string };
        pendingConfirmation?: unknown;
        pendingToolCall?: unknown;
      };
    };
    return {
      branchCreated: Boolean(result.newJobBranch?.id),
      activeTurnStatus: result.session?.activeTurn?.status,
      stage: result.session?.taskState?.stage,
      completionStatus: result.session?.taskState?.completionStatus,
      pendingConfirmation: Boolean(result.session?.pendingConfirmation),
      pendingToolCall: Boolean(result.session?.pendingToolCall)
    };
  }, { timeout: 30_000 }).toMatchObject({
    branchCreated: true,
    activeTurnStatus: "completed",
    stage: "quality_result",
    completionStatus: "completed",
    pendingConfirmation: false,
    pendingToolCall: false
  });

  const result = await readMigratedResult(page, entities, fixture.sessionId) as {
    sourceBranch?: Record<string, unknown>;
    newJobBranch?: Record<string, unknown>;
    session: {
      pendingConfirmation?: unknown;
      pendingToolCall?: unknown;
      activeTurn?: { status?: string };
      messages: Array<{ id: string; role: string; metadata?: { executionState?: string } }>;
    };
  };
  expect(result.newJobBranch?.id).toBeTruthy();
  expect(result.newJobBranch?.id).not.toBe(entities.resumeId);
  expect(result.sourceBranch).toEqual(sourceBranchBefore);
  expect(result.session.pendingConfirmation).toBeUndefined();
  expect(result.session.pendingToolCall).toBeUndefined();
  expect(result.session.activeTurn?.status).toBe("completed");
  expect(result.session.messages.some((message) => message.role === "user" && message.metadata?.executionState === "running")).toBe(false);
  expect(new Set(result.session.messages.map((message) => message.id)).size).toBe(result.session.messages.length);

  await page.getByRole("button", { name: /产物 \d+/ }).click();
  await expect(page.getByRole("link", { name: "打开简历编辑器" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "打开简历编辑器" }).click();
  await expect(page).toHaveURL(new RegExp(`/resume\\?branchId=${result.newJobBranch?.id}`));
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
  await openManualPageTab(page);
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST", { timeout: 30_000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "下载 PDF" }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  expect(response.status()).toBe(200);
  const pdfPath = testInfo.outputPath("migrated-tailored.pdf");
  await download.saveAs(pdfPath);
  expect(existsSync(pdfPath)).toBe(true);
  const text = execFileSync(resolvePopplerBinary(), [pdfPath, "-"], { encoding: "utf8" });
  expect(text).toContain("同学");
  expect(text).not.toContain("{{");

  await page.reload();
  await expect.poll(() => readSessionProjection(page)).toMatchObject({ migrationNoticeCount: 1 });
});

type ModelBody = {
  messages?: Array<{ role: string; name?: string; content: string }>;
};

type EntityIds = {
  profileId: string;
  profileVersion: number;
  resumeId: string;
  resumeRevisionId?: string;
  jobId: string;
};

async function bypassSetupIfNeeded(page: Page) {
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await skip.click();
    await page.goto("/resume");
  }
}

async function readAuthoritativeEntities(page: Page): Promise<EntityIds> {
  return page.evaluate(async () => {
    const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T,>(db: IDBDatabase, storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const database = await openDatabase();
    const [profiles, branches, jobs] = await Promise.all([
      read<Record<string, unknown>>(database, "profiles"),
      read<Record<string, unknown>>(database, "resumeBranches"),
      read<Record<string, unknown>>(database, "jobDescriptions")
    ]);
    database.close();
    const profile = profiles[0];
    const resume = branches.find((branch) => branch.profileId === profile?.id && (branch.branchPurpose === "general" || branch.purpose === "general"));
    const job = jobs[0];
    if (!profile?.id || !resume?.id || !job?.id) throw new Error("authoritative_demo_entities_missing");
    return {
      profileId: String(profile.id),
      profileVersion: Number(profile.version ?? 1),
      resumeId: String(resume.id),
      resumeRevisionId: typeof resume.currentRevisionId === "string" ? resume.currentRevisionId : undefined,
      jobId: String(job.id)
    };
  });
}

async function seedLegacySession(page: Page, entities: EntityIds) {
  return page.evaluate(async (input) => {
    const now = new Date().toISOString();
    const sessionId = "agent-session-p43d2-legacy";
    const operationId = "legacy-answer-operation";
    const oldQuestionPlan = {
      id: "legacy-question-plan",
      revision: 1,
      questionIds: Array.from({ length: 39 }, (_, index) => `legacy-question-${index + 1}`),
      activeQuestionId: "legacy-question-1"
    };
    const oldDiff = {
      target: { sectionId: "summary", itemId: "legacy-summary", fieldPath: "text" },
      operation: "replace",
      original: "旧版摘要",
      value: "旧版修改建议",
      reason: "旧版建议",
      requirementIds: [],
      targetKeywords: [],
      evidenceRefs: [],
      supportLevel: "verified"
    };
    const taskState = {
      goal: "create_tailored_resume",
      rootGoal: "create_tailored_resume",
      activeGoal: "clarify_tailoring",
      workflowId: "tailor_existing_resume",
      stage: "clarify_unsupported_facts",
      requiredSlots: ["profileId", "resumeId", "jobId"],
      knownSlots: {
        pendingConfirmation: { toolName: "answer_tailoring_question", operationId },
        tailoringSession: {
          tailoringRuntimeVersion: 1,
          id: "legacy-tailoring-session",
          revision: 2,
          plan: {
            clarificationQuestions: Array.from({ length: 39 }, (_, index) => ({ id: `legacy-question-${index + 1}`, question: `旧问题 ${index + 1}` })),
            questionPlan: oldQuestionPlan,
            diffs: [oldDiff]
          }
        }
      },
      missingSlots: [],
      selectedEntities: {
        profileId: input.profileId,
        profileVersion: input.profileVersion,
        resumeId: input.resumeId,
        resumeRevisionId: input.resumeRevisionId,
        jobId: input.jobId,
        tailoringSessionId: "legacy-tailoring-session"
      },
      dependencySnapshots: { fitResult: { profileId: input.profileId, resumeId: input.resumeId, jobId: input.jobId } },
      artifacts: [],
      completionStatus: "waiting_for_confirmation",
      computeTier: "T1",
      updatedAt: now
    };
    const session = {
      id: sessionId,
      title: "旧版岗位定制会话",
      messages: [],
      sessionRevision: 0,
      workflowState: {
        workflowId: "tailor_existing_resume",
        step: "clarify_unsupported_facts",
        status: "waiting_for_confirmation",
        toolCallCount: 4,
        data: {}
      },
      artifactRefs: [],
      activeProfileId: input.profileId,
      activeResumeId: input.resumeId,
      activeJobId: input.jobId,
      conversationSummary: "旧版会话摘要",
      pendingConfirmation: {
        id: "legacy-confirmation",
        operationId,
        toolName: "answer_tailoring_question",
        title: "确认回答",
        description: "旧确认",
        destructive: false,
        status: "pending",
        requestedAt: now
      },
      pendingToolCall: { toolName: "answer_tailoring_question", operationId, input: { answer: "旧答案" } },
      activeTurn: { id: "legacy-turn", sessionId, status: "completed", startedAt: now, completedAt: now },
      taskState,
      turnCheckpoints: [],
      archived: false,
      createdAt: now,
      updatedAt: now
    };
    const messages = [
      {
        id: "user-old",
        sessionId,
        sequence: 0,
        turnId: "legacy-turn",
        role: "user",
        content: "原始用户回答",
        status: "complete",
        metadata: { executionState: "running" },
        createdAt: now
      },
      {
        id: "tool-old",
        sessionId,
        sequence: 1,
        turnId: "legacy-turn",
        role: "tool",
        content: "等待回答写入",
        kind: "tool_status",
        type: "tool_status",
        status: "pending",
        toolName: "answer_tailoring_question",
        operationId,
        metadata: { activityState: "running" },
        createdAt: now
      },
      {
        id: "assistant-old",
        sessionId,
        sequence: 2,
        turnId: "legacy-turn",
        role: "assistant",
        content: "旧版已完成一部分岗位定制。",
        kind: "text",
        type: "text",
        status: "complete",
        errorCode: "provider_textual_tool_protocol",
        userMessageId: "user-old",
        metadata: { errorType: "provider" },
        createdAt: now
      },
      {
        id: "assistant-later",
        sessionId,
        sequence: 3,
        turnId: "legacy-later-turn",
        role: "assistant",
        content: "旧版后续进度已写入，但缺少早期回合检查点。",
        kind: "text",
        type: "text",
        status: "complete",
        createdAt: now
      }
    ];
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["agentSessions", "agentMessages"], "readwrite");
    transaction.objectStore("agentSessions").put(session);
    for (const message of messages) transaction.objectStore("agentMessages").put(message);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    localStorage.setItem("careeradapt.agent.activeSessionId", sessionId);
    return { sessionId };
  }, entities);
}

async function readSessionProjection(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const get = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    const messages = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const get = database.transaction("agentMessages", "readonly").objectStore("agentMessages").getAll();
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
    const id = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === id) ?? sessions[0];
    const taskState = session?.taskState as Record<string, unknown> | undefined;
    const selected = taskState?.selectedEntities as Record<string, unknown> | undefined;
    const knownSlots = taskState?.knownSlots as Record<string, unknown> | undefined;
    const questionPlan = knownSlots?.questionPlan as Record<string, unknown> | undefined;
    const sessionMessages = messages.filter((message) => message.sessionId === session?.id);
    const blocked = sessionMessages.find((message) => (message.metadata as Record<string, unknown> | undefined)?.regenerationBlocked === "legacy_domain_checkpoint_missing");
    const stale = sessionMessages.find((message) => message.id === "tool-old");
    const staleUser = sessionMessages.find((message) => message.id === "user-old");
    const projection = {
      id: session?.id,
      activeSessionId: id,
      agentSessionSchemaVersion: session?.agentSessionSchemaVersion,
      sessionRevision: session?.sessionRevision,
      rootGoal: taskState?.rootGoal,
      stage: taskState?.stage,
      activeQuestionId: questionPlan?.activeQuestionId,
      selectedProfileId: selected?.profileId,
      selectedResumeId: selected?.resumeId,
      selectedJobId: selected?.jobId,
      pendingConfirmation: session?.pendingConfirmation,
      pendingToolCall: session?.pendingToolCall,
      migrationNoticeCount: sessionMessages.filter((message) => message.id === "agent-system-tailoring-runtime-v2-upgrade").length,
      staleActivityState: (stale?.metadata as Record<string, unknown> | undefined)?.activityState,
      staleUserExecutionState: (staleUser?.metadata as Record<string, unknown> | undefined)?.executionState,
      regenerationBlocked: (blocked?.metadata as Record<string, unknown> | undefined)?.regenerationBlocked,
      allSessions: sessions.map((candidate) => ({
        id: candidate.id,
        version: candidate.agentSessionSchemaVersion,
        revision: candidate.sessionRevision,
        stage: (candidate.taskState as Record<string, unknown> | undefined)?.stage,
        pendingToolName: (candidate.pendingToolCall as Record<string, unknown> | undefined)?.toolName
      }))
    };
    database.close();
    return {
      ...projection,
      session: {
        ...session,
        messages: sessionMessages
      }
    };
  });
}

async function readMigratedResult(page: Page, entities: EntityIds, sessionId: string) {
  return page.evaluate(async (input) => {
    const open = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T,>(database: IDBDatabase, storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const database = await open();
    const [branches, sessions, messages] = await Promise.all([
      read<Record<string, unknown>>(database, "resumeBranches"),
      read<Record<string, unknown>>(database, "agentSessions"),
      read<Record<string, unknown>>(database, "agentMessages")
    ]);
    database.close();
    const session = sessions.find((candidate) => candidate.id === input.sessionId) ?? sessions[0];
    const sessionMessages = messages.filter((message) => message.sessionId === session?.id);
    const sourceBranch = branches.find((branch) => branch.id === input.resumeId);
    const newJobBranch = branches.find((branch) => branch.jobId === input.jobId && branch.id !== input.resumeId && branch.lifecycleStatus !== "archived");
    return {
      sourceBranch,
      newJobBranch,
      session: { ...session, messages: sessionMessages }
    };
  }, { ...entities, sessionId });
}

async function readBranch(page: Page, branchId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const branch = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const get = database.transaction("resumeBranches", "readonly").objectStore("resumeBranches").get(id);
      get.onsuccess = () => resolve(get.result as Record<string, unknown> | undefined);
      get.onerror = () => reject(get.error);
    });
    database.close();
    return branch;
  }, branchId);
}

function toolObservations(body: ModelBody) {
  const messages = body.messages ?? [];
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  return messages.slice(latestUserIndex + 1).filter((message) => message.role === "tool").map((message) => ({
    name: message.name ?? "",
    content: message.content
  }));
}

function latestUserMessage(body: ModelBody) {
  return [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "";
}

function readToolObservation(content: string) {
  try {
    const envelope = JSON.parse(content) as Record<string, unknown>;
    return (envelope.observation ?? envelope) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function currentQuestion(session: Record<string, unknown> | undefined) {
  const plan = recordValue(recordValue(session?.plan));
  const questionPlan = recordValue(plan?.questionPlan);
  const activeId = typeof questionPlan?.activeQuestionId === "string" ? questionPlan.activeQuestionId : undefined;
  if (!activeId || !Array.isArray(plan?.clarificationQuestions)) return undefined;
  return plan.clarificationQuestions.map(recordValue).find((question) => question?.id === activeId);
}

function nativeTool(id: string, name: string, args: Record<string, unknown>) {
  const call = { id, name, arguments: args };
  return sse([
    ["model_tool_call_start", { type: "model_tool_call_start", index: 0, id, name }],
    ["model_tool_call_complete", { type: "model_tool_call_complete", index: 0, call }],
    ["model_finish", { type: "model_finish", stopReason: "tool_calls" }]
  ]);
}

function nativeAsk(message: string) {
  return sse([
    ["model_text_delta", { type: "model_text_delta", delta: message }],
    ["model_finish", { type: "model_finish", stopReason: "ask_user" }]
  ]);
}

function nativeFinal(message: string) {
  return sse([
    ["model_text_delta", { type: "model_text_delta", delta: message }],
    ["model_finish", { type: "model_finish", stopReason: "final" }]
  ]);
}

function sse(events: Array<[string, Record<string, unknown>]>) {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function resolvePopplerBinary() {
  return [
    "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
    "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
  ].find((candidate) => existsSync(candidate)) ?? "pdftotext";
}
