# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hermes-p46h-integration.spec.ts >> P4.6h hermetic Web + browser MCP integration >> CASE A UX011-PROFILE — narrative candidates are editable, partially accepted and explicitly committed
- Location: tests\e2e\hermes-p46h-integration.spec.ts:138:7

# Error details

```
TypeError: Cannot read properties of undefined (reading 'knownSlots')
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
          - generic [ref=e134]: 固定：UX011 匿名人物 · V1
          - button "UX011 匿名人物 · V1 0 条经历 · 1 项基础信息 · 创建于 2026/11/05" [ref=e136] [cursor=pointer]:
            - generic [ref=e137]:
              - strong [ref=e138]: UX011 匿名人物 · V1
              - generic [ref=e139]: 0 条经历 · 1 项基础信息 · 创建于 2026/11/05
            - img [ref=e140]
        - generic [ref=e142]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e144] [cursor=pointer]:
            - generic [ref=e145]: AI · 服务
            - generic [ref=e146]: Ready
            - generic [ref=e147]: 控制
          - status [ref=e148]: 等待你回答
          - button "打开历史记录" [ref=e149] [cursor=pointer]:
            - img [ref=e150]
          - button "更多任务操作" [ref=e155] [cursor=pointer]:
            - img [ref=e156]
      - generic [ref=e161]:
        - generic [ref=e162]:
          - generic [ref=e163]: 已自动保存到本地
          - button "暂停任务" [ref=e164] [cursor=pointer]:
            - img [ref=e165]
            - text: 暂停任务
        - region "AI 对话" [ref=e168]:
          - generic [ref=e169]:
            - article [ref=e170]:
              - generic [ref=e171]:
                - generic [ref=e172]:
                  - paragraph [ref=e176]: 帮我整理资料库 UX011-PROFILE：就读匿名大学计算机专业。参与匿名课程项目，使用 Python 清洗数据并提交报告。获得匿名竞赛三等奖。
                  - generic "用户消息操作" [ref=e177]:
                    - button "编辑并重发" [ref=e178] [cursor=pointer]:
                      - img [ref=e179]
                    - button "历史版本" [ref=e181] [cursor=pointer]:
                      - img [ref=e182]
                    - button "复制消息" [ref=e186] [cursor=pointer]:
                      - img [ref=e187]
                    - group [ref=e190]:
                      - generic "更多消息操作" [ref=e191] [cursor=pointer]:
                        - img [ref=e192]
                - generic "你" [ref=e196]:
                  - img [ref=e197]
            - article [ref=e200]:
              - group [ref=e201]:
                - status "已完成 1 个任务步骤" [ref=e202] [cursor=pointer]:
                  - generic [ref=e203]:
                    - img [ref=e204]
                    - img [ref=e206]
                    - img [ref=e208]
                  - strong [ref=e211]: 已完成 1 个任务步骤
              - generic [ref=e212]:
                - generic "AI 助手" [ref=e213]:
                  - img [ref=e214]
                - generic [ref=e217]:
                  - paragraph [ref=e221]: 已进入 Profile Intake，并停在下一步资料补充边界。
                  - generic "可选回答" [ref=e222]:
                    - button "换一个方向" [ref=e223] [cursor=pointer]
                    - button "完成整理" [ref=e224] [cursor=pointer]
                    - button "重新执行当前步骤" [ref=e225] [cursor=pointer]
                  - generic "AI 消息操作" [ref=e226]:
                    - button "重新生成" [ref=e227] [cursor=pointer]:
                      - img [ref=e228]
                    - button "基于此继续" [ref=e231] [cursor=pointer]:
                      - img [ref=e232]
                    - button "复制消息" [ref=e234] [cursor=pointer]:
                      - img [ref=e235]
                    - group [ref=e238]:
                      - generic "更多消息操作" [ref=e239] [cursor=pointer]:
                        - img [ref=e240]
            - region "经历候选核对" [ref=e244]:
              - generic [ref=e245]:
                - button "经历候选 3 项 · 已核对 0/3 部分字段需要核对" [expanded] [ref=e246] [cursor=pointer]:
                  - generic [ref=e247]:
                    - strong [ref=e248]: 经历候选
                    - generic [ref=e249]: 3 项 · 已核对 0/3
                    - img [ref=e250]
                    - generic [ref=e252]: 部分字段需要核对
                - button "展开全部" [ref=e253] [cursor=pointer]
              - generic [ref=e255]:
                - article [ref=e256]:
                  - group [ref=e257]:
                    - generic "教育 匿名大学 / 计算机专业 AI 已整理 待核对" [ref=e258] [cursor=pointer]:
                      - generic [ref=e259]:
                        - generic [ref=e260]: 教育
                        - strong [ref=e261]: 匿名大学 / 计算机专业
                        - generic [ref=e262]: AI 已整理
                        - generic [ref=e263]: 待核对
                    - generic [ref=e264]:
                      - paragraph [ref=e265]: 就读匿名大学计算机专业。
                      - generic [ref=e266]:
                        - generic [ref=e267]:
                          - term [ref=e268]: 学校
                          - definition [ref=e269]: 匿名大学
                        - generic [ref=e270]:
                          - term [ref=e271]: 专业
                          - definition [ref=e272]: 计算机专业
                      - group [ref=e273]:
                        - generic "查看来源" [ref=e274] [cursor=pointer]
                      - generic "匿名大学 / 计算机专业操作" [ref=e275]:
                        - button "采用" [ref=e276] [cursor=pointer]
                        - button "编辑后采用" [ref=e277] [cursor=pointer]
                        - button "忽略" [ref=e278] [cursor=pointer]
                - article [ref=e279]:
                  - group [ref=e280]:
                    - generic "项目 匿名课程项目 AI 已整理 待核对" [ref=e281] [cursor=pointer]:
                      - generic [ref=e282]:
                        - generic [ref=e283]: 项目
                        - strong [ref=e284]: 匿名课程项目
                        - generic [ref=e285]: AI 已整理
                        - generic [ref=e286]: 待核对
                - article [ref=e287]:
                  - group [ref=e288]:
                    - generic "奖项 匿名竞赛三等奖 AI 已整理 待核对" [ref=e289] [cursor=pointer]:
                      - generic [ref=e290]:
                        - generic [ref=e291]: 奖项
                        - strong [ref=e292]: 匿名竞赛三等奖
                        - generic [ref=e293]: AI 已整理
                        - generic [ref=e294]: 待核对
            - generic "会话操作" [ref=e295]:
              - button "重新生成最近回答" [ref=e296] [cursor=pointer]:
                - img [ref=e297]
                - text: 重新生成最近回答
        - generic [ref=e300]:
          - generic [ref=e301]:
            - generic [ref=e302]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e303]:
              - /placeholder: 补充你的实际经历，或回复“跳过”…
          - generic [ref=e304]:
            - button "添加材料与工具" [ref=e306] [cursor=pointer]:
              - img [ref=e307]
            - button "上传文件" [ref=e308]
            - button "完成整理" [ref=e310] [cursor=pointer]:
              - generic [ref=e311]: 完成整理
            - generic [ref=e312]:
              - generic [ref=e313]: 等待你回答
              - button "发送消息" [disabled] [ref=e314]:
                - img [ref=e315]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
```

