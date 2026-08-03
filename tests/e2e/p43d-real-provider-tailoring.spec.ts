import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openManualPageTab } from "./support/g7b2Ui";

test("P4.3d real provider generates one grounded consolidated tailoring draft", async ({ request }) => {
  test.setTimeout(180_000);
  const response = await request.post("/api/ai/structured", {
    data: {
      task: "resume-tailor-batch",
      input: {
        draftId: "p43d-anonymous-draft",
        profileId: "p43d-anonymous-profile",
        jobId: "p43d-anonymous-job",
        intensity: "balanced",
        compactJobContext: {
          title: "AI 质量工程师",
          roleMission: "设计可追溯的 AI 质量验证流程",
          topResponsibilities: ["设计 AI 任务", "验收输出质量", "复盘失败案例"],
          targetKeywords: ["AI 质量", "自动化测试", "任务设计", "验收"]
        },
        targets: [
          target({
            itemId: "summary-1",
            sectionType: "summary",
            fieldPath: "text",
            structuredItem: {
              id: "summary-1",
              sectionType: "summary",
              text: "负责 AI 应用需求拆解、质量验收与迭代复盘。",
              customFields: []
            },
            before: "负责 AI 应用需求拆解、质量验收与迭代复盘。"
          }),
          target({
            itemId: "skills-1",
            sectionType: "skills",
            fieldPath: "description",
            structuredItem: {
              id: "skills-1",
              sectionType: "skills",
              name: "自动化测试",
              description: "使用 TypeScript 与 Playwright 编写回归测试。",
              customFields: []
            },
            before: "使用 TypeScript 与 Playwright 编写回归测试。"
          }),
          target({
            itemId: "project-1",
            sectionType: "project",
            fieldPath: "highlights",
            structuredItem: {
              id: "project-1",
              sectionType: "project",
              title: "匿名 AI 工作流项目",
              role: "项目负责人",
              current: false,
              tools: ["TypeScript", "Playwright"],
              highlights: ["设计多步骤任务流程并建立自动化验收用例。"],
              outcomes: [],
              customFields: []
            },
            before: ["设计多步骤任务流程并建立自动化验收用例。"]
          })
        ]
      }
    }
  });
  expect(response.status()).toBe(200);
  const result = await response.json() as {
    ok: boolean;
    output?: { suggestions?: Array<{ itemId?: string; targetItemId?: string; after?: string | string[] }> };
    meta?: { provider?: string; model?: string; latencyMs?: number };
    errorCode?: string;
  };
  expect(result.ok, result.errorCode).toBe(true);
  expect(result.output?.suggestions?.length).toBeGreaterThan(0);
  expect(result.output?.suggestions?.length).toBeLessThanOrEqual(3);
  for (const suggestion of result.output?.suggestions ?? []) {
    expect(["summary-1", "skills-1", "project-1"]).toContain(suggestion.targetItemId ?? suggestion.itemId);
    expect(suggestion.after).toBeTruthy();
  }
  console.info("[p43d-real-provider]", {
    provider: result.meta?.provider,
    model: result.meta?.model,
    generationCalls: 1,
    targetCount: 3,
    generatedDiffCount: result.output?.suggestions?.length ?? 0,
    latencyMs: result.meta?.latencyMs
  });
});

