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

Expected: true
Received: false

Call Log:
- Timeout 30000ms exceeded while waiting on the predicate
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
          - button "新的对话 任务状态：等待输入" [ref=e69] [cursor=pointer]:
            - generic [ref=e71]: 新的对话
            - generic "任务状态：等待输入" [ref=e72]: 等待输入
          - generic [ref=e73]:
            - button "重命名" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
            - button "归档" [ref=e78] [cursor=pointer]:
              - img [ref=e79]
        - generic [ref=e82]:
          - button "新的对话 任务状态：等待输入" [ref=e83] [cursor=pointer]:
            - generic [ref=e85]: 新的对话
            - generic "任务状态：等待输入" [ref=e86]: 等待输入
          - generic [ref=e87]:
            - button "重命名" [ref=e88] [cursor=pointer]:
              - img [ref=e89]
            - button "归档" [ref=e92] [cursor=pointer]:
              - img [ref=e93]
      - generic [ref=e96]:
        - generic "工作区模式" [ref=e97]:
          - button "AI" [pressed] [ref=e98] [cursor=pointer]:
            - generic [ref=e99]: AI
          - button "协作" [ref=e100] [cursor=pointer]:
            - generic [ref=e101]: 协作
          - button "手动" [ref=e102] [cursor=pointer]:
            - generic [ref=e103]: 手动
        - link "设置与更多" [ref=e104] [cursor=pointer]:
          - /url: /settings
          - img [ref=e105]
          - generic [ref=e108]: 设置与更多
        - generic [ref=e109]:
          - generic [ref=e110]: CA
          - generic [ref=e111]:
            - strong [ref=e112]: 求职工作区
            - generic [ref=e113]: 本地数据
    - main [ref=e116]:
      - generic [ref=e117]:
        - generic [ref=e118]:
          - strong [ref=e119]: 新的对话
          - generic [ref=e120]: 固定：H1Q合成人物 · V1
          - button "H1Q合成人物 · V1 0 条经历 · 1 项基础信息 · 创建于 2026/11/11" [ref=e122] [cursor=pointer]:
            - generic [ref=e123]:
              - strong [ref=e124]: H1Q合成人物 · V1
              - generic [ref=e125]: 0 条经历 · 1 项基础信息 · 创建于 2026/11/11
            - img [ref=e126]
        - generic [ref=e128]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e130] [cursor=pointer]:
            - generic [ref=e131]: AI · 服务
            - generic [ref=e132]: Ready
            - generic [ref=e133]: 控制
          - status [ref=e134]: 等待你回答
          - button "打开历史记录" [ref=e135] [cursor=pointer]:
            - img [ref=e136]
          - button "更多任务操作" [ref=e141] [cursor=pointer]:
            - img [ref=e142]
      - generic [ref=e147]:
        - button "暂停任务" [ref=e149] [cursor=pointer]:
          - img [ref=e150]
          - text: 暂停任务
        - region "AI 对话" [ref=e153]:
          - generic [ref=e154]:
            - article [ref=e155]:
              - generic [ref=e156]:
                - generic [ref=e157]:
                  - paragraph [ref=e161]: 请先分析这个岗位。 岗位：数据开发工程师 岗位职责：维护数据查询，参与数据清洗与产品测试。 任职要求： 本科及以上学历。 必须掌握 SQL。 至少熟悉 Java 或 Go 中的一项。 Python 优先。
                  - generic "用户消息操作" [ref=e162]:
                    - button "编辑并重发" [ref=e163] [cursor=pointer]:
                      - img [ref=e164]
                    - button "历史版本" [ref=e166] [cursor=pointer]:
                      - img [ref=e167]
                    - button "复制消息" [ref=e171] [cursor=pointer]:
                      - img [ref=e172]
                    - group [ref=e175]:
                      - generic "更多消息操作" [ref=e176] [cursor=pointer]:
                        - img [ref=e177]
                - generic "你" [ref=e181]:
                  - img [ref=e182]
            - article [ref=e185]:
              - group "任务过程" [ref=e186]:
                - status "已完成 3 个任务步骤 用时约 20 秒" [ref=e187] [cursor=pointer]:
                  - generic [ref=e188]:
                    - img [ref=e189]
                    - img [ref=e191]
                    - img [ref=e193]
                    - img [ref=e196]
                    - img [ref=e198]
                  - strong [ref=e201]: 已完成 3 个任务步骤
                  - generic [ref=e202]: 用时约 20 秒
                  - img [ref=e203]
              - generic [ref=e205]:
                - generic "AI 助手" [ref=e206]:
                  - img [ref=e207]
                - generic [ref=e210]:
                  - paragraph [ref=e214]: 当前步骤已处理，请核对业务结果。
                  - generic "AI 消息操作" [ref=e215]:
                    - button "重新生成" [ref=e216] [cursor=pointer]:
                      - img [ref=e217]
                    - button "基于此继续" [ref=e220] [cursor=pointer]:
                      - img [ref=e221]
                    - button "复制消息" [ref=e223] [cursor=pointer]:
                      - img [ref=e224]
                    - group [ref=e227]:
                      - generic "更多消息操作" [ref=e228] [cursor=pointer]:
                        - img [ref=e229]
            - article [ref=e233]:
              - generic [ref=e234]:
                - generic [ref=e235]:
                  - paragraph [ref=e239]: 保存刚才这个岗位。
                  - generic "用户消息操作" [ref=e240]:
                    - button "编辑并重发" [ref=e241] [cursor=pointer]:
                      - img [ref=e242]
                    - button "历史版本" [ref=e244] [cursor=pointer]:
                      - img [ref=e245]
                    - button "复制消息" [ref=e249] [cursor=pointer]:
                      - img [ref=e250]
                    - group [ref=e253]:
                      - generic "更多消息操作" [ref=e254] [cursor=pointer]:
                        - img [ref=e255]
                - generic "你" [ref=e259]:
                  - img [ref=e260]
            - generic [ref=e263]:
              - group "任务过程" [ref=e264]:
                - status "等待你确认：保存岗位 用时 18 秒" [ref=e265] [cursor=pointer]:
                  - generic [ref=e266]:
                    - img [ref=e267]
                    - img [ref=e269]
                    - img [ref=e271]
                    - img [ref=e274]
                    - img [ref=e276]
                  - strong [ref=e279]: 等待你确认：保存岗位
                  - generic [ref=e280]: 用时 18 秒
                  - img [ref=e281]
              - alert [ref=e283]:
                - img [ref=e284]
                - generic [ref=e286]:
                  - strong [ref=e287]: 任务暂时中断
                  - paragraph [ref=e288]: 具体操作尚未完成，输入和已有进度已保留。请核对结果后从当前步骤继续。
            - region "当前目标岗位" [ref=e289]:
              - strong [ref=e290]: 未填写公司 · 数据开发工程师
              - paragraph [ref=e291]: 本次提供的岗位描述 · 5 条要求
              - group [ref=e292]:
                - generic "核对岗位要求与来源" [ref=e293]
            - generic "会话操作" [ref=e294]:
              - button "重新执行当前步骤" [ref=e295] [cursor=pointer]:
                - img [ref=e296]
                - text: 重新执行当前步骤
        - generic [ref=e299]:
          - generic [ref=e300]:
            - generic [ref=e301]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e302]:
              - /placeholder: 补充你的实际经历，或回复“跳过”…
          - generic [ref=e303]:
            - button "添加材料与工具" [ref=e305] [cursor=pointer]:
              - img [ref=e306]
            - button "上传文件" [ref=e307]
            - generic [ref=e308]:
              - generic [ref=e309]: 等待你回答
              - button "发送消息" [disabled] [ref=e310]:
                - img [ref=e311]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
