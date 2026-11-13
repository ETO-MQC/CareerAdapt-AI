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
                  - paragraph [ref=e161]: 我要投华为那个AI岗位
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
                - status "已完成 2 个任务步骤 用时 20 秒" [ref=e187] [cursor=pointer]:
                  - generic [ref=e188]:
                    - img [ref=e189]
                    - img [ref=e191]
                    - img [ref=e193]
                    - img [ref=e196]
                    - img [ref=e198]
                  - strong [ref=e201]: 已完成 2 个任务步骤
                  - generic [ref=e202]: 用时 20 秒
                  - img [ref=e203]
              - generic [ref=e205]:
                - generic "AI 助手" [ref=e206]:
                  - img [ref=e207]
                - generic [ref=e210]:
                  - paragraph [ref=e214]: 匹配已完成。
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
                  - paragraph [ref=e239]: AI大模型应用开发工程师
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
                - status "当前业务步骤已完成 用时 0 秒" [ref=e265] [cursor=pointer]:
                  - generic [ref=e266]:
                    - img [ref=e267]
                    - img [ref=e269]
                    - img [ref=e271]
                    - img [ref=e274]
                    - img [ref=e276]
                  - strong [ref=e279]: 当前业务步骤已完成
                  - generic [ref=e280]: 用时 0 秒
                  - img [ref=e281]
              - generic [ref=e283]:
                - generic "AI 助手" [ref=e284]:
                  - img [ref=e285]
                - generic [ref=e288]:
                  - paragraph [ref=e292]: 已选择岗位：AI大模型应用开发工程师 · 华为。
                  - generic "AI 消息操作" [ref=e293]:
                    - button "重新生成" [ref=e294] [cursor=pointer]:
                      - img [ref=e295]
                    - button "基于此继续" [ref=e298] [cursor=pointer]:
                      - img [ref=e299]
                    - button "复制消息" [ref=e301] [cursor=pointer]:
                      - img [ref=e302]
                    - group [ref=e305]:
                      - generic "更多消息操作" [ref=e306] [cursor=pointer]:
                        - img [ref=e307]
            - generic "会话操作" [ref=e311]:
              - button "重新生成最近回答" [ref=e312] [cursor=pointer]:
                - img [ref=e313]
                - text: 重新生成最近回答
        - generic [ref=e316]:
          - generic [ref=e317]:
            - generic [ref=e318]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e319]:
              - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
          - generic [ref=e320]:
            - button "添加材料与工具" [ref=e322] [cursor=pointer]:
              - img [ref=e323]
            - button "上传文件" [ref=e324]
            - generic [ref=e325]:
              - generic [ref=e326]: 已完成
              - button "发送消息" [disabled] [ref=e327]:
                - img [ref=e328]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import type { AgentSession } from "@/agent/contracts/agentSession";
  3  | import { installCoreWritingProvider, readStore } from "./support/p51CoreWorkflow";
  4  | 
  5  | test("H4A-Q selected assets, fit, next action, stop and fork", async ({ page, context }) => {
  6  |   test.setTimeout(180_000);
  7  |   page.setDefaultTimeout(15_000);
  8  |   const bridgeResults: Array<Record<string, unknown>> = [];
  9  |   page.on("request", request => {
  10 |     if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
  11 |     const body = request.postDataJSON() as { action?: string; result?: Record<string, unknown> };
  12 |     if (body.action === "result" && body.result) bridgeResults.push(body.result);
  13 |   });
  14 |   await page.addInitScript(({ baseUrl }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true })), { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  15 |   await page.goto("/h3-fixture");
  16 |   await page.getByRole("button", { name: "Seed confirmed Profile" }).click();
  17 |   await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
  18 |   const branches = await readStore(page, "resumeBranches");
  19 |   const general = branches.find(branch => branch.branchPurpose === "general")!;
  20 |   expect(general.currentRevisionId).toBeTruthy();
  21 |   await installCoreWritingProvider(page);
  22 |   await page.goto("/ai-workspace");
  23 |   await expect.poll(async () => {
  24 |     const state = (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot;
  25 |     return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady && state?.toolSurfaceReady;
  26 |   }, { timeout: 60_000 }).toBe(true);
  27 |   const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  28 |   const previous = new Set((await sessions()).map(session => session.id));
  29 |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  30 |   await expect.poll(async () => (await sessions()).filter(session => !previous.has(session.id)).length).toBe(1);
  31 |   const sessionId = (await sessions()).find(session => !previous.has(session.id))!.id;
  32 |   const current = async () => (await sessions()).find(session => session.id === sessionId)!;
  33 |   await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  34 |   const send = async (text: string) => {
  35 |     await page.getByLabel("描述你的求职任务").fill(text);
  36 |     await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 20_000 });
  37 |     await page.getByRole("button", { name: "发送消息", exact: true }).click();
  38 |   };
  39 |   await send("我要投华为那个AI岗位");
  40 |   await expect.poll(async () => (await current())?.taskState?.workflowUserInputCheckpoint?.kind, { timeout: 45_000 }).toBe("job_choice");
  41 |   await expect(page.getByRole("button", { name: "AI大模型应用开发工程师 · 华为" })).toBeVisible();
  42 |   await send("AI大模型应用开发工程师");
  43 |   await expect.poll(async () => (await current())?.taskState?.selectedEntities.jobId, { timeout: 20_000 }).toBe("h3-job-ai");
  44 |   const inspector = await context.newPage();
  45 |   try {
  46 |     await inspector.goto("/h3-fixture");
  47 |     await inspector.getByLabel("Session ID").fill(sessionId);
  48 |     await inspector.getByRole("button", { name: "Inspect context" }).click();
  49 |     await expect.poll(async () => (await inspector.getByTestId("context-result").textContent()) ?? "").toContain('"jobId":"h3-job-ai"');
  50 |   } finally { await inspector.close(); }
  51 |   await send("帮我分析匹配度");
  52 |   await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  53 |   const fit = await current();
> 54 |   expect(fit.taskState?.workflowId).toBe("analyze_job_fit");
     |                                     ^ Error: expect(received).toBe(expected) // Object.is equality
  55 |   expect(fit.activeTurn?.status).toBe("completed");
  56 |   expect(fit.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id, revisionId: general.currentRevisionId });
  57 |   const receipt = (name: string) => bridgeResults.some(result => result.ok === true && (result.receipt as { toolName?: string } | undefined)?.toolName === name);
  58 |   expect(receipt("career.job.get")).toBe(true);
  59 |   expect(receipt("career.resume.get")).toBe(true);
  60 |   expect(receipt("career.workflow.job_fit")).toBe(true);
  61 |   expect(bridgeResults.some(result => {
  62 |     const data = result.data as { job?: { id?: string; rawText?: string; requirementGraph?: unknown } } | undefined;
  63 |     return result.ok === true && data?.job?.id === "h3-job-ai" && data.job.rawText?.includes("必须熟悉 Python") && Boolean(data.job.requirementGraph);
  64 |   })).toBe(true);
  65 |   const fitArtifact = fit.artifactRefs.find(artifact => artifact.kind === "job_fit_overview")!;
  66 |   expect(fitArtifact.binding).toMatchObject({ sessionId, branchId: fit.activeBranchId, jobId: "h3-job-ai", resumeBranchId: general.id, revisionId: general.currentRevisionId });
  67 |   await expect(page.getByRole("button", { name: "生成岗位简历", exact: true })).toBeVisible();
  68 |   await expect(page.getByRole("button", { name: "查看详细匹配", exact: true })).toBeVisible();
  69 |   await expect(page.getByRole("button", { name: "暂时不用", exact: true })).toBeVisible();
  70 |   await page.getByRole("button", { name: "查看匹配分析" }).click();
  71 |   await expect(page.getByRole("complementary", { name: "任务产物" }).getByRole("list", { name: "岗位要求与证据" })).toBeVisible();
  72 |   await send("好");
  73 |   await expect(page.getByText("你想继续哪一步？", { exact: true })).toBeVisible();
  74 |   expect((await current()).taskState?.completionStatus).toBe("completed");
  75 |   expect((await current()).taskState?.selectedEntities.jobId).toBe("h3-job-ai");
  76 |   await send("生成岗位简历");
  77 |   await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 20_000 }).toBe("tailor_existing_resume");
  78 |   await expect(page.getByRole("button", { name: "停止运行", exact: true })).toBeEnabled();
  79 |   await expect.poll(async () => Boolean((await current())?.hermesRun?.runId), { timeout: 15_000 }).toBe(true);
  80 |   const running = await current();
  81 |   const oldBranch = running.activeBranchId;
  82 |   const oldTurn = running.activeTurn!.id;
  83 |   expect(running.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id });
  84 |   await page.getByRole("button", { name: "停止运行", exact: true }).click();
  85 |   await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 20_000 }).toBe("aborted");
  86 |   const row = page.locator(".agent-message-row.is-user").filter({ hasText: "生成岗位简历" }).last();
  87 |   await row.getByRole("button", { name: "编辑并重发" }).click();
  88 |   await row.getByRole("textbox", { name: "编辑消息" }).fill("查看详细匹配");
  89 |   await row.getByRole("button", { name: "确认并重发" }).click();
  90 |   await expect.poll(async () => (await current())?.activeBranchId, { timeout: 20_000 }).not.toBe(oldBranch);
  91 |   await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 25_000 }).not.toBe("running");
  92 |   const fork = await current();
  93 |   expect(fork.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id, revisionId: general.currentRevisionId });
  94 |   expect(fork.artifactRefs.some(artifact => artifact.kind === "job_fit_overview" && artifact.binding?.branchId === fork.activeBranchId && artifact.binding.jobId === "h3-job-ai")).toBe(true);
  95 |   expect(fork.taskState?.knownSlots.resumeCompositionProposal).toBeUndefined();
  96 |   expect(fork.activeTurn?.id).not.toBe(oldTurn);
  97 |   await expect(page.getByText("没有目标岗位", { exact: false })).toHaveCount(0);
  98 | });
  99 | 
```