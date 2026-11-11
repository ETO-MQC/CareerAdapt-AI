# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflow-continuation-h1.spec.ts >> H1 bundled Hermes analyze/save/compose/confirm/fit/refresh
- Location: tests\e2e\workflow-continuation-h1.spec.ts:12:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 3
Received: 2

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e12]:
    - complementary "AI 工作区导航" [ref=e13]:
      - generic [ref=e14]:
        - link "职适AI 首页" [ref=e15] [cursor=pointer]:
          - /url: /
          - generic [ref=e16]: 职
          - generic [ref=e17]: 职适AI
        - button "收起 AI 导航" [ref=e18] [cursor=pointer]:
          - img [ref=e19]
      - generic [ref=e22]:
        - button "新任务" [ref=e23] [cursor=pointer]:
          - img [ref=e24]
          - generic [ref=e25]: 新任务
        - button "搜索 / 历史" [ref=e26] [cursor=pointer]:
          - img [ref=e27]
          - generic [ref=e30]: 搜索 / 历史
      - navigation "资产" [ref=e31]:
        - generic [ref=e32]: 资产
        - link "AI 助手" [ref=e33] [cursor=pointer]:
          - /url: /ai-workspace
          - img [ref=e34]
          - generic [ref=e37]: AI 助手
        - link "我的简历" [ref=e38] [cursor=pointer]:
          - /url: /resume
          - img [ref=e39]
          - generic [ref=e42]: 我的简历
        - link "个人资料库" [ref=e43] [cursor=pointer]:
          - /url: /profile
          - img [ref=e44]
          - generic [ref=e47]: 个人资料库
        - link "岗位" [ref=e48] [cursor=pointer]:
          - /url: /jobs
          - img [ref=e49]
          - generic [ref=e53]: 岗位
        - link "求职进度" [ref=e54] [cursor=pointer]:
          - /url: /applications
          - img [ref=e55]
          - generic [ref=e57]: 求职进度
        - link "回收站" [ref=e58] [cursor=pointer]:
          - /url: /recycle
          - img [ref=e59]
          - generic [ref=e66]: 回收站
      - region "最近任务" [ref=e67]:
        - text: 最近任务
        - generic [ref=e68]:
          - button "新的对话 任务状态：失败" [ref=e69] [cursor=pointer]:
            - generic [ref=e71]: 新的对话
            - generic "任务状态：失败" [ref=e72]: 失败
          - generic [ref=e73]:
            - button "重命名" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
            - button "归档" [ref=e78] [cursor=pointer]:
              - img [ref=e79]
        - generic [ref=e82]:
          - button "新的对话 任务状态：已完成" [ref=e83] [cursor=pointer]:
            - generic [ref=e85]: 新的对话
            - generic "任务状态：已完成" [ref=e86]: 已完成
          - generic [ref=e87]:
            - button "重命名" [ref=e88] [cursor=pointer]:
              - img [ref=e89]
            - button "归档" [ref=e92] [cursor=pointer]:
              - img [ref=e93]
        - generic [ref=e96]:
          - button "新的对话 任务状态：等待输入" [ref=e97] [cursor=pointer]:
            - generic [ref=e99]: 新的对话
            - generic "任务状态：等待输入" [ref=e100]: 等待输入
          - generic [ref=e101]:
            - button "重命名" [ref=e102] [cursor=pointer]:
              - img [ref=e103]
            - button "归档" [ref=e106] [cursor=pointer]:
              - img [ref=e107]
      - generic [ref=e110]:
        - generic "工作区模式" [ref=e111]:
          - button "AI" [pressed] [ref=e112] [cursor=pointer]:
            - generic [ref=e113]: AI
          - button "协作" [ref=e114] [cursor=pointer]:
            - generic [ref=e115]: 协作
          - button "手动" [ref=e116] [cursor=pointer]:
            - generic [ref=e117]: 手动
        - link "设置与更多" [ref=e118] [cursor=pointer]:
          - /url: /settings
          - img [ref=e119]
          - generic [ref=e122]: 设置与更多
        - generic [ref=e123]:
          - generic [ref=e124]: CA
          - generic [ref=e125]:
            - strong [ref=e126]: 求职工作区
            - generic [ref=e127]: 本地数据
    - main [ref=e130]:
      - generic [ref=e131]:
        - generic [ref=e132]:
          - strong [ref=e133]: 新的对话
          - button "H1Q合成人物 · V1 0 条经历 · 1 项基础信息 · 创建于 2026/11/11" [ref=e135] [cursor=pointer]:
            - generic [ref=e136]:
              - strong [ref=e137]: H1Q合成人物 · V1
              - generic [ref=e138]: 0 条经历 · 1 项基础信息 · 创建于 2026/11/11
            - img [ref=e139]
        - generic [ref=e141]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e143] [cursor=pointer]:
            - generic [ref=e144]: AI · 服务
            - generic [ref=e145]: Ready
            - generic [ref=e146]: 控制
          - status [ref=e147]: 执行失败
          - button "打开历史记录" [ref=e148] [cursor=pointer]:
            - img [ref=e149]
          - button "更多任务操作" [ref=e154] [cursor=pointer]:
            - img [ref=e155]
      - generic [ref=e160]:
        - generic [ref=e162]:
          - img [ref=e163]
          - text: 本轮回答未完成，当前资料已保留
        - region "AI 对话" [ref=e170]:
          - generic [ref=e171]:
            - article [ref=e172]:
              - generic [ref=e173]:
                - generic [ref=e174]:
                  - paragraph [ref=e178]: 保存刚才这个岗位。
                  - generic "用户消息操作" [ref=e179]:
                    - button "编辑并重发" [ref=e180] [cursor=pointer]:
                      - img [ref=e181]
                    - button "历史版本" [ref=e183] [cursor=pointer]:
                      - img [ref=e184]
                    - button "复制消息" [ref=e188] [cursor=pointer]:
                      - img [ref=e189]
                    - group [ref=e192]:
                      - generic "更多消息操作" [ref=e193] [cursor=pointer]:
                        - img [ref=e194]
                - generic "你" [ref=e198]:
                  - img [ref=e199]
            - generic [ref=e202]:
              - group "任务过程" [ref=e203]:
                - status "当前操作未完成 用时 14 秒" [ref=e204] [cursor=pointer]:
                  - generic [ref=e205]:
                    - img [ref=e206]
                    - img [ref=e208]
                    - img [ref=e210]
                    - img [ref=e213]
                    - img [ref=e215]
                  - strong [ref=e218]: 当前操作未完成
                  - generic [ref=e219]: 用时 14 秒
                  - img [ref=e220]
              - alert [ref=e222]:
                - img [ref=e223]
                - generic [ref=e225]:
                  - strong [ref=e226]: 任务暂时中断
                  - paragraph [ref=e227]: 具体操作尚未完成，输入和已有进度已保留。请核对结果后从当前步骤继续。
                  - generic "可选回答" [ref=e228]:
                    - button "重新执行当前步骤" [ref=e229] [cursor=pointer]
            - generic "会话操作" [ref=e230]:
              - button "重新执行当前步骤" [ref=e231] [cursor=pointer]:
                - img [ref=e232]
                - text: 重新执行当前步骤
        - generic [ref=e235]:
          - generic [ref=e236]:
            - generic [ref=e237]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e238]:
              - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
          - generic [ref=e239]:
            - button "添加材料与工具" [ref=e241] [cursor=pointer]:
              - img [ref=e242]
            - button "上传文件" [ref=e243]
            - generic [ref=e244]:
              - generic [ref=e245]: 执行失败
              - button "发送消息" [disabled] [ref=e246]:
                - img [ref=e247]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import { writeFileSync } from "node:fs";
  3   | import path from "node:path";
  4   | import { readStore, installCoreWritingProvider } from "./support/p51CoreWorkflow";
  5   | import type { AgentSession } from "@/agent/contracts/agentSession";
  6   | import { CareerProfileSchema } from "@/domain/schemas";
  7   | import { ResumeCompositionResultSchema } from "@/domain/resumeComposition/contracts";
  8   | 
  9   | const JD = "岗位：数据开发工程师\n岗位职责：维护数据查询，参与数据清洗与产品测试。\n任职要求：本科及以上学历；必须掌握 SQL；具备项目开发或实习经验，满足其一即可；Python 优先。";
  10  | const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
  11  | 
  12  | test("H1 bundled Hermes analyze/save/compose/confirm/fit/refresh", async ({ page }, info) => {
  13  |   test.setTimeout(300_000);
  14  |   page.setDefaultTimeout(15_000);
  15  |   const timeline: Array<Record<string, unknown>> = [];
  16  |   const bridgeResults: Array<Record<string, unknown>> = [];
  17  |   const requests: Array<Record<string, unknown>> = [];
  18  |   page.on("request", request => {
  19  |     if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
  20  |     const body = record(request.postDataJSON());
  21  |     if (body.action === "result") bridgeResults.push({ requestId: body.requestId, result: body.result });
  22  |   });
  23  |   page.on("response", async response => {
  24  |     if (!response.url().includes("/api/agent/mcp?bridge=1") || response.request().method() !== "GET") return;
  25  |     const body = record(await response.json().catch(() => undefined));
  26  |     if (body.request) requests.push(record(body.request));
  27  |     if (Array.isArray(body.requests)) requests.push(...body.requests.map(record));
  28  |   });
  29  |   let sessionId = "";
  30  |   const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  31  |   const current = async () => (await sessions()).find(session => session.id === sessionId)!;
  32  |   const snapshot = async (step: string) => {
  33  |     const value = { step, at: new Date().toISOString(), session: sessionId ? await current() : undefined,
  34  |       profiles: await readStore(page, "profiles"), jobs: await readStore(page, "jobDescriptions"),
  35  |       branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions") };
  36  |     timeline.push(value);
  37  |     return value;
  38  |   };
  39  |   try {
  40  |     // Only non-secret Provider settings. No business data or TaskState in localStorage.
  41  |     await page.addInitScript(({ baseUrl }) => {
  42  |       localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test",
  43  |         provider: "openai-compatible", apiKeyConfigured: true }));
  44  |     }, { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  45  |     await page.goto("/h1q-fixture");
  46  |     await page.getByRole("button", { name: "Seed confirmed Profile", exact: true }).click();
  47  |     await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
  48  |     const profileId = (await page.getByTestId("seed-result").textContent())!;
  49  |     const before = await snapshot("repository-seed");
  50  |     const profile = CareerProfileSchema.parse(before.profiles.find(row => row.id === profileId));
  51  |     expect(profile.experiences.filter(row => row.type === "education")).toHaveLength(1);
  52  |     expect(profile.experiences.find(row => row.type === "project")!.facts.length).toBeGreaterThanOrEqual(2);
  53  |     expect(profile.experiences.find(row => row.type === "internship")!.facts.length).toBeGreaterThanOrEqual(1);
  54  |     expect(profile.experiences.every(row => row.facts.every(fact => fact.confirmedByUser))).toBe(true);
  55  |     expect(profile.skills.map(skill => skill.name)).toEqual(["SQL", "Python"]);
  56  |     expect(before.branches).toHaveLength(0);
  57  |     expect(before.revisions).toHaveLength(0);
  58  |     const baselineJobs = before.jobs.length;
  59  |     await installCoreWritingProvider(page);
  60  |     await page.goto("/ai-workspace");
  61  |     // One explicit READY preflight. Real Supervisor/API/MCP/Facade projections.
  62  |     await expect.poll(async () => {
  63  |       const body = await (await page.request.get("/api/agent/runtime/hermes/control")).json();
  64  |       const state = body.snapshot;
  65  |       return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady
  66  |         && state?.toolSurfaceReady && state?.requiredCareerFacadesReady === state?.requiredCareerFacadesTotal;
  67  |     }, { timeout: 90_000 }).toBe(true);
  68  |     await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u);
  69  |     const sessionIds = new Set((await sessions()).map(session => session.id));
  70  |     await page.getByRole("button", { name: "新任务", exact: true }).click();
  71  |     await expect.poll(async () => (await sessions()).filter(session => !sessionIds.has(session.id)).length).toBe(1);
  72  |     sessionId = (await sessions()).find(session => !sessionIds.has(session.id))!.id;
  73  |     const send = async (text: string) => {
  74  |       await page.getByLabel("描述你的求职任务").fill(text);
  75  |       await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 30_000 });
  76  |       await page.getByRole("button", { name: "发送消息", exact: true }).click();
  77  |     };
  78  |     await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
  79  |     await snapshot("new-session-persisted");
  80  |     await send(`请先分析这个岗位。\n${JD}`);
  81  |     await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  82  |     const analyzed = await snapshot("analyze-only");
  83  |     expect(analyzed.jobs).toHaveLength(baselineJobs);
  84  |     expect(analyzed.session?.taskState?.workflowId).toBe("job_ingestion");
  85  |     expect(analyzed.session?.taskState?.knownSlots.rawText).toBe(JD);
  86  |     expect(record(analyzed.session?.taskState?.knownSlots.facadeCheckpoint).targetSnapshot).toBeTruthy();
  87  |     // Force recovery from durable state; the next user message contains no JD.
  88  |     await page.reload();
  89  |     await send("保存刚才这个岗位。");
