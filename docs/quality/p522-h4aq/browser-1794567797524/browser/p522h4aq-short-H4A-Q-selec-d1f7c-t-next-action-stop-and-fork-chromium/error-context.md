# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p522h4aq-short.spec.ts >> H4A-Q selected assets, fit, next action, stop and fork
- Location: tests\e2e\p522h4aq-short.spec.ts:5:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "analyze_job_fit"
Received: "entity_selection"

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
          - generic [ref=e120]: 固定：H1Q合成人物 · V1
          - button "H1Q合成人物 · V1 5 条经历 · 1 项基础信息 · 创建于 2026/11/13" [ref=e122] [cursor=pointer]:
            - generic [ref=e123]:
              - strong [ref=e124]: H1Q合成人物 · V1
              - generic [ref=e125]: 5 条经历 · 1 项基础信息 · 创建于 2026/11/13
            - img [ref=e126]
        - generic [ref=e128]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e130] [cursor=pointer]:
            - generic [ref=e131]: AI · 服务
            - generic [ref=e132]: Ready
            - generic [ref=e133]: 控制
          - status [ref=e134]: 正在处理
          - button "打开历史记录" [ref=e135] [cursor=pointer]:
            - img [ref=e136]
          - button "更多任务操作" [ref=e141] [cursor=pointer]:
            - img [ref=e142]
      - generic [ref=e147]:
        - button "暂停任务" [ref=e149] [cursor=pointer]:
          - img [ref=e150]
          - text: 暂停任务
        - status [ref=e153]:
          - generic [ref=e154]: 这一步响应时间较长
          - generic [ref=e155]:
            - button "继续等待" [ref=e156] [cursor=pointer]
            - button "停止任务" [ref=e157] [cursor=pointer]
        - region "AI 对话" [ref=e158]:
          - generic [ref=e159]:
            - article [ref=e160]:
              - generic [ref=e161]:
                - generic [ref=e162]:
                  - paragraph [ref=e166]: 我要投华为那个AI岗位
                  - generic "用户消息操作" [ref=e167]:
                    - button "编辑并重发" [ref=e168] [cursor=pointer]:
                      - img [ref=e169]
                    - button "历史版本" [ref=e171] [cursor=pointer]:
                      - img [ref=e172]
                    - button "复制消息" [ref=e176] [cursor=pointer]:
                      - img [ref=e177]
                    - group [ref=e180]:
                      - generic "更多消息操作" [ref=e181] [cursor=pointer]:
                        - img [ref=e182]
                - generic "你" [ref=e186]:
                  - img [ref=e187]
            - article [ref=e190]:
              - group "任务过程" [ref=e191]:
                - status "已完成 2 个任务步骤 用时约 13 秒" [ref=e192] [cursor=pointer]:
                  - generic [ref=e193]:
                    - img [ref=e194]
                    - img [ref=e196]
                    - img [ref=e198]
                    - img [ref=e201]
                    - img [ref=e203]
                  - strong [ref=e206]: 已完成 2 个任务步骤
                  - generic [ref=e207]: 用时约 13 秒
                  - img [ref=e208]
              - generic [ref=e210]:
                - generic "AI 助手" [ref=e211]:
                  - img [ref=e212]
                - generic [ref=e215]:
                  - paragraph [ref=e219]: 匹配已完成。
                  - generic "AI 消息操作" [ref=e220]:
                    - button "重新生成" [ref=e221] [cursor=pointer]:
                      - img [ref=e222]
                    - button "基于此继续" [ref=e225] [cursor=pointer]:
                      - img [ref=e226]
                    - button "复制消息" [ref=e228] [cursor=pointer]:
                      - img [ref=e229]
                    - group [ref=e232]:
                      - generic "更多消息操作" [ref=e233] [cursor=pointer]:
                        - img [ref=e234]
            - article [ref=e238]:
              - generic [ref=e239]:
                - generic [ref=e240]:
                  - paragraph [ref=e244]: AI大模型应用开发工程师
                  - generic "用户消息操作" [ref=e245]:
                    - button "编辑并重发" [ref=e246] [cursor=pointer]:
                      - img [ref=e247]
                    - button "历史版本" [ref=e249] [cursor=pointer]:
                      - img [ref=e250]
                    - button "复制消息" [ref=e254] [cursor=pointer]:
                      - img [ref=e255]
                    - group [ref=e258]:
                      - generic "更多消息操作" [ref=e259] [cursor=pointer]:
                        - img [ref=e260]
                - generic "你" [ref=e264]:
                  - img [ref=e265]
            - article [ref=e268]:
              - group "任务过程" [ref=e269]:
                - status "本轮回复已结束 用时 0 秒" [ref=e270] [cursor=pointer]:
                  - generic [ref=e271]:
                    - img [ref=e272]
                    - img [ref=e274]
                    - img [ref=e276]
                    - img [ref=e279]
                    - img [ref=e281]
                  - strong [ref=e284]: 本轮回复已结束
                  - generic [ref=e285]: 用时 0 秒
                  - img [ref=e286]
              - generic [ref=e288]:
                - generic "AI 助手" [ref=e289]:
                  - img [ref=e290]
                - generic [ref=e293]:
                  - paragraph [ref=e297]: 已选择岗位：AI大模型应用开发工程师 · 华为。
                  - generic "AI 消息操作" [ref=e298]:
                    - button "重新生成" [ref=e299] [cursor=pointer]:
                      - img [ref=e300]
                    - button "基于此继续" [ref=e303] [cursor=pointer]:
                      - img [ref=e304]
                    - button "复制消息" [ref=e306] [cursor=pointer]:
                      - img [ref=e307]
                    - group [ref=e310]:
                      - generic "更多消息操作" [ref=e311] [cursor=pointer]:
                        - img [ref=e312]
            - article [ref=e316]:
              - generic [ref=e317]:
                - generic [ref=e318]:
                  - paragraph [ref=e322]: 帮我分析匹配度
                  - generic "用户消息操作" [ref=e323]:
                    - button "编辑并重发" [ref=e324] [cursor=pointer]:
                      - img [ref=e325]
                    - button "历史版本" [ref=e327] [cursor=pointer]:
                      - img [ref=e328]
                    - button "复制消息" [ref=e332] [cursor=pointer]:
                      - img [ref=e333]
                    - group [ref=e336]:
                      - generic "更多消息操作" [ref=e337] [cursor=pointer]:
                        - img [ref=e338]
                - generic "你" [ref=e342]:
                  - img [ref=e343]
            - article [ref=e346]:
              - group "任务过程" [ref=e347]:
                - status "正在执行业务操作 已用时 59 秒" [ref=e348] [cursor=pointer]:
                  - generic [ref=e349]:
                    - img [ref=e350]
                    - img [ref=e352]
                    - img [ref=e354]
                    - img [ref=e357]
                    - img [ref=e359]
                  - strong [ref=e362]: 正在执行业务操作
                  - generic [ref=e363]: 已用时 59 秒
                  - img [ref=e364]
                - list [ref=e366]:
                  - listitem [ref=e367]:
                    - strong [ref=e368]: 进行中
                    - generic [ref=e369]: 处理当前任务
              - generic [ref=e370]:
                - generic "AI 助手" [ref=e371]:
                  - img [ref=e372]
                - generic [ref=e375]:
                  - paragraph [ref=e379]: 正在回复…
                  - generic "AI 消息操作" [ref=e381]:
                    - button "重新生成" [disabled] [ref=e382]:
                      - img [ref=e383]
                    - button "基于此继续" [disabled] [ref=e386]:
                      - img [ref=e387]
                    - button "复制消息" [disabled] [ref=e389]:
                      - img [ref=e390]
            - generic "会话操作" [ref=e393]:
              - button "重新生成最近回答" [ref=e394] [cursor=pointer]:
                - img [ref=e395]
                - text: 重新生成最近回答
        - generic [ref=e398]:
          - generic [ref=e399]:
            - generic [ref=e400]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e401]:
              - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
          - generic [ref=e402]:
            - button "添加材料与工具" [ref=e404] [cursor=pointer]:
              - img [ref=e405]
            - button "上传文件" [ref=e406]
            - generic [ref=e407]:
              - generic [ref=e408]: 正在处理
              - button "发送消息" [disabled] [ref=e409]:
                - img [ref=e410]
              - button "停止运行" [ref=e413] [cursor=pointer]:
                - img [ref=e414]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import type { AgentSession } from "@/agent/contracts/agentSession";
  3   | import { installCoreWritingProvider, readStore } from "./support/p51CoreWorkflow";
  4   | 
  5   | test("H4A-Q selected assets, fit, next action, stop and fork", async ({ page, context }) => {
  6   |   test.setTimeout(180_000);
  7   |   page.setDefaultTimeout(15_000);
  8   |   const bridgeResults: Array<Record<string, unknown>> = [];
  9   |   page.on("request", request => {
  10  |     if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
  11  |     const body = request.postDataJSON() as { action?: string; result?: Record<string, unknown> };
  12  |     if (body.action === "result" && body.result) bridgeResults.push(body.result);
  13  |   });
  14  |   await page.addInitScript(({ baseUrl }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true })), { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  15  |   await page.goto("/h3-fixture");
  16  |   await page.getByRole("button", { name: "Seed confirmed Profile" }).click();
  17  |   await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
  18  |   const branches = await readStore(page, "resumeBranches");
  19  |   const general = branches.find(branch => branch.branchPurpose === "general")!;
  20  |   expect(general.currentRevisionId).toBeTruthy();
  21  |   await installCoreWritingProvider(page);
  22  |   await page.goto("/ai-workspace");
  23  |   await expect.poll(async () => {
  24  |     const state = (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot;
  25  |     return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady && state?.toolSurfaceReady;
  26  |   }, { timeout: 60_000 }).toBe(true);
  27  |   const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  28  |   const previous = new Set((await sessions()).map(session => session.id));
  29  |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  30  |   await expect.poll(async () => (await sessions()).filter(session => !previous.has(session.id)).length).toBe(1);
  31  |   const sessionId = (await sessions()).find(session => !previous.has(session.id))!.id;
  32  |   const current = async () => (await sessions()).find(session => session.id === sessionId)!;
  33  |   await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  34  |   const send = async (text: string) => {
  35  |     await page.getByLabel("描述你的求职任务").fill(text);
  36  |     await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 20_000 });
  37  |     await page.getByRole("button", { name: "发送消息", exact: true }).click();
  38  |   };
  39  |   await send("我要投华为那个AI岗位");
  40  |   await expect.poll(async () => (await current())?.taskState?.workflowUserInputCheckpoint?.kind, { timeout: 45_000 }).toBe("job_choice");
  41  |   await expect(page.getByRole("button", { name: "AI大模型应用开发工程师 · 华为" })).toBeVisible();
  42  |   await send("AI大模型应用开发工程师");
  43  |   await expect.poll(async () => (await current())?.taskState?.selectedEntities.jobId, { timeout: 20_000 }).toBe("h3-job-ai");
  44  |   const inspector = await context.newPage();
  45  |   try {
  46  |     await inspector.goto("/h3-fixture");
  47  |     await inspector.getByLabel("Session ID").fill(sessionId);
  48  |     await inspector.getByRole("button", { name: "Inspect context" }).click();
  49  |     await expect.poll(async () => (await inspector.getByTestId("context-result").textContent()) ?? "").toContain('"jobId":"h3-job-ai"');
  50  |   } finally { await inspector.close(); }
  51  |   await send("帮我分析匹配度");
> 52  |   await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 60_000 }).toBe("analyze_job_fit");
      |                                                                                                ^ Error: expect(received).toBe(expected) // Object.is equality
  53  |   await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  54  |   await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 20_000 }).toBe("completed");
  55  |   const fit = await current();
  56  |   expect(fit.taskState?.workflowId).toBe("analyze_job_fit");
  57  |   expect(fit.activeTurn?.status).toBe("completed");
  58  |   expect(fit.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id, revisionId: general.currentRevisionId });
  59  |   const receipt = (name: string) => bridgeResults.some(result => result.ok === true && (result.receipt as { toolName?: string } | undefined)?.toolName === name);
  60  |   expect(receipt("career.job.get")).toBe(true);
  61  |   expect(receipt("career.resume.get")).toBe(true);
  62  |   expect(receipt("career.workflow.job_fit")).toBe(true);
  63  |   expect(bridgeResults.some(result => {
  64  |     const data = result.data as { job?: { id?: string; rawText?: string; requirementGraph?: unknown } } | undefined;
  65  |     return result.ok === true && data?.job?.id === "h3-job-ai" && data.job.rawText?.includes("必须熟悉 Python") && Boolean(data.job.requirementGraph);
  66  |   })).toBe(true);
  67  |   const fitArtifact = fit.artifactRefs.find(artifact => artifact.kind === "job_fit_overview")!;
  68  |   expect(fitArtifact.binding).toMatchObject({ sessionId, branchId: fit.activeBranchId, jobId: "h3-job-ai", resumeBranchId: general.id, revisionId: general.currentRevisionId });
  69  |   await expect(page.getByRole("button", { name: "生成岗位简历", exact: true })).toBeVisible();
  70  |   await expect(page.getByRole("button", { name: "查看详细匹配", exact: true })).toBeVisible();
  71  |   await expect(page.getByRole("button", { name: "暂时不用", exact: true })).toBeVisible();
  72  |   await page.getByRole("button", { name: "查看匹配分析" }).click();
  73  |   await expect(page.getByRole("complementary", { name: "任务产物" }).getByRole("list", { name: "岗位要求与证据" })).toBeVisible();
  74  |   await send("好");
  75  |   await expect(page.getByText("你想继续哪一步？", { exact: true })).toBeVisible();
  76  |   expect((await current()).taskState?.completionStatus).toBe("completed");
  77  |   expect((await current()).taskState?.selectedEntities.jobId).toBe("h3-job-ai");
  78  |   await send("生成岗位简历");
  79  |   await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 20_000 }).toBe("tailor_existing_resume");
  80  |   await expect(page.getByRole("button", { name: "停止运行", exact: true })).toBeEnabled();
  81  |   await expect.poll(async () => Boolean((await current())?.hermesRun?.runId), { timeout: 15_000 }).toBe(true);
  82  |   const running = await current();
  83  |   const oldBranch = running.activeBranchId;
  84  |   const oldTurn = running.activeTurn!.id;
  85  |   expect(running.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id });
  86  |   await page.getByRole("button", { name: "停止运行", exact: true }).click();
  87  |   await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 20_000 }).toBe("aborted");
  88  |   const row = page.locator(".agent-message-row.is-user").filter({ hasText: "生成岗位简历" }).last();
  89  |   await row.getByRole("button", { name: "编辑并重发" }).click();
  90  |   await row.getByRole("textbox", { name: "编辑消息" }).fill("查看详细匹配");
  91  |   await row.getByRole("button", { name: "确认并重发" }).click();
  92  |   await expect.poll(async () => (await current())?.activeBranchId, { timeout: 20_000 }).not.toBe(oldBranch);
  93  |   await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 25_000 }).not.toBe("running");
  94  |   const fork = await current();
  95  |   expect(fork.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id, revisionId: general.currentRevisionId });
  96  |   expect(fork.artifactRefs.some(artifact => artifact.kind === "job_fit_overview" && artifact.binding?.branchId === fork.activeBranchId && artifact.binding.jobId === "h3-job-ai")).toBe(true);
  97  |   expect(fork.taskState?.knownSlots.resumeCompositionProposal).toBeUndefined();
  98  |   expect(fork.activeTurn?.id).not.toBe(oldTurn);
  99  |   await expect(page.getByText("没有目标岗位", { exact: false })).toHaveCount(0);
  100 | });
  101 | 
```