```

# Test source

```ts
  9   | const JD = "岗位：数据开发工程师\n岗位职责：维护数据查询，参与数据清洗与产品测试。\n任职要求：\n本科及以上学历。\n必须掌握 SQL。\n至少熟悉 Java 或 Go 中的一项。\nPython 优先。";
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
  42  |       if (!localStorage.getItem("careeradapt-ai-settings")) localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test",
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
  78  |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", /^(ready|new_session_ready)$/u);
  79  |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  80  |     await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
  81  |     await snapshot("new-session-persisted");
  82  |     await send(`请先分析这个岗位。\n${JD}`);
  83  |     await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  84  |     const analyzed = await snapshot("analyze-only");
  85  |     expect(analyzed.jobs).toHaveLength(baselineJobs);
  86  |     expect(analyzed.session?.taskState?.workflowId).toBe("job_ingestion");
  87  |     expect(analyzed.session?.taskState?.knownSlots.rawText).toBe(JD);
  88  |     expect(record(analyzed.session?.taskState?.knownSlots.facadeCheckpoint).targetSnapshot).toBeTruthy();
  89  |     const graph = record(analyzed.session?.taskState?.knownSlots.graph);
  90  |     const requirements = (graph.requirements as Array<Record<string, unknown>>);
  91  |     expect(requirements.some(row => String(row.statement).includes("SQL") && row.hardConstraint === true)).toBe(true);
  92  |     expect(requirements.some(row => record(row.keywordLogic).relation === "any_of")).toBe(true);
  93  |     // Force recovery from durable state; the next user message contains no JD.
  94  |     await page.reload();
  95  |     // A visible Composer alone does not prove asynchronous Session hydration.
  96  |     // Wait for the previous user message to be restored before interacting.
  97  |     await expect(page.getByText(`请先分析这个岗位。\n${JD}`, { exact: true })).toBeVisible();
  98  |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready");
  99  |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  100 |     expect((await current()).taskState).toEqual(analyzed.session?.taskState);
  101 |     await send("保存刚才这个岗位。");
  102 |     // A save request may require its persisted Host confirmation. Exercise the
  103 |     // real authorization boundary rather than waiting for an unapproved write.
  104 |     await expect(page.getByRole("region", { name: "确认保存岗位信息" })).toBeVisible({ timeout: 30_000 });
  105 |     expect(await readStore(page, "jobDescriptions")).toHaveLength(baselineJobs);
  106 |     await snapshot("job-awaiting-confirmation");
  107 |     await page.getByRole("region", { name: "确认保存岗位信息" }).getByRole("button", { name: "确认", exact: true }).click();
  108 |     await expect.poll(async () => (await readStore(page, "jobDescriptions")).length, { timeout: 60_000 }).toBe(baselineJobs + 1);
