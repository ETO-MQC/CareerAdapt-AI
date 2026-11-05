# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: resume01-hermes.spec.ts >> RESUME01 real Hermes review-only then explicit confirmed improvement isolates Profile
- Location: tests\e2e\resume01-hermes.spec.ts:12:5

# Error details

```
Test timeout of 180000ms exceeded.
```

```
Error: locator.click: Test timeout of 180000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '发送消息', exact: true })
    - locator resolved to <button type="submit" aria-label="发送消息" class="agent-send-button">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 100ms
    299 × waiting for element to be visible, enabled and stable
        - element is not enabled
      - retrying click action
        - waiting 500ms

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
          - button "新的对话 任务状态：等待输入" [ref=e69] [cursor=pointer]:
            - generic [ref=e71]: 新的对话
            - generic "任务状态：等待输入" [ref=e72]: 等待输入
          - generic [ref=e73]:
            - button "重命名" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
            - button "归档" [ref=e78] [cursor=pointer]:
              - img [ref=e79]
      - generic [ref=e82]:
        - generic "工作区模式" [ref=e83]:
          - button "AI" [pressed] [ref=e84] [cursor=pointer]:
            - generic [ref=e85]: AI
          - button "协作" [ref=e86] [cursor=pointer]:
            - generic [ref=e87]: 协作
          - button "手动" [ref=e88] [cursor=pointer]:
            - generic [ref=e89]: 手动
        - link "设置与更多" [ref=e90] [cursor=pointer]:
          - /url: /settings
          - img [ref=e91]
          - generic [ref=e94]: 设置与更多
        - generic [ref=e95]:
          - generic [ref=e96]: CA
          - generic [ref=e97]:
            - strong [ref=e98]: 求职工作区
            - generic [ref=e99]: 本地数据
    - main [ref=e102]:
      - generic [ref=e103]:
        - generic [ref=e104]:
          - strong [ref=e105]: 新的对话
          - generic [ref=e106]: 固定：Core 候选人 · V1
          - button "Core 候选人 · V1 1 条经历 · 2 项基础信息 · 创建于 2026/11/04" [ref=e108] [cursor=pointer]:
            - generic [ref=e109]:
              - strong [ref=e110]: Core 候选人 · V1
              - generic [ref=e111]: 1 条经历 · 2 项基础信息 · 创建于 2026/11/04
            - img [ref=e112]
        - generic [ref=e114]:
          - button "AI Runtime Hermes，状态 Ready" [ref=e116] [cursor=pointer]:
            - generic [ref=e117]: AI · 服务
            - generic [ref=e118]: Ready
            - generic [ref=e119]: 控制
          - status [ref=e120]: AI 就绪
          - button "打开历史记录" [ref=e121] [cursor=pointer]:
            - img [ref=e122]
          - button "更多任务操作" [ref=e127] [cursor=pointer]:
            - img [ref=e128]
      - generic [ref=e133]:
        - region "今天想从哪一步开始？" [ref=e134]:
          - generic [ref=e135]:
            - generic [ref=e136]: 从真实经历开始
            - heading "今天想从哪一步开始？" [level=1] [ref=e137]
            - paragraph [ref=e138]: 导入一次经历，生成每个岗位专属的简历与求职方案。
          - generic [ref=e139]:
            - button "从零整理我的经历 通过简短访谈，把真实经历整理成可复用资料。" [ref=e140] [cursor=pointer]:
              - img [ref=e142]
              - generic [ref=e147]: 从零整理我的经历
              - generic [ref=e148]: 通过简短访谈，把真实经历整理成可复用资料。
            - button "导入现有简历 上传文件，提取内容并逐项核对来源。" [ref=e149] [cursor=pointer]:
              - img [ref=e151]
              - generic [ref=e155]: 导入现有简历
              - generic [ref=e156]: 上传文件，提取内容并逐项核对来源。
            - button "生成岗位定制简历 选择现有简历与岗位，生成安全的定制版本。" [ref=e157] [cursor=pointer]:
              - img [ref=e159]
              - generic [ref=e162]: 生成岗位定制简历
              - generic [ref=e163]: 选择现有简历与岗位，生成安全的定制版本。
            - button "从资料库组装简历 从已确认资料中选择经历，组织一份目标简历。" [ref=e164] [cursor=pointer]:
              - img [ref=e166]
              - generic [ref=e168]: 从资料库组装简历
              - generic [ref=e169]: 从已确认资料中选择经历，组织一份目标简历。
            - button "分析岗位匹配度 核对岗位要求、证据覆盖和需要补充的内容。" [ref=e170] [cursor=pointer]:
              - img [ref=e172]
              - generic [ref=e176]: 分析岗位匹配度
              - generic [ref=e177]: 核对岗位要求、证据覆盖和需要补充的内容。
            - button "检查并导出简历 检查结构、排版与事实风险，准备导出。" [ref=e178] [cursor=pointer]:
              - img [ref=e180]
              - generic [ref=e184]: 检查并导出简历
              - generic [ref=e185]: 检查结构、排版与事实风险，准备导出。
        - generic [ref=e186]:
          - generic [ref=e187]:
            - generic [ref=e188]: 描述你的求职任务
            - textbox "描述你的求职任务" [active] [ref=e189]:
              - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
          - generic [ref=e190]:
            - button "添加材料与工具" [ref=e192] [cursor=pointer]:
              - img [ref=e193]
            - button "上传文件" [ref=e194]
            - generic [ref=e195]:
              - generic [ref=e196]: AI 就绪
              - button "发送消息" [disabled] [ref=e197]:
                - img [ref=e198]
          - generic:
            - img
            - text: 松开即可添加文件
  - region "操作通知"
```

