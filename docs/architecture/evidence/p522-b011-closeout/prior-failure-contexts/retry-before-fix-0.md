# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p522-b011-closeout.spec.ts >> model failure leaves a recoverable task and preserves the answered question
- Location: tests\e2e\p522-b011-closeout.spec.ts:170:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.agent-tailoring-inline')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
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
    - button "B01.1 定制验收 任务状态：失败": B01.1 定制验收 失败
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
      - paragraph: 没有
      - button "编辑并重发"
      - button "历史版本"
      - button "复制消息"
      - group
    - article:
      - paragraph: 正在回复…
      - button "重新执行当前步骤"
      - button "重新生成" [disabled]
      - button "基于此继续" [disabled]
      - button "复制消息" [disabled]
    - button "重新生成最近回答"
  - text: 描述你的求职任务
  - textbox "描述你的求职任务":
    - /placeholder: 补充你的实际经历，或回复“跳过”…
  - button "上传文件"
  - button "Choose File"
  - button "选择简历"
  - button "导入岗位"
  - button "从资料库"
  - button "工具"
  - text: 等待回答
  - button "排队发送消息" [disabled]
  - button "停止运行"
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
      - tab "匹配概览" [selected]
      - tab "问答记录 · 0/1"
      - tab "修改预览"
- region "操作通知"
```

# Test source

```ts
  89  |   await setup(page);
  90  |   const fixture = await seedQuestion(page);
  91  |   const profileBefore = await readStore(page, "profiles");
  92  |   const sourceBefore = (await readStore(page, "resumeBranches")).find(row => row.id === fixture.sourceId);
  93  |   const requests = await installWriter(page);
  94  |   await page.route("**/api/agent/stream", route => route.abort());
  95  |   await page.route("**/api/agent/runtime/hermes", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "unexpected_runtime_call", message: "Golden Journey must use its existing deterministic transition" } }) }));
  96  |   await page.goto("/ai-workspace");
  97  |   await page.getByRole("button", { name: /B01.1 定制验收 任务状态/ }).click();
  98  |   await expect(page.getByText("B01.1 定制验收", { exact: true }).first()).toBeVisible();
  99  |   await expect(page.getByLabel("描述你的求职任务")).toBeVisible();
  100 |   await page.getByLabel("描述你的求职任务").fill("没有使用过 Kubernetes，不加入这项技能。");
  101 |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
  102 |   await expect(page.locator(".agent-tailoring-inline")).toBeVisible({ timeout: 25_000 });
  103 |   const generated = await active(page, fixture.sessionId);
  104 |   writeFileSync(info.outputPath("after-answer.json"), JSON.stringify(generated.taskState));
  105 |   await info.attach("after-answer", { body: JSON.stringify(generated.taskState), contentType: "application/json" });
  106 |   const task = generated.taskState as { knownSlots: { tailoringSession: { plan: { clarificationAnswers: Array<{ questionId: string }>; diffs: Array<{ value: string | string[]; target: { itemId: string; fieldPath: string } }> } } } };
  107 |   expect(task.knownSlots.tailoringSession.plan.clarificationAnswers.some(answer => answer.questionId === fixture.questionId)).toBe(true);
  108 |   expect(task.knownSlots.tailoringSession.plan.diffs.length).toBeGreaterThanOrEqual(2);
  109 |   const acceptedDiff = task.knownSlots.tailoringSession.plan.diffs[0];
  110 |   const rejectedDiff = task.knownSlots.tailoringSession.plan.diffs[1];
  111 |   await page.reload();
  112 |   const preview = page.locator(".agent-tailoring-inline");
  113 |   await expect(preview).toBeVisible();
  114 |   await preview.getByRole("button", { name: "采用", exact: true }).click();
  115 |   await preview.getByRole("button", { name: "忽略", exact: true }).click();
  116 |   for (let i = 0; i < 8 && await preview.getByRole("button", { name: "忽略", exact: true }).isVisible(); i++) await preview.getByRole("button", { name: "忽略", exact: true }).click();
  117 |   await preview.getByRole("button", { name: /提交/ }).click();
  118 |   await expect(page.getByRole("button", { name: "生成岗位简历", exact: true })).toBeVisible();
  119 |   expect((await readStore(page, "resumeBranches")).some(row => row.jobId === fixture.jobId)).toBe(false);
  120 |   await page.reload();
  121 |   await page.getByRole("button", { name: "生成岗位简历", exact: true }).click();
  122 |   await expect.poll(async () => (await active(page, fixture.sessionId)).taskState).toMatchObject({ completionStatus: "completed" });
  123 |   const completed = await active(page, fixture.sessionId);
  124 |   writeFileSync(info.outputPath("completed-task.json"), JSON.stringify(completed.taskState));
  125 |   await info.attach("completed-task", { body: JSON.stringify(completed.taskState), contentType: "application/json" });
  126 |   const branches = await readStore(page, "resumeBranches");
  127 |   const target = branches.find(row => row.jobId === fixture.jobId && row.branchPurpose === "job_specific")!;
  128 |   expect(target).toBeTruthy();
  129 |   expect(branches.find(row => row.id === fixture.sourceId)).toEqual(sourceBefore);
  130 |   expect(await readStore(page, "profiles")).toEqual(profileBefore);
  131 |   await page.goto(`/resume?branchId=${target.id}`);
  132 |   await page.reload();
  133 |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  134 |   await openManualPageTab(page);
  135 |   const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  136 |   const responsePromise = page.waitForResponse(response => response.url().includes("/api/resume-export/pdf") && response.request().method() === "POST");
  137 |   await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  138 |   const [download, response] = await Promise.all([downloadPromise, responsePromise]);
  139 |   expect(response.status()).toBe(200);
  140 |   const pdf = info.outputPath("tailored.pdf"); await download.saveAs(pdf);
  141 |   const binary = ["E:/Pycharm/Lib/poppler/Library/bin/pdftotext.exe", "C:/Users/mqcin/AppData/Local/Programs/MiKTeX/miktex/bin/x64/pdftotext.exe"].find(existsSync) ?? "pdftotext";
  142 |   const text = execFileSync(binary, [pdf, "-"], { encoding: "utf8" });
  143 |   const normalize = (value: string) => value.replace(/\s+/gu, "");
  144 |   for (const value of [acceptedDiff.value].flat()) expect(normalize(text)).toContain(normalize(value));
  145 |   for (const value of [rejectedDiff.value].flat()) expect(normalize(text)).not.toContain(normalize(value));
  146 |   expect(text).not.toContain("Kubernetes");
  147 |   const exports = await readStore(page, "exportRecords");
  148 |   expect(exports.some(row => row.branchId === target.id && row.revisionId === target.currentRevisionId && row.exportStatus === "direct_pdf_success")).toBe(true);
  149 |   writeFileSync(info.outputPath("pdf-text.txt"), text);
  150 |   writeFileSync(info.outputPath("model-ledger.json"), JSON.stringify(requests));
  151 |   writeFileSync(info.outputPath("export-records.json"), JSON.stringify(exports));
  152 |   await info.attach("pdf-text", { body: text, contentType: "text/plain" });
  153 |   await info.attach("model-ledger", { body: JSON.stringify(requests), contentType: "application/json" });
  154 | });
  155 | 
  156 | test("bounded state probe after the last answer", async ({ page }, info) => {
  157 |   await setup(page); const fixture = await seedQuestion(page); const ledger = await installWriter(page);
  158 |   await page.route("**/api/agent/stream", route => route.abort());
  159 |   await page.goto("/ai-workspace");
  160 |   await page.getByRole("button", { name: /B01.1 定制验收 任务状态/ }).click();
  161 |   await page.getByLabel("描述你的求职任务").fill("没有");
  162 |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
  163 |   await page.waitForTimeout(1000);
  164 |   const state = await active(page, fixture.sessionId);
  165 |   writeFileSync(info.outputPath("probe-state.json"), JSON.stringify({ state, ledger }));
  166 |   await info.attach("probe-state", { body: JSON.stringify({ state, ledger }), contentType: "application/json" });
  167 |   console.log(JSON.stringify({ stage: (state.taskState as Record<string, unknown>).stage, ledger }));
  168 | });
  169 | 
  170 | test("model failure leaves a recoverable task and preserves the answered question", async ({ page }, info) => {
  171 |   await setup(page); const fixture = await seedQuestion(page); const ledger = await installWriter(page, true);
  172 |   await page.route("**/api/agent/stream", route => route.abort());
  173 |   await page.goto("/ai-workspace");
  174 |   await page.getByRole("button", { name: /B01.1 定制验收 任务状态/ }).click();
  175 |   await page.getByLabel("描述你的求职任务").fill("没有");
  176 |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
  177 |   await expect(page.getByText(/AI 简历撰写服务响应超时/).first()).toBeVisible();
  178 |   const failed = await active(page, fixture.sessionId);
  179 |   writeFileSync(info.outputPath("model-failure.json"), JSON.stringify({ taskState: failed.taskState, ledger }));
  180 |   expect(ledger).toHaveLength(1);
  181 |   expect((failed.taskState as { knownSlots: { tailoringSession: { plan: { clarificationAnswers: unknown[] } } } }).knownSlots.tailoringSession.plan.clarificationAnswers).toHaveLength(1);
  182 |   expect((await readStore(page, "resumeBranches")).some(row => row.jobId === fixture.jobId)).toBe(false);
  183 |   await page.reload();
  184 |   const retry = page.getByRole("button", { name: "重新执行当前步骤", exact: true });
  185 |   await expect(retry).toBeVisible();
  186 |   writeFileSync(info.outputPath("after-reload-failure.json"), JSON.stringify(await active(page, fixture.sessionId)));
  187 |   await installWriter(page);
  188 |   await retry.click();
> 189 |   try { await expect(page.locator(".agent-tailoring-inline")).toBeVisible(); } finally { writeFileSync(info.outputPath("after-retry.json"), JSON.stringify(await active(page, fixture.sessionId))); }
      |                                                               ^ Error: expect(locator).toBeVisible() failed
  190 |   const recovered = await active(page, fixture.sessionId);
  191 |   expect((recovered.taskState as { knownSlots: { tailoringSession: { plan: { clarificationAnswers: unknown[] } } } }).knownSlots.tailoringSession.plan.clarificationAnswers).toHaveLength(1);
  192 | });
  193 | 
```