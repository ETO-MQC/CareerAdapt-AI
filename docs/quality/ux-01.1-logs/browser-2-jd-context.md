# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hermes-p46h-integration.spec.ts >> P4.6h hermetic Web + browser MCP integration >> CASE B UX011-JD — temporary target persists across reload and explicit new target replaces it
- Location: tests\e2e\hermes-p46h-integration.spec.ts:183:7

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('region', { name: '当前目标岗位' }).locator('[data-target-requirement-id]')
Expected: 3
Received: 5
Timeout:  30000ms

Call log:
  - Expect "toHaveCount" with timeout 30000ms
  - waiting for getByRole('region', { name: '当前目标岗位' }).locator('[data-target-requirement-id]')
    62 × locator resolved to 5 elements
       - unexpected value "5"

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
          - button "新的对话 任务状态：已完成" [ref=e69] [cursor=pointer]:
            - generic [ref=e71]: 新的对话
            - generic "任务状态：已完成" [ref=e72]: 已完成
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
          - generic [ref=e120]: 固定：人物已固定 · V1
          - button "同学 · V1 7 条经历 · 5 项基础信息 · 创建于 2026/07/01" [ref=e122] [cursor=pointer]:
            - generic [ref=e123]:
              - strong [ref=e124]: 同学 · V1
              - generic [ref=e125]: 7 条经历 · 5 项基础信息 · 创建于 2026/07/01
            - img [ref=e126]
        - generic [ref=e128]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e130] [cursor=pointer]:
            - generic [ref=e131]: AI · 服务
            - generic [ref=e132]: Ready
            - generic [ref=e133]: 控制
          - status [ref=e134]: 已完成
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
                  - paragraph [ref=e161]: 公司：匿名甲公司 UX011-JD 岗位：数据分析师 任职要求 必须掌握 Python 或 R。 必须掌握 Python 和 SQL。 加分项 熟悉 Java。
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
              - group [ref=e186]:
                - status "已完成 1 个任务步骤" [ref=e187] [cursor=pointer]:
                  - generic [ref=e188]:
                    - img [ref=e189]
                    - img [ref=e191]
                    - img [ref=e193]
                  - strong [ref=e196]: 已完成 1 个任务步骤
              - generic [ref=e197]:
                - generic "AI 助手" [ref=e198]:
                  - img [ref=e199]
                - generic [ref=e202]:
                  - paragraph [ref=e206]: 岗位解析已完成，请核对后保存。
                  - generic "AI 消息操作" [ref=e207]:
                    - button "重新生成" [ref=e208] [cursor=pointer]:
                      - img [ref=e209]
                    - button "基于此继续" [ref=e212] [cursor=pointer]:
                      - img [ref=e213]
                    - button "复制消息" [ref=e215] [cursor=pointer]:
                      - img [ref=e216]
                    - group [ref=e219]:
                      - generic "更多消息操作" [ref=e220] [cursor=pointer]:
                        - img [ref=e221]
            - region "当前目标岗位" [ref=e225]:
              - strong [ref=e226]: 匿名甲公司 UX011-JD · 数据分析师
              - paragraph [ref=e227]: 本次提供的岗位描述 · 5 条要求
              - group [ref=e228]:
                - generic "核对岗位要求与来源" [active] [ref=e229]
                - paragraph [ref=e230]: 以下为解析结果，请对照原文核对；能力是否满足需另行匹配证据。
                - list [ref=e231]:
                  - listitem [ref=e232]:
                    - strong [ref=e233]: 岗位要求：
                    - text: 公司：匿名甲公司 UX011-JD
                  - listitem [ref=e234]:
                    - strong [ref=e235]: 岗位要求：
                    - text: 岗位：数据分析师
                  - listitem [ref=e236]:
                    - strong [ref=e237]: 必须条件：
                    - text: 必须掌握 Python 或 R。
                  - listitem [ref=e238]:
                    - strong [ref=e239]: 必须条件：
                    - text: 必须掌握 Python 和 SQL。
                  - listitem [ref=e240]:
                    - strong [ref=e241]: 优先条件：
                    - text: 熟悉 Java。
                - group [ref=e242]:
                  - generic "查看原始岗位描述" [ref=e243]
            - generic "会话操作" [ref=e244]:
              - button "重新生成最近回答" [ref=e245] [cursor=pointer]:
                - img [ref=e246]
                - text: 重新生成最近回答
          - button "回到最新消息" [ref=e249] [cursor=pointer]
        - generic [ref=e250]:
          - generic [ref=e251]:
            - generic [ref=e252]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e253]:
              - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
          - generic [ref=e254]:
            - button "添加材料与工具" [ref=e256] [cursor=pointer]:
              - img [ref=e257]
            - button "上传文件" [ref=e258]
            - generic [ref=e259]:
              - generic [ref=e260]: 已完成
              - button "发送消息" [disabled] [ref=e261]:
                - img [ref=e262]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
