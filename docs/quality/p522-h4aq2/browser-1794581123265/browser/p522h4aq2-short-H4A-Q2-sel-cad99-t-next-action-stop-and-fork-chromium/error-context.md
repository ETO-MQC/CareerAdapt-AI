# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p522h4aq2-short.spec.ts >> H4A-Q2 selected assets, fit, next action, stop and fork
- Location: tests\e2e\p522h4aq2-short.spec.ts:8:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "next_action"
Received: undefined

Call Log:
- Timeout 20000ms exceeded while waiting on the predicate
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
          - button "产物 1" [ref=e135] [cursor=pointer]:
            - img [ref=e136]
            - text: 产物 1
          - button "打开历史记录" [ref=e139] [cursor=pointer]:
            - img [ref=e140]
          - button "更多任务操作" [ref=e145] [cursor=pointer]:
            - img [ref=e146]
      - generic [ref=e151]:
        - button "暂停任务" [ref=e153] [cursor=pointer]:
          - img [ref=e154]
          - text: 暂停任务
        - region "AI 对话" [ref=e157]:
          - generic [ref=e158]:
            - article [ref=e159]:
              - generic [ref=e160]:
                - generic [ref=e161]:
                  - paragraph [ref=e165]: 我要投华为那个AI岗位
                  - generic "用户消息操作" [ref=e166]:
                    - button "编辑并重发" [ref=e167] [cursor=pointer]:
                      - img [ref=e168]
                    - button "历史版本" [ref=e170] [cursor=pointer]:
                      - img [ref=e171]
                    - button "复制消息" [ref=e175] [cursor=pointer]:
                      - img [ref=e176]
                    - group [ref=e179]:
                      - generic "更多消息操作" [ref=e180] [cursor=pointer]:
                        - img [ref=e181]
                - generic "你" [ref=e185]:
                  - img [ref=e186]
            - article [ref=e189]:
              - group "任务过程" [ref=e190]:
                - status "已完成 2 个任务步骤 用时约 13 秒" [ref=e191] [cursor=pointer]:
                  - generic [ref=e192]:
                    - img [ref=e193]
                    - img [ref=e195]
                    - img [ref=e197]
                    - img [ref=e200]
                    - img [ref=e202]
                  - strong [ref=e205]: 已完成 2 个任务步骤
                  - generic [ref=e206]: 用时约 13 秒
                  - img [ref=e207]
              - generic [ref=e209]:
                - generic "AI 助手" [ref=e210]:
                  - img [ref=e211]
                - generic [ref=e214]:
                  - paragraph [ref=e218]: 匹配已完成。
                  - generic "AI 消息操作" [ref=e219]:
                    - button "重新生成" [ref=e220] [cursor=pointer]:
                      - img [ref=e221]
                    - button "基于此继续" [ref=e224] [cursor=pointer]:
                      - img [ref=e225]
                    - button "复制消息" [ref=e227] [cursor=pointer]:
                      - img [ref=e228]
                    - group [ref=e231]:
                      - generic "更多消息操作" [ref=e232] [cursor=pointer]:
                        - img [ref=e233]
            - article [ref=e237]:
              - generic [ref=e238]:
                - generic [ref=e239]:
                  - paragraph [ref=e243]: AI大模型应用开发工程师
                  - generic "用户消息操作" [ref=e244]:
                    - button "编辑并重发" [ref=e245] [cursor=pointer]:
                      - img [ref=e246]
                    - button "历史版本" [ref=e248] [cursor=pointer]:
                      - img [ref=e249]
                    - button "复制消息" [ref=e253] [cursor=pointer]:
                      - img [ref=e254]
                    - group [ref=e257]:
                      - generic "更多消息操作" [ref=e258] [cursor=pointer]:
                        - img [ref=e259]
                - generic "你" [ref=e263]:
                  - img [ref=e264]
            - article [ref=e267]:
              - group "任务过程" [ref=e268]:
                - status "本轮回复已结束 用时 0 秒" [ref=e269] [cursor=pointer]:
                  - generic [ref=e270]:
                    - img [ref=e271]
                    - img [ref=e273]
                    - img [ref=e275]
                    - img [ref=e278]
                    - img [ref=e280]
                  - strong [ref=e283]: 本轮回复已结束
                  - generic [ref=e284]: 用时 0 秒
                  - img [ref=e285]
              - generic [ref=e287]:
                - generic "AI 助手" [ref=e288]:
                  - img [ref=e289]
                - generic [ref=e292]:
                  - paragraph [ref=e296]: 已选择岗位：AI大模型应用开发工程师 · 华为。
                  - generic "AI 消息操作" [ref=e297]:
                    - button "重新生成" [ref=e298] [cursor=pointer]:
                      - img [ref=e299]
                    - button "基于此继续" [ref=e302] [cursor=pointer]:
                      - img [ref=e303]
                    - button "复制消息" [ref=e305] [cursor=pointer]:
                      - img [ref=e306]
                    - group [ref=e309]:
                      - generic "更多消息操作" [ref=e310] [cursor=pointer]:
                        - img [ref=e311]
            - article [ref=e315]:
              - generic [ref=e316]:
                - generic [ref=e317]:
                  - paragraph [ref=e321]: 帮我分析匹配度
                  - generic "用户消息操作" [ref=e322]:
                    - button "编辑并重发" [ref=e323] [cursor=pointer]:
                      - img [ref=e324]
                    - button "历史版本" [ref=e326] [cursor=pointer]:
                      - img [ref=e327]
                    - button "复制消息" [ref=e331] [cursor=pointer]:
                      - img [ref=e332]
                    - group [ref=e335]:
                      - generic "更多消息操作" [ref=e336] [cursor=pointer]:
                        - img [ref=e337]
                - generic "你" [ref=e341]:
                  - img [ref=e342]
            - article [ref=e345]:
              - group "任务过程" [ref=e346]:
                - status "当前业务步骤已完成 用时 27 秒" [ref=e347] [cursor=pointer]:
                  - generic [ref=e348]:
                    - img [ref=e349]
                    - img [ref=e351]
                    - img [ref=e353]
                    - img [ref=e356]
                    - img [ref=e358]
                  - strong [ref=e361]: 当前业务步骤已完成
                  - generic [ref=e362]: 用时 27 秒
                  - img [ref=e363]
              - generic [ref=e365]:
                - generic "AI 助手" [ref=e366]:
                  - img [ref=e367]
                - generic [ref=e370]:
                  - paragraph [ref=e374]: 匹配已完成。
                  - generic "可选回答" [ref=e375]:
                    - button "生成岗位简历" [ref=e376] [cursor=pointer]
                    - button "查看详细匹配" [ref=e377] [cursor=pointer]
                    - button "暂时不用" [ref=e378] [cursor=pointer]
                  - generic "AI 消息操作" [ref=e379]:
                    - button "重新生成" [ref=e380] [cursor=pointer]:
                      - img [ref=e381]
                    - button "基于此继续" [ref=e384] [cursor=pointer]:
                      - img [ref=e385]
                    - button "复制消息" [ref=e387] [cursor=pointer]:
                      - img [ref=e388]
                    - group [ref=e391]:
                      - generic "更多消息操作" [ref=e392] [cursor=pointer]:
                        - img [ref=e393]
            - generic [ref=e397]:
              - strong [ref=e398]: 岗位匹配分析已完成
              - button "查看匹配分析" [ref=e399] [cursor=pointer]
            - generic "会话操作" [ref=e400]:
              - button "重新生成最近回答" [ref=e401] [cursor=pointer]:
                - img [ref=e402]
                - text: 重新生成最近回答
        - generic [ref=e405]:
          - generic [ref=e406]:
            - generic [ref=e407]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e408]:
              - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
          - generic [ref=e409]:
            - button "添加材料与工具" [ref=e411] [cursor=pointer]:
              - img [ref=e412]
            - button "上传文件" [ref=e413]
            - generic [ref=e414]:
              - generic [ref=e415]: 已完成
              - button "发送消息" [disabled] [ref=e416]:
                - img [ref=e417]
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
  4   | import type { AgentSession } from "@/agent/contracts/agentSession";
  5   | import { deriveAgentTurnLifecycle, derivePendingInteraction } from "@/agent/runtime/agentTurnLifecycle";
  6   | import { installCoreWritingProvider, readStore } from "./support/p51CoreWorkflow";
  7   | 
  8   | test("H4A-Q2 selected assets, fit, next action, stop and fork", async ({ page, context }) => {
  9   |   test.setTimeout(180_000);
  10  |   page.setDefaultTimeout(15_000);
  11  |   const bridgeResults: Array<Record<string, unknown>> = [];
  12  |   const ownership: Array<{ bridgeId: string | null; sessionId?: string; turnId?: string; name: string }> = [];
  13  |   page.on("response", async response => {
  14  |     if (response.request().method() !== "GET" || !response.url().includes("/api/agent/mcp?bridge=1")) return;
  15  |     const url = new URL(response.url());
  16  |     const payload = await response.json().catch(() => undefined) as { requests?: Array<{ name: string; agentSessionId?: string; logicalTurnId?: string }> } | undefined;
  17  |     for (const request of payload?.requests ?? []) ownership.push({ bridgeId: url.searchParams.get("bridgeId"), sessionId: request.agentSessionId, turnId: request.logicalTurnId, name: request.name });
  18  |     if (process.env.H3_EVIDENCE_DIR) writeFileSync(path.join(process.env.H3_EVIDENCE_DIR, "bridge-ownership.json"), JSON.stringify(ownership, null, 2));
  19  |   });
  20  |   page.on("request", request => {
  21  |     if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
  22  |     const body = request.postDataJSON() as { action?: string; result?: Record<string, unknown> };
  23  |     if (body.action === "result" && body.result) bridgeResults.push(body.result);
  24  |   });
  25  |   await page.addInitScript(({ baseUrl }) => localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true })), { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  26  |   await page.goto("/h3-fixture");
  27  |   await page.getByRole("button", { name: "Seed confirmed Profile" }).click();
  28  |   await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
  29  |   const branches = await readStore(page, "resumeBranches");
  30  |   const general = branches.find(branch => branch.branchPurpose === "general")!;
  31  |   expect(general.currentRevisionId).toBeTruthy();
  32  |   await installCoreWritingProvider(page);
  33  |   await page.goto("/ai-workspace");
  34  |   await expect.poll(async () => {
  35  |     const state = (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot;
  36  |     return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady && state?.toolSurfaceReady;
  37  |   }, { timeout: 60_000 }).toBe(true);
  38  |   const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  39  |   const previous = new Set((await sessions()).map(session => session.id));
  40  |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  41  |   await expect.poll(async () => (await sessions()).filter(session => !previous.has(session.id)).length).toBe(1);
  42  |   const sessionId = (await sessions()).find(session => !previous.has(session.id))!.id;
  43  |   const current = async () => (await sessions()).find(session => session.id === sessionId)!;
  44  |   await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  45  |   const send = async (text: string) => {
  46  |     await page.getByLabel("描述你的求职任务").fill(text);
  47  |     await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 20_000 });
  48  |     await page.getByRole("button", { name: "发送消息", exact: true }).click();
  49  |   };
  50  |   await send("我要投华为那个AI岗位");
  51  |   await expect.poll(async () => (await current())?.taskState?.workflowUserInputCheckpoint?.kind, { timeout: 45_000 }).toBe("job_choice");
  52  |   await expect(page.getByRole("button", { name: "AI大模型应用开发工程师 · 华为" })).toBeVisible();
  53  |   await send("AI大模型应用开发工程师");
  54  |   await expect.poll(async () => (await current())?.taskState?.selectedEntities.jobId, { timeout: 20_000 }).toBe("h3-job-ai");
  55  |   const inspector = await context.newPage();
  56  |   try {
  57  |     await inspector.goto("/h3-fixture");
  58  |     await inspector.getByLabel("Session ID").fill(sessionId);
  59  |     await inspector.getByRole("button", { name: "Inspect context" }).click();
  60  |     await expect.poll(async () => (await inspector.getByTestId("context-result").textContent()) ?? "").toContain('"jobId":"h3-job-ai"');
  61  |   } finally { await inspector.close(); }
  62  |   await send("帮我分析匹配度");
  63  |   await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 60_000 }).toBe("analyze_job_fit");
  64  |   await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  65  |   await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 20_000 }).toBe("completed");
