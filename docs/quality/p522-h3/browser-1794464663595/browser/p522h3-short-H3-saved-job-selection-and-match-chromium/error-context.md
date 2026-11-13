# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p522h3-short.spec.ts >> H3 saved job selection and match
- Location: tests\e2e\p522h3-short.spec.ts:5:5

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
  - generic [ref=e6] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e7]:
      - img [ref=e8]
    - generic [ref=e11]:
      - button "Open issues overlay" [ref=e12]:
        - generic [ref=e13]:
          - generic [ref=e14]: "0"
          - generic [ref=e15]: "1"
        - generic [ref=e16]: Issue
      - button "Collapse issues badge" [ref=e17]:
        - img [ref=e18]
  - alert [ref=e20]
  - generic [ref=e21]:
    - complementary "AI 工作区导航" [ref=e22]:
      - generic [ref=e23]:
        - link "职适AI 首页" [ref=e24] [cursor=pointer]:
          - /url: /
          - generic [ref=e25]: 职
          - generic [ref=e26]: 职适AI
        - button "收起 AI 导航" [ref=e27] [cursor=pointer]:
          - img [ref=e28]
      - generic [ref=e31]:
        - button "新任务" [ref=e32] [cursor=pointer]:
          - img [ref=e33]
          - generic [ref=e34]: 新任务
        - button "搜索 / 历史" [ref=e35] [cursor=pointer]:
          - img [ref=e36]
          - generic [ref=e39]: 搜索 / 历史
      - navigation "资产" [ref=e40]:
        - generic [ref=e41]: 资产
        - link "AI 助手" [ref=e42] [cursor=pointer]:
          - /url: /ai-workspace
          - img [ref=e43]
          - generic [ref=e46]: AI 助手
        - link "我的简历" [ref=e47] [cursor=pointer]:
          - /url: /resume
          - img [ref=e48]
          - generic [ref=e51]: 我的简历
        - link "个人资料库" [ref=e52] [cursor=pointer]:
          - /url: /profile
          - img [ref=e53]
          - generic [ref=e56]: 个人资料库
        - link "岗位" [ref=e57] [cursor=pointer]:
          - /url: /jobs
          - img [ref=e58]
          - generic [ref=e62]: 岗位
        - link "求职进度" [ref=e63] [cursor=pointer]:
          - /url: /applications
          - img [ref=e64]
          - generic [ref=e66]: 求职进度
        - link "回收站" [ref=e67] [cursor=pointer]:
          - /url: /recycle
          - img [ref=e68]
          - generic [ref=e75]: 回收站
      - region "最近任务" [ref=e76]:
        - text: 最近任务
        - generic [ref=e77]:
          - button "新的对话 任务状态：等待输入" [ref=e78] [cursor=pointer]:
            - generic [ref=e80]: 新的对话
            - generic "任务状态：等待输入" [ref=e81]: 等待输入
          - generic [ref=e82]:
            - button "重命名" [ref=e83] [cursor=pointer]:
              - img [ref=e84]
            - button "归档" [ref=e87] [cursor=pointer]:
              - img [ref=e88]
        - generic [ref=e91]:
          - button "新的对话 任务状态：等待输入" [ref=e92] [cursor=pointer]:
            - generic [ref=e94]: 新的对话
            - generic "任务状态：等待输入" [ref=e95]: 等待输入
          - generic [ref=e96]:
            - button "重命名" [ref=e97] [cursor=pointer]:
              - img [ref=e98]
            - button "归档" [ref=e101] [cursor=pointer]:
              - img [ref=e102]
      - generic [ref=e105]:
        - generic "工作区模式" [ref=e106]:
          - button "AI" [pressed] [ref=e107] [cursor=pointer]:
            - generic [ref=e108]: AI
          - button "协作" [ref=e109] [cursor=pointer]:
            - generic [ref=e110]: 协作
          - button "手动" [ref=e111] [cursor=pointer]:
            - generic [ref=e112]: 手动
        - link "设置与更多" [ref=e113] [cursor=pointer]:
          - /url: /settings
          - img [ref=e114]
          - generic [ref=e117]: 设置与更多
        - generic [ref=e118]:
          - generic [ref=e119]: CA
          - generic [ref=e120]:
            - strong [ref=e121]: 求职工作区
            - generic [ref=e122]: 本地数据
    - main [ref=e125]:
      - generic [ref=e126]:
        - generic [ref=e127]:
          - strong [ref=e128]: 新的对话
          - generic [ref=e129]: 固定：H1Q合成人物 · V1
          - button "H1Q合成人物 · V1 5 条经历 · 1 项基础信息 · 创建于 2026/11/12" [ref=e131] [cursor=pointer]:
            - generic [ref=e132]:
              - strong [ref=e133]: H1Q合成人物 · V1
              - generic [ref=e134]: 5 条经历 · 1 项基础信息 · 创建于 2026/11/12
            - img [ref=e135]
        - generic [ref=e137]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e139] [cursor=pointer]:
            - generic [ref=e140]: AI · 服务
            - generic [ref=e141]: Ready
            - generic [ref=e142]: 控制
          - status [ref=e143]: 等待你回答
          - button "打开历史记录" [ref=e144] [cursor=pointer]:
            - img [ref=e145]
          - button "更多任务操作" [ref=e150] [cursor=pointer]:
            - img [ref=e151]
      - generic [ref=e156]:
        - generic [ref=e157]:
          - generic [ref=e158]:
            - img [ref=e159]
            - text: 本轮回答未完成，当前资料已保留
          - button "暂停任务" [ref=e166] [cursor=pointer]:
            - img [ref=e167]
            - text: 暂停任务
        - region "AI 对话" [ref=e170]:
          - generic [ref=e171]:
            - article [ref=e172]:
              - generic [ref=e173]:
                - generic [ref=e174]:
                  - paragraph [ref=e178]: 我想应聘岗位里面那个华为岗位
                  - generic "用户消息操作" [ref=e179]:
                    - button "编辑并重发" [ref=e180] [cursor=pointer]:
                      - img [ref=e181]
                    - button "历史版本" [ref=e183] [cursor=pointer]:
                      - img [ref=e184]
                    - button "复制消息" [ref=e188] [cursor=pointer]:
                      - img [ref=e189]
                    - group [ref=e192]:
                      - generic "更多消息操作" [ref=e193] [cursor=pointer]:
                        - img [ref=e194]
                - generic "你" [ref=e198]:
                  - img [ref=e199]
            - article [ref=e202]:
              - group "任务过程" [ref=e203]:
                - status "已完成 2 个任务步骤 用时约 15 秒" [ref=e204] [cursor=pointer]:
                  - generic [ref=e205]:
                    - img [ref=e206]
                    - img [ref=e208]
                    - img [ref=e210]
                    - img [ref=e213]
                    - img [ref=e215]
                  - strong [ref=e218]: 已完成 2 个任务步骤
                  - generic [ref=e219]: 用时约 15 秒
                  - img [ref=e220]
              - generic [ref=e222]:
                - generic "AI 助手" [ref=e223]:
                  - img [ref=e224]
                - generic [ref=e227]:
                  - paragraph [ref=e231]: 当前步骤已处理，请核对业务结果。
                  - generic "可选回答" [ref=e232]:
                    - button "AI大模型应用开发工程师 · 华为" [ref=e233] [cursor=pointer]
                    - button "开发工程师2 · 华为" [ref=e234] [cursor=pointer]
                    - button "数据分析实习生 · 示例科技公司" [ref=e235] [cursor=pointer]
                    - button "外贸/跨境运营实习生 · 示例跨境公司" [ref=e236] [cursor=pointer]
                  - generic "AI 消息操作" [ref=e237]:
                    - button "重新生成" [ref=e238] [cursor=pointer]:
                      - img [ref=e239]
                    - button "基于此继续" [ref=e242] [cursor=pointer]:
                      - img [ref=e243]
                    - button "复制消息" [ref=e245] [cursor=pointer]:
                      - img [ref=e246]
                    - group [ref=e249]:
                      - generic "更多消息操作" [ref=e250] [cursor=pointer]:
                        - img [ref=e251]
            - article [ref=e255]:
              - generic [ref=e256]:
                - generic [ref=e257]:
                  - paragraph [ref=e261]: AI大模型应用开发工程师
                  - generic "用户消息操作" [ref=e262]:
                    - button "编辑并重发" [ref=e263] [cursor=pointer]:
                      - img [ref=e264]
                    - button "历史版本" [ref=e266] [cursor=pointer]:
                      - img [ref=e267]
                    - button "复制消息" [ref=e271] [cursor=pointer]:
                      - img [ref=e272]
                    - group [ref=e275]:
                      - generic "更多消息操作" [ref=e276] [cursor=pointer]:
                        - img [ref=e277]
                - generic "你" [ref=e281]:
                  - img [ref=e282]
            - generic [ref=e285]:
              - group "任务过程" [ref=e286]:
                - status "处理未完成，请核对后重试 用时约 0 秒" [ref=e287] [cursor=pointer]:
                  - generic [ref=e288]:
                    - img [ref=e289]
                    - img [ref=e291]
                    - img [ref=e293]
                    - img [ref=e296]
                    - img [ref=e298]
                  - strong [ref=e301]: 处理未完成，请核对后重试
                  - generic [ref=e302]: 用时约 0 秒
                  - img [ref=e303]
              - alert [ref=e305]:
                - img [ref=e306]
                - generic [ref=e308]:
                  - strong [ref=e309]: 任务暂时中断
                  - paragraph [ref=e310]: 本轮回答失败。当前对话已保留，你可以重试。
            - article [ref=e311]:
              - generic [ref=e312]:
                - generic [ref=e313]:
                  - paragraph [ref=e317]: 帮我分析匹配度
                  - generic "用户消息操作" [ref=e318]:
                    - button "编辑并重发" [ref=e319] [cursor=pointer]:
                      - img [ref=e320]
                    - button "历史版本" [ref=e322] [cursor=pointer]:
                      - img [ref=e323]
                    - button "复制消息" [ref=e327] [cursor=pointer]:
                      - img [ref=e328]
                    - group [ref=e331]:
                      - generic "更多消息操作" [ref=e332] [cursor=pointer]:
                        - img [ref=e333]
                - generic "你" [ref=e337]:
                  - img [ref=e338]
            - generic [ref=e341]:
              - group "任务过程" [ref=e342]:
                - status "当前操作未完成 用时 7 秒" [ref=e343] [cursor=pointer]:
                  - generic [ref=e344]:
                    - img [ref=e345]
                    - img [ref=e347]
                    - img [ref=e349]
                    - img [ref=e352]
                    - img [ref=e354]
                  - strong [ref=e357]: 当前操作未完成
                  - generic [ref=e358]: 用时 7 秒
                  - img [ref=e359]
              - alert [ref=e361]:
                - img [ref=e362]
                - generic [ref=e364]:
                  - strong [ref=e365]: 任务暂时中断
                  - paragraph [ref=e366]: 具体操作尚未完成，输入和已有进度已保留。请核对结果后从当前步骤继续。
            - generic "会话操作" [ref=e367]:
              - button "重新执行当前步骤" [ref=e368] [cursor=pointer]:
                - img [ref=e369]
                - text: 重新执行当前步骤
        - generic [ref=e372]:
          - generic [ref=e373]:
            - generic [ref=e374]: 描述你的求职任务
            - textbox "描述你的求职任务" [ref=e375]:
              - /placeholder: 输入岗位名称，或选择一个选项…
          - generic [ref=e376]:
            - button "添加材料与工具" [ref=e378] [cursor=pointer]:
              - img [ref=e379]
            - button "上传文件" [ref=e380]
            - generic [ref=e381]:
              - generic [ref=e382]: 等待你回答
              - button "发送消息" [disabled] [ref=e383]:
                - img [ref=e384]
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
  5  | test("H3 saved job selection and match", async ({ page }) => {
  6  |   test.setTimeout(180_000);
  7  |   page.setDefaultTimeout(15_000);
  8  |   await page.addInitScript(({ baseUrl }) => {
  9  |     localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl, model: "careeradapt-test", provider: "openai-compatible", apiKeyConfigured: true }));
  10 |   }, { baseUrl: process.env.HERMES_INTEGRATION_PROVIDER_URL! });
  11 |   await page.goto("/h3-fixture");
  12 |   await page.getByRole("button", { name: "Seed confirmed Profile" }).click();
  13 |   await expect(page.getByTestId("seed-result")).toHaveText(/^profile-/u);
  14 |   await installCoreWritingProvider(page);
  15 |   await page.goto("/ai-workspace");
  16 |   await expect.poll(async () => {
  17 |     const state = (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot;
  18 |     return state?.processReady && state?.apiReady && state?.providerReady && state?.careerMcpReady && state?.toolSurfaceReady;
  19 |   }, { timeout: 90_000 }).toBe(true);
  20 |   const sessions = async () => await readStore(page, "agentSessions") as unknown as AgentSession[];
  21 |   const previous = new Set((await sessions()).map(session => session.id));
  22 |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  23 |   await expect.poll(async () => (await sessions()).filter(session => !previous.has(session.id)).length).toBe(1);
  24 |   const sessionId = (await sessions()).find(session => !previous.has(session.id))!.id;
  25 |   const current = async () => (await sessions()).find(session => session.id === sessionId)!;
  26 |   await expect(page.getByTestId("agent-recovery-state")).toHaveAttribute("data-session-id", sessionId);
  27 |   const send = async (text: string) => {
  28 |     await page.getByLabel("描述你的求职任务").fill(text);
  29 |     await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeEnabled({ timeout: 30_000 });
  30 |     await page.getByRole("button", { name: "发送消息", exact: true }).click();
  31 |   };
  32 |   await send("我想应聘岗位里面那个华为岗位");
  33 |   await expect.poll(async () => (await current())?.taskState?.workflowUserInputCheckpoint?.kind, { timeout: 60_000 }).toBe("job_choice");
  34 |   await expect(page.getByRole("button", { name: "AI大模型应用开发工程师 · 华为" })).toBeVisible();
  35 |   await send("AI大模型应用开发工程师");
  36 |   await expect.poll(async () => (await current())?.taskState?.selectedEntities.jobId, { timeout: 30_000 }).toBe("h3-job-ai");
  37 |   expect((await current()).activeJobId).toBe("h3-job-ai");
  38 |   await send("帮我分析匹配度");
> 39 |   await expect.poll(async () => (await current())?.taskState?.workflowId, { timeout: 60_000 }).toBe("analyze_job_fit");
     |                                                                                                ^ Error: expect(received).toBe(expected) // Object.is equality
  40 |   await expect.poll(async () => (await current())?.taskState?.completionStatus, { timeout: 60_000 }).toBe("completed");
  41 |   expect((await current()).taskState?.selectedEntities.jobId).toBe("h3-job-ai");
  42 |   await expect(page.getByRole("complementary", { name: "任务产物" })).toBeVisible();
  43 | });
  44 | 
```