> 90  |     await expect.poll(async () => (await readStore(page, "jobDescriptions")).length, { timeout: 60_000 }).toBe(baselineJobs + 1);
      |                                                                                                           ^ Error: expect(received).toBe(expected) // Object.is equality
  91  |     await expect.poll(async () => (await current())?.taskState?.knownSlots.jobPersistenceVerified, { timeout: 30_000 }).toBe(true);
  92  |     const saved = await snapshot("job-saved");
  93  |     const job = saved.jobs.find(row => !before.jobs.some(old => old.id === row.id))!;
  94  |     expect(job).toMatchObject({ rawText: JD, company: null });
  95  |     const jobId = job.id;
  96  |     expect(saved.session?.taskState).toMatchObject({ workflowId: "job_ingestion", completionStatus: "completed", selectedEntities: { profileId, jobId } });
  97  |     await send("基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配。");
  98  |     await expect(page.getByRole("button", { name: "直接生成", exact: true }).last()).toBeVisible({ timeout: 60_000 });
  99  |     const proposed = await snapshot("composition-proposed");
  100 |     expect(proposed.session?.taskState).toMatchObject({ workflowId: "compose_resume", selectedEntities: { profileId, jobId } });
  101 |     expect(proposed.session?.taskState?.knownSlots.nextAction).toMatchObject({ kind: "job_fit", profileId, jobId });
  102 |     expect(proposed.branches).toHaveLength(0);
  103 |     const checkpoint = record(proposed.session?.taskState?.knownSlots.resumeCompositionCheckpoint);
  104 |     const composition = ResumeCompositionResultSchema.parse(checkpoint.compositionResult);
  105 |     expect(composition.items.some(item => item.data.sectionType === "project")).toBe(true);
  106 |     expect(composition.items.some(item => item.data.sectionType === "internship")).toBe(true);
  107 |     expect(composition.proposal.bulletCount).toBeGreaterThan(0);
  108 |     expect(composition.evidenceGraph.sourceAssetIds.length).toBeGreaterThan(0);
  109 |     expect(composition.jobId).toBeUndefined();
  110 |     const compose = bridgeResults.map(row => record(row.result)).find(result => record(record(result.diagnostics).mcpCallTrace).toolName === "career.workflow.compose_resume");
  111 |     expect(compose, JSON.stringify(bridgeResults)).toBeTruthy();
  112 |     expect(compose!.ok).toBe(true);
  113 |     expect(record(record(compose!.diagnostics).mcpCallTrace).gatewayReached).toBe(true);
  114 |     expect(record(compose!.diagnostics).schemaIssues ?? []).toEqual([]);
  115 |     await page.reload();
  116 |     await page.getByRole("button", { name: "直接生成", exact: true }).last().click();
  117 |     await expect.poll(async () => ({ workflowId: (await current())?.taskState?.workflowId,
  118 |       completionStatus: (await current())?.taskState?.completionStatus }), { timeout: 60_000 }).toEqual({ workflowId: "analyze_job_fit", completionStatus: "completed" });
  119 |     const completed = await snapshot("fit-completed");
  120 |     expect(completed.branches).toHaveLength(1);
  121 |     expect(completed.revisions).toHaveLength(1);
  122 |     const branch = completed.branches[0];
  123 |     expect(branch.branchPurpose).toBe("general");
  124 |     expect(branch.profileId).toBe(profileId);
  125 |     expect(branch.jobId).toBeUndefined();
  126 |     const revisionId = branch.currentRevisionId;
  127 |     expect(completed.revisions[0]).toMatchObject({ id: revisionId, branchId: branch.id });
  128 |     expect(completed.session?.taskState?.selectedEntities).toMatchObject({ profileId, jobId, resumeId: branch.id, revisionId });
  129 |     expect(completed.session?.taskState?.knownSlots.nextAction).toBeUndefined();
  130 |     const fitCheckpoint = record(completed.session?.taskState?.knownSlots.facadeCheckpoint);
  131 |     expect(fitCheckpoint).toMatchObject({ kind: "job_fit", profileId, jobId, resumeId: branch.id });
  132 |     const fit = record(completed.session?.taskState?.knownSlots.fitAnalysis);
  133 |     expect(fit.analysis).toBeTruthy();
  134 |     expect(fit.dependencies).toMatchObject({ profileId, jobId, resumeId: branch.id, resumeRevisionId: revisionId });
  135 |     expect(JSON.stringify(fit.analysis)).toMatch(/status/u);
  136 |     expect(JSON.stringify(fit.analysis)).toMatch(/evidence|unknown/iu);
  137 |     await page.reload();
  138 |     await expect(page.getByLabel("描述你的求职任务")).toBeVisible();
  139 |     const restored = await snapshot("refreshed");
  140 |     expect(restored.session?.taskState).toMatchObject({ workflowId: "analyze_job_fit", completionStatus: "completed",
  141 |       selectedEntities: { profileId, jobId, resumeId: branch.id, revisionId } });
  142 |     expect(restored.session?.taskState?.knownSlots.fitAnalysis).toEqual(fit);
  143 |     expect(restored.profiles).toEqual(before.profiles);
  144 |     expect(restored.jobs).toHaveLength(baselineJobs + 1);
  145 |     expect(restored.jobs.find(row => row.id === jobId)).toEqual(job);
  146 |     expect(restored.branches).toEqual(completed.branches);
  147 |     expect(restored.revisions).toEqual(completed.revisions);
  148 |     expect(JSON.stringify({ sessions: await sessions(), bridgeResults })).not.toMatch(/career_agent_duplicate_invalid_call|gateway_validation_failed|jobId invalid_type|mode invalid_value/u);
  149 |   } finally {
  150 |     const evidence = { sessionId, timeline, bridgeResults, requests };
  151 |     await info.attach("h1q-business-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  152 |     if (process.env.H1Q_EVIDENCE_DIR) writeFileSync(path.join(process.env.H1Q_EVIDENCE_DIR, "business-evidence.json"), JSON.stringify(evidence, null, 2));
  153 |   }
  154 | });
  155 | 
```