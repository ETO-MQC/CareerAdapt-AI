# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p522-b011-closeout.spec.ts >> answer → unified Diff → partial rejection → confirmed independent Revision → reload → real PDF download
- Location: tests\e2e\p522-b011-closeout.spec.ts:86:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.agent-tailoring-inline')
Expected: visible
Timeout: 25000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 25000ms
  - waiting for locator('.agent-tailoring-inline')

```

```yaml
- alert
- complementary "AI 工作区导航":
  - link "职适AI 首页":
    - /url: /
    - text: 职适AI
  - button "收起 AI 导航"
  - button "新任务"
  - button "搜索 / 历史"
  - navigation "资产":
    - text: 资产
    - link "AI 助手":
      - /url: /ai-workspace
    - link "我的简历":
      - /url: /resume
    - link "个人资料库":
      - /url: /profile
    - link "岗位":
      - /url: /jobs
    - link "求职进度":
      - /url: /applications
    - link "回收站":
      - /url: /recycle
  - region "最近任务":
    - text: 最近任务
    - button "B01.1 定制验收 任务状态：等待输入": B01.1 定制验收 等待输入
    - button "重命名"
    - button "归档"
  - button "AI" [pressed]
  - button "协作"
  - button "手动"
  - link "设置与更多":
    - /url: /settings
  - strong: 求职工作区
  - text: 本地数据
- main:
  - strong: B01.1 定制验收
  - text: 固定：同学 · V1
  - button "同学 · V1 7 条经历 · 5 项基础信息 · 创建于 2026/07/01":
    - strong: 同学 · V1
    - text: 7 条经历 · 5 项基础信息 · 创建于 2026/07/01
  - button "AI Runtime Hermes，状态 Ready": AI · Agent Ready 控制
  - text: 等待输入
  - button "产物 1"
  - button "打开历史记录"
  - button "更多任务操作"
  - button "导出对话"
  - button "导出技术诊断"
  - button "暂停任务"
  - button "历史"
  - region "AI 对话":
    - article:
      - paragraph: 已记录。
      - paragraph: 问题 1/1：
      - paragraph: 这个岗位看重“使用 Kubernetes 完成部署”。资料里没有明确记录，你在课程、练习或项目中接触过吗？可以自由描述，也可以跳过。
      - paragraph: 你可以直接补充说明，或回复“跳过”。
      - button "有" [disabled]
      - button "没有" [disabled]
      - button "不确定" [disabled]
      - button "跳过" [disabled]
      - button "重新生成"
      - button "基于此继续"
      - button "复制消息"
      - group
    - article:
      - paragraph: 没有使用过 Kubernetes，不加入这项技能。
      - button "编辑并重发"
      - button "历史版本"
      - button "复制消息"
      - group
    - article:
      - paragraph: 请检查当前结果并告诉我下一步如何处理。
      - button "重新生成"
      - button "基于此继续"
      - button "复制消息"
      - group
    - button "重新生成最近回答"
  - text: 描述你的求职任务
  - textbox "描述你的求职任务":
    - /placeholder: 补充经历，或告诉我还需要调整什么…
  - button "上传文件"
  - button "Choose File"
  - button "选择简历"
  - button "导入岗位"
  - button "从资料库"
  - button "工具"
  - text: 等待回答
  - button "发送消息" [disabled]
  - text: 松开即可添加文件
  - complementary "任务产物":
    - separator "调整产物面板宽度"
    - text: 任务产物
    - strong: 岗位定制工作区
    - button "收起任务产物"
    - button "关闭任务产物"
    - tablist "切换任务产物":
      - tab "岗位定制工作区" [selected]
    - tablist "岗位定制工作区视图":
      - tab "匹配概览"
      - tab "问答记录 · 1/1" [selected]
      - tab "修改预览"
    - region "岗位定制问答记录":
      - strong: 问答记录
      - text: 1 / 1
      - button "上一个问题" [disabled]: ←
      - text: 问题 1 / 1
      - button "下一个问题" [disabled]: →
      - article:
        - strong: 使用 Kubernetes 完成部署
        - text: 已回答
        - paragraph: 没有使用过 Kubernetes，不加入这项技能。
        - button "编辑"
