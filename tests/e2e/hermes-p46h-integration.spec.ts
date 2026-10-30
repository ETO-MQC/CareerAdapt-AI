import { expect, test, type Page } from "@playwright/test";
import { core02BehaviorCases } from "../agent-eval/core02-behavior-cases";
import { core02Material } from "./support/core02Material";
import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { completeCoreResumeWorkflow, installCoreWritingProvider, prepareCoreSourceResume, readStore, verifyCoreResumePdf } from "./support/p51CoreWorkflow";

test.use({ actionTimeout: 15_000 });

const closeoutTraces = new WeakMap<Page, ReturnType<typeof observeRuntimeAndBridge>>();
const differentialTimelines = new WeakMap<Page, Array<{ stage: string; at: string; elapsedMs: number; status?: number }>>();
const providerOffsets = new WeakMap<Page, number>();
const baselineTimings = new WeakMap<Page, Array<{ stage: string; at: number; durationMs?: number; status?: number }>>();

type SafeHermesEvent = { event?: string; runId?: string; tool?: string; timestamp?: number };
declare global { interface Window { __caseIEvents?: SafeHermesEvent[]; __core02IO?: string[] } }

test.describe("P4.6h hermetic Web + browser MCP integration", () => {
  test.beforeEach(async ({ page }) => {
    providerOffsets.set(page, (await readProviderEvidence(page)).requests.length);
    if (process.env.P518_RUNTIME_BASELINE === "1") {
      const rows: Array<{ stage: string; at: number; durationMs?: number; status?: number }> = [];
      baselineTimings.set(page, rows);
      const stage = (url: string, body: string | null) => {
        const pathname = new URL(url).pathname;
        if (pathname === "/api/agent/runtime/hermes") return `runtime:${parseJson(body)?.action ?? "unknown"}`;
        if (pathname.includes("/api/agent/mcp")) return `mcp:${parseJson(body)?.action ?? "poll"}`;
        if (pathname.includes("pdf")) return "pdf";
        return undefined;
      };
      page.on("request", request => { const name = stage(request.url(), request.postData()); if (name) rows.push({ stage: `${name}:dispatch`, at: Date.now() }); });
      page.on("response", response => { const name = stage(response.url(), response.request().postData()); if (name) rows.push({ stage: `${name}:headers`, at: Date.now(), status: response.status() }); });
      page.on("requestfinished", request => { const name = stage(request.url(), request.postData()); if (name) rows.push({ stage: `${name}:end`, at: Date.now(), durationMs: request.timing().responseEnd }); });
    }
  });
  test.afterEach(async ({ page }, testInfo) => {
    const trace = closeoutTraces.get(page);
    if (process.env.P518_RUNTIME_BASELINE === "1") {
      const provider = (await readProviderEvidence(page)).requests.slice(providerOffsets.get(page) ?? 0);
      const events = await page.evaluate(() => window.__caseIEvents ?? []);
      const safe = { scenario: testInfo.title, status: testInfo.status, providerKind: "simulated", sampleCount: 1,
        testDurationMs: testInfo.duration, requests: baselineTimings.get(page), events,
        provider: provider.map(row => ({ at: row.at, finishedAt: row.finishedAt, payloadBytes: row.payloadBytes })),
        providerCalls: provider.length, hermesSkillViewCount: provider.filter(row => row.selectedTool === "skill_view").length,
        domainSkillLoadCount: null,
        mcpToolCount: trace?.toolRequests.length, toolNames: trace?.toolRequests.map(row => row.name),
        formalWriteCount: trace?.formalWrites.length, formalWrites: trace?.formalWrites.map(row => ({ store: row.store, at: row.at })),
        unobservable: ["provider internal inference", "domain tool internal start/end", "repository method latency", "skill load if Hermes emits no skill event"],
        timeline: differentialTimelines.get(page) };
      await appendFile(".tmp/p518-baseline-" + process.env.HERMES_INTEGRATION_RUN_ID + ".jsonl", JSON.stringify(safe) + "\n");
    }
    const caseReceipt = { timeline: differentialTimelines.get(page), case: testInfo.title.match(/^CASE ([A-N])/u)?.[1], started: true,
      status: testInfo.status, toolSequence: trace?.toolRequests.map(request => request.name),
      runReceipts: trace?.runReceipts, checkpointTransitions: trace?.toolReceipts,
      providerCalls: (await readProviderEvidence(page)).requests.length - (providerOffsets.get(page) ?? 0),
      formalWriteCount: trace?.formalWrites.length, formalWrites: trace?.formalWrites,
      writeScope: "Committed renderer IndexedDB add/put operations after initial fixture readiness, including explicit source import fixtures" };
    await testInfo.attach("case-gate-receipt", { body: JSON.stringify(caseReceipt), contentType: "application/json" });
    await appendFile(`.tmp/core02-case-gate-${process.env.HERMES_INTEGRATION_RUN_ID}.jsonl`, `${JSON.stringify(caseReceipt)}\n`);
    if (!/^CASE [IJKLMN]/u.test(testInfo.title)) return;
    if (/^CASE [LMN]/u.test(testInfo.title)) {
      await testInfo.attach("closeout-provider", { body: JSON.stringify(await readProviderEvidence(page), null, 2), contentType: "application/json" });
      await testInfo.attach("closeout-transport", { body: JSON.stringify(closeoutTraces.get(page), null, 2), contentType: "application/json" });
      for (const name of ["agentSessions", "profiles", "resumeBranches", "jobDescriptions", "appMeta"]) {
        await testInfo.attach(`closeout-${name}`, { body: JSON.stringify(await readStore(page, name), null, 2), contentType: "application/json" });
      }
    }
    const sessions = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const result = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
        result.onerror = () => reject(result.error);
        result.onsuccess = () => {
          database.close();
          resolve(result.result.map(session => ({
            sessionId: session.id, activeTurn: session.activeTurn, hermesRun: session.hermesRun, activeConversationBranchId: session.activeConversationBranchId,
            pendingConfirmation: session.pendingConfirmation ? { operationId: session.pendingConfirmation.operationId, turnId: session.pendingConfirmation.turnId } : null,
            task: session.taskState ? { workflowId: session.taskState.workflowId, stage: session.taskState.stage, completionStatus: session.taskState.completionStatus, selectedEntities: session.taskState.selectedEntities } : null,
            messages: session.messages?.map((message: { id: string; role: string; turnId?: string; status?: string; conversationBranchId?: string }) => ({ id: message.id, role: message.role, turnId: message.turnId, status: message.status, conversationBranchId: message.conversationBranchId }))
          })));
        };
      };
    }));
    await testInfo.attach("host-confirmation-receipt", { body: JSON.stringify(sessions, null, 2), contentType: "application/json" });
  });
  test("CASE A — ordinary greeting completes through official Hermes Runs", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await send(page, "你好");
    await expectAssistant(page, "你好，Hermes hermetic runtime 已就绪。");
    expect(trace.runtimeActions.filter((action) => action === "run_start")).toHaveLength(1);
    expect(trace.runtimeActions.filter((action) => action === "run_events")).toHaveLength(1);
    expect(trace.toolRequests).toHaveLength(0);
  });

  test("CASE B — general career advice stays tool-free", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await send(page, "大学生找工作应该怎么准备？");
    await expectAssistant(page, "你好，Hermes hermetic runtime 已就绪。");
    expect(trace.toolRequests).toHaveLength(0);
  });

  test("CASE C — personal career questions use a read-only Career tool", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await assertHermesReadyForCase(page);
    await send(page, "根据我的经历，你觉得我适合哪些岗位？");
    await expectAssistant(page, "当前示例资料包含 2 个项目经历。");
    await expectToolNames(trace, ["career.profile.get"]);
    expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
    expect(trace.resultActions).toContain("result");
    expect(trace.toolRequests.every((request) => request.name.startsWith("career.") && !request.name.includes("workflow"))).toBe(true);
  });

  test("CASE D — building from zero starts Profile Intake through a facade", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await assertHermesReadyForCase(page);
    await send(page, "我没有简历，从零开始帮我做一份。");
    await expectAssistant(page, "已进入 Profile Intake，并停在下一步资料补充边界。");
    await expectToolNames(trace, ["career.workflow.profile_intake_turn"]);
    expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
  });

  test("CASE E — general Resume review uses compose update_existing", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await prepareCoreSourceResume(page);
    await page.goto("/ai-workspace");
    await startFreshConversation(page);
    await installCoreWritingProvider(page);
    await assertHermesReadyForCase(page);
    await send(page, "帮我看看这份简历有什么问题");
    await expectAssistant(page, "已完成通用简历检查，并停在用户确认边界。");
    await expectToolNames(trace, ["career.resume.list", "career.profile.get", "career.workflow.compose_resume"]);
    expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
    expect(trace.toolRequests.at(-1)?.input).toMatchObject({ mode: "general", generalResumeMode: "update_existing" });
  });

  test("CASE F — pasted JD tailoring uses the canonical workflow facade", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await assertHermesReadyForCase(page);
    await send(page, "根据这个 JD 帮我生成岗位简历");
    await expectAssistant(page, "已读取当前示例岗位，并停在用户确认边界。");
    await expectToolNames(trace, ["career.workflow.tailor_resume"]);
    expect(trace.toolReceipts).toEqual([expect.objectContaining({ result: expect.objectContaining({
      error: expect.objectContaining({ code: "agent_confirmation_required" })
    }) })]);
    expect(trace.toolRequests[0]?.input).toMatchObject({ targetText: expect.any(String) });
    expect(trace.toolRequests.some((request) => request.name.startsWith("career.tailoring."))).toBe(false);
    expect(trace.resultActions).toContain("result");
  });

  test("CASE G — Job Fit stays a comparison workflow", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await prepareCoreSourceResume(page);
    await page.goto("/ai-workspace");
    await startFreshConversation(page);
    await assertHermesReadyForCase(page);
    await send(page, "分析一下我和这个岗位匹不匹配");
    await expectAssistant(page, "已完成岗位匹配比较，并保留证据缺口。");
    await expectToolNames(trace, ["career.resume.list", "career.workflow.job_fit"]);
    expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
  });

  test("CASE H — export uses the dedicated export facade", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await prepareCoreSourceResume(page);
    await page.goto("/ai-workspace");
    await startFreshConversation(page);
    await assertHermesReadyForCase(page);
    await send(page, "导出这份简历");
    await expectAssistant(page, "已准备简历导出产物。");
    await expectToolNames(trace, ["career.resume.list", "career.workflow.resume_export"]);
    expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
  });

  test("CASE K — an attachment submitted while busy executes in the next Hermes Turn", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem("careeradapt-ai-settings") ?? "{}");
      localStorage.setItem("careeradapt.resumeImportAiPreference", JSON.stringify({ schemaVersion: "resume-import-ai-preference-v1", mode: "local", providerFingerprint: [settings.provider, settings.baseUrl, settings.model].join("|") }));
    });
    await send(page, "P512-QUEUE-FIRST");
    await expect(page.getByRole("button", { name: "排队发送消息", exact: true })).toBeVisible();
    await page.locator('.agent-composer input[type="file"]').setInputFiles({ name: "queued-certificate.txt", mimeType: "text/plain", buffer: Buffer.from("证书\n大学英语六级 2025-06") });
    await page.getByLabel("描述你的求职任务").fill("P512-MATERIAL，把这个证书整理到资料库");
    await page.getByRole("button", { name: "排队发送消息", exact: true }).click();
    await expectAssistant(page, "已识别为证书，已生成候选资料，请核对后确认保存。");
    expect(trace.runtimeActions.filter(action => action === "run_start")).toHaveLength(2);
    await expect.poll(() => trace.toolRequests.filter(request => request.name === "career.workflow.material_intake").length).toBe(2);
    await expect(page.locator('.agent-message-attachments')).toContainText("queued-certificate.txt");
  });

  test("CASE J — material source, Hermes classification and Profile draft continue in one Run", async ({ page }) => {
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await expect.poll(async () => (await readStore(page, "appMeta")).some(row => row.key === "demoSeededAt")).toBe(true);
    const profilesBefore = await readStore(page, "profiles");
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem("careeradapt-ai-settings") ?? "{}");
      localStorage.setItem("careeradapt.resumeImportAiPreference", JSON.stringify({ schemaVersion: "resume-import-ai-preference-v1", mode: "local", providerFingerprint: [settings.provider, settings.baseUrl, settings.model].join("|") }));
    });
    await page.locator('.agent-composer input[type="file"]').setInputFiles({ name: "certificate.txt", mimeType: "text/plain", buffer: Buffer.from("证书\n大学英语六级 2025-06") });
    await send(page, "P512-MATERIAL，把这个证书整理到资料库");
    await expectAssistant(page, "已识别为证书，已生成候选资料，请核对后确认保存。");
    expect(trace.runtimeActions.filter(action => action === "run_start")).toHaveLength(1);
    await expect.poll(() => trace.toolRequests.filter(request => request.name === "career.workflow.material_intake").length).toBe(2);
    const receipt = await page.evaluate(() => new Promise<{ sessions: Array<{ hermesRun?: { runId: string; status: string }; artifactRefs: Array<{ kind: string; entityId: string }> }>; formalProfiles: number }>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb"); request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction(["agentSessions", "profiles"], "readonly");
        const sessions = tx.objectStore("agentSessions").getAll(); const profiles = tx.objectStore("profiles").count();
        tx.oncomplete = () => { db.close(); resolve({ sessions: sessions.result, formalProfiles: profiles.result }); };
      };
    }));
    const current = receipt.sessions.find(session => session.hermesRun);
    expect(current?.hermesRun?.status).toBe("completed");
    expect(current?.artifactRefs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "resume_import_review", entityId: expect.stringMatching(/^material-profile:/u) })]));
    expect(receipt.formalProfiles).toBe(profilesBefore.length);
    expect(await readStore(page, "profiles")).toEqual(profilesBefore);
  });

  test("CASE L Core-02 — saved JD, Fit, follow-up tailoring, confirmed isolated revision and PDF", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const trace = observeRuntimeAndBridge(page);
    closeoutTraces.set(page, trace);
    await openWorkspace(page);
    const initialBranchIds = new Set((await readStore(page, "resumeBranches")).map(branch => branch.id));
    await prepareCoreSourceResume(page);
    const branches = await readStore(page, "resumeBranches");
    const source = branches.find(branch => !initialBranchIds.has(branch.id) && branch.branchPurpose === "general")!;
    expect(source).toBeTruthy();
    const profilesBefore = await readStore(page, "profiles");
    await page.goto("/ai-workspace");
    await startFreshConversation(page);
    await assertHermesReadyForCase(page);
    await expect.poll(async () => {
      const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
      return (await readStore(page, "agentSessions")).find(row => row.id === id)?.activeProfileId;
    }).toBe(source.profileId);
    const providerBefore = await readProviderEvidence(page);
    await send(page, "保存这个岗位 CORE-JD：公司 Core Test，数据分析实习生，负责数据清洗，要求了解 Python 或 SQL。");
    await expect(page.locator(".agent-confirmation")).toBeVisible();
    await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
    await expectAssistant(page, "已按你的确认完成当前 Career 工作流。");
    const jobsBefore = await readStore(page, "jobDescriptions");
    await send(page, "P51-C02-FIT 这个岗位适合我吗？");
    await expectAssistant(page, "C02FITCOMPLETE");
    await installCoreWritingProvider(page);
    await send(page, "P51-C02-TAILOR 那按它帮我改简历，别改模板，只改内容。");
    await expectTailoringReview(page, trace);
    const inline = page.locator(".agent-tailoring-inline");
    await expect(inline).toBeVisible();
    if (!await inline.evaluate(element => (element as HTMLDetailsElement).open)) await inline.locator("summary").click();
    for (let index = 0; index < 8 && await inline.getByRole("button", { name: "采用", exact: true }).count(); index++) {
      await inline.getByRole("button", { name: "采用", exact: true }).first().click();
    }
    await inline.getByRole("button", { name: "提交本次选择", exact: true }).click();
    await expect(page.getByRole("region", { name: "应用这些简历修改？" })).toBeVisible();
    await page.getByRole("button", { name: "生成岗位简历", exact: true }).click();
    await expect.poll(async () => (await readStore(page, "resumeBranches")).filter(branch => branch.branchPurpose === "job_specific").length).toBeGreaterThan(0);
    const after = await readStore(page, "resumeBranches");
    const target = after.find(branch => branch.branchPurpose === "job_specific" && branch.sourceBranchId === source.id)!;
    expect(target).toBeTruthy();
    expect(after.find(branch => branch.id === source.id)).toEqual(source);
    expect(await readStore(page, "profiles")).toEqual(profilesBefore);
    expect(await readStore(page, "jobDescriptions")).toEqual(jobsBefore);
    await assertCoreTarget(page, source, target);
    expect(trace.toolRequests.map(request => request.name)).toEqual([
      "career.workflow.job_intake", "career.resume.list", "career.job.list", "career.workflow.job_fit", "career.resume.list", "career.job.list", "career.workflow.tailor_resume"
    ]);
    const providerAfter = await readProviderEvidence(page);
    const sessions = await readStore(page, "agentSessions");
    await testInfo.attach("core02-tool-trace", { body: JSON.stringify({
      providerKind: "simulated", providerRequests: providerAfter.requests.length - providerBefore.requests.length,
      clarificationCount: 0, toolSequence: trace.toolRequests.map(request => request.name),
      runStarts: trace.runtimeActions.filter(action => action === "run_start").length,
      entityIds: { profileId: source.profileId, sourceResumeId: source.id, targetResumeId: target.id, revisionId: target.currentRevisionId, jobId: target.jobId },
      repositoryWrites: { newResumeBranches: after.length - branches.length, generalUnchanged: true, profileUnchanged: true },
      taskStates: sessions.map(session => session.taskState)
    }, null, 2), contentType: "application/json" });
    await page.goto(`/resume?branchId=${encodeURIComponent(String(target.id))}`);
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await verifyCoreResumePdf(page, String(target.id));
  });

  test("CASE M Core-02 — new material to confirmed Profile, General Resume, Job, isolated tailoring and PDF", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const startedAt = Date.now();
    const timeline: Array<{ stage: string; at: string; elapsedMs: number; status?: number }> = [];
    differentialTimelines.set(page, timeline);
    const mark = (stage: string, status?: number) => timeline.push({ stage, at: new Date().toISOString(), elapsedMs: Date.now() - startedAt, ...(status === undefined ? {} : { status }) });
    mark("case_start");
    page.on("request", request => {
      if (request.url().includes("/api/resume-export/pdf") && request.method() === "POST") mark("pdf_request_start");
      if (request.url().includes("/api/agent/runtime/hermes") && parseJson(request.postData())?.action === "run_start") mark("run_start");
    });
    page.on("response", response => {
      if (response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST") mark("pdf_response_headers", response.status());
    });
    page.on("requestfinished", request => {
      if (request.url().includes("/api/resume-export/pdf") && request.method() === "POST") mark("pdf_response_end");
    });
    page.on("requestfailed", request => {
      if (request.url().includes("/api/resume-export/pdf") && request.method() === "POST") mark("pdf_request_failed");
    });
    const trace = observeRuntimeAndBridge(page);
    closeoutTraces.set(page, trace);
    await openWorkspace(page);
    const beforeProfiles = await readStore(page, "profiles");
    const beforeBranches = await readStore(page, "resumeBranches");
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem("careeradapt-ai-settings") ?? "{}");
      localStorage.setItem("careeradapt.resumeImportAiPreference", JSON.stringify({ schemaVersion: "resume-import-ai-preference-v1", mode: "local", providerFingerprint: [settings.provider, settings.baseUrl, settings.model].join("|") }));
    });
    await page.locator('.agent-composer input[type="file"]').setInputFiles({ name: "anonymous-career.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(core02Material)) });
    await send(page, "P51-C02-MATERIAL，把这份职业材料整理到资料库");
    await expectAssistant(page, "已生成候选资料");
    await page.getByRole("button", { name: "产物 1", exact: true }).click();
    await page.getByRole("button", { name: "查看来源与逐项核对", exact: true }).click();
    const dialog = page.getByTestId("agent-import-review-dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
    for (let index = 0; index < 40 && await dialog.getByRole("button", { name: "确认此字段", exact: true }).count(); index++) {
      await dialog.getByRole("button", { name: "确认此字段", exact: true }).first().click();
    }
    for (let index = 0; index < 40 && await dialog.getByRole("button", { name: "核对并保留来源", exact: true }).count(); index++) {
      await dialog.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
    }
    await dialog.locator(".import-review-footer button.primary-button").click();
    await expect(dialog).not.toBeVisible();
    const profiles = await readStore(page, "profiles");
    expect(profiles).toHaveLength(beforeProfiles.length + 1);
    const profile = profiles.find(value => !beforeProfiles.some(old => old.id === value.id))!;
    expect(await readStore(page, "resumeBranches")).toEqual(beforeBranches);
    await expect.poll(async () => {
      const sessions = await readStore(page, "agentSessions");
      const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
      const session = sessions.find(value => value.id === id);
      const task = session?.taskState as { selectedEntities?: { profileId?: string } } | undefined;
      return { personId: session?.personId, profileId: session?.activeProfileId,
        profileRevision: session?.profileRevision, checkpointProfileId: task?.selectedEntities?.profileId };
    }).toEqual({ personId: profile.personId, profileId: profile.id,
      profileRevision: profile.version, checkpointProfileId: profile.id });
    await installCoreWritingProvider(page);
    await send(page, "P51-C02-COMPOSE 根据这些资料帮我生成一份通用简历。");
    await expect(page.locator(".agent-confirmation")).toBeVisible();
    await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
    await expect.poll(async () => (await readStore(page, "resumeBranches")).filter(branch => branch.profileId === profile.id && branch.branchPurpose === "general").length).toBe(1);
    const source = (await readStore(page, "resumeBranches")).find(branch => branch.profileId === profile.id && branch.branchPurpose === "general")!;
    expect(source.profileId).toBe(profile.id);
    // A committed branch is not the Hermes terminal receipt. Starting the
    // Job turn here can race the composition Run's final acknowledgement.
    await expect.poll(async () => {
      const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
      const session = (await readStore(page, "agentSessions")).find(value => value.id === id);
      return (session?.hermesRun as { status?: string } | undefined)?.status;
    }, { timeout: 15_000 }).toMatch(/^(completed|failed|cancelled)$/u);
    mark("composition_terminal_observed");
    mark("job_start");
    await send(page, "保存这个岗位 CORE-JD：公司 Core Test，数据分析实习生，负责数据清洗，要求了解 Python 或 SQL。");
    await expect(page.locator(".agent-confirmation")).toBeVisible();
    await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
    await expectAssistant(page, "已按你的确认完成当前 Career 工作流。");
    mark("job_complete");
    mark("fit_start");
    await send(page, "P51-C02-FIT 这个岗位适合我吗？");
    await expectAssistant(page, "C02FITCOMPLETE");
    mark("fit_complete");
    mark("tailoring_start");
    await send(page, "P51-C02-TAILOR 那按它帮我改简历，别改模板，只改内容。");
    await expectTailoringReview(page, trace);
    mark("tailoring_proposal_complete");
    const inline = page.locator(".agent-tailoring-inline");
    await expect(inline).toBeVisible();
    for (let index = 0; index < 8 && await inline.getByRole("button", { name: "采用", exact: true }).count(); index++) await inline.getByRole("button", { name: "采用", exact: true }).first().click();
    await inline.getByRole("button", { name: "提交本次选择", exact: true }).click();
    await expect(page.getByRole("region", { name: "应用这些简历修改？" })).toBeVisible();
    mark("tailoring_confirmation");
    await page.getByRole("button", { name: "生成岗位简历", exact: true }).click();
    await expect.poll(async () => (await readStore(page, "resumeBranches")).filter(branch => branch.profileId === profile.id && branch.branchPurpose === "job_specific").length).toBe(1);
    mark("repository_branch_observed");
    const branches = await readStore(page, "resumeBranches");
    const target = branches.find(branch => branch.profileId === profile.id && branch.branchPurpose === "job_specific")!;
    expect(branches.find(branch => branch.id === source.id)).toEqual(source);
    expect(await readStore(page, "profiles")).toEqual(profiles);
    expect(target.sourceBranchId).toBe(source.id);
    mark("revision_observed");
    await assertCoreTarget(page, source, target);
    mark("host_terminal_observed");
    expect((await readStore(page, "jobDescriptions")).filter(job => String(job.title).includes("CORE-JD"))).toHaveLength(1);
    await page.goto(`/resume?branchId=${encodeURIComponent(String(target.id))}`);
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    mark("pdf_verify_start");
    await verifyCoreResumePdf(page, String(target.id));
    mark("pdf_verify_complete");
    await testInfo.attach("core02-M-tools", { body: JSON.stringify(trace), contentType: "application/json" });
  });

  test("SQ1 CLAIM — current user skill reaches confirmed General Resume and official PDF without Profile sync", async ({ page }) => {
    test.setTimeout(240_000);
    const trace = observeRuntimeAndBridge(page);
    closeoutTraces.set(page, trace);
    await openWorkspace(page);
    await prepareCoreSourceResume(page);
    const profilesBefore = await readStore(page, "profiles");
    const branchesBefore = await readStore(page, "resumeBranches");
    await page.goto("/ai-workspace");
    await startFreshConversation(page);
    await installCoreWritingProvider(page);
    await send(page, "P51-C02-COMPOSE 根据资料生成通用简历。SQL 基础查询我能独立完成，只用于这份简历，不加入资料库。我只学过 Pandas，没有正式项目。");
    await expect(page.locator(".agent-confirmation")).toBeVisible();
    expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
    await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
    await expect.poll(async () => (await readStore(page, "resumeBranches")).length).toBe(branchesBefore.length + 1);
    const target = (await readStore(page, "resumeBranches")).find(branch => !branchesBefore.some(before => before.id === branch.id))!;
    expect(JSON.stringify(target.structuredContentItems)).toContain("SQL");
    expect(JSON.stringify(target.structuredContentItems)).toContain("Pandas（基础接触）");
    expect(await readStore(page, "profiles")).toEqual(profilesBefore);
    for (const before of branchesBefore) expect((await readStore(page, "resumeBranches")).find(branch => branch.id === before.id)).toEqual(before);
    await page.goto(`/resume?branchId=${encodeURIComponent(String(target.id))}`);
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    const pdf = await verifyCoreResumePdf(page, String(target.id));
    expect(pdf.text.replace(/\s/gu, "")).toContain("SQL");
    expect(pdf.text.replace(/\s/gu, "")).toContain("Pandas（基础接触）");
  });

  test("CASE N Scenario D — content-only Hermes tailoring inherits Presentation through official PDF", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const trace = observeRuntimeAndBridge(page);
    closeoutTraces.set(page, trace);
    await openWorkspace(page);
    const beforeIds = new Set((await readStore(page, "resumeBranches")).map(branch => branch.id));
    await prepareCoreSourceResume(page);
    const source = (await readStore(page, "resumeBranches")).find(branch => !beforeIds.has(branch.id) && branch.branchPurpose === "general")!;
    const profilesBefore = await readStore(page, "profiles");
    const metaBefore = await readStore(page, "appMeta");
    const sourcePresentation = metaBefore.find(row => row.key === `resumePresentationConfig:${source.id}`)!.value as Record<string, unknown>;
    const visual = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => !["branchId", "contentRevision", "presentationRevision", "updatedAt"].includes(key)));
    await page.goto("/ai-workspace");
    await startFreshConversation(page);
    await send(page, "P51-C02-JOB-AI CORE-JD 保存这个岗位：AI 产品实习生，参与需求梳理、原型设计和功能验收。");
    await expect(page.locator(".agent-confirmation")).toBeVisible();
    await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
    await expectAssistant(page, "已按你的确认完成当前 Career 工作流。");
    await installCoreWritingProvider(page);
    await send(page, "P51-C02-TAILOR 按这个岗位优化，只改内容，别改模板。");
    await expectTailoringReview(page, trace);
    const inline = page.locator(".agent-tailoring-inline");
    await expect(inline).toBeVisible();
    for (let index = 0; index < 8 && await inline.getByRole("button", { name: "采用", exact: true }).count(); index++) await inline.getByRole("button", { name: "采用", exact: true }).first().click();
    await inline.getByRole("button", { name: "提交本次选择", exact: true }).click();
    await expect(page.getByRole("region", { name: "应用这些简历修改？" })).toBeVisible();
    await page.getByRole("button", { name: "生成岗位简历", exact: true }).click();
    await expect.poll(async () => (await readStore(page, "resumeBranches")).some(branch => branch.sourceBranchId === source.id && branch.branchPurpose === "job_specific")).toBe(true);
    const branches = await readStore(page, "resumeBranches");
    const target = branches.find(branch => branch.sourceBranchId === source.id && branch.branchPurpose === "job_specific")!;
    expect(branches.find(branch => branch.id === source.id)).toEqual(source);
    expect(await readStore(page, "profiles")).toEqual(profilesBefore);
    expect(target.structuredContentItems).not.toEqual(source.structuredContentItems);
    await assertCoreTarget(page, source, target);
    const targetPresentation = (await readStore(page, "appMeta")).find(row => row.key === `resumePresentationConfig:${target.id}`)!.value as Record<string, unknown>;
    expect(visual(targetPresentation)).toEqual(visual(sourcePresentation));
    await page.goto(`/resume?branchId=${encodeURIComponent(String(target.id))}`);
    await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
    await verifyCoreResumePdf(page, String(target.id));
    expect(visual((await readStore(page, "appMeta")).find(row => row.key === `resumePresentationConfig:${target.id}`)!.value as Record<string, unknown>)).toEqual(visual(sourcePresentation));
    await testInfo.attach("scenario-D-presentation", { body: JSON.stringify({ sourceId: source.id, targetId: target.id,
      sourceRevision: source.currentRevisionId, targetRevision: target.currentRevisionId, templateId: sourcePresentation.templateId,
      presentationSHA256: createHash("sha256").update(JSON.stringify(visual(sourcePresentation))).digest("hex"), trace }), contentType: "application/json" });
  });

  test("CASE I — pasted JD crosses real Hermes and MCP, then one Host confirmation saves the Job", async ({ page }) => {
    test.setTimeout(240_000);
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    await prepareCoreSourceResume(page);
    await page.goto("/ai-workspace");
    await assertHermesReadyForCase(page);
    await send(page, "保存这个岗位 CORE-JD：公司 Core Test，数据分析实习生，负责数据清洗，要求了解 Python 或 SQL。");
    await expect(page.locator(".agent-confirmation")).toContainText("确认执行 Career 操作");
    await expectToolNames(trace, ["career.workflow.job_intake"]);
    await expect(page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true })).toBeEnabled();
    const before = await readCaseISession(page);
    const providerBefore = await readProviderEvidence(page);
    expect(before.confirmationId).toBeTruthy();
    expect(before.runId).toBeTruthy();
    expect(trace.resultActions).toHaveLength(0);
    const confirmedAt = Date.now();
    await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
    await expectAssistant(page, "已按你的确认完成当前 Career 工作流。");
    await expect.poll(() => page.evaluate(() => window.__caseIEvents?.some(event => event.event === "run.completed"))).toBe(true);
    const events = await page.evaluate(() => window.__caseIEvents ?? []);
    const after = await readCaseISession(page);
    const providerAfter = await readProviderEvidence(page);
    const continued = providerAfter.requests.slice(providerBefore.requests.length);
    expect(continued.length).toBeGreaterThanOrEqual(1);
    const toolCallId = providerBefore.requests.at(-1)?.responseToolCallId;
    expect(toolCallId).toBeTruthy();
    expect(continued.some(request => request.toolResults.some(result => result.toolCallId === toolCallId && Boolean(result.jobId)))).toBe(true);
    expect(after).toMatchObject({ runId: before.runId, sessionId: before.sessionId, userMessageId: before.userMessageId, runStatus: "completed" });
    expect(after.confirmationId).toBeUndefined();
    expect(events.filter(event => event.runId).every(event => event.runId === before.runId)).toBe(true);
    const evidencePath = `.tmp/final01-case-i-${Date.now()}.json`;
    await writeFile(evidencePath, JSON.stringify({ before, after, toolCallId, confirmedAt,
      providerRequestsBeforeConfirmation: providerBefore.requests.length,
      providerRequestsAfterConfirmation: continued.length, continued,
      firstEventAfterConfirmation: events.find(event => event.timestamp && event.timestamp * 1000 >= confirmedAt),
      events, returnedToolResults: trace.returnedToolResults }, null, 2));
    console.log(`CASE_I_EVIDENCE=${evidencePath}`);
    expect(trace.runtimeActions.filter(action => action === "run_start")).toHaveLength(1);
    expect(trace.resultActions).toContain("result");
    const jobs = await page.evaluate(() => new Promise<Array<{ id: string; title: string; rawText: string }>>((resolve, reject) => {
      const request = indexedDB.open("CareerAdaptDb");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const result = database.transaction("jobDescriptions", "readonly").objectStore("jobDescriptions").getAll();
        result.onerror = () => reject(result.error);
        result.onsuccess = () => { database.close(); resolve(result.result); };
      };
    }));
    const saved = jobs.filter(job => job.title.includes("CORE-JD"));
    expect(saved).toHaveLength(1);
    expect(saved[0].rawText).toContain("Python 或 SQL");
    await completeCoreResumeWorkflow(page, saved[0].id);
  });
});

