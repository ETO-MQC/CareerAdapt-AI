# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hermes-p46h-integration.spec.ts >> P4.6h hermetic Web + browser MCP integration >> CASE A UX011-PROFILE — narrative candidates are editable, partially accepted and explicitly committed
- Location: tests\e2e\hermes-p46h-integration.spec.ts:126:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: '经历候选核对' })
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for getByRole('region', { name: '经历候选核对' })

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
    - button "新的对话 任务状态：已完成": 新的对话 已完成
    - button "重命名"
    - button "归档"
    - button "新的对话 任务状态：等待输入": 新的对话 等待输入
    - button "重命名"
    - button "归档"
    - button "新的对话 任务状态：等待输入": 新的对话 等待输入
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
  - strong: 新的对话
  - text: 固定：UX011 匿名人物 · V1
  - button "UX011 匿名人物 · V1 0 条经历 · 1 项基础信息 · 创建于 2026/11/05":
    - strong: UX011 匿名人物 · V1
    - text: 0 条经历 · 1 项基础信息 · 创建于 2026/11/05
  - button "AI Runtime Hermes，状态 Ready": AI · 服务 Ready 控制
  - status: 已完成
  - button "打开历史记录"
  - button "更多任务操作"
  - region "AI 对话":
    - article:
      - paragraph: 帮我整理资料库 UX011-PROFILE：就读匿名大学计算机专业。参与匿名课程项目，使用 Python 清洗数据并提交报告。获得匿名竞赛三等奖。
      - button "编辑并重发"
      - button "历史版本"
      - button "复制消息"
      - group
    - article:
      - group:
        - status "已完成 1 个任务步骤":
          - strong: 已完成 1 个任务步骤
      - paragraph: 已进入 Profile Intake，并停在下一步资料补充边界。
      - button "重新生成"
      - button "基于此继续"
      - button "复制消息"
      - group
    - button "重新生成最近回答"
  - text: 描述你的求职任务
  - textbox "描述你的求职任务":
    - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
  - button "添加材料与工具"
  - button "上传文件"
  - text: 已完成
  - button "发送消息" [disabled]
  - text: 松开即可添加文件