test("P4.3d real provider completes the browser tailoring journey through PDF", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl: "https://server-environment.invalid/v1",
      apiKey: "server-environment",
      model: "server-environment",
      provider: "openai-compatible"
    }));
    localStorage.removeItem("careeradapt.agent.activeSessionId");
  });
  await page.route("**/api/**", async (route) => {
    if (!/\/api\/(agent\/stream|ai\/structured)/.test(route.request().url())) {
      await route.continue();
      return;
    }
    const headers = { ...route.request().headers() };
    delete headers["x-ai-config"];
    await route.continue({ headers });
  });

  const entities = await prepareBrowserEntities(page);
  const branchesBefore = await readStore(page, "resumeBranches");
  const modelRequestNames: string[] = [];
  const modelRequestLatencyMs: number[] = [];
  const structuredTasks: string[] = [];
  const structuredMeta: Array<{ provider?: string; model?: string; latencyMs?: number }> = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const requestStarted = new WeakMap<object, number>();

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (/\/api\/(agent\/stream|ai\/structured)/.test(request.url())) {
      requestFailures.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown"}`);
    }
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/agent/stream")) {
      requestStarted.set(request, Date.now());
      try {
        const body = request.postDataJSON() as { messages?: Array<{ role?: string; name?: string }> };
        const latestTool = [...(body.messages ?? [])].reverse().find((message) => message.role === "tool");
        if (latestTool?.name) modelRequestNames.push(latestTool.name);
      } catch {
        // The request body is diagnostic-only; the browser journey remains authoritative.
      }
    }
    if (request.url().includes("/api/ai/structured")) {
      try {
        structuredTasks.push(String((request.postDataJSON() as { task?: string }).task ?? "unknown"));
      } catch {
        structuredTasks.push("unknown");
      }
    }
  });
  page.on("response", async (response) => {
    if (response.url().includes("/api/agent/stream")) {
      const started = requestStarted.get(response.request());
      if (started) modelRequestLatencyMs.push(Date.now() - started);
    }
    if (response.url().includes("/api/ai/structured")) {
      try {
        const body = await response.json() as { meta?: { provider?: string; model?: string; latencyMs?: number } };
        if (body.meta) structuredMeta.push(body.meta);
      } catch {
        // The failure is asserted through the request/response state below.
      }
    }
  });

  await page.goto("/ai-workspace");
  await bypassSetupIfNeeded(page);
  const quickAction = page.getByRole("button", { name: /生成岗位定制简历/ });
  if (!(await quickAction.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "新任务", exact: true }).click();
  }
  await expect(quickAction).toBeVisible({ timeout: 20_000 });
  await quickAction.click();

  let questionCount = 0;
  let candidateQuestionCount = 0;
  let planContinuationCount = 0;
  let selectedJobId = entities.jobId;
  const startedAt = Date.now();
  for (let step = 0; step < 18; step += 1) {
    const task = await readActiveTask(page);
    if (task?.rootGoal !== "create_tailored_resume" || task.workflowId !== "tailor_existing_resume") {
      throw new Error(`real provider left tailoring root: ${JSON.stringify(task)}`);
    }
    const questionPlan = task.questionPlan;
    candidateQuestionCount = Math.max(candidateQuestionCount, questionPlan?.questionIds?.length ?? 0);
    if (["preview_changes", "confirm_apply", "quality_result"].includes(String(task.stage))) break;
    if (task.activeQuestionId) {
      questionCount += 1;
      if (questionCount > 5) throw new Error(`real provider exceeded question maximum: ${JSON.stringify(task)}`);
      const priorQuestionId = task.activeQuestionId;
      await page.getByLabel("描述你的求职任务").fill("跳过");
      await page.getByRole("button", { name: "发送消息" }).click();
      await expect.poll(() => readActiveTask(page), { timeout: 90_000 }).not.toMatchObject({ activeQuestionId: priorQuestionId });
      continue;
    }
    if (task.stage === "generate_plan" && planContinuationCount < 3) {
      planContinuationCount += 1;
      const continuation = planContinuationCount === 1
        ? "岗位匹配分析已经完成，请不要重复调用 analyze_job_fit，直接创建岗位定制会话并继续生成方案。"
        : "当前任务已经处于 generate_plan 阶段。不要重新分析岗位，请调用 create_tailoring_session，使用已经选定的 Profile、Resume 和 Job 继续。";
      await page.getByLabel("描述你的求职任务").fill(continuation);
      await page.getByRole("button", { name: "发送消息" }).click();
      continue;
    }
    if (task.stage === "generate_plan") {
      throw new Error(`real provider did not create a tailoring session after bounded continuation: ${JSON.stringify(task)}`);
    }
    if (task.stage === "choose_resume_source") {
      const resumeCandidate = task.resumeCandidates.find((item: Record<string, unknown>) => String(item.id) === entities.resumeId) ?? task.resumeCandidates[0];
      const resumeName = String(resumeCandidate?.name ?? "资料库简历");
      const resumeOption = page.getByRole("button", { name: resumeName, exact: true }).last();
      try {
        await resumeOption.click({ timeout: 5_000 });
        await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).not.toMatchObject({ stage: "choose_resume_source" });
        continue;
      } catch {
        // Use the typed resume picker when the model message has no rendered option.
      }
      try {
        await page.getByRole("button", { name: "选择简历", exact: true }).last().click();
        const picker = page.getByRole("dialog", { name: "选择简历" });
        await picker.getByRole("button").filter({ hasText: resumeName }).last().click();
        await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).not.toMatchObject({ stage: "choose_resume_source" });
        continue;
      } catch {
        // Fall back to the typed name only when the picker is unavailable.
      }
      await page.getByLabel("描述你的求职任务").fill(`使用${resumeName}继续当前岗位定制任务`);
      await page.getByRole("button", { name: "发送消息" }).click();
      continue;
    }
    if (task.stage === "choose_job") {
      const candidates = task.jobCandidates;
      const candidate = candidates.find((item: Record<string, unknown>) => String(item.id) === selectedJobId) ?? candidates[0];
      if (candidate?.id) selectedJobId = String(candidate.id);
      const candidateLabel = candidate
        ? `${String(candidate.title ?? "未命名岗位")}${candidate.company ? ` · ${String(candidate.company)}` : ""}`
        : entities.jobTitle;
      const candidateTitle = String(candidate?.title ?? entities.jobTitle);
      const namedJobOption = page.getByRole("button", { name: new RegExp(candidateTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).last();
      try {
        await namedJobOption.click({ timeout: 5_000 });
        await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).not.toMatchObject({ stage: "choose_job" });
        continue;
      } catch {
        // The provider can finish the candidate response after the task state is persisted.
        // Give the current option group a short bounded chance before sending text.
      }
      const firstJobOption = page.locator(".agent-message-options").last().getByRole("button").first();
      try {
        await firstJobOption.click({ timeout: 5_000 });
        await expect.poll(() => readActiveTask(page), { timeout: 30_000 }).not.toMatchObject({ stage: "choose_job" });
        continue;
      } catch {
        // Fall back to the typed label only when the current response has no option buttons.
      }
      await page.getByLabel("描述你的求职任务").fill(candidateLabel);
      await page.getByRole("button", { name: "发送消息" }).click();
      continue;
    }
    await page.waitForTimeout(500);
  }
  await expect.poll(() => readActiveTask(page), { timeout: Math.max(30_000, 120_000 - (Date.now() - startedAt)) }).toMatchObject({
    rootGoal: "create_tailored_resume",
    workflowId: "tailor_existing_resume",
    stage: expect.stringMatching(/preview_changes|confirm_apply/)
  });

  const generatedTask = await readActiveTask(page);
  const generatedPlan = generatedTask.tailoringPlan;
  const generatedDiffCount = generatedPlan?.diffs?.length ?? 0;
  const locallyBlockedDiffCount = generatedPlan?.diffs?.filter((diff) => diff.supportLevel === "blocked" || diff.status === "blocked").length ?? 0;
  expect(generatedDiffCount).toBeGreaterThan(0);
  expect(generatedDiffCount).toBeLessThanOrEqual(20);
  expect(candidateQuestionCount).toBeLessThanOrEqual(5);
  const agentCallsBeforeReview = modelRequestNames.length;
  const structuredCallsBeforeReview = structuredTasks.length;
  let acceptedCount = 0;
  let editedCount = 0;
  let rejectedCount = 0;
  for (;;) {
    const accept = page.locator(".agent-diff-list").getByRole("button", { name: "采用", exact: true }).first();
    if (await accept.isVisible().catch(() => false)) {
      await accept.click();
      acceptedCount += 1;
      continue;
    }
    const edit = page.locator(".agent-diff-list").getByRole("button", { name: "编辑后采用", exact: true }).first();
    if (await edit.isVisible().catch(() => false)) {
      await edit.click();
      editedCount += 1;
      continue;
    }
    const reject = page.locator(".agent-diff-list").getByRole("button", { name: "忽略", exact: true }).first();
    if (await reject.isVisible().catch(() => false)) {
      await reject.click();
      rejectedCount += 1;
      continue;
    }
    break;
  }
  expect(modelRequestNames.length).toBe(agentCallsBeforeReview);
  expect(structuredTasks.length).toBe(structuredCallsBeforeReview);
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "确认", exact: true }).click();

  const settled = await expect.poll(async () => {
    const result = await readTailoringResult(page, entities.resumeId, selectedJobId, branchesBefore);
    const session = result.session as Record<string, unknown> | undefined;
    const activeTurn = session?.activeTurn as Record<string, unknown> | undefined;
    const taskState = session?.taskState as Record<string, unknown> | undefined;
    return {
      branchCreated: Boolean(result.newBranch?.id),
      activeTurnStatus: activeTurn?.status,
      pendingConfirmation: Boolean(session?.pendingConfirmation),
      pendingToolCall: Boolean(session?.pendingToolCall),
      stage: taskState?.stage,
      completionStatus: taskState?.completionStatus
    };
  }, { timeout: 90_000 }).toMatchObject({
    branchCreated: true,
    activeTurnStatus: "completed",
    pendingConfirmation: false,
    pendingToolCall: false,
    stage: "quality_result",
    completionStatus: "completed"
  });
  void settled;
  const result = await readTailoringResult(page, entities.resumeId, selectedJobId, branchesBefore);
  const resultSession = result.session as Record<string, unknown> | undefined;
  const resultMessages = Array.isArray(resultSession?.messages)
    ? resultSession.messages as Array<Record<string, unknown>>
    : [];
  expect(result.newBranch?.id).toBeTruthy();
  expect(result.newBranch?.id).not.toBe(entities.resumeId);
  expect(result.sourceBranch).toEqual(result.sourceBefore);
  const actualToolNames = resultMessages
    .map((message) => typeof message.toolName === "string" ? message.toolName : undefined)
    .filter((name): name is string => Boolean(name));
  expect(resultMessages.some((message) => {
    const metadata = message.metadata as Record<string, unknown> | undefined;
    return message.role === "user" && metadata?.executionState === "running";
  })).toBe(false);
  expect(actualToolNames.filter((name) => name === "analyze_job_fit")).toHaveLength(1);
  expect(actualToolNames.filter((name) => name === "create_tailoring_session")).toHaveLength(1);
  expect(actualToolNames.filter((name) => name === "generate_tailoring_changes")).toHaveLength(1);
  expect(actualToolNames.filter((name) => name === "apply_tailoring_changes")).toHaveLength(1);

  const sourcePresentation = result.sourcePresentation;
  const newPresentation = result.newPresentation;
  const presentationChangedKeys = changedKeys(stripPresentationIdentity(sourcePresentation), stripPresentationIdentity(newPresentation));
  expect(presentationChangedKeys).toEqual([]);

  await page.getByRole("button", { name: /产物 \d+/ }).click();
  const editorLink = page.getByRole("link", { name: "打开简历编辑器" }).last();
  await expect(editorLink).toBeVisible({ timeout: 30_000 });
  await editorLink.click();
  await expect(page).toHaveURL(new RegExp(`/resume\\?branchId=${result.newBranch?.id}`));
  await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
  await openManualPageTab(page);
  const pdfStarted = Date.now();
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST", { timeout: 30_000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "下载 PDF" }).click();
  const [pdfResponse, download] = await Promise.all([responsePromise, downloadPromise]);
  const pdfLatencyMs = Date.now() - pdfStarted;
  expect(pdfResponse.status()).toBe(200);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const pdfPath = testInfo.outputPath("real-provider-tailored.pdf");
  await download.saveAs(pdfPath);
  expect(existsSync(pdfPath)).toBe(true);
  const pdfText = execFileSync(resolvePopplerBinary(), [pdfPath, "-"], { encoding: "utf8" });
  expect(pdfText).toMatch(/[\u4e00-\u9fff]/u);
  expect(pdfText).not.toContain("{{");

  const telemetry = {
    provider: structuredMeta.find((meta) => meta.provider)?.provider,
    model: structuredMeta.find((meta) => meta.model)?.model,
    analyzeLatencyMs: structuredMeta.find((meta, index) => structuredTasks[index] === "resume-tailor-batch")?.latencyMs,
    planLatencyMs: structuredMeta.filter((meta, index) => structuredTasks[index]?.startsWith("resume-tailor"))[0]?.latencyMs,
    candidateQuestionCount,
    selectedQuestionCount: questionCount,
    finalQuestionCount: questionCount,
    answerToolCount: actualToolNames.filter((name) => name === "answer_tailoring_question").length,
    consolidatedGenerationLatencyMs: structuredMeta.find((meta, index) => structuredTasks[index] === "resume-tailor-batch")?.latencyMs,
    generatedDiffCount,
    locallyBlockedDiffCount,
    acceptedCount,
    editedCount,
    rejectedCount,
    applyLatencyMs: modelRequestLatencyMs.at(-1),
    pdfLatencyMs,
    agentRequestCount: modelRequestNames.length,
    structuredRequestCount: structuredTasks.length,
    pageErrors,
    requestFailures
  };
  await testInfo.attach("real-provider-telemetry.json", {
    body: JSON.stringify(telemetry, null, 2),
    contentType: "application/json"
  });
  console.info("[p43d-real-provider-browser]", telemetry);
  expect(pageErrors).toEqual([]);
  expect(requestFailures).toEqual([]);
});

