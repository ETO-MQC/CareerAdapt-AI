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
          - button "新的对话 任务状态：等待核对" [ref=e69] [cursor=pointer]:
            - generic [ref=e71]: 新的对话
            - generic "任务状态：等待核对" [ref=e72]: 等待核对
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
          - button "H1Q合成人物 · V1 0 条经历 · 1 项基础信息 · 创建于 2026/11/12" [ref=e122] [cursor=pointer]:
            - generic [ref=e123]:
              - strong [ref=e124]: H1Q合成人物 · V1
              - generic [ref=e125]: 0 条经历 · 1 项基础信息 · 创建于 2026/11/12
            - img [ref=e126]
        - generic [ref=e128]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e130] [cursor=pointer]:
            - generic [ref=e131]: AI · 服务
            - generic [ref=e132]: Ready
            - generic [ref=e133]: 控制
          - status [ref=e134]: 等待确认
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
                - status "已完成 3 个任务步骤 用时约 22 秒" [ref=e187] [cursor=pointer]:
                  - generic [ref=e188]:
                    - img [ref=e189]
                    - img [ref=e191]
                    - img [ref=e193]
                    - img [ref=e196]
                    - img [ref=e198]
                  - strong [ref=e201]: 已完成 3 个任务步骤
                  - generic [ref=e202]: 用时约 22 秒
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
            - article [ref=e263]:
              - group "任务过程" [ref=e264]:
                - status "处理未完成，请核对后重试 用时约 12 秒" [ref=e265] [cursor=pointer]:
                  - generic [ref=e266]:
                    - img [ref=e267]
                    - img [ref=e269]
                    - img [ref=e271]
                    - img [ref=e274]
                    - img [ref=e276]
                  - strong [ref=e279]: 处理未完成，请核对后重试
                  - generic [ref=e280]: 用时约 12 秒
                  - img [ref=e281]
              - generic [ref=e283]:
                - generic "AI 助手" [ref=e284]:
                  - img [ref=e285]
                - generic [ref=e288]:
                  - paragraph [ref=e292]: 正在回复…
                  - status [ref=e294]:
                    - img [ref=e295]
                    - generic [ref=e298]: 您已确认
                  - generic "AI 消息操作" [ref=e299]:
                    - button "重新生成" [disabled] [ref=e300]:
                      - img [ref=e301]
                    - button "基于此继续" [disabled] [ref=e304]:
                      - img [ref=e305]
                    - button "复制消息" [disabled] [ref=e307]:
                      - img [ref=e308]
            - article [ref=e311]:
              - generic [ref=e312]:
                - generic "AI 助手" [ref=e313]:
                  - img [ref=e314]
                - generic [ref=e317]:
                  - paragraph [ref=e321]: 已按你的确认完成当前 Career 工作流。结果已保存，可继续查看预览或下一步。
                  - generic "AI 消息操作" [ref=e322]:
                    - button "重新生成" [ref=e323] [cursor=pointer]:
                      - img [ref=e324]
                    - button "基于此继续" [ref=e327] [cursor=pointer]:
                      - img [ref=e328]
                    - button "复制消息" [ref=e330] [cursor=pointer]:
                      - img [ref=e331]
                    - group [ref=e334]:
                      - generic "更多消息操作" [ref=e335] [cursor=pointer]:
                        - img [ref=e336]
            - article [ref=e340]:
              - generic [ref=e341]:
                - generic [ref=e342]:
                  - paragraph [ref=e346]: 基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配。
                  - generic "用户消息操作" [ref=e347]:
                    - button "编辑并重发" [ref=e348] [cursor=pointer]:
                      - img [ref=e349]
                    - button "历史版本" [ref=e351] [cursor=pointer]:
                      - img [ref=e352]
                    - button "复制消息" [ref=e356] [cursor=pointer]:
                      - img [ref=e357]
                    - group [ref=e360]:
                      - generic "更多消息操作" [ref=e361] [cursor=pointer]:
                        - img [ref=e362]
                - generic "你" [ref=e366]:
                  - img [ref=e367]
            - article [ref=e370]:
              - group "任务过程" [ref=e371]:
                - status "等待你确认：创建通用简历 用时 17 秒" [ref=e372] [cursor=pointer]:
                  - generic [ref=e373]:
                    - img [ref=e374]
                    - img [ref=e376]
                    - img [ref=e378]
                    - img [ref=e381]
                    - img [ref=e383]
                  - strong [ref=e386]: 等待你确认：创建通用简历
                  - generic [ref=e387]: 用时 17 秒
                  - img [ref=e388]
              - generic [ref=e390]:
                - generic "AI 助手" [ref=e391]:
                  - img [ref=e392]
                - generic [ref=e395]:
                  - paragraph [ref=e399]: 当前任务尚未形成可确认的完成凭证（当前步骤：confirm_create）。已保留任务进度，请从当前步骤继续。
                  - region "确认当前变更" [ref=e400]:
                    - generic [ref=e401]:
                      - heading "确认当前变更" [level=3] [ref=e402]
                      - paragraph [ref=e403]: 这项 Career 操作需要用户确认后才能继续。
                    - generic [ref=e404]:
                      - button "取消" [ref=e405] [cursor=pointer]
                      - button "确认" [ref=e406] [cursor=pointer]
                  - generic "可选回答" [ref=e407]:
                    - button "直接生成" [ref=e408] [cursor=pointer]
                    - button "调整方向" [ref=e409] [cursor=pointer]
                    - button "继续补充资料" [ref=e410] [cursor=pointer]
                    - button "重新执行当前步骤" [ref=e411] [cursor=pointer]
                  - generic "AI 消息操作" [ref=e412]:
                    - button "重新生成" [ref=e413] [cursor=pointer]:
                      - img [ref=e414]
                    - button "基于此继续" [ref=e417] [cursor=pointer]:
                      - img [ref=e418]
                    - button "复制消息" [ref=e420] [cursor=pointer]:
                      - img [ref=e421]
                    - group [ref=e424]:
                      - generic "更多消息操作" [ref=e425] [cursor=pointer]:
                        - img [ref=e426]
            - generic "会话操作" [ref=e430]:
              - button "重新生成最近回答" [ref=e431] [cursor=pointer]:
                - img [ref=e432]
                - text: 重新生成最近回答
        - generic [ref=e435]:
          - generic [ref=e436]:
            - generic [ref=e437]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e438]:
              - /placeholder: 输入“确认”或“取消”…
          - generic [ref=e439]:
            - button "添加材料与工具" [ref=e441] [cursor=pointer]:
              - img [ref=e442]
            - button "上传文件" [ref=e443]
            - generic [ref=e444]:
              - generic [ref=e445]: 等待确认
              - button "发送消息" [disabled] [ref=e446]:
                - img [ref=e447]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