- region "操作通知"
```

# Test source

```ts
  1   | import "fake-indexeddb/auto";
  2   | import { expect, test, type Page } from "@playwright/test";
  3   | import { execFileSync } from "node:child_process";
  4   | import { existsSync } from "node:fs";
  5   | import { CareerAdaptDb } from "@/services/storage/db";
  6   | import { WorkspaceRepository } from "@/services/storage/repositories";
  7   | import { demoCareerProfile } from "@/data/demoProfile";
  8   | import { demoJobDescriptions } from "@/data/demoJobs";
  9   | import { createTailoringSessionCommand } from "@/services/jobs/tailoringCommands";
  10  | import { AgentRuntime } from "@/agent/runtime/agentRuntime";
  11  | import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
  12  | import { AgentSessionSchema, AgentTaskStateSchema } from "@/agent/contracts/agentSession";
  13  | import { projectTaskStateIntoSession } from "@/agent/runtime/projectTaskStateToWorkflowState";
  14  | import { projectActiveTailoringQuestionToChat } from "@/agent/runtime/AgentHostStore";
  15  | import { readStore } from "./support/p51CoreWorkflow";
  16  | import { openManualPageTab } from "./support/g7b2Ui";
  17  | 
  18  | async function seedQuestion(page: Page) {
  19  |   const db = new CareerAdaptDb(`b011-fixture-${crypto.randomUUID()}`);
  20  |   const repo = new WorkspaceRepository(db);
  21  |   await repo.saveProfile(structuredClone(demoCareerProfile));
  22  |   await repo.setActiveProfileId(demoCareerProfile.id);
  23  |   const profile = (await repo.getProfile(demoCareerProfile.id))!;
  24  |   const general = (await repo.ensureGeneralResumeFromProfile({ profileId: profile.id, mode: "create_new", operationId: "b011-source-create" })).branch;
  25  |   const job = { ...structuredClone(demoJobDescriptions[0]), id: "b011-job", rawText: "负责数据分析与需求梳理，要求使用 Kubernetes 完成部署。",
  26  |     requirements: [...demoJobDescriptions[0].requirements, { ...demoJobDescriptions[0].requirements[0], id: "b011-kubernetes", sourceSpan: { start: 0, end: 21, text: "使用 Kubernetes 完成部署" }, category: "required_skill" as const, description: "使用 Kubernetes 完成部署", keywords: ["Kubernetes"], priority: "high" as const, hardConstraint: false }] };
  27  |   await repo.saveJobDescription(job);
  28  |   const tailoring = createTailoringSessionCommand({ operationId: "b011-create-session", profile, branch: general, job, mode: "competitive" }).session;
  29  |   expect(tailoring.plan.questionPlan?.activeQuestionId).toBeTruthy();
  30  |   const base = AgentRuntime.create("tailor_existing_resume", "clarify_unsupported_facts", "B01.1 定制验收", {
  31  |     personId: profile.personId!, profileId: profile.id, profileVersionNumber: profile.profileVersionNumber!, profileRevision: profile.version
  32  |   });
  33  |   const initial = new AgentTaskStateReducer().create(base, "create_tailored_resume");
  34  |   const state = AgentTaskStateSchema.parse({ ...initial, stage: "clarify_unsupported_facts", completionStatus: "waiting_for_user",
  35  |     selectedEntities: { ...initial.selectedEntities, profileId: profile.id, profileVersion: profile.version,
  36  |       resumeId: general.id, resumeRevisionId: general.currentRevisionId, jobId: job.id, tailoringSessionId: tailoring.id },
  37  |     knownSlots: { ...initial.knownSlots, tailoringSession: tailoring, questionPlan: tailoring.plan.questionPlan,
  38  |       activeQuestionId: tailoring.plan.questionPlan?.activeQuestionId }, updatedAt: new Date().toISOString() });
  39  |   const session = AgentSessionSchema.parse(projectActiveTailoringQuestionToChat(projectTaskStateIntoSession({ ...base,
  40  |     activeResumeId: general.id, activeJobId: job.id, runtimeId: "hermes" }, state), state));
  41  |   await repo.saveAgentSession(session);
  42  |   const records: Record<string, unknown[]> = {};
  43  |   for (const table of db.tables) records[table.name] = await table.toArray();
  44  |   db.close();
  45  |   // Initial synthetic workspace only. All measured answers, review, apply and export use the product UI/Repository.
  46  |   await page.evaluate(async ({ records, sessionId }) => {
  47  |     const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("CareerAdaptDb"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  48  |     const names = Object.keys(records).filter(name => records[name].length > 0);
  49  |     await new Promise<void>((resolve, reject) => { const tx = db.transaction(names, "readwrite"); for (const name of names) for (const row of records[name]) tx.objectStore(name).put(row); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  50  |     db.close(); localStorage.setItem("careeradapt.agent.activeSessionId", sessionId);
  51  |   }, { records, sessionId: session.id });
  52  |   return { sessionId: session.id, sourceId: general.id, jobId: job.id, questionId: tailoring.plan.questionPlan!.activeQuestionId! };
  53  | }
  54  | 
  55  | async function setup(page: Page) {
  56  |   await page.goto("/resume");
  57  |   const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  58  |   await expect(skip.or(page.getByRole("button", { name: /从个人资料库创建/ }))).toBeVisible({ timeout: 15_000 });
  59  |   if (await skip.isVisible()) { await skip.click(); await page.waitForURL(/\/$/); await page.goto("/resume"); }
  60  |   await expect(page.getByRole("button", { name: /从个人资料库创建/ })).toBeVisible();
  61  | }
  62  | 
  63  | function installWriter(page: Page, fail = false) {
  64  |   const requests: Array<{ requestId: string; taskId: string; phase: string }> = [];
  65  |   return page.route("**/api/ai/structured", async route => {
  66  |     const body = route.request().postDataJSON() as { task: string; input: Record<string, unknown> };
  67  |     requests.push({ requestId: route.request().headers()["x-career-request-id"] ?? "missing", taskId: body.task, phase: "received" });
  68  |     if (fail) { await route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "provider_timeout", message: "Isolated model deadline", retryable: true } }) }); return; }
  69  |     expect(body.task).toBe("resume-tailor-diff");
  70  |     const input = body.input as unknown as { target: { sectionId: string; itemId: string; fieldPath: string }; currentContent: { fieldValue: string | string[] }; allowedEvidenceRefs: unknown[]; relevantRequirements: Array<{ requirementId: string }> };
  71  |     const original = input.currentContent.fieldValue;
  72  |     let value: string | string[] = original;
  73  |     if (input.target.sectionId === "summary") value = "基于数据分析项目完成结构化交付，并突出与目标岗位相关的分析经验。";
  74  |     if (input.target.sectionId === "project") {
  75  |       const rephrase = (line: string) => line.includes("需求梳理") ? "参与需求梳理、原型设计和功能验收等 AI 应用项目工作。" : line;
  76  |       value = Array.isArray(original) ? original.map(rephrase) : rephrase(original);
  77  |     }
  78  |     const diffs = JSON.stringify(value) === JSON.stringify(original) ? [] : [{ target: input.target, operation: "replace", original, value,
  79  |       reason: "重组已确认项目事实，保持来源与职责范围", requirementIds: input.relevantRequirements.map(item => item.requirementId), targetKeywords: [], evidenceRefs: input.allowedEvidenceRefs, supportLevel: "verified" }];
  80  |     await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "b011-deterministic", output: { diffs, clarifications: [] }, meta: { provider: "deterministic-test", model: "b011", latencyMs: 1 } }) });
  81  |   }).then(() => requests);
  82  | }
  83  | 
  84  | async function active(page: Page, id: string) { return (await readStore(page, "agentSessions")).find(row => row.id === id)!; }
  85  | 
  86  | test("answer → unified Diff → partial rejection → confirmed independent Revision → reload → real PDF download", async ({ page }, info) => {
  87  |   test.setTimeout(150_000);
  88  |   await setup(page);
  89  |   const fixture = await seedQuestion(page);
  90  |   const profileBefore = await readStore(page, "profiles");
  91  |   const sourceBefore = (await readStore(page, "resumeBranches")).find(row => row.id === fixture.sourceId);
  92  |   const requests = await installWriter(page);
  93  |   await page.route("**/api/agent/stream", route => route.abort());
  94  |   await page.route("**/api/agent/runtime/hermes", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "unexpected_runtime_call", message: "Golden Journey must use its existing deterministic transition" } }) }));
  95  |   await page.goto("/ai-workspace");
  96  |   await page.getByRole("button", { name: /B01.1 定制验收 任务状态/ }).click();
  97  |   await expect(page.getByText("B01.1 定制验收", { exact: true }).first()).toBeVisible();
  98  |   await expect(page.getByLabel("描述你的求职任务")).toBeVisible();
  99  |   await page.getByLabel("描述你的求职任务").fill("没有使用过 Kubernetes，不加入这项技能。");
  100 |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