# Test source

```ts
  77  |       writeScope: "Committed renderer IndexedDB add/put operations after initial fixture readiness, including explicit source import fixtures" };
  78  |     await testInfo.attach("case-gate-receipt", { body: JSON.stringify(caseReceipt), contentType: "application/json" });
  79  |     await appendFile(`.tmp/core02-case-gate-${process.env.HERMES_INTEGRATION_RUN_ID}.jsonl`, `${JSON.stringify(caseReceipt)}\n`);
  80  |     if (!/^CASE [IJKLMN]/u.test(testInfo.title)) return;
  81  |     if (/^CASE [LMN]/u.test(testInfo.title)) {
  82  |       await testInfo.attach("closeout-provider", { body: JSON.stringify(await readProviderEvidence(page), null, 2), contentType: "application/json" });
  83  |       await testInfo.attach("closeout-transport", { body: JSON.stringify(closeoutTraces.get(page), null, 2), contentType: "application/json" });
  84  |       for (const name of ["agentSessions", "profiles", "resumeBranches", "jobDescriptions", "appMeta"]) {
  85  |         await testInfo.attach(`closeout-${name}`, { body: JSON.stringify(await readStore(page, name), null, 2), contentType: "application/json" });
  86  |       }
  87  |     }
  88  |     const sessions = await page.evaluate(() => new Promise((resolve, reject) => {
  89  |       const request = indexedDB.open("CareerAdaptDb");
  90  |       request.onerror = () => reject(request.error);
  91  |       request.onsuccess = () => {
  92  |         const database = request.result;
  93  |         const result = database.transaction("agentSessions", "readonly").objectStore("agentSessions").getAll();
  94  |         result.onerror = () => reject(result.error);
  95  |         result.onsuccess = () => {
  96  |           database.close();
  97  |           resolve(result.result.map(session => ({
  98  |             sessionId: session.id, activeTurn: session.activeTurn, hermesRun: session.hermesRun, activeConversationBranchId: session.activeConversationBranchId,
  99  |             pendingConfirmation: session.pendingConfirmation ? { operationId: session.pendingConfirmation.operationId, turnId: session.pendingConfirmation.turnId } : null,
  100 |             task: session.taskState ? { workflowId: session.taskState.workflowId, stage: session.taskState.stage, completionStatus: session.taskState.completionStatus, selectedEntities: session.taskState.selectedEntities } : null,
  101 |             messages: session.messages?.map((message: { id: string; role: string; turnId?: string; status?: string; conversationBranchId?: string }) => ({ id: message.id, role: message.role, turnId: message.turnId, status: message.status, conversationBranchId: message.conversationBranchId }))
  102 |           })));
  103 |         };
  104 |       };
  105 |     }));
  106 |     await testInfo.attach("host-confirmation-receipt", { body: JSON.stringify(sessions, null, 2), contentType: "application/json" });
  107 |   });
  108 |   test("CASE A — ordinary greeting completes through official Hermes Runs", async ({ page }) => {
  109 |     const trace = observeRuntimeAndBridge(page);
  110 |     await openWorkspace(page);
  111 |     await send(page, "你好");
  112 |     await expectAssistant(page, "你好，Hermes hermetic runtime 已就绪。");
  113 |     expect(trace.runtimeActions.filter((action) => action === "run_start")).toHaveLength(1);
  114 |     expect(trace.runtimeActions.filter((action) => action === "run_events")).toHaveLength(1);
  115 |     expect(trace.toolRequests).toHaveLength(0);
  116 |   });
  117 | 
  118 |   test("CASE B — general career advice stays tool-free", async ({ page }) => {
  119 |     const trace = observeRuntimeAndBridge(page);
  120 |     await openWorkspace(page);
  121 |     await send(page, "大学生找工作应该怎么准备？");
  122 |     await expectAssistant(page, "你好，Hermes hermetic runtime 已就绪。");
  123 |     expect(trace.toolRequests).toHaveLength(0);
  124 |   });
  125 | 
  126 |   test("CASE C — personal career questions use a read-only Career tool", async ({ page }) => {
  127 |     const trace = observeRuntimeAndBridge(page);
  128 |     await openWorkspace(page);
  129 |     await assertHermesReadyForCase(page);
  130 |     await send(page, "根据我的经历，你觉得我适合哪些岗位？");
  131 |     await expectAssistant(page, "当前示例资料包含 2 个项目经历。");
  132 |     await expectToolNames(trace, ["career.profile.get"]);
  133 |     expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
  134 |     expect(trace.resultActions).toContain("result");
  135 |     expect(trace.toolRequests.every((request) => request.name.startsWith("career.") && !request.name.includes("workflow"))).toBe(true);
  136 |   });
  137 | 
  138 |   test("CASE A UX011-PROFILE — narrative candidates are editable, partially accepted and explicitly committed", async ({ page }) => {
  139 |     const trace = observeRuntimeAndBridge(page);
  140 |     await openWorkspace(page);
  141 |     await page.goto("/profile");
  142 |     await page.locator('[data-profile-category="basics"]').click();
  143 |     await page.getByRole("button", { name: "新增", exact: true }).click();
  144 |     await page.locator("#new-profile-name").fill("UX011 匿名人物");
  145 |     await page.getByRole("button", { name: "创建人物", exact: true }).click();
  146 |     await expect.poll(async () => (await readStore(page, "profiles")).some(row => (row.basics as { name?: string })?.name === "UX011 匿名人物")).toBe(true);
  147 |     const profile = (await readStore(page, "profiles")).find(row => (row.basics as { name?: string })?.name === "UX011 匿名人物")!;
  148 |     await page.goto("/ai-workspace");
  149 |     await startFreshConversation(page);
  150 |     await page.route("**/api/ai/structured**", async route => {
  151 |       const body = route.request().postDataJSON();
  152 |       if (body.task !== "profile-intake-semantic") return route.continue();
  153 |       const raw = body.input.rawNarrative as string;
  154 |       const records = [
  155 |         { text: "就读匿名大学计算机专业。", item: { id: "ux-edu", sectionType: "education", school: "匿名大学", major: "计算机专业" } },
  156 |         { text: "参与匿名课程项目，使用 Python 清洗数据并提交报告。", item: { id: "ux-project", sectionType: "project", title: "匿名课程项目", role: "参与", description: "使用 Python 清洗数据并提交报告。", tools: ["Python"] } },
  157 |         { text: "获得匿名竞赛三等奖。", item: { id: "ux-award", sectionType: "awards", name: "匿名竞赛三等奖" } }
  158 |       ];
  159 |       await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: body.task, promptVersion: "ux011-synthetic", output: {
  160 |         candidates: records.map(record => ({ candidateKey: record.item.id, sectionType: record.item.sectionType,
  161 |           sourceSpan: { start: raw.indexOf(record.text), end: raw.indexOf(record.text) + record.text.length }, structuredItem: record.item,
  162 |           professionalText: record.text, uncertainFields: [] })), followUpQuestions: []
  163 |       }, meta: { provider: "scripted", model: "ux011" } }) });
  164 |     });
  165 |     const text = "帮我整理资料库 UX011-PROFILE：就读匿名大学计算机专业。参与匿名课程项目，使用 Python 清洗数据并提交报告。获得匿名竞赛三等奖。";
  166 |     await send(page, text);
  167 |     const review = page.getByRole("region", { name: "经历候选核对" });
  168 |     await expect(review).toBeVisible();
  169 |     await expect(review.locator(".profile-intake-candidate-card")).toHaveCount(3);
  170 |     await expectToolNames(trace, ["career.workflow.profile_intake_turn"]);
  171 |     const readSession = async () => {
  172 |       const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  173 |       return (await readStore(page, "agentSessions")).find(row => row.id === id)!;
  174 |     };
  175 |     const sourceSession = await readSession();
  176 |     const sourceTask = sourceSession.taskState as { knownSlots: { profileIntakeReviewProjection: { importId: string; sourceMessageId: string; sourceTurnId: string } } };
> 177 |     const source = sourceTask.knownSlots.profileIntakeReviewProjection;
      |                               ^ TypeError: Cannot read properties of undefined (reading 'knownSlots')
  178 |     const branchesBefore = await readStore(page, "resumeBranches");
  179 |     const revisionsBefore = await readStore(page, "resumeRevisions");
  180 |     await writeFile("docs/quality/ux-01.1-r-logs/ux-a-candidate-state.json", JSON.stringify({ profile, source, sourceSession, branchesBefore, revisionsBefore }, null, 2));
  181 |     await page.screenshot({ path: "docs/quality/ux-01.1-r-logs/profile-candidates.png", fullPage: true });
  182 |     expect((await readStore(page, "profiles")).find(row => row.id === profile.id)).toEqual(profile);
  183 |     const education = review.locator(".profile-intake-candidate-card").filter({ hasText: "匿名大学" });
  184 |     await education.getByRole("button", { name: "编辑后采用", exact: true }).click();
  185 |     await education.getByLabel("专业", { exact: true }).fill("计算机");
  186 |     await education.getByRole("button", { name: "保存并采用", exact: true }).click();
  187 |     await expect(review).toContainText("已记录教育经历");
  188 |     const award = review.locator(".profile-intake-candidate-card").filter({ hasText: "匿名竞赛" });
  189 |     if (await award.locator("details").first().getAttribute("open") === null) await award.locator("summary").first().click();
  190 |     await award.getByRole("button", { name: "忽略", exact: true }).click();
  191 |     const project = review.locator(".profile-intake-candidate-card").filter({ hasText: "匿名课程项目" });
  192 |     if (await project.locator("details").first().getAttribute("open") === null) await project.locator("summary").first().click();
  193 |     await project.getByRole("button", { name: "采用", exact: true }).click();
  194 |     await expect.poll(async () => JSON.stringify((await readSession()).taskState)).toContain('"ignored"');
  195 |     expect((await readStore(page, "profiles")).find(row => row.id === profile.id)).toEqual(profile);
  196 |     expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
  197 |     expect(await readStore(page, "resumeRevisions")).toEqual(revisionsBefore);
  198 |     await writeFile("docs/quality/ux-01.1-r-logs/ux-a-reviewed-state.json", JSON.stringify(await readSession(), null, 2));
  199 |     await page.locator("form.agent-composer").getByRole("button", { name: "完成整理", exact: true }).click();
  200 |     await expect.poll(async () => ((await readSession()).taskState as { stage: string }).stage).toBe("final_review");
  201 |     const artifact = page.getByRole("region", { name: "经历核对" });
  202 |     if (!await artifact.isVisible()) await page.getByRole("button", { name: /产物/ }).click();
  203 |     expect((await readStore(page, "profiles")).find(row => row.id === profile.id)).toEqual(profile);
  204 |     await artifact.getByRole("button", { name: "完成整理并保存到资料库", exact: true }).evaluate(button => { button.click(); button.click(); });
  205 |     await expect.poll(async () => (await readStore(page, "profiles")).find(row => row.id === profile.id)?.version).toBe(Number(profile.version) + 1);
  206 |     const saved = (await readStore(page, "profiles")).find(row => row.id === profile.id)!;
  207 |     expect(JSON.stringify(saved)).toContain("匿名课程项目");
  208 |     const canonical = canonicalProfileLibraryItems(CareerProfileSchema.parse(saved));
  209 |     expect(canonical.some(item => item.sectionType === "awards")).toBe(false);
  210 |     expect(JSON.stringify(canonical)).toContain("计算机");
  211 |     const draft = (await readUx011Drafts(page)).find(row => row.importId === source.importId)!;
  212 |     expect(JSON.stringify(draft)).toContain(source.sourceMessageId);
  213 |     expect(JSON.stringify(draft)).toContain(source.sourceTurnId);
  214 |     expect(JSON.stringify(draft)).toContain(text);
  215 |     expect(await readStore(page, "resumeBranches")).toEqual(branchesBefore);
  216 |     expect(await readStore(page, "resumeRevisions")).toEqual(revisionsBefore);
  217 |     await expect.poll(async () => ((await readSession()).taskState as { stage: string }).stage).toBe("profile_complete");
  218 |     await writeFile("docs/quality/ux-01.1-r-logs/ux-a-confirmed-state.json", JSON.stringify({ saved, draft, session: await readSession() }, null, 2));
  219 |     await page.reload();
  220 |     await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u);
  221 |     expect((await readStore(page, "profiles")).find(row => row.id === profile.id)).toEqual(saved);
  222 |     expect((await readUx011Drafts(page)).find(row => row.importId === source.importId)).toEqual(draft);
  223 |     expect(((await readSession()).taskState as { stage: string }).stage).toBe("profile_complete");
  224 |   });
  225 | 
  226 |   test("CASE B UX011-JD — temporary target persists across reload and explicit new target replaces it", async ({ page }) => {
  227 |     observeRuntimeAndBridge(page);
  228 |     await openWorkspace(page);
  229 |     const jobs = await readStore(page, "jobDescriptions");
  230 |     const readTarget = async () => {
  231 |       const id = await page.evaluate(() => localStorage.getItem("careeradapt.agent.activeSessionId"));
  232 |       const session = (await readStore(page, "agentSessions")).find(row => row.id === id)!;
  233 |       const task = session.taskState as { selectedEntities: { targetSnapshotId?: string }; knownSlots: { targetSnapshot?: unknown; fitAnalysis?: unknown } };
  234 |       return { task, snapshot: JobTargetSnapshotSchema.parse(task.knownSlots.targetSnapshot) };
  235 |     };
  236 |     const first = "公司：匿名甲公司 UX011-JD\n岗位：数据分析师\n任职要求\n必须掌握 Python 或 R。\n必须掌握 Python 和 SQL。\n加分项\n熟悉 Java。";
  237 |     await send(page, first);
  238 |     const target = page.getByRole("region", { name: "当前目标岗位" });
  239 |     await expect(target).toContainText("数据分析师");
  240 |     const id = await target.getAttribute("data-target-id");
  241 |     await target.getByText("核对岗位要求与来源", { exact: true }).click();
  242 |     await expect(target.locator("[data-target-requirement-id]")).toHaveCount(3);
  243 |     const original = await target.locator("[data-target-requirement-id]").allTextContents();
  244 |     const bound = await readTarget();
  245 |     expect(bound.snapshot.rawText).toBe(first);
  246 |     const graph = bound.snapshot.requirementGraph!;
  247 |     expect(graph.requirements).toHaveLength(3);
  248 |     expect(graph.requirements.map(row => row.id)).toEqual(bound.snapshot.normalizedRequirements.map(row => row.id));
  249 |     expect(graph.requirements.some(row => /公司：|岗位：/.test(row.statement))).toBe(false);
  250 |     expect(bound.snapshot.normalizedRequirements.filter(row => row.hardConstraint)).toHaveLength(2);
  251 |     expect(bound.snapshot.normalizedRequirements.filter(row => row.priority === "nice_to_have")).toHaveLength(1);
  252 |     await writeFile("docs/quality/ux-01.1-r-logs/ux-b-initial-state.json", JSON.stringify(bound, null, 2));
  253 |     await page.screenshot({ path: "docs/quality/ux-01.1-r-logs/jd-target.png", fullPage: true });
  254 |     await page.reload();
  255 |     await expect(target).toHaveAttribute("data-target-id", id!);
  256 |     expect(await target.locator("[data-target-requirement-id]").allTextContents()).toEqual(original);
  257 |     expect((await readTarget()).snapshot).toEqual(bound.snapshot);
  258 |     expect(await readStore(page, "jobDescriptions")).toEqual(jobs);
  259 |     await send(page, "公司：匿名乙公司 UX011-JD\n岗位：后端工程师\n任职要求\n必须掌握 Java，能够实现接口服务。熟悉 Spring 者优先。");
  260 |     await expect(target).toContainText("后端工程师");
  261 |     await expect(target).not.toHaveAttribute("data-target-id", id!);
  262 |     await expect(target).not.toContainText("Python");
  263 |     const switched = await readTarget();
  264 |     expect(switched.task.knownSlots.fitAnalysis).toBeUndefined();
  265 |     expect(switched.snapshot.id).not.toBe(bound.snapshot.id);
  266 |     expect(switched.snapshot.rawText).toContain("匿名乙公司");
  267 |     await writeFile("docs/quality/ux-01.1-r-logs/ux-b-switched-state.json", JSON.stringify(switched, null, 2));
  268 |     expect(await readStore(page, "jobDescriptions")).toEqual(jobs);
  269 |     await page.goto("/jobs");
  270 |     await expect(page.locator(".jobs-workspace")).toBeVisible();
  271 |     await expect(page.locator(".selected-job-workspace")).toHaveCount(0);
  272 |     await page.locator(".job-card-body").first().click();
  273 |     await expect(page.locator(".selected-job-workspace")).toBeVisible();
  274 |     await expect(page).toHaveURL(/jobId=/);
  275 |     const selected = new URL(page.url()).searchParams.get("jobId");
  276 |     await page.reload();
  277 |     await expect(page.locator(".selected-job-workspace")).toBeVisible();
```