- region "操作通知"
```

# Test source

```ts
  55  |             responseToolCallId: row.responseToolCallId ?? null, toolResults: row.toolResults,
  56  |             ...row.safeMetrics };
  57  |         }) } : {}) };
  58  |       await appendFile(".tmp/p518-baseline-" + process.env.HERMES_INTEGRATION_RUN_ID + ".jsonl", JSON.stringify(safe) + "\n");
  59  |     }
  60  |     const caseReceipt = { timeline: differentialTimelines.get(page), case: testInfo.title.match(/^CASE ([A-N])/u)?.[1], started: true,
  61  |       status: testInfo.status, toolSequence: trace?.toolRequests.map(request => request.name),
  62  |       runReceipts: trace?.runReceipts, checkpointTransitions: trace?.toolReceipts,
  63  |       providerCalls: (await readProviderEvidence(page)).requests.length - (providerOffsets.get(page) ?? 0),
  64  |       formalWriteCount: trace?.formalWrites.length, formalWrites: trace?.formalWrites,
  65  |       writeScope: "Committed renderer IndexedDB add/put operations after initial fixture readiness, including explicit source import fixtures" };
  66  |     await testInfo.attach("case-gate-receipt", { body: JSON.stringify(caseReceipt), contentType: "application/json" });
  67  |     await appendFile(`.tmp/core02-case-gate-${process.env.HERMES_INTEGRATION_RUN_ID}.jsonl`, `${JSON.stringify(caseReceipt)}\n`);
  68  |     if (!/^CASE [IJKLMN]/u.test(testInfo.title)) return;
  69  |     if (/^CASE [LMN]/u.test(testInfo.title)) {
  70  |       await testInfo.attach("closeout-provider", { body: JSON.stringify(await readProviderEvidence(page), null, 2), contentType: "application/json" });
  71  |       await testInfo.attach("closeout-transport", { body: JSON.stringify(closeoutTraces.get(page), null, 2), contentType: "application/json" });
  72  |       for (const name of ["agentSessions", "profiles", "resumeBranches", "jobDescriptions", "appMeta"]) {
  73  |         await testInfo.attach(`closeout-${name}`, { body: JSON.stringify(await readStore(page, name), null, 2), contentType: "application/json" });
  74  |       }
  75  |     }
  76  |     const sessions = await page.evaluate(() => new Promise((resolve, reject) => {
  77  |       const request = indexedDB.open("CareerAdaptDb");
  78  |       request.onerror = () => reject(request.error);
  79  |       request.onsuccess = () => {
  80  |         const database = request.result;
  81  |         const result = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
  82  |         result.onerror = () => reject(result.error);
  83  |         result.onsuccess = () => {
  84  |           database.close();
  85  |           resolve(result.result.map(session => ({
  86  |             sessionId: session.id, activeTurn: session.activeTurn, hermesRun: session.hermesRun, activeConversationBranchId: session.activeConversationBranchId,
  87  |             pendingConfirmation: session.pendingConfirmation ? { operationId: session.pendingConfirmation.operationId, turnId: session.pendingConfirmation.turnId } : null,
  88  |             task: session.taskState ? { workflowId: session.taskState.workflowId, stage: session.taskState.stage, completionStatus: session.taskState.completionStatus, selectedEntities: session.taskState.selectedEntities } : null,
  89  |             messages: session.messages?.map((message: { id: string; role: string; turnId?: string; status?: string; conversationBranchId?: string }) => ({ id: message.id, role: message.role, turnId: message.turnId, status: message.status, conversationBranchId: message.conversationBranchId }))
  90  |           })));
  91  |         };
  92  |       };
  93  |     }));
  94  |     await testInfo.attach("host-confirmation-receipt", { body: JSON.stringify(sessions, null, 2), contentType: "application/json" });
  95  |   });
  96  |   test("CASE A — ordinary greeting completes through official Hermes Runs", async ({ page }) => {
  97  |     const trace = observeRuntimeAndBridge(page);
  98  |     await openWorkspace(page);
  99  |     await send(page, "你好");
  100 |     await expectAssistant(page, "你好，Hermes hermetic runtime 已就绪。");
  101 |     expect(trace.runtimeActions.filter((action) => action === "run_start")).toHaveLength(1);
  102 |     expect(trace.runtimeActions.filter((action) => action === "run_events")).toHaveLength(1);
  103 |     expect(trace.toolRequests).toHaveLength(0);
  104 |   });
  105 | 
  106 |   test("CASE B — general career advice stays tool-free", async ({ page }) => {
  107 |     const trace = observeRuntimeAndBridge(page);
  108 |     await openWorkspace(page);
  109 |     await send(page, "大学生找工作应该怎么准备？");
  110 |     await expectAssistant(page, "你好，Hermes hermetic runtime 已就绪。");
  111 |     expect(trace.toolRequests).toHaveLength(0);
  112 |   });
  113 | 
  114 |   test("CASE C — personal career questions use a read-only Career tool", async ({ page }) => {
  115 |     const trace = observeRuntimeAndBridge(page);
  116 |     await openWorkspace(page);
  117 |     await assertHermesReadyForCase(page);
  118 |     await send(page, "根据我的经历，你觉得我适合哪些岗位？");
  119 |     await expectAssistant(page, "当前示例资料包含 2 个项目经历。");
  120 |     await expectToolNames(trace, ["career.profile.get"]);
  121 |     expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
  122 |     expect(trace.resultActions).toContain("result");
  123 |     expect(trace.toolRequests.every((request) => request.name.startsWith("career.") && !request.name.includes("workflow"))).toBe(true);
  124 |   });
  125 | 
  126 |   test("CASE A UX011-PROFILE — narrative candidates are editable, partially accepted and explicitly committed", async ({ page }) => {
  127 |     await openWorkspace(page);
  128 |     await page.goto("/profile");
  129 |     await page.locator('[data-profile-category="basics"]').click();
  130 |     await page.getByRole("button", { name: "新增", exact: true }).click();
  131 |     await page.locator("#new-profile-name").fill("UX011 匿名人物");
  132 |     await page.getByRole("button", { name: "创建人物", exact: true }).click();
  133 |     await expect.poll(async () => (await readStore(page, "profiles")).some(row => (row.basics as { name?: string })?.name === "UX011 匿名人物")).toBe(true);
  134 |     const profile = (await readStore(page, "profiles")).find(row => (row.basics as { name?: string })?.name === "UX011 匿名人物")!;
  135 |     await page.goto("/ai-workspace");
  136 |     await startFreshConversation(page);
  137 |     await page.route("**/api/ai/structured**", async route => {
  138 |       const body = route.request().postDataJSON();
  139 |       if (body.task !== "profile-intake-semantic") return route.continue();
  140 |       const raw = body.input.rawNarrative as string;
  141 |       const records = [
  142 |         { text: "就读匿名大学计算机专业。", item: { id: "ux-edu", sectionType: "education", school: "匿名大学", major: "计算机专业" } },
  143 |         { text: "参与匿名课程项目，使用 Python 清洗数据并提交报告。", item: { id: "ux-project", sectionType: "project", title: "匿名课程项目", role: "参与", description: "使用 Python 清洗数据并提交报告。", tools: ["Python"] } },
  144 |         { text: "获得匿名竞赛三等奖。", item: { id: "ux-award", sectionType: "awards", name: "匿名竞赛三等奖" } }
  145 |       ];
  146 |       await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "ux011-synthetic", output: {
  147 |         candidates: records.map(record => ({ candidateKey: record.item.id, sectionType: record.item.sectionType,
  148 |           sourceSpan: { start: raw.indexOf(record.text), end: raw.indexOf(record.text) + record.text.length }, structuredItem: record.item,
  149 |           professionalText: record.text, uncertainFields: [] })), followUpQuestions: []
  150 |       }, meta: { provider: "scripted", model: "ux011" } }) });
  151 |     });
  152 |     const text = "帮我整理资料库 UX011-PROFILE：就读匿名大学计算机专业。参与匿名课程项目，使用 Python 清洗数据并提交报告。获得匿名竞赛三等奖。";
  153 |     await send(page, text);
  154 |     const review = page.getByRole("region", { name: "经历候选核对" });
