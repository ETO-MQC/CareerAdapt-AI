# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-activity-presentation.spec.ts >> UX02 tool activities use business wording and preserve source selection
- Location: tests\e2e\agent-activity-presentation.spec.ts:59:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.career-context-trigger')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.career-context-trigger')

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
    - paragraph: 完成第一条任务后会显示在这里。
  - button "AI" [pressed]
  - button "协作"
  - button "手动"
  - link "设置与更多":
    - /url: /settings
  - strong: 求职工作区
  - text: 本地数据
- img
- heading "欢迎使用职适AI" [level=1]
- paragraph: 配置 AI 接口后即可开始使用
- text: API 密钥
- textbox "API 密钥":
  - /placeholder: sk-...
- button "显示"
- paragraph: 内置 Hermes 会在应用启动时接管 AI；密钥经系统安全存储加密后保存在本机，不会保存在浏览器中。
- text: API 地址
- textbox "API 地址":
  - /placeholder: 使用应用内置配置，或填写自定义 OpenAI 兼容地址
- paragraph: 留空即可使用应用随附的 AI 接口配置。
- text: 模型名称
- textbox "模型名称":
  - /placeholder: 使用应用内置模型，或填写自定义模型
- paragraph: 留空即可使用应用随附的模型配置。
- button "开始使用" [disabled]
- button "跳过，先体验其他功能"
- paragraph: 密钥由系统安全存储加密保存在本机，不会上传到任何服务器
- paragraph: 可随时在「设置 → AI 配置」中修改
- region "操作通知"
```

# Test source

```ts
  1  | import { expect, test, type Page } from "@playwright/test";
  2  | import { installHermesRuntimeFixture } from "./support/hermesRuntimeFixture";
  3  | 
  4  | async function openWorkspace(page: Page) {
  5  |   await page.goto("/");
  6  |   const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  7  |   if (await skip.isVisible()) { await skip.click(); await page.waitForURL(/\/$/); }
  8  |   await page.goto("/ai-workspace");
  9  |   const context = page.locator(".career-context-trigger");
> 10 |   await expect(context).toBeVisible();
     |                         ^ Error: expect(locator).toBeVisible() failed
  11 |   if ((await context.innerText()).includes("选择人物")) {
  12 |     await context.click(); await page.getByRole("tab", { name: "新增人物" }).click();
  13 |     await page.getByLabel("人物名称").fill("过程展示测试人物");
  14 |     await page.getByRole("button", { name: "创建人物" }).click();
  15 |     await page.getByRole("button", { name: "使用此版本" }).click();
  16 |     await expect(context).toContainText("过程展示测试人物");
  17 |   }
  18 | }
  19 | 
  20 | test("UX02 long running presentation, completion collapse and structured answer", async ({ page }) => {
  21 |   let release!: () => void;
  22 |   const eventsReady = new Promise<void>(resolve => { release = resolve; });
  23 |   await installHermesRuntimeFixture(page, { eventsReady, output: "# 岗位信息分析\n\n主要内容：请根据实际经历补充职责。\n\n## 下一步\n\n核对来源后再保存。\n\n> [!NOTE]\n> 当前分析不会自动写入资料库。\n\n> [!WARNING]\n> 新事实需要你的确认。" });
  24 |   await openWorkspace(page);
  25 |   await page.getByLabel("描述你的求职任务").fill("请帮我分析岗位信息");
  26 |   await page.getByRole("button", { name: "发送消息" }).click();
  27 |   const card = page.locator('.agent-tool-status-row').last();
  28 |   await expect(card).toHaveAttribute("open", "");
  29 |   await expect(card).toContainText(/正在处理当前任务|任务已接收/);
  30 |   await expect(card.locator('.agent-activity-duration')).toContainText(/已用时 [1-9]\d* 秒/);
  31 |   await page.screenshot({ path: "artifacts/ux02-running-1440.png", fullPage: true });
  32 |   release();
  33 |   await expect(page.getByRole("heading", { level: 1, name: "岗位信息分析" })).toBeVisible();
  34 |   await expect(card).not.toHaveAttribute("open", "");
  35 |   await expect(card).toContainText(/用时.*秒/);
  36 |   await card.locator("summary").click();
  37 |   await expect(card.locator("li")).toBeVisible();
  38 |   await expect(card).not.toContainText(/toolId|operationId|career\.|hermes-e2e|raw/);
  39 |   await expect(page.getByLabel("说明", { exact: true })).toContainText("当前分析不会自动写入资料库");
  40 |   await expect(page.getByLabel("提醒", { exact: true })).toContainText("新事实需要你的确认");
  41 |   const sizes = await page.locator('.agent-markdown').last().evaluate(element => ({
  42 |     h1: parseFloat(getComputedStyle(element.querySelector('h1')!).fontSize),
  43 |     h2: parseFloat(getComputedStyle(element.querySelector('h2')!).fontSize),
  44 |     p: parseFloat(getComputedStyle(element.querySelector('p')!).fontSize),
  45 |     note: parseFloat(getComputedStyle(element.querySelector('aside p')!).fontSize)
  46 |   }));
  47 |   expect(sizes.h1).toBeGreaterThan(sizes.h2); expect(sizes.h2).toBeGreaterThan(sizes.p); expect(sizes.p).toBeGreaterThanOrEqual(sizes.note);
  48 |   await card.locator("summary").click();
  49 |   await page.screenshot({ path: "artifacts/ux02-completed-1440.png", fullPage: true });
  50 |   await page.setViewportSize({ width: 1024, height: 768 });
  51 |   await card.locator("summary").click();
  52 |   await expect(card.locator('li')).toBeVisible();
  53 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  54 |   await page.screenshot({ path: "artifacts/ux02-expanded-1024.png", fullPage: true });
  55 |   await page.emulateMedia({ reducedMotion: "reduce" });
  56 |   await expect(page.locator('.agent-streaming-indicator')).toHaveCount(0);
  57 | });
  58 | 
  59 | test("UX02 tool activities use business wording and preserve source selection", async ({ page }) => {
  60 |   await installHermesRuntimeFixture(page);
  61 |   await openWorkspace(page);
  62 |   await page.getByLabel("描述你的求职任务").fill("优化已有简历");
  63 |   await page.getByRole("button", { name: "发送消息" }).click();
  64 |   const card = page.locator('.agent-tool-status-row').last();
  65 |   await expect(page.getByText("请选择用于岗位定制的通用简历。", { exact: true })).toBeVisible();
  66 |   await expect(card).not.toHaveAttribute("open", "");
  67 |   await card.locator('summary').click();
  68 |   await expect(card).toContainText("生成岗位简历提案");
  69 |   await expect(card).not.toContainText(/career\.workflow|tool-call-|operation-/);
  70 |   await expect(page.locator('textarea[data-agent-checkpoint-kind="resume_choice"]')).toBeVisible();
  71 |   await page.screenshot({ path: "artifacts/ux02-tools-1440.png", fullPage: true });
  72 | });
  73 | 
```