test.describe("Core-02 Hermes multi-turn", () => {
  test("SCENARIO B — confirmed certificate refreshes Profile and General Resume", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    const ids = new Set((await readStore(page, "resumeBranches")).map(row => row.id));
    await prepareCoreSourceResume(page);
    const source = (await readStore(page, "resumeBranches")).find(row => !ids.has(row.id))!;
    const profile = (await readStore(page, "profiles")).find(row => row.id === source.profileId)!;
    await page.goto("/ai-workspace");
    await startFreshConversation(page);
    await installCoreWritingProvider(page);
    await send(page, "P51-C02-COMPOSE UPDATE 用资料库更新我的通用简历，先生成方案。");
    await expect(page.locator(".agent-confirmation")).toBeVisible();
    await expect.poll(() => trace.toolReceipts.some(value => Boolean((value as { result?: { data?: { workflowCheckpoint?: { checkpointId?: string } } } }).result?.data?.workflowCheckpoint?.checkpointId))).toBe(true);
    const old = trace.toolReceipts.map(value => (value as { result?: { data?: { workflowCheckpoint?: { checkpointId?: string } } } }).result?.data?.workflowCheckpoint).find(value => value?.checkpointId)!;
    await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
    await expect.poll(async () => (await readStore(page, "resumeBranches")).find(row => row.id === source.id)?.revision).toBe(Number(source.revision) + 1);
    await expectAssistant(page, "已按你的确认完成当前 Career 工作流。");
    await startFreshConversation(page);
    expect(old?.checkpointId).toBeTruthy();
    const certificate = { ...core02Material, sections: [{ id: "certificate", sectionType: "certificates", title: "证书", order: 0, visible: true,
      items: [{ id: "core-new-certificate", sectionType: "certificates", name: "匿名测试证书", issuer: "测试机构", issuedAt: "2025-06", customFields: [] }] }] };
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem("careeradapt-ai-settings") ?? "{}");
      localStorage.setItem("careeradapt.resumeImportAiPreference", JSON.stringify({ schemaVersion: "resume-import-ai-preference-v1", mode: "local", providerFingerprint: [settings.provider, settings.baseUrl, settings.model].join("|") }));
    });
    await page.locator('.agent-composer input[type="file"]').setInputFiles({ name: "certificate.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(certificate)) });
    await send(page, "P51-C02-MATERIAL 把这个加入资料库，然后更新我的通用简历。");
    await expectAssistant(page, "已生成候选资料");
    await testInfo.attach("scenario-B-material-session", { body: JSON.stringify({ sessions: await readStore(page, "agentSessions"), trace }), contentType: "application/json" });
    await page.getByRole("button", { name: "产物 1", exact: true }).click();
    await page.getByRole("button", { name: "查看来源与逐项核对", exact: true }).click();
    const dialog = page.getByTestId("agent-import-review-dialog");
    await dialog.locator("label.import-target-option").filter({ hasText: "导入到已有资料" }).click();
    await dialog.locator('select[name="import-target-profile"]').selectOption(String(profile.id));
    await dialog.locator('input[name="import-create-general-resume"]').uncheck();
    for (let index = 0; index < 40 && await dialog.getByRole("button", { name: "确认此字段", exact: true }).count(); index++) await dialog.getByRole("button", { name: "确认此字段", exact: true }).first().click();
    for (let index = 0; index < 40 && await dialog.getByRole("button", { name: "核对并保留来源", exact: true }).count(); index++) await dialog.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
    await dialog.locator(".import-review-footer button.primary-button").click();
    await expect(dialog).not.toBeVisible();
    const updated = (await readStore(page, "profiles")).find(row => row.id === profile.id)!;
    expect(updated.version).toBe(Number(profile.version) + 1);
    await send(page, "P51-C02-COMPOSE UPDATE 重新读取最新资料并更新我的通用简历。");
    await expect(page.locator(".agent-confirmation")).toBeVisible();
    const fresh = trace.toolReceipts.map(value => (value as { result?: { data?: { workflowCheckpoint?: { checkpointId?: string; profileRevision?: number } } } }).result?.data?.workflowCheckpoint).filter(value => value?.checkpointId).at(-1)!;
    expect(fresh.checkpointId).not.toBe(old.checkpointId);
    expect(fresh.profileRevision).toBe(updated.version);
    expect((await readStore(page, "resumeBranches")).find(row => row.id === source.id)?.revision).toBe(Number(source.revision) + 1);
    await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
    await expect.poll(async () => (await readStore(page, "resumeBranches")).find(row => row.id === source.id)?.sourceProfileVersion).toBe(updated.version);
    expect(JSON.stringify((await readStore(page, "resumeBranches")).find(row => row.id === source.id))).toContain("匿名测试证书");
    const compose = trace.toolRequests.filter(request => request.name === "career.workflow.compose_resume").at(-1)!;
    expect(compose.input).toMatchObject({ profileId: profile.id, expectedProfileRevision: updated.version, sourceResumeId: source.id, generalResumeMode: "update_existing" });
    await testInfo.attach("scenario-B-receipt", { body: JSON.stringify({ sourceId: source.id, oldCheckpointId: old.checkpointId, profileRevision: updated.version, trace }), contentType: "application/json" });
  });

  test("SCENARIO C — switching Job rejects A proposal and regenerates B", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const trace = observeRuntimeAndBridge(page);
    await openWorkspace(page);
    const ids = new Set((await readStore(page, "resumeBranches")).map(row => row.id));
    await prepareCoreSourceResume(page);
    const source = (await readStore(page, "resumeBranches")).find(row => !ids.has(row.id))!;
    await page.goto("/ai-workspace");
    await startFreshConversation(page);
    await installCoreWritingProvider(page);
    let sessionA: Record<string, unknown> | undefined;
    for (const label of ["JOB-A", "JOB-B"]) {
      await send(page, `P51-C02-JOB-AI CORE-JD ${label} 保存这个岗位`);
      await expect(page.locator(".agent-confirmation")).toBeVisible();
      await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
      await expectAssistant(page, "已按你的确认完成当前 Career 工作流。");
      if (label === "JOB-A") {
        await send(page, "P51-C02-TAILOR 按岗位 A 准备修改提案，先不确认。");
        await expectTailoringReview(page, trace);
        await expect.poll(async () => (await readStore(page, "agentSessions")).some(row => (row.taskState as { stage?: string } | undefined)?.stage === "preview_changes")).toBe(true);
        sessionA = (await readStore(page, "agentSessions")).find(row => (row.taskState as { stage?: string } | undefined)?.stage === "preview_changes");
        await startFreshConversation(page);
      }
    }
    const proposals = () => trace.toolReceipts.flatMap(value => {
      const checkpoint = (value as { result?: { data?: { workflowCheckpoint?: Record<string, unknown> } } }).result?.data?.workflowCheckpoint;
      return checkpoint?.kind === "tailoring_session" ? [checkpoint] : [];
    });
    const a = proposals()[0];
    expect(a?.checkpointId).toBeTruthy();
    await send(page, "P51-C02-TAILOR JOB-B 确认前切换到岗位 B，重新生成它自己的提案。");
    await expect.poll(() => proposals().length).toBe(2);
    const b = proposals()[1];
    expect(b.jobId).not.toBe(a.jobId);
    const matrix = (checkpoint: Record<string, unknown>) => {
      const session = checkpoint.session as { candidateEvidenceMatrix?: { analysisId: string; binding: { jobId: string } } };
      return session.candidateEvidenceMatrix!;
    };
    expect(matrix(b).binding.jobId).toBe(b.jobId);
    expect(matrix(b).analysisId).not.toBe(matrix(a).analysisId);
    await send(page, `P51-C02-OLD-TAILOR OLD-CHECKPOINT=${a.checkpointId} 试图把旧方案提交到当前岗位 B。`);
    await expect.poll(() => trace.toolReceipts.some(value => JSON.stringify(value).includes("tailoring_checkpoint_not_found"))).toBe(true);
    const preservedA = (await readStore(page, "agentSessions")).find(row => row.id === sessionA?.id)!;
    expect(preservedA.taskState).toEqual(sessionA?.taskState);
    expect(preservedA.activeProfileId).toBe(sessionA?.activeProfileId);
    expect((await readStore(page, "resumeBranches")).find(row => row.id === source.id)).toEqual(source);
    expect((await readStore(page, "resumeBranches")).filter(row => row.sourceBranchId === source.id)).toHaveLength(0);
    await testInfo.attach("scenario-C-receipt", { body: JSON.stringify({ a, b, trace }), contentType: "application/json" });
  });
});