async function bypassSetupIfNeeded(page: Page) {
  const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  if (await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await skip.click();
    await page.goto("/resume");
  }
}

async function prepareBrowserEntities(page: Page) {
  await page.goto("/resume");
  await bypassSetupIfNeeded(page);
  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const counts = await Promise.all(["profiles", "resumeBranches", "jobDescriptions"].map((storeName) => new Promise<number>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })));
    database.close();
    return { profiles: counts[0], resumeBranches: counts[1], jobDescriptions: counts[2] };
  }), { timeout: 30_000 }).toMatchObject({ profiles: 1, jobDescriptions: expect.any(Number) });
  const createGeneralResume = page.getByRole("button", { name: /从个人资料库创建/ });
  if (await createGeneralResume.isVisible().catch(() => false)) {
    await createGeneralResume.click();
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 30_000 });
    await page.goto("/resume");
  }
  return page.evaluate(async () => {
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
    const [profiles, branches, jobs] = await Promise.all([
      read<Record<string, unknown>>(database, "profiles"),
      read<Record<string, unknown>>(database, "resumeBranches"),
      read<Record<string, unknown>>(database, "jobDescriptions")
    ]);
    database.close();
    const profile = profiles[0];
    const resume = branches.find((candidate) => candidate.profileId === profile?.id && (candidate.branchPurpose === "general" || candidate.purpose === "general"));
    const job = jobs[0];
    if (!profile?.id || !resume?.id || !job?.id) {
      throw new Error(`real_provider_demo_entities_missing:${JSON.stringify({ profiles: profiles.length, branches: branches.length, jobs: jobs.length, profileId: profile?.id, resumeId: resume?.id, jobId: job?.id })}`);
    }
    return {
      profileId: String(profile.id),
      resumeId: String(resume.id),
      jobId: String(job.id),
      jobTitle: String(job.title ?? "已保存岗位"),
      profileVersion: Number(profile.version ?? 1)
    };
  });
}

