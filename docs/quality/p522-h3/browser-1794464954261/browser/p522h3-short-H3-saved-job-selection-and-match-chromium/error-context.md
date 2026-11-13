# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p522h3-short.spec.ts >> H3 saved job selection and match
- Location: tests\e2e\p522h3-short.spec.ts:5:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: '任务产物' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('complementary', { name: '任务产物' })

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
  - button "AI" [pressed]
  - button "协作"
  - button "手动"
  - link "设置与更多":
    - /url: /settings
  - strong: 求职工作区
  - text: 本地数据
- main:
  - strong: 新的对话
  - text: 固定：H1Q合成人物 · V1
  - button "H1Q合成人物 · V1 5 条经历 · 1 项基础信息 · 创建于 2026/11/12":
    - strong: H1Q合成人物 · V1
    - text: 5 条经历 · 1 项基础信息 · 创建于 2026/11/12
  - button "AI Runtime Hermes，状态 Ready": AI · 服务 Ready 控制
  - status: 已完成
  - button "打开历史记录"
  - button "更多任务操作"
  - button "暂停任务"
  - region "AI 对话":
    - article:
      - paragraph: 我想应聘岗位里面那个华为岗位
      - button "编辑并重发"
      - button "历史版本"
      - button "复制消息"
      - group
    - article:
      - group "任务过程":
        - status "已完成 2 个任务步骤 用时约 11 秒":
          - strong: 已完成 2 个任务步骤
          - text: 用时约 11 秒
      - paragraph: 已记录当前选择。
      - button "重新生成"
      - button "基于此继续"
      - button "复制消息"
      - group
    - article:
      - paragraph: AI大模型应用开发工程师
      - button "编辑并重发"
      - button "历史版本"
      - button "复制消息"
      - group
    - group "任务过程":
      - status "处理未完成，请核对后重试 用时约 0 秒":
        - strong: 处理未完成，请核对后重试
        - text: 用时约 0 秒
    - alert:
      - strong: 任务暂时中断
      - paragraph: 本轮回答失败。当前对话已保留，你可以重试。
    - article:
      - paragraph: 帮我分析匹配度
      - button "编辑并重发"
      - button "历史版本"
      - button "复制消息"
      - group
    - article:
      - group "任务过程":
        - status "当前业务步骤已完成 用时 12 秒":
          - strong: 当前业务步骤已完成
          - text: 用时 12 秒
      - paragraph: 已记录当前选择。
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
  1  | import { expect, test } from "@playwright/test";
  2  | import type { AgentSession } from "@/agent/contracts/agentSession";
  3  | import { installCoreWritingProvider, readStore } from "./support/p51CoreWorkflow";
  4  | 
  5  | test("H3 saved job selection and match", async ({ page }) => {
  6  |   test.setTimeout(180_000);
  7  |   page.setDefaultTimeout(15_000);
  8  |   const bridgeResults: Record<string, unknown>[] = [];
  9  |   page.on("request", request => {
  10 |     if (request.method() !== "POST" || !request.url().includes("/api/agent/mcp?bridge=1")) return;
  11 |     const body = request.postDataJSON() as { action?: string; result?: Record<string, unknown> };
  12 |     if (body.action === "result" && body.result) bridgeResults.push(body.result);
  13 |   });
  14 |   await page.addInitScript(({ baseUrl }) => {
  15 |     localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true }));
  16 |   }, { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  17 |   await page.goto("/h3-fixture");
  18 |   await page.getByRole("button", { name: "Seed confirmed Profile" }).click();
  19 |   await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
  20 |   await installCoreWritingProvider(page);
  21 |   await page.goto("/ai-workspace");
  22 |   await expect.poll(async () => {
  23 |     const state = (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot;
  24 |     return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady && state?.toolSurfaceReady;
  25 |   }, { timeout: 90_000 }).toBe(true);
  26 |   const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  27 |   const previous = new Set((await sessions()).map(session => session.id));
  28 |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  29 |   await expect.poll(async () => (await sessions()).filter(session => !previous.has(session.id)).length).toBe(1);
  30 |   const sessionId = (await sessions()).find(session => !previous.has(session.id))!.id;
  31 |   const current = async () => (await sessions()).find(session => session.id === sessionId)!;
  32 |   await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  33 |   const send = async (text: string) => {
  34 |     await page.getByLabel("描述你的求职任务").fill(text);
  35 |     await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 30_000 });
  36 |     await page.getByRole("button", { name: "发送消息", exact: true }).click();
  37 |   };
  38 |   await send("我想应聘岗位里面那个华为岗位");
  39 |   await expect.poll(async () => (await current())?.taskState?.workflowUserInputCheckpoint?.kind, { timeout: 60_000 }).toBe("job_choice");
  40 |   await expect(page.getByRole("button", { name: "AI大模型应用开发工程师 · 华为" })).toBeVisible();
  41 |   await send("AI大模型应用开发工程师");
  42 |   await expect.poll(async () => (await current())?.taskState?.selectedEntities.jobId, { timeout: 30_000 }).toBe("h3-job-ai");
  43 |   expect((await current()).activeJobId).toBe("h3-job-ai");
  44 |   await send("帮我分析匹配度");
  45 |   await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 60_000 }).toBe("analyze_job_fit");
  46 |   await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  47 |   expect((await current()).taskState?.selectedEntities.jobId).toBe("h3-job-ai");
  48 |   expect(bridgeResults.some(result => {
  49 |     const data = result.data as { job?: { id?: string; rawText?: string; requirementGraph?: unknown } } | undefined;
  50 |     return result.ok === true && data?.job?.id === "h3-job-ai" && data.job.rawText?.includes("必须熟悉 Python") && Boolean(data.job.requirementGraph);
  51 |   })).toBe(true);
> 52 |   await expect(page.getByRole("complementary", { name: "任务产物" })).toBeVisible();
     |                                                                   ^ Error: expect(locator).toBeVisible() failed
  53 | });
  54 | 
```