> 66  |   await expect.poll(async () => derivePendingInteraction(await current())?.kind, { timeout: 20_000 }).toBe("next_action");
      |                                                                                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  67  |   const fit = await current();
  68  |   expect(fit.taskState?.workflowId).toBe("analyze_job_fit");
  69  |   expect(fit.activeTurn?.status).toBe("completed");
  70  |   expect(deriveAgentTurnLifecycle(fit)).toBe("COMPLETED");
  71  |   expect(derivePendingInteraction(fit)?.kind).toBe("next_action");
  72  |   expect(fit.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id, revisionId: general.currentRevisionId });
  73  |   const receipt = (name: string) => bridgeResults.some(result => result.ok === true && (result.receipt as { toolName?: string } | undefined)?.toolName === name);
  74  |   expect(receipt("career.job.get")).toBe(true);
  75  |   expect(receipt("career.resume.get")).toBe(true);
  76  |   expect(receipt("career.workflow.job_fit")).toBe(true);
  77  |   const detailNames = ["career.job.get", "career.resume.get", "career.workflow.job_fit"];
  78  |   await expect.poll(() => detailNames.every(name => ownership.some(item => item.name === name))).toBe(true);
  79  |   const detailOwnership = detailNames.map(name => ownership.findLast(item => item.name === name)!);
  80  |   expect(detailOwnership.every(item => item.sessionId === sessionId && item.turnId === fit.activeTurn?.id && item.bridgeId === detailOwnership[0].bridgeId && item.bridgeId)).toBe(true);
  81  |   expect(bridgeResults.some(result => {
  82  |     const data = result.data as { job?: { id?: string; rawText?: string; requirementGraph?: unknown } } | undefined;
  83  |     return result.ok === true && data?.job?.id === "h3-job-ai" && data.job.rawText?.includes("必须熟悉 Python") && Boolean(data.job.requirementGraph);
  84  |   })).toBe(true);
  85  |   const fitArtifact = fit.artifactRefs.find(artifact => artifact.kind === "job_fit_overview")!;
  86  |   expect(fitArtifact.binding).toMatchObject({ sessionId, branchId: fit.activeBranchId, workflowId: "analyze_job_fit", jobId: "h3-job-ai", resumeBranchId: general.id, revisionId: general.currentRevisionId });
  87  |   await expect(page.getByRole("button", { name: "生成岗位简历", exact: true })).toBeVisible();
  88  |   await expect(page.getByRole("button", { name: "查看详细匹配", exact: true })).toBeVisible();
  89  |   await expect(page.getByRole("button", { name: "暂时不用", exact: true })).toBeVisible();
  90  |   await page.getByRole("button", { name: "查看匹配分析" }).click();
  91  |   await expect(page.getByRole("complementary", { name: "任务产物" }).getByRole("list", { name: "岗位要求与证据" })).toBeVisible();
  92  |   await send("好");
  93  |   await expect(page.getByText("你想继续哪一步？", { exact: true })).toBeVisible();
  94  |   expect((await current()).taskState?.completionStatus).toBe("completed");
  95  |   expect((await current()).taskState?.selectedEntities.jobId).toBe("h3-job-ai");
  96  |   await send("生成岗位简历");
  97  |   await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 20_000 }).toBe("tailor_existing_resume");
  98  |   await expect(page.getByRole("button", { name: "停止运行", exact: true })).toBeEnabled();
  99  |   await expect.poll(async () => Boolean((await current())?.hermesRun?.runId), { timeout: 15_000 }).toBe(true);
  100 |   const running = await current();
  101 |   const oldBranch = running.activeBranchId;
  102 |   const oldTurn = running.activeTurn!.id;
  103 |   expect(running.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id });
  104 |   await page.getByRole("button", { name: "停止运行", exact: true }).click();
  105 |   await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 20_000 }).toBe("aborted");
  106 |   const row = page.locator(".agent-message-row.is-user").filter({ hasText: "生成岗位简历" }).last();
  107 |   await row.getByRole("button", { name: "编辑并重发" }).click();
  108 |   await row.getByRole("textbox", { name: "编辑消息" }).fill("查看详细匹配");
  109 |   await row.getByRole("button", { name: "确认并重发" }).click();
  110 |   await expect.poll(async () => (await current())?.activeBranchId, { timeout: 20_000 }).not.toBe(oldBranch);
  111 |   await expect.poll(async () => (await current())?.activeTurn?.status, { timeout: 25_000 }).not.toBe("running");
  112 |   const fork = await current();
  113 |   expect(fork.taskState?.selectedEntities).toMatchObject({ jobId: "h3-job-ai", resumeId: general.id, revisionId: general.currentRevisionId });
  114 |   expect(fork.artifactRefs.filter(artifact => artifact.kind === "job_fit_overview" && artifact.binding?.branchId === fork.activeBranchId)).toHaveLength(0);
  115 |   expect(fork.taskState?.knownSlots.resumeCompositionProposal).toBeUndefined();
  116 |   expect(fork.activeTurn?.id).not.toBe(oldTurn);
  117 |   await expect(page.getByText("没有目标岗位", { exact: false })).toHaveCount(0);
  118 | });
  119 | 
```