async function readStore(page: Page, storeName: string) {
  return page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const values = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = database.transaction(name, "readonly").objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return values;
  }, storeName);
}

async function readActiveTask(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const activeId = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === activeId) ?? sessions.at(-1);
    const task = session?.taskState as Record<string, unknown> | undefined;
    const known = (task?.knownSlots as Record<string, unknown> | undefined) ?? {};
    const tailoring = (known.tailoringSession as Record<string, unknown> | undefined) ?? {};
    const tailoringPlan = (tailoring.plan as Record<string, unknown> | undefined) ?? {};
    const questionPlan = (known.questionPlan as Record<string, unknown> | undefined)
      ?? (tailoringPlan.questionPlan as Record<string, unknown> | undefined);
    return {
      rootGoal: task?.rootGoal,
      workflowId: task?.workflowId,
      stage: task?.stage,
      completionStatus: task?.completionStatus,
      activeQuestionId: typeof known.activeQuestionId === "string" ? known.activeQuestionId : questionPlan?.activeQuestionId,
      jobCandidates: Array.isArray(known.jobCandidates) ? known.jobCandidates : [],
      resumeCandidates: Array.isArray(known.resumeCandidates) ? known.resumeCandidates : [],
      questionPlan: questionPlan ? {
        questionIds: Array.isArray(questionPlan.questionIds) ? questionPlan.questionIds : [],
        activeQuestionId: questionPlan.activeQuestionId
      } : undefined,
      tailoringPlan: {
        diffs: Array.isArray(tailoringPlan.diffs) ? tailoringPlan.diffs : [],
        diffReviews: Array.isArray(tailoringPlan.diffReviews) ? tailoringPlan.diffReviews : []
      },
      taskState: task,
      activeTurnStatus: (session?.activeTurn as Record<string, unknown> | undefined)?.status
    };
  });
}