```

# Test source

```ts
  40  |     // Only non-secret Provider settings. No business data or TaskState in localStorage.
  41  |     await page.addInitScript(({ baseUrl }) => {
  42  |       if (!localStorage.getItem("careeradapt-ai-settings")) localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test",
  43  |         provider: "openai-compatible", apiKeyConfigured: true }));
  44  |     }, { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  45  |     await page.addInitScript(() => {
  46  |       const observations: Array<{ state: string; sendEnabled: boolean }> = [];
  47  |       Object.assign(window, { h2qRecoveryObservations: observations });
  48  |       new MutationObserver(() => {
  49  |         const state = document.querySelector('[data-testid="agent-recovery-state"]')?.getAttribute("data-state");
  50  |         if (!state) return;
  51  |         const send = document.querySelector<HTMLButtonElement>('button[aria-label="发送消息"]');
  52  |         observations.push({ state, sendEnabled: Boolean(send && !send.disabled) });
  53  |       }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "disabled"] });
  54  |     });
  55  |     await page.goto("/h1q-fixture");
  56  |     await page.getByRole("button", { name: "Seed confirmed Profile", exact: true }).click();
  57  |     await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
  58  |     const profileId = (await page.getByTestId("seed-result").textContent())!;
  59  |     const before = await snapshot("repository-seed");
  60  |     const profile = CareerProfileSchema.parse(before.profiles.find(row => row.id === profileId));
  61  |     expect(profile.experiences.filter(row => row.type === "education")).toHaveLength(1);
  62  |     expect(profile.experiences.find(row => row.type === "project")!.facts.length).toBeGreaterThanOrEqual(2);
  63  |     expect(profile.experiences.find(row => row.type === "internship")!.facts.length).toBeGreaterThanOrEqual(1);
  64  |     expect(profile.experiences.every(row => row.facts.every(fact => fact.confirmedByUser))).toBe(true);
  65  |     expect(profile.skills.map(skill => skill.name)).toEqual(["SQL", "Python"]);
  66  |     expect(before.branches).toHaveLength(0);
  67  |     expect(before.revisions).toHaveLength(0);
  68  |     const baselineJobs = before.jobs.length;
  69  |     await installCoreWritingProvider(page);
  70  |     await page.goto("/ai-workspace");
  71  |     // One explicit READY preflight. Real Supervisor/API/MCP/Facade projections.
  72  |     await expect.poll(async () => {
  73  |       const body = await (await page.request.get("/api/agent/runtime/hermes/control")).json();
  74  |       const state = body.snapshot;
  75  |       return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady
  76  |         && state?.toolSurfaceReady && state?.requiredCareerFacadesReady === state?.requiredCareerFacadesTotal;
  77  |     }, { timeout: 90_000 }).toBe(true);
  78  |     await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u);
  79  |     const sessionIds = new Set((await sessions()).map(session => session.id));
  80  |     await page.getByRole("button", { name: "新任务", exact: true }).click();
  81  |     await expect.poll(async () => (await sessions()).filter(session => !sessionIds.has(session.id)).length).toBe(1);
  82  |     sessionId = (await sessions()).find(session => !sessionIds.has(session.id))!.id;
  83  |     const send = async (text: string) => {
  84  |       await page.getByLabel("描述你的求职任务").fill(text);
  85  |       await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 30_000 });
  86  |       await page.getByRole("button", { name: "发送消息", exact: true }).click();
  87  |     };
  88  |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", /^(ready|new_session_ready)$/u);
  89  |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  90  |     await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
  91  |     await snapshot("new-session-persisted");
  92  |     await send(`请先分析这个岗位。\n${JD}`);
  93  |     await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  94  |     const analyzed = await snapshot("analyze-only");
  95  |     expect(analyzed.jobs).toHaveLength(baselineJobs);
  96  |     expect(analyzed.session?.taskState?.workflowId).toBe("job_ingestion");
  97  |     expect(analyzed.session?.taskState?.knownSlots.rawText).toBe(JD);
  98  |     expect(record(analyzed.session?.taskState?.knownSlots.facadeCheckpoint).targetSnapshot).toBeTruthy();
  99  |     const graph = record(analyzed.session?.taskState?.knownSlots.graph);
  100 |     const requirements = (graph.requirements as Array<Record<string, unknown>>);
  101 |     expect(requirements.some(row => String(row.statement).includes("SQL") && row.hardConstraint === true)).toBe(true);
  102 |     expect(requirements.some(row => record(row.keywordLogic).relation === "any_of")).toBe(true);
  103 |     // Force recovery from durable state; the next user message contains no JD.
  104 |     await page.reload();
  105 |     // A visible Composer alone does not prove asynchronous Session hydration.
  106 |     // Wait for the previous user message to be restored before interacting.
  107 |     await expect(page.getByText(`请先分析这个岗位。\n${JD}`, { exact: true })).toBeVisible();
  108 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready");
  109 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  110 |     expect((await current()).taskState).toEqual(analyzed.session?.taskState);
  111 |     expect((await current()).activeBranchId).toBe(analyzed.session?.activeBranchId);
  112 |     const recoveryObservations = await page.evaluate(() => (window as unknown as {
  113 |       h2qRecoveryObservations: Array<{ state: string; sendEnabled: boolean }>
  114 |     }).h2qRecoveryObservations);
  115 |     expect(recoveryObservations.some(row => row.state === "restoring")).toBe(true);
  116 |     expect(recoveryObservations.filter(row => row.state === "restoring").every(row => !row.sendEnabled)).toBe(true);
  117 |     timeline.push({ step: "recovery-send-gate", recoveryObservations });
  118 |     await send("保存刚才这个岗位。");
  119 |     // A save request may require its persisted Host confirmation. Exercise the
  120 |     // real authorization boundary rather than waiting for an unapproved write.
  121 |     await expect(page.getByRole("region", { name: "确认保存岗位信息" })).toBeVisible({ timeout: 30_000 });
  122 |     expect(await readStore(page, "jobDescriptions")).toHaveLength(baselineJobs);
  123 |     await snapshot("job-awaiting-confirmation");
  124 |     await page.getByRole("region", { name: "确认保存岗位信息" }).getByRole("button", { name: "确认", exact: true }).click();
  125 |     await expect.poll(async () => (await readStore(page, "jobDescriptions")).length, { timeout: 60_000 }).toBe(baselineJobs + 1);
  126 |     await expect.poll(async () => (await current())?.taskState?.knownSlots.jobPersistenceVerified, { timeout: 30_000 }).toBe(true);
  127 |     const saved = await snapshot("job-saved");
  128 |     const job = saved.jobs.find(row => !before.jobs.some(old => old.id === row.id))!;
  129 |     expect(job).toMatchObject({ rawText: JD, company: null });
  130 |     const jobId = job.id;
  131 |     expect(saved.session?.taskState).toMatchObject({ workflowId: "job_ingestion", completionStatus: "completed", selectedEntities: { profileId, jobId } });
  132 |     await send("基于已确认的 Profile 创建一份通用简历，然后再做岗位匹配。");
  133 |     await expect(page.getByRole("button", { name: "直接生成", exact: true }).last()).toBeVisible({ timeout: 60_000 });
  134 |     const proposed = await snapshot("composition-proposed");
  135 |     expect(proposed.session?.taskState).toMatchObject({ workflowId: "compose_resume", selectedEntities: { profileId, jobId } });
  136 |     expect(proposed.session?.taskState?.knownSlots.nextAction).toMatchObject({ kind: "job_fit", profileId, jobId });
  137 |     expect(proposed.branches).toHaveLength(0);
  138 |     const checkpoint = record(proposed.session?.taskState?.knownSlots.resumeCompositionCheckpoint);
  139 |     const composition = ResumeCompositionResultSchema.parse(checkpoint.compositionResult);