> 155 |     await expect(review).toBeVisible();
      |                          ^ Error: expect(locator).toBeVisible() failed
  156 |     await expect(review.locator(".profile-intake-candidate-card")).toHaveCount(3);
  157 |     await page.screenshot({ path: "docs/quality/ux-01.1-logs/profile-candidates.png", fullPage: true });
  158 |     expect((await readStore(page, "profiles")).find(row => row.id === profile.id)).toEqual(profile);
  159 |     const education = review.locator(".profile-intake-candidate-card").filter({ hasText: "匿名大学" });
  160 |     await education.getByRole("button", { name: "编辑后采用", exact: true }).click();
  161 |     await education.getByLabel("专业", { exact: true }).fill("计算机");
  162 |     await education.getByRole("button", { name: "保存并采用", exact: true }).click();
  163 |     await expect(review).toContainText("已记录教育经历");
  164 |     const award = review.locator(".profile-intake-candidate-card").filter({ hasText: "匿名竞赛" });
  165 |     await award.locator("summary").first().click();
  166 |     await award.getByRole("button", { name: "忽略", exact: true }).click();
  167 |     const project = review.locator(".profile-intake-candidate-card").filter({ hasText: "匿名课程项目" });
  168 |     await project.locator("summary").first().click();
  169 |     await project.getByRole("button", { name: "采用", exact: true }).click();
  170 |     expect((await readStore(page, "profiles")).find(row => row.id === profile.id)).toEqual(profile);
  171 |     await page.locator("form.agent-composer").getByRole("button", { name: "完成整理", exact: true }).click();
  172 |     const artifact = page.getByRole("region", { name: "经历核对" });
  173 |     if (!await artifact.isVisible()) await page.getByRole("button", { name: /产物/ }).click();
  174 |     await artifact.getByRole("button", { name: "完成整理并保存到资料库", exact: true }).click();
  175 |     await expect.poll(async () => (await readStore(page, "profiles")).find(row => row.id === profile.id)?.version).toBe(Number(profile.version) + 1);
  176 |     const saved = (await readStore(page, "profiles")).find(row => row.id === profile.id)!;
  177 |     expect(JSON.stringify(saved)).toContain("匿名课程项目");
  178 |     expect(JSON.stringify(saved)).not.toContain("匿名竞赛三等奖");
  179 |     await page.reload();
  180 |     expect((await readStore(page, "profiles")).find(row => row.id === profile.id)).toEqual(saved);
  181 |   });
  182 | 
  183 |   test("CASE B UX011-JD — temporary target persists across reload and explicit new target replaces it", async ({ page }) => {
  184 |     await openWorkspace(page);
  185 |     const jobs = await readStore(page, "jobDescriptions");
  186 |     const first = "请分析 UX011-JD 岗位。公司：匿名甲公司\n岗位：数据分析师\n任职要求\n必须掌握 Python 或 R。\n必须掌握 Python 和 SQL。\n加分项\n熟悉 Java。";
  187 |     await send(page, first);
  188 |     const target = page.getByRole("region", { name: "当前目标岗位" });
  189 |     await expect(target).toContainText("数据分析师");
  190 |     const id = await target.getAttribute("data-target-id");
  191 |     await target.getByText("核对岗位要求与来源", { exact: true }).click();
  192 |     await expect(target.locator("[data-target-requirement-id]")).toHaveCount(3);
  193 |     const original = await target.locator("[data-target-requirement-id]").allTextContents();
  194 |     await page.screenshot({ path: "docs/quality/ux-01.1-logs/jd-target.png", fullPage: true });
  195 |     await page.reload();
  196 |     await expect(target).toHaveAttribute("data-target-id", id!);
  197 |     expect(await target.locator("[data-target-requirement-id]").allTextContents()).toEqual(original);
  198 |     expect(await readStore(page, "jobDescriptions")).toEqual(jobs);
  199 |     await send(page, "请分析 UX011-JD 岗位。公司：匿名乙公司\n岗位：后端工程师\n任职要求\n必须掌握 Java，能够实现接口服务。熟悉 Spring 者优先。");
  200 |     await expect(target).toContainText("后端工程师");
  201 |     await expect(target).not.toHaveAttribute("data-target-id", id!);
  202 |     await expect(target).not.toContainText("Python");
  203 |     expect(await readStore(page, "jobDescriptions")).toEqual(jobs);
  204 |     await page.goto("/jobs");
  205 |     await expect(page.locator(".jobs-workspace")).toBeVisible();
  206 |     await expect(page.locator(".selected-job-workspace")).toHaveCount(0);
  207 |     await page.locator(".job-card-body").first().click();
  208 |     await expect(page.locator(".selected-job-workspace")).toBeVisible();
  209 |     await expect(page).toHaveURL(/jobId=/);
  210 |   });
  211 | 
  212 |   test("CASE D — building from zero starts Profile Intake through a facade", async ({ page }) => {
  213 |     const trace = observeRuntimeAndBridge(page);
  214 |     await openWorkspace(page);
  215 |     await assertHermesReadyForCase(page);
  216 |     await send(page, "我没有简历，从零开始帮我做一份。");
  217 |     await expectAssistant(page, "已进入 Profile Intake，并停在下一步资料补充边界。");
  218 |     await expectToolNames(trace, ["career.workflow.profile_intake_turn"]);
  219 |     expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
  220 |   });
  221 | 
  222 |   test("CASE E — general Resume review uses compose update_existing", async ({ page }) => {
  223 |     const trace = observeRuntimeAndBridge(page);
  224 |     await openWorkspace(page);
  225 |     await prepareCoreSourceResume(page);
  226 |     await page.goto("/ai-workspace");
  227 |     await startFreshConversation(page);
  228 |     await installCoreWritingProvider(page);
  229 |     await assertHermesReadyForCase(page);
  230 |     await send(page, "帮我看看这份简历有什么问题");
  231 |     await expectAssistant(page, "已完成通用简历检查，并停在用户确认边界。");
  232 |     await expectToolNames(trace, ["career.resume.list", "career.profile.get", "career.workflow.compose_resume"]);
  233 |     expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
  234 |     expect(trace.toolRequests.at(-1)?.input).toMatchObject({ mode: "general", generalResumeMode: "update_existing" });
  235 |   });
  236 | 
  237 |   test("CASE F — pasted JD tailoring uses the canonical workflow facade", async ({ page }) => {
  238 |     const trace = observeRuntimeAndBridge(page);
  239 |     await openWorkspace(page);
  240 |     await assertHermesReadyForCase(page);
  241 |     await send(page, "根据这个 JD 帮我生成岗位简历");
  242 |     await expectAssistant(page, "已读取当前示例岗位，并停在用户确认边界。");
  243 |     await expectToolNames(trace, ["career.workflow.tailor_resume"]);
  244 |     expect(trace.toolReceipts).toEqual([expect.objectContaining({ result: expect.objectContaining({
  245 |       error: expect.objectContaining({ code: "agent_confirmation_required" })
  246 |     }) })]);
  247 |     expect(trace.toolRequests[0]?.input).toMatchObject({ targetText: expect.any(String) });
  248 |     expect(trace.toolRequests.some((request) => request.name.startsWith("career.tailoring."))).toBe(false);
  249 |     expect(trace.resultActions).toContain("result");
  250 |   });
  251 | 
  252 |   test("CASE G — Job Fit stays a comparison workflow", async ({ page }) => {
  253 |     const trace = observeRuntimeAndBridge(page);
  254 |     await openWorkspace(page);
  255 |     await prepareCoreSourceResume(page);
```