async function readTailoringResult(page: Page, resumeId: string, jobId: string, branchesBefore: Array<Record<string, unknown>>) {
  return page.evaluate(async (input) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T,>(storeName: string) => new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const readMeta = (key: string) => new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = database.transaction("appMeta", "readonly").objectStore("appMeta").get(key);
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error);
    });
    const [branches, sessions, messages] = await Promise.all([
      read<Record<string, unknown>>("resumeBranches"),
      read<Record<string, unknown>>("agentSessions"),
      read<Record<string, unknown>>("agentMessages")
    ]);
    const beforeIds = new Set(input.branchesBefore.map((branch) => String(branch.id)));
    const newBranch = branches.find((branch) => branch.jobId === input.jobId && branch.id !== input.resumeId && !beforeIds.has(String(branch.id)) && branch.lifecycleStatus !== "archived");
    const [sourcePresentation, newPresentation] = await Promise.all([
      readMeta(`resumePresentationConfig:${input.resumeId}`),
      newBranch?.id ? readMeta(`resumePresentationConfig:${newBranch.id}`) : Promise.resolve(undefined)
    ]);
    database.close();
    const sessionId = localStorage.getItem("careeradapt.agent.activeSessionId");
    const session = sessions.find((candidate) => candidate.id === sessionId) ?? sessions.at(-1);
    const sessionMessages = messages.filter((message) => message.sessionId === session?.id);
    const sourceBranch = branches.find((branch) => branch.id === input.resumeId);
    const presentation = sourcePresentation?.value;
    const newPresentationValue = newPresentation?.value;
    return {
      sourceBranch,
      sourceBefore: input.branchesBefore.find((branch) => branch.id === input.resumeId),
      newBranch,
      sourcePresentation: presentation,
      newPresentation: newPresentationValue,
      session: session ? { ...session, messages: sessionMessages, taskState: session.taskState } : undefined
    };
  }, { resumeId, jobId, branchesBefore });
}