> 140 |     expect(composition.items.some(item => item.data.sectionType === "project")).toBe(true);
      |                                                                                 ^ Error: expect(received).toBe(expected) // Object.is equality
  141 |     expect(composition.items.some(item => item.data.sectionType === "internship")).toBe(true);
  142 |     expect(composition.proposal.bulletCount).toBeGreaterThan(0);
  143 |     expect(composition.evidenceGraph.sourceAssetIds.length).toBeGreaterThan(0);
  144 |     expect(composition.jobId).toBeUndefined();
  145 |     const compose = bridgeResults.map(row => record(row.result)).find(result => record(record(result.diagnostics).mcpCallTrace).toolName === "career.workflow.compose_resume");
  146 |     expect(compose, JSON.stringify(bridgeResults)).toBeTruthy();
  147 |     expect(compose!.ok).toBe(true);
  148 |     expect(record(record(compose!.diagnostics).mcpCallTrace).gatewayReached).toBe(true);
  149 |     expect(record(compose!.diagnostics).schemaIssues ?? []).toEqual([]);
  150 |     expect(requests.find(request => request.name === "career.workflow.compose_resume")?.input).toEqual({ mode: "general" });
  151 |     await page.reload();
  152 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready");
  153 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  154 |     expect((await current()).taskState?.knownSlots.nextAction).toEqual(proposed.session?.taskState?.knownSlots.nextAction);
  155 |     expect((await current()).taskState?.knownSlots.resumeCompositionCheckpoint).toEqual(checkpoint);
  156 |     expect((await current()).pendingConfirmation).toEqual(proposed.session?.pendingConfirmation);
  157 |     expect((await current()).activeBranchId).toBe(proposed.session?.activeBranchId);
  158 |     await snapshot("composition-confirmation-restored");
  159 |     await page.getByRole("button", { name: "直接生成", exact: true }).last().click();
  160 |     await expect.poll(async () => ({ workflowId: (await current())?.taskState?.workflowId,
  161 |       completionStatus: (await current())?.taskState?.completionStatus }), { timeout: 60_000 }).toEqual({ workflowId: "analyze_job_fit", completionStatus: "completed" });
  162 |     const completed = await snapshot("fit-completed");
  163 |     expect(completed.branches).toHaveLength(1);
  164 |     expect(completed.revisions).toHaveLength(1);
  165 |     const branch = completed.branches[0];
  166 |     expect(branch.branchPurpose).toBe("general");
  167 |     expect(branch.profileId).toBe(profileId);
  168 |     expect(branch.jobId).toBeUndefined();
  169 |     const revisionId = branch.currentRevisionId;
  170 |     expect(completed.revisions[0]).toMatchObject({ id: revisionId, branchId: branch.id });
  171 |     expect(completed.session?.taskState?.selectedEntities).toMatchObject({ profileId, jobId, resumeId: branch.id, revisionId });
  172 |     expect(completed.session?.taskState?.knownSlots.nextAction).toBeUndefined();
  173 |     const fitCheckpoint = record(completed.session?.taskState?.knownSlots.facadeCheckpoint);
  174 |     expect(fitCheckpoint).toMatchObject({ kind: "job_fit", profileId, jobId, resumeId: branch.id });
  175 |     const fit = record(completed.session?.taskState?.knownSlots.fitAnalysis);
  176 |     expect(fit.analysis).toBeTruthy();
  177 |     expect(fit.dependencies).toMatchObject({ profileId, jobId, resumeId: branch.id, resumeRevisionId: revisionId });
  178 |     expect(JSON.stringify(fit.analysis)).toMatch(/status/u);
  179 |     expect(JSON.stringify(fit.analysis)).toMatch(/evidence|unknown/iu);
  180 |     const fitArtifact = completed.session?.artifactRefs.find(artifact => artifact.kind === "job_fit_overview");
  181 |     expect(fitArtifact?.binding).toMatchObject({ sessionId, branchId: completed.session?.activeBranchId,
  182 |       workflowId: "analyze_job_fit", jobId, resumeBranchId: branch.id, revisionId });
  183 |     expect(completed.session?.pendingConfirmation).toBeUndefined();
  184 |     await page.reload();
  185 |     await expect(page.getByText("通用简历已创建，岗位匹配已完成，可以打开匹配结果。", { exact: true })).toBeVisible();
  186 |     const restored = await snapshot("refreshed");
  187 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-state", "ready");
  188 |     await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  189 |     expect(restored.session?.activeBranchId).toBe(completed.session?.activeBranchId);
  190 |     expect(restored.session?.taskState).toEqual(completed.session?.taskState);
  191 |     expect(restored.session?.artifactRefs).toContainEqual(fitArtifact);
  192 |     expect(restored.session?.pendingConfirmation).toBeUndefined();
  193 |     expect(restored.session?.taskState).toMatchObject({ workflowId: "analyze_job_fit", completionStatus: "completed",
  194 |       selectedEntities: { profileId, jobId, resumeId: branch.id, revisionId } });
  195 |     expect(restored.session?.taskState?.knownSlots.fitAnalysis).toEqual(fit);
  196 |     expect(restored.profiles).toEqual(before.profiles);
  197 |     expect(restored.jobs).toHaveLength(baselineJobs + 1);
  198 |     expect(restored.jobs.find(row => row.id === jobId)).toEqual(job);
  199 |     expect(restored.branches).toEqual(completed.branches);
  200 |     expect(restored.revisions).toEqual(completed.revisions);
  201 |     expect(JSON.stringify({ sessions: await sessions(), bridgeResults })).not.toMatch(/career_agent_duplicate_invalid_call|gateway_validation_failed|jobId invalid_type|mode invalid_value/u);
  202 |   } finally {
  203 |     await snapshot("final-observed-state");
  204 |     const evidence = { sessionId, timeline, bridgeResults, requests: requests.map(({ name, input, agentSessionId, operationId }) => ({ name, input, agentSessionId, operationId })) };
  205 |     await info.attach("h1q-business-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  206 |     if (process.env.H1Q_EVIDENCE_DIR) writeFileSync(path.join(process.env.H1Q_EVIDENCE_DIR, "business-evidence.json"), JSON.stringify(evidence, null, 2));
  207 |   }
  208 | });
  209 | 
```