async function assertCoreTarget(page: Page, source: Record<string, unknown>, target: Record<string, unknown>) {
  expect(target).toMatchObject({ sourceBranchId: source.id, sourceRevisionId: source.currentRevisionId, jobId: expect.any(String) });
  expect(target.structuredContentItems).not.toEqual(source.structuredContentItems);
  const meta = await readStore(page, "appMeta");
  const presentation = (id: unknown) => meta.find(row => row.key === `resumePresentationConfig:${id}`)!.value as Record<string, unknown>;
  const visual = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => !["branchId", "contentRevision", "presentationRevision", "updatedAt"].includes(key)));
  expect(presentation(target.id).templateId).toBe(presentation(source.id).templateId);
  expect(visual(presentation(target.id))).toEqual(visual(presentation(source.id)));
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(row => row.id === id)!;
    const task = session.taskState as { completionStatus?: string; knownSlots: Record<string, unknown> };
    return { completionStatus: task.completionStatus, confirmation: session.pendingConfirmation,
      toolCall: session.pendingToolCall, taskConfirmation: task.knownSlots.pendingConfirmation };
  }).toEqual({ completionStatus: "completed", confirmation: undefined, toolCall: undefined, taskConfirmation: undefined });
}

async function openWorkspace(page: Page) {
  await page.addInitScript(() => {
    window.__core02IO = [];
    const record = (value: string) => { window.__core02IO!.push(value); if (window.__core02IO!.length > 200) window.__core02IO!.shift(); };
    const arrayBuffer = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () {
      record("blob:start");
      const bytes = await arrayBuffer.call(this);
      record("blob:complete");
      return bytes;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      const request = put.apply(this, args);
      const name = this.name;
      const transaction = this.transaction;
      record(`put:${name}:start`);
      request.addEventListener("success", () => record(`put:${name}:success`));
      request.addEventListener("success", () => transaction.addEventListener("complete", () => {
        if (["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions"].includes(name)) console.debug("CORE02_FORMAL_WRITE", JSON.stringify({ store: name, key: request.result, at: new Date().toISOString() }));
      }, { once: true }));
      request.addEventListener("error", () => record(`put:${name}:error`));
      return request;
    };
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<typeof add>) {
      const request = add.apply(this, args);
      const name = this.name;
      const transaction = this.transaction;
      request.addEventListener("success", () => transaction.addEventListener("complete", () => {
        if (["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions"].includes(name)) console.debug("CORE02_FORMAL_WRITE", JSON.stringify({ store: name, key: request.result, at: new Date().toISOString() }));
      }, { once: true }));
      return request;
    };
    window.__caseIEvents = [];
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      const url = new URL(typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : args[0].href, location.origin);
      if (url.pathname !== "/api/agent/runtime/hermes" || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
      const reader = response.clone().body?.getReader();
      if (reader) void (async () => {
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let newline: number;
            while ((newline = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
              if (!line.startsWith("data: ")) continue;
              const data = JSON.parse(line.slice(6));
              window.__caseIEvents!.push({ event: data.event, runId: data.run_id, tool: data.tool, timestamp: data.timestamp });
              if (data.event === "run.completed" || data.event === "run.failed") {
                void reader.cancel().catch(() => undefined);
                return;
              }
            }
          }
        } catch { window.__caseIEvents!.push({ event: "capture.failed" }); }
      })();
      return response;
    };
  });
  const providerBaseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  const providerApiKey = process.env.HERMES_INTEGRATION_PROVIDER_KEY;
  if (!providerBaseUrl || !providerApiKey) throw new Error("hermes_integration_provider_settings_missing");
  await page.addInitScript(({ baseUrl, apiKey }) => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({
      baseUrl,
      apiKey,
      model: "careeradapt-test",
      provider: "openai-compatible",
      credentialAction: "replace"
    }));
  }, { baseUrl: providerBaseUrl, apiKey: providerApiKey });
  await page.goto("/ai-workspace");
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /AI Runtime Hermes，状态 Ready/u, { timeout: 90_000 });
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/mcp", { headers: { Connection: "close" } });
    const payload = await response.json() as { status?: { connected?: boolean; discoveredToolCount?: number } };
    return payload.status;
  }, { timeout: 60_000, intervals: [250, 500, 1_000] }).toMatchObject({ connected: true, discoveredToolCount: expect.any(Number) });
  await expect.poll(async () => (await readStore(page, "appMeta")).some(row => row.key === "demoSeededAt")).toBe(true);
  // Seeding and the workspace's first Session hydrate independently. Create
  // the business fixture only after the official active context exists;
  // restarting Hermes used to hide these unbound demo Sessions.
  await startFreshConversation(page);
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    return (await readStore(page, "agentSessions")).find(row => row.id === id)?.activeProfileId;
  }).toBe("profile-demo-student");
  await integrationPreflight(page);
  const trace = closeoutTraces.get(page);
  if (trace) trace.formalWrites.length = 0;
}