function stripPresentationIdentity(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const identityFields = new Set(["branchId", "contentRevision", "updatedAt"]);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !identityFields.has(key)));
}

function changedKeys(left: unknown, right: unknown) {
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) return ["presentation"];
  const keys = new Set([...Object.keys(left as Record<string, unknown>), ...Object.keys(right as Record<string, unknown>)]);
  return [...keys].filter((key) => JSON.stringify((left as Record<string, unknown>)[key]) !== JSON.stringify((right as Record<string, unknown>)[key]));
}

function resolvePopplerBinary() {
  return [
    "E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe",
    "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"
  ].find((candidate) => existsSync(candidate)) ?? "pdftotext";
}

function target(input: {
  itemId: string;
  sectionType: "summary" | "skills" | "project";
  fieldPath: "text" | "description" | "highlights";
  structuredItem: Record<string, unknown>;
  before: string | string[];
}) {
  return {
    ...input,
    sectionId: input.sectionType,
    renderedText: Array.isArray(input.before) ? input.before.join("\n") : input.before,
    relevantRequirements: [{
      requirementId: "req-ai-quality",
      description: "具备 AI 质量验收、任务设计与自动化测试经验",
      priority: "must",
      keywords: ["AI 质量", "任务设计", "自动化测试"],
      relevanceScore: 1
    }],
    allowedEvidenceRefs: [],
    allowedFacts: [{
      value: Array.isArray(input.before) ? input.before.join("\n") : input.before,
      evidenceRefs: []
    }]
  };
}
