# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux012-business-recovery.spec.ts >> UX012 persisted rate-limit recovery preserves input and requires an explicit new request
- Location: tests\e2e\ux012-business-recovery.spec.ts:5:5

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('status', { name: '业务进度' })
Expected: "failed"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for getByRole('status', { name: '业务进度' })

```

```yaml
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
    - button "新的对话 任务状态：失败": 新的对话 失败
    - button "重命名"
    - button "归档"
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
- alert
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { AgentRuntime } from "../../src/agent/runtime/agentRuntime";
  3  | import { installHermesRuntimeFixture } from "./support/hermesRuntimeFixture";
  4  | 
  5  | test("UX012 persisted rate-limit recovery preserves input and requires an explicit new request", async ({ page }) => {
  6  |   const fixture = await installHermesRuntimeFixture(page);
  7  |   await page.goto("/ai-workspace");
  8  |   const skip = page.getByRole("button", { name: "跳过，先体验其他功能" });
  9  |   if (await skip.isVisible()) { await skip.click(); await page.goto("/ai-workspace"); }
  10 |   await expect(page.getByRole("button", { name: "新任务", exact: true })).toBeVisible();
  11 |   const session = AgentRuntime.createConversationSession();
  12 |   const now = new Date().toISOString();
  13 |   const text = "请解释如何核对当前任务，保留这条原始输入。";
  14 |   session.activeTurn = { id: "ux012-failed-turn", sessionId: session.id, userMessageId: "ux012-user", status: "failed", startedAt: now,
  15 |     lastSafeErrorCode: "hermes_provider_http_error", runtimeFailureDiagnostics: { safeErrorCategory: "provider_rate_limit", httpStatus: 429 } };
  16 |   session.messages = [{ id: "ux012-user", turnId: session.activeTurn.id, role: "user", content: text, createdAt: now },
  17 |     { id: "ux012-failure", turnId: session.activeTurn.id, role: "assistant", kind: "text", status: "complete", content: "服务暂时不可用，原始输入已保留。", createdAt: now }];
  18 |   await page.evaluate(async value => {
  19 |     const database = await new Promise<IDBDatabase>((resolve, reject) => {
  20 |       const request = indexedDB.open("CareerAdaptDb"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  21 |     });
  22 |     await new Promise<void>((resolve, reject) => {
  23 |       const transaction = database.transaction(["agentSessions", "agentMessages"], "readwrite");
  24 |       transaction.objectStore("agentSessions").put({ ...value, messages: [] });
  25 |       value.messages.forEach((message, sequence) => transaction.objectStore("agentMessages").put({ ...message, sequence, sessionId: value.id }));
  26 |       transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  27 |     });
  28 |     database.close(); localStorage.setItem("careeradapt.agent.activeSessionId", value.id);
  29 |   }, session);
  30 |   await page.reload();
  31 |   const status = page.getByRole("status", { name: "业务进度" });
> 32 |   await expect(status).toHaveAttribute("data-business-state", "failed");
     |                        ^ Error: expect(locator).toHaveAttribute(expected) failed
  33 |   await expect(status).toContainText("不会自动重试或切换模型");
  34 |   await expect(page.getByText(text, { exact: true })).toBeVisible();
  35 |   expect(fixture.runStarts).toHaveLength(0);
  36 |   await page.screenshot({ path: "docs/quality/ux-01.2-logs/recovery-before.png", fullPage: true });
  37 |   const composer = page.locator("textarea").last();
  38 |   await composer.fill(text);
  39 |   await composer.press("Enter");
  40 |   await expect.poll(() => fixture.runStarts.length).toBe(1);
  41 |   await expect(status).toHaveAttribute("data-business-state", "awaiting_input");
  42 |   await expect(status).toContainText("尚无业务完成回执");
  43 |   await page.screenshot({ path: "docs/quality/ux-01.2-logs/recovery-after.png", fullPage: true });
  44 |   await page.reload();
  45 |   await expect(status).toHaveAttribute("data-business-state", "awaiting_input");
  46 |   expect(fixture.runStarts).toHaveLength(1);
  47 | });
  48 | 
```