async function startFreshConversation(page: Page) {
  const previous = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"))).not.toBe(previous);
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    return (await readStore(page, "agentSessions")).some(value => value.id === id && value.id !== previous);
  }).toBe(true);
  await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
  await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
  await integrationPreflight(page);
}

async function expectTailoringReview(page: Page, trace: ReturnType<typeof observeRuntimeAndBridge>) {
  await expect.poll(() => trace.toolReceipts.some(value => {
    const receipt = value as { result?: { ok?: boolean; data?: { status?: string; workflowStage?: string } } };
    return receipt.result?.ok && receipt.result.data?.status === "review_ready" && receipt.result.data.workflowStage === "preview_changes";
  })).toBe(true);
  await expect(page.locator(".agent-tailoring-inline")).toBeVisible();
}

async function send(page: Page, message: string) {
  await page.getByLabel("描述你的求职任务").fill(message);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}

async function assertHermesReadyForCase(page: Page) {
  // Playwright owns a fresh Context/IndexedDB/Session for every case. The MCP
  // HTTP gateway resolves the currently registered Browser Host on each call;
  // restarting the shared process adds no business isolation.
  await integrationPreflight(page);
}

async function integrationPreflight(page: Page) {
  let stage = "next_endpoint";
  const startedAt = new Date().toISOString();
  try {
    const bridgeResponse = await page.request.get("/api/agent/mcp", { headers: { Connection: "close" } });
    expect(bridgeResponse.ok()).toBe(true);
    const bridge = await bridgeResponse.json();
    stage = "browser_mcp";
    expect(bridge.status.connected).toBe(true);
    expect(bridge.status.bridgeId).toBeTruthy();
    stage = "control_get";
    const control = await page.request.get("/api/agent/runtime/hermes/control", { headers: { Connection: "close" } });
    expect(control.ok()).toBe(true);
    const { snapshot } = await control.json();
    stage = "runtime_ready";
    expect(snapshot).toMatchObject({ overallState: "ready", processReady: true,
      apiReady: true, runReady: true, careerMcpReady: true, toolSurfaceReady: true });
    stage = "career_facades";
    expect(snapshot.requiredCareerFacadesTotal).toBeGreaterThan(0);
    expect(snapshot.requiredCareerFacadesReady).toBe(snapshot.requiredCareerFacadesTotal);
    stage = "hermes_health";
    const health = await page.request.get("/api/agent/runtime/hermes/health", { headers: { Connection: "close" } });
    expect(health.ok()).toBe(true);
    stage = "fake_provider";
    const provider = await page.request.get(`${process.env.HERMES_INTEGRATION_PROVIDER_URL}/models`, {
      headers: { Authorization: `Bearer ${process.env.HERMES_INTEGRATION_PROVIDER_KEY}`, Connection: "close" }
    });
    expect(provider.ok()).toBe(true);
    console.log("INTEGRATION_PREFLIGHT_PASS", JSON.stringify({ startedAt,
      bridgeId: bridge.status.bridgeId, runtimeUrl: snapshot.runtimeUrl,
      requiredCareerFacadesReady: snapshot.requiredCareerFacadesReady }));
  } catch (error) {
    console.error("INTEGRATION_PREFLIGHT_FAIL", JSON.stringify({ stage, startedAt }));
    throw error;
  }
}