```

# Test source

```ts
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
  155 |     await expect(review).toBeVisible();
  156 |     await expect(review.locator(".profile-intake-candidate-card")).toHaveCount(3);
  157 |     await page.screenshot({ path: "docs/quality/ux-01.1-logs/profile-candidates.png", fullPage: true });
  158 |     expect((await readStore(page, "profiles")).find(row => row.id === profile.id)).toEqual(profile);
  159 |     const education = review.locator(".profile-intake-candidate-card").filter({ hasText: "匿名大学" });
  160 |     await education.getByRole("button", { name: "编辑后采用", exact: true }).click();
  161 |     await education.getByLabel("专业", { exact: true }).fill("计算机");
  162 |     await education.getByRole("button", { name: "保存并采用", exact: true }).click();
  163 |     await expect(review).toContainText("已记录教育经历");
  164 |     const award = review.locator(".profile-intake-candidate-card").filter({ hasText: "匿名竞赛" });
  165 |     if (await award.locator("details").first().getAttribute("open") === null) await award.locator("summary").first().click();
  166 |     await award.getByRole("button", { name: "忽略", exact: true }).click();
  167 |     const project = review.locator(".profile-intake-candidate-card").filter({ hasText: "匿名课程项目" });
  168 |     if (await project.locator("details").first().getAttribute("open") === null) await project.locator("summary").first().click();
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
  186 |     const first = "公司：匿名甲公司 UX011-JD\n岗位：数据分析师\n任职要求\n必须掌握 Python 或 R。\n必须掌握 Python 和 SQL。\n加分项\n熟悉 Java。";
  187 |     await send(page, first);
  188 |     const target = page.getByRole("region", { name: "当前目标岗位" });
  189 |     await expect(target).toContainText("数据分析师");
  190 |     const id = await target.getAttribute("data-target-id");
  191 |     await target.getByText("核对岗位要求与来源", { exact: true }).click();
> 192 |     await expect(target.locator("[data-target-requirement-id]")).toHaveCount(3);
      |                                                                  ^ Error: expect(locator).toHaveCount(expected) failed
  193 |     const original = await target.locator("[data-target-requirement-id]").allTextContents();
  194 |     await page.screenshot({ path: "docs/quality/ux-01.1-logs/jd-target.png", fullPage: true });
  195 |     await page.reload();
  196 |     await expect(target).toHaveAttribute("data-target-id", id!);
  197 |     expect(await target.locator("[data-target-requirement-id]").allTextContents()).toEqual(original);
  198 |     expect(await readStore(page, "jobDescriptions")).toEqual(jobs);
  199 |     await send(page, "公司：匿名乙公司 UX011-JD\n岗位：后端工程师\n任职要求\n必须掌握 Java，能够实现接口服务。熟悉 Spring 者优先。");
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
  256 |     await page.goto("/ai-workspace");
  257 |     await startFreshConversation(page);
  258 |     await assertHermesReadyForCase(page);
  259 |     await send(page, "分析一下我和这个岗位匹不匹配");
  260 |     await expectAssistant(page, "已完成岗位匹配比较，并保留证据缺口。");
  261 |     await expectToolNames(trace, ["career.resume.list", "career.workflow.job_fit"]);
  262 |     expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
  263 |   });
  264 | 
  265 |   test("CASE H — export uses the dedicated export facade", async ({ page }) => {
  266 |     const trace = observeRuntimeAndBridge(page);
  267 |     await openWorkspace(page);
  268 |     await prepareCoreSourceResume(page);
  269 |     await page.goto("/ai-workspace");
  270 |     await startFreshConversation(page);
  271 |     await assertHermesReadyForCase(page);
  272 |     await send(page, "导出这份简历");
  273 |     await expectAssistant(page, "已准备简历导出产物。");
  274 |     await expectToolNames(trace, ["career.resume.list", "career.workflow.resume_export"]);
  275 |     expect(trace.toolReceipts.every(value => (value as { result?: { ok?: boolean } }).result?.ok === true)).toBe(true);
  276 |   });
  277 | 
  278 |   test("CASE K — an attachment submitted while busy executes in the next Hermes Turn", async ({ page }) => {
  279 |     const trace = observeRuntimeAndBridge(page);
  280 |     await openWorkspace(page);
  281 |     await page.evaluate(() => {
  282 |       const settings = JSON.parse(localStorage.getItem("careeradapt-ai-settings") ?? "{}");
  283 |       localStorage.setItem("careeradapt.resumeImportAiPreference", JSON.stringify({ schemaVersion: "resume-import-ai-preference-v1", mode: "local", providerFingerprint: [settings.provider, settings.baseUrl, settings.model].join("|") }));
  284 |     });
  285 |     await send(page, "P512-QUEUE-FIRST");
  286 |     await expect(page.getByRole("button", { name: "排队发送消息", exact: true })).toBeVisible();
  287 |     await page.locator('.agent-composer input[type="file"]').setInputFiles({ name: "queued-certificate.txt", mimeType: "text/plain", buffer: Buffer.from("证书\n大学英语六级 2025-06") });
  288 |     await page.getByLabel("描述你的求职任务").fill("P512-MATERIAL，把这个证书整理到资料库");
  289 |     await page.getByRole("button", { name: "排队发送消息", exact: true }).click();
  290 |     await expectAssistant(page, "已识别为证书，已生成候选资料，请核对后确认保存。");
  291 |     expect(trace.runtimeActions.filter(action => action === "run_start")).toHaveLength(2);
  292 |     await expect.poll(() => trace.toolRequests.filter(request => request.name === "career.workflow.material_intake").length).toBe(2);
```