> 109 |     await expect.poll(async () => (await current())?.taskState?.knownSlots.jobPersistenceVerified, { timeout: 30_000 }).toBe(true);
      |                                                                                                                         ^ Error: expect(received).toBe(expected) // Object.is equality
  110 |     const saved = await snapshot("job-saved");
  111 |     const job = saved.jobs.find(row => !before.jobs.some(old => old.id === row.id))!;
  112 |     expect(job).toMatchObject({ rawText: JD, company: null });
  113 |     const jobId = job.id;
  114 |     expect(saved.session?.taskState).toMatchObject({ workflowId: "job_ingestion", completionStatus: "completed", selectedEntities: { profileId, jobId } });
  115 |     await send("基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配。");
  116 |     await expect(page.getByRole("button", { name: "直接生成", exact: true }).last()).toBeVisible({ timeout: 60_000 });
  117 |     const proposed = await snapshot("composition-proposed");
  118 |     expect(proposed.session?.taskState).toMatchObject({ workflowId: "compose_resume", selectedEntities: { profileId, jobId } });
  119 |     expect(proposed.session?.taskState?.knownSlots.nextAction).toMatchObject({ kind: "job_fit", profileId, jobId });
  120 |     expect(proposed.branches).toHaveLength(0);
  121 |     const checkpoint = record(proposed.session?.taskState?.knownSlots.resumeCompositionCheckpoint);
  122 |     const composition = ResumeCompositionResultSchema.parse(checkpoint.compositionResult);
  123 |     expect(composition.items.some(item => item.data.sectionType === "project")).toBe(true);
  124 |     expect(composition.items.some(item => item.data.sectionType === "internship")).toBe(true);
  125 |     expect(composition.proposal.bulletCount).toBeGreaterThan(0);
  126 |     expect(composition.evidenceGraph.sourceAssetIds.length).toBeGreaterThan(0);
  127 |     expect(composition.jobId).toBeUndefined();
  128 |     const compose = bridgeResults.map(row => record(row.result)).find(result => record(record(result.diagnostics).mcpCallTrace).toolName === "career.workflow.compose_resume");
  129 |     expect(compose, JSON.stringify(bridgeResults)).toBeTruthy();
  130 |     expect(compose!.ok).toBe(true);
  131 |     expect(record(record(compose!.diagnostics).mcpCallTrace).gatewayReached).toBe(true);
  132 |     expect(record(compose!.diagnostics).schemaIssues ?? []).toEqual([]);
  133 |     expect(requests.find(request => request.name === "career.workflow.compose_resume")?.input).toEqual({ mode: "general" });
  134 |     await page.reload();
  135 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready");
  136 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  137 |     expect((await current()).taskState?.knownSlots.nextAction).toEqual(proposed.session?.taskState?.knownSlots.nextAction);
  138 |     expect((await current()).taskState?.knownSlots.resumeCompositionCheckpoint).toEqual(checkpoint);
  139 |     expect((await current()).pendingConfirmation).toEqual(proposed.session?.pendingConfirmation);
  140 |     expect((await current()).activeBranchId).toBe(proposed.session?.activeBranchId);
  141 |     await snapshot("composition-confirmation-restored");
  142 |     await page.getByRole("button", { name: "直接生成", exact: true }).last().click();
  143 |     await expect.poll(async () => ({ workflowId: (await current())?.taskState?.workflowId,
  144 |       completionStatus: (await current())?.taskState?.completionStatus }), { timeout: 60_000 }).toEqual({ workflowId: "analyze_job_fit", completionStatus: "completed" });
  145 |     const completed = await snapshot("fit-completed");
  146 |     expect(completed.branches).toHaveLength(1);
  147 |     expect(completed.revisions).toHaveLength(1);
  148 |     const branch = completed.branches[0];
  149 |     expect(branch.branchPurpose).toBe("general");
  150 |     expect(branch.profileId).toBe(profileId);
  151 |     expect(branch.jobId).toBeUndefined();
  152 |     const revisionId = branch.currentRevisionId;
  153 |     expect(completed.revisions[0]).toMatchObject({ id: revisionId, branchId: branch.id });
  154 |     expect(completed.session?.taskState?.selectedEntities).toMatchObject({ profileId, jobId, resumeId: branch.id, revisionId });
  155 |     expect(completed.session?.taskState?.knownSlots.nextAction).toBeUndefined();
  156 |     const fitCheckpoint = record(completed.session?.taskState?.knownSlots.facadeCheckpoint);
  157 |     expect(fitCheckpoint).toMatchObject({ kind: "job_fit", profileId, jobId, resumeId: branch.id });
  158 |     const fit = record(completed.session?.taskState?.knownSlots.fitAnalysis);
  159 |     expect(fit.analysis).toBeTruthy();
  160 |     expect(fit.dependencies).toMatchObject({ profileId, jobId, resumeId: branch.id, resumeRevisionId: revisionId });
  161 |     expect(JSON.stringify(fit.analysis)).toMatch(/status/u);
  162 |     expect(JSON.stringify(fit.analysis)).toMatch(/evidence|unknown/iu);
  163 |     const fitArtifact = completed.session?.artifactRefs.find(artifact => artifact.kind === "job_fit_overview");
  164 |     expect(fitArtifact?.binding).toMatchObject({ sessionId, branchId: completed.session?.activeBranchId,
  165 |       workflowId: "analyze_job_fit", jobId, resumeBranchId: branch.id, revisionId });
  166 |     expect(completed.session?.pendingConfirmation).toBeUndefined();
  167 |     await page.reload();
  168 |     await expect(page.getByText("通用简历已创建，岗位匹配已完成，可以打开匹配结果。", { exact: true })).toBeVisible();
  169 |     const restored = await snapshot("refreshed");
  170 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready");
  171 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  172 |     expect(restored.session?.activeBranchId).toBe(completed.session?.activeBranchId);
  173 |     expect(restored.session?.taskState).toEqual(completed.session?.taskState);
  174 |     expect(restored.session?.artifactRefs).toContainEqual(fitArtifact);
  175 |     expect(restored.session?.pendingConfirmation).toBeUndefined();
  176 |     expect(restored.session?.taskState).toMatchObject({ workflowId: "analyze_job_fit", completionStatus: "completed",
  177 |       selectedEntities: { profileId, jobId, resumeId: branch.id, revisionId } });
  178 |     expect(restored.session?.taskState?.knownSlots.fitAnalysis).toEqual(fit);
  179 |     expect(restored.profiles).toEqual(before.profiles);
  180 |     expect(restored.jobs).toHaveLength(baselineJobs + 1);
  181 |     expect(restored.jobs.find(row => row.id === jobId)).toEqual(job);
  182 |     expect(restored.branches).toEqual(completed.branches);
  183 |     expect(restored.revisions).toEqual(completed.revisions);
  184 |     expect(JSON.stringify({ sessions: await sessions(), bridgeResults })).not.toMatch(/career_agent_duplicate_invalid_call|gateway_validation_failed|jobId invalid_type|mode invalid_value/u);
  185 |   } finally {
  186 |     const evidence = { sessionId, timeline, bridgeResults, requests: requests.map(({ name, input, agentSessionId, operationId }) => ({ name, input, agentSessionId, operationId })) };
  187 |     await info.attach("h1q-business-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  188 |     if (process.env.H1Q_EVIDENCE_DIR) writeFileSync(path.join(process.env.H1Q_EVIDENCE_DIR, "business-evidence.json"), JSON.stringify(evidence, null, 2));
  189 |   }
  190 | });
  191 | 
```