async function expectAssistant(page: Page, text: string) {
  await expect.poll(async () => {
    const messages = page.locator('[data-message-role="assistant"]');
    return await messages.last().textContent();
  }, { timeout: 90_000, intervals: [250, 500, 1_000] }).toContain(text);
  // Narration can arrive before Host terminal persistence. A following turn
  // must not start against the previous turn's in-flight snapshot.
  await expect.poll(async () => {
    const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
    const session = (await readStore(page, "agentSessions")).find(value => value.id === id);
    return (session?.hermesRun as { status?: string } | undefined)?.status;
  }, { timeout: 15_000 }).toMatch(/^(completed|failed|cancelled)$/u);
}

async function expectToolNames(trace: ReturnType<typeof observeRuntimeAndBridge>, names: string[]) {
  await expect.poll(() => trace.toolRequests.map((request) => request.name), {
    timeout: 10_000,
    intervals: [100, 250, 500]
  }).toEqual(names);
}

function observeRuntimeAndBridge(page: Page) {
  const formalWrites: Array<{ store: string; key: string; at: string }> = [];
  page.on("console", message => {
    if (message.text().startsWith("CORE02_FORMAL_WRITE ")) formalWrites.push(JSON.parse(message.text().slice("CORE02_FORMAL_WRITE ".length)));
  });
  const returnedToolResults: Array<{ requestId?: string; ok?: boolean; status?: string; at: string }> = [];
  const runtimeActions: string[] = [];
  const runRequests: unknown[] = [];
  const runReceipts: unknown[] = [];
  const toolReceipts: unknown[] = [];
  const resultActions: string[] = [];
  const toolRequests: Array<{ name: string; input: unknown }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/api/agent/runtime/hermes")) {
      const body = parseJson(request.postData());
      if (typeof body?.action === "string") runtimeActions.push(body.action);
      if (body?.action === "run_start") runRequests.push(body);
      return;
    }
    if (url.pathname.endsWith("/api/agent/mcp") && url.searchParams.get("bridge") === "1") {
      const body = parseJson(request.postData());
      if (body?.action === "result") {
        resultActions.push("result");
        toolReceipts.push(body);
        const result = body.result as { ok?: boolean; data?: { status?: string } } | undefined;
        returnedToolResults.push({ requestId: body.requestId as string | undefined, ok: result?.ok, status: result?.data?.status, at: new Date().toISOString() });
      }
    }
  });
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname.endsWith("/api/agent/runtime/hermes") && parseJson(response.request().postData())?.action === "run_start") {
      runReceipts.push(await response.json());
    }
    if (url.pathname.endsWith("/api/agent/runtime/hermes") && parseJson(response.request().postData())?.action === "run_events") {
      return;
    }
    if (!url.pathname.endsWith("/api/agent/mcp") || url.searchParams.get("bridge") !== "1" || response.request().method() !== "GET") return;
    const payload = await response.json().catch(() => undefined) as { requests?: Array<{ name?: string; input?: unknown }> } | undefined;
    for (const request of payload?.requests ?? []) {
      if (typeof request.name === "string") toolRequests.push({ name: request.name, input: request.input });
    }
  });
  const trace = { runtimeActions, resultActions, toolRequests, returnedToolResults, runRequests, runReceipts, toolReceipts, formalWrites };
  closeoutTraces.set(page, trace);
  return trace;
}

async function readProviderEvidence(page: Page): Promise<{ requests: Array<{ at: string; finishedAt?: string; payloadBytes?: number; selectedTool?: string; responseToolCallId?: string; toolResults: Array<{ toolCallId: string; jobId?: string }> }> }> {
  // Finite test probes must not inherit a pooled socket across disposed
  // BrowserContexts or race Node's idle keep-alive close. No request retry.
  const response = await page.request.get(`${process.env.HERMES_INTEGRATION_PROVIDER_URL}/integration-evidence`, {
    headers: { Authorization: `Bearer ${process.env.HERMES_INTEGRATION_PROVIDER_KEY}`, Connection: "close" }
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function readCaseISession(page: Page) {
  return page.evaluate(() => new Promise<{ sessionId: string; runId: string; runStatus: string; userMessageId: string; confirmationId?: string; operationId?: string }>((resolve, reject) => {
    const request = indexedDB.open("CareerAdaptDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const result = db.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
      result.onerror = () => reject(result.error);
      result.onsuccess = () => {
        db.close();
        const session = result.result.find(session => session.hermesRun);
        if (!session) { reject(new Error("Hermes session receipt missing")); return; }
        resolve({ sessionId: session.id, runId: session.hermesRun.runId, runStatus: session.hermesRun.status,
          userMessageId: session.activeTurn?.sourceUserMessageId ?? session.activeTurn?.userMessageId,
          confirmationId: session.pendingConfirmation?.id, operationId: session.pendingConfirmation?.operationId });
      };
    };
  }));
}

function parseJson(value: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}


test.describe("Core Hermes Behavior Baseline", () => {
  test.afterAll(async () => {
    if (!process.env.HERMES_CORE_BEHAVIOR) return;
    const records = (await readFile(`.tmp/core02-behavior-${process.env.HERMES_CORE_BEHAVIOR_RUN_ID}.jsonl`, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    await writeFile(".tmp/core02-hermes-behavior.json", JSON.stringify({
      providerKind: "simulated", scope: "Locked Hermes + MCP + Host; scripted Provider, not natural-language model quality certification",
      manifestCount: core02BehaviorCases.length, executedCount: records.length,
      cases: records
    }, null, 2));
  });
  for (const definition of core02BehaviorCases) {
    test(`BEHAVIOR ${definition.id}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      const item = definition as typeof definition & { source?: boolean; savedJob?: boolean; cancel?: boolean; terminal?: string; expectedFailure?: boolean };
      const trace = observeRuntimeAndBridge(page);
      const result: Record<string, unknown> = { id: item.id, category: item.category, status: "failed" };
      let before: unknown;
      let startTool = 0;
      let providerStart = 0;
      try {
        await openWorkspace(page);
        if (item.source) {
          await prepareCoreSourceResume(page);
          await page.goto("/ai-workspace");
          await startFreshConversation(page);
          await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
        }
        if (item.savedJob) {
          await send(page, "CORE-JD 保存这个岗位");
          await expect(page.locator(".agent-confirmation")).toBeVisible();
          await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
          await expectAssistant(page, "已按你的确认完成当前 Career 工作流。");
        }
        await installCoreWritingProvider(page);
        startTool = trace.toolRequests.length;
        const providerBefore = await readProviderEvidence(page);
        providerStart = providerBefore.requests.length;
        const formal = async () => Object.fromEntries(await Promise.all(["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions"].map(async name => [name, await readStore(page, name)])));
        before = await formal();
        if (item.category === "material") {
          await page.evaluate(() => {
            const settings = JSON.parse(localStorage.getItem("careeradapt-ai-settings") ?? "{}");
            localStorage.setItem("careeradapt.resumeImportAiPreference", JSON.stringify({ schemaVersion: "resume-import-ai-preference-v1", mode: "local", providerFingerprint: [settings.provider, settings.baseUrl, settings.model].join("|") }));
          });
          const resumeMaterial = item.id === "material-resume";
          await page.locator('.agent-composer input[type="file"]').setInputFiles({ name: resumeMaterial ? "career.json" : "certificate.txt", mimeType: resumeMaterial ? "application/json" : "text/plain", buffer: Buffer.from(resumeMaterial ? JSON.stringify(core02Material) : "证书\n大学英语六级 2025-06") });
        }
        await send(page, item.text);
        if (item.cancel) {
          await expect(page.locator(".agent-confirmation")).toBeVisible();
          await page.locator(".agent-confirmation").getByRole("button", { name: "取消", exact: true }).click();
        } else if (item.expectedFailure) {
          await expect.poll(async () => (await readStore(page, "agentSessions")).some(session => {
            const run = session.hermesRun as { status?: string } | undefined;
            return run && ["failed", "completed"].includes(String(run.status));
          }), { timeout: 60_000 }).toBe(true);
        } else if (item.id === "tailor-followup") {
          await expectTailoringReview(page, trace);
        } else {
          await expectAssistant(page, item.terminal!);
        }
        const after = await formal();
        const tools = trace.toolRequests.slice(startTool);
        const names = tools.map(tool => tool.name);
        const requests = (await readProviderEvidence(page)).requests.slice(providerBefore.requests.length);
        const sessions = await readStore(page, "agentSessions");
        const current = sessions.find(session => session.hermesRun)!;
        const task = current.taskState as { completionStatus?: string; pendingQuestions?: unknown[]; knownSlots?: Record<string, unknown> } | undefined;
        const signatures = tools.map(tool => JSON.stringify([tool.name, tool.input]));
        const noWrites = JSON.stringify(after) === JSON.stringify(before);
        Object.assign(result, { toolSequence: names, toolChoiceAccuracy: JSON.stringify(names) === JSON.stringify(item.tools) ? 1 : 0,
          repeatedToolCallCount: signatures.length - new Set(signatures).size,
          providerRequestCount: requests.length, runCount: trace.runReceipts.length,
          runReceipts: trace.runReceipts, careerCheckpoints: trace.runRequests,
          hostPendingQuestionCount: task?.pendingQuestions?.length ?? 0,
          formalStateUnchanged: noWrites, wrongTargetWriteCount: noWrites ? 0 : "REQUIRES_REVIEW",
          unsupportedFormalClaimCount: noWrites ? 0 : "REQUIRES_REVIEW",
          finalCompletion: task?.completionStatus ?? "no_workflow", finalRun: current.hermesRun,
          expectedFailure: item.expectedFailure ?? false, toolResults: trace.toolReceipts });
        expect(names).toEqual([...item.tools]);
        expect(noWrites).toBe(true);
        result.status = "passed";
      } finally {
        const tools = trace.toolRequests.slice(startTool);
        const signatures = tools.map(tool => JSON.stringify([tool.name, tool.input]));
        const requests = (await readProviderEvidence(page)).requests.slice(providerStart);
        const sessions = await readStore(page, "agentSessions");
        const current = sessions.find(session => session.hermesRun);
        const task = current?.taskState as { completionStatus?: string; pendingQuestions?: unknown[] } | undefined;
        const after = Object.fromEntries(await Promise.all(["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions"].map(async name => [name, await readStore(page, name)])));
        const unchanged = before !== undefined && JSON.stringify(before) === JSON.stringify(after);
        Object.assign(result, {
          toolSequence: tools.map(tool => tool.name),
          toolChoiceAccuracy: JSON.stringify(tools.map(tool => tool.name)) === JSON.stringify(item.tools) ? 1 : 0,
          repeatedToolCallCount: signatures.length - new Set(signatures).size,
          providerRequestCount: requests.length,
          hostPendingQuestionCount: task?.pendingQuestions?.length ?? 0,
          unnecessaryClarificationCount: task?.pendingQuestions?.length ?? 0,
          clarificationOracle: "No clarification required in these scripted scenarios; Host pending questions observed at boundary",
          unsupportedClaimCount: unchanged ? 0 : "UNMEASURED_FORMAL_STATE_CHANGED",
          wrongTargetWriteCount: unchanged ? 0 : "UNMEASURED_FORMAL_STATE_CHANGED",
          formalStateUnchanged: unchanged,
          finalCompletion: task?.completionStatus === "completed",
          finalWorkflowStatus: task?.completionStatus ?? "none",
          finalRun: current?.hermesRun,
          toolResults: trace.toolReceipts, providerRequests: requests,
          runReceipts: trace.runReceipts, runRequests: trace.runRequests
        });
        result.io = await page.evaluate(() => window.__core02IO);
        await appendFile(`.tmp/core02-behavior-${process.env.HERMES_CORE_BEHAVIOR_RUN_ID}.jsonl`, `${JSON.stringify(result)}\n`);
        await testInfo.attach("behavior-receipt", { body: JSON.stringify({ ...result, trace }, null, 2), contentType: "application/json" });
      }
    });
  }
});