# Test source

```ts
  1  | import { test, expect, type Page } from "@playwright/test";
  2  | import { prepareCoreSourceResume, readStore, installCoreWritingProvider } from "./support/p51CoreWorkflow";
  3  | 
  4  | async function fresh(page: Page) {
  5  |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  6  |   await expect(page.getByLabel("描述你的求职任务")).toBeEnabled();
  7  | }
  8  | async function send(page: Page, text: string) {
  9  |   await page.getByLabel("描述你的求职任务").fill(text);
> 10 |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
     |                                                                 ^ Error: locator.click: Test timeout of 180000ms exceeded.
  11 | }
  12 | test("RESUME01 real Hermes review-only then explicit confirmed improvement isolates Profile", async ({ page }, info) => {
  13 |   const baseUrl = process.env.HERMES_INTEGRATION_PROVIDER_URL;
  14 |   const apiKey = process.env.HERMES_INTEGRATION_PROVIDER_KEY;
  15 |   if (!baseUrl || !apiKey) throw new Error("synthetic_provider_missing");
  16 |   await page.addInitScript(settings => localStorage.setItem("careeradapt-ai-settings", JSON.stringify(settings)),
  17 |     { baseUrl, apiKey, model: "careeradapt-test", provider: "openai-compatible", credentialAction: "replace" });
  18 |   await page.goto("/ai-workspace");
  19 |   await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
  20 |   await expect.poll(async () => (await readStore(page, "appMeta")).some(row => row.key === "demoSeededAt")).toBe(true);
  21 |   await prepareCoreSourceResume(page);
  22 |   const branches = await readStore(page, "resumeBranches");
  23 |   const revisions = await readStore(page, "resumeRevisions");
  24 |   const profiles = await readStore(page, "profiles");
  25 |   const receipts: Array<Record<string, unknown>> = [];
  26 |   page.on("request", request => {
  27 |     if (request.url().includes("/api/agent/mcp") && request.method() === "POST") {
  28 |       const body = request.postDataJSON();
  29 |       if (body.action === "tool_result") receipts.push(body);
  30 |     }
  31 |   });
  32 |   await page.goto("/ai-workspace");
  33 |   await fresh(page);
  34 |   await send(page, "P51-C02-COMPOSE UPDATE RESUME01-REVIEW 完整审阅当前通用简历，只读，不修改。");
  35 |   await expect(page.locator(".agent-thread")).toContainText("RESUME01REVIEWDONE", { timeout: 90_000 });
  36 |   expect(await readStore(page, "resumeBranches")).toEqual(branches);
  37 |   expect(await readStore(page, "resumeRevisions")).toEqual(revisions);
  38 |   expect(await readStore(page, "profiles")).toEqual(profiles);
  39 |   await expect(page.locator(".agent-confirmation")).toHaveCount(0);
  40 |   await info.attach("review-only", { body: await page.screenshot(), contentType: "image/png" });
  41 |   await fresh(page);
  42 |   await installCoreWritingProvider(page);
  43 |   await send(page, "P51-C02-COMPOSE UPDATE 根据审阅生成改善提案，等待我的明确确认，不同步个人资料库。");
  44 |   await expect(page.locator(".agent-confirmation")).toBeVisible();
  45 |   expect(await readStore(page, "resumeRevisions")).toEqual(revisions);
  46 |   expect(await readStore(page, "profiles")).toEqual(profiles);
  47 |   await page.locator(".agent-confirmation").getByRole("button", { name: "确认", exact: true }).click();
  48 |   await expect.poll(async () => (await readStore(page, "resumeRevisions")).length).toBe(revisions.length + 1);
  49 |   expect(await readStore(page, "profiles")).toEqual(profiles);
  50 |   const after = await readStore(page, "resumeBranches");
  51 |   expect(after).toHaveLength(branches.length);
  52 |   expect(after.filter(branch => branch.currentRevisionId !== branches.find(old => old.id === branch.id)?.currentRevisionId)).toHaveLength(1);
  53 |   await info.attach("confirmed-improvement", { body: await page.screenshot(), contentType: "image/png" });
  54 | });
  55 | 
```