> 101 |   await expect(page.locator(".agent-tailoring-inline")).toBeVisible({ timeout: 25_000 });
      |                                                         ^ Error: expect(locator).toBeVisible() failed
  102 |   const generated = await active(page, fixture.sessionId);
  103 |   await info.attach("after-answer", { body: JSON.stringify(generated.taskState), contentType: "application/json" });
  104 |   const task = generated.taskState as { knownSlots: { tailoringSession: { plan: { clarificationAnswers: Array<{ questionId: string }>; diffs: unknown[] } } } };
  105 |   expect(task.knownSlots.tailoringSession.plan.clarificationAnswers.some(answer => answer.questionId === fixture.questionId)).toBe(true);
  106 |   expect(task.knownSlots.tailoringSession.plan.diffs.length).toBeGreaterThanOrEqual(2);
  107 |   await page.reload();
  108 |   const preview = page.locator(".agent-tailoring-inline");
  109 |   await expect(preview).toBeVisible();
  110 |   await preview.getByRole("button", { name: "采用", exact: true }).click();
  111 |   await preview.getByRole("button", { name: "忽略", exact: true }).click();
  112 |   for (let i = 0; i < 8 && await preview.getByRole("button", { name: "忽略", exact: true }).isVisible(); i++) await preview.getByRole("button", { name: "忽略", exact: true }).click();
  113 |   await preview.getByRole("button", { name: /提交/ }).click();
  114 |   await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
  115 |   await page.getByRole("button", { name: "确认", exact: true }).click();
  116 |   await expect.poll(async () => (await active(page, fixture.sessionId)).taskState).toMatchObject({ completionStatus: "completed" });
  117 |   const completed = await active(page, fixture.sessionId);
  118 |   await info.attach("completed-task", { body: JSON.stringify(completed.taskState), contentType: "application/json" });
  119 |   const branches = await readStore(page, "resumeBranches");
  120 |   const target = branches.find(row => row.jobId === fixture.jobId && row.branchPurpose === "job_specific")!;
  121 |   expect(target).toBeTruthy();
  122 |   expect(branches.find(row => row.id === fixture.sourceId)).toEqual(sourceBefore);
  123 |   expect(await readStore(page, "profiles")).toEqual(profileBefore);
  124 |   await page.goto(`/resume?branchId=${target.id}`);
  125 |   await page.reload();
  126 |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  127 |   await openManualPageTab(page);
  128 |   const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  129 |   const responsePromise = page.waitForResponse(response => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST");
  130 |   await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  131 |   const [download, response] = await Promise.all([downloadPromise, responsePromise]);
  132 |   expect(response.status()).toBe(200);
  133 |   const pdf = info.outputPath("tailored.pdf"); await download.saveAs(pdf);
  134 |   const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
  135 |   const text = execFileSync(binary, [pdf, "-"], { encoding: "utf8" });
  136 |   expect(text.replace(/\s+/gu, "")).toContain("基于数据分析项目完成结构化交付");
  137 |   expect(text).not.toContain("Kubernetes");
  138 |   const exports = await readStore(page, "exportRecords");
  139 |   expect(exports.some(row => row.branchId === target.id && row.revisionId === target.currentRevisionId && row.exportStatus === "direct_pdf_success")).toBe(true);
  140 |   await info.attach("pdf-text", { body: text, contentType: "text/plain" });
  141 |   await info.attach("model-ledger", { body: JSON.stringify(requests), contentType: "application/json" });
  142 | });
  143 | 
```