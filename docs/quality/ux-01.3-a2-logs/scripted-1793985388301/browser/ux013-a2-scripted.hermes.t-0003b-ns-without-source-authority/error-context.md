# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-a2-scripted.hermes.ts >> A2 real Hermes local Scripted Provider proposes four selected operations without source authority
- Location: tests\e2e\ux013-a2-scripted.hermes.ts:7:5

# Error details

```
Error: expect(page).not.toHaveURL(expected) failed

Expected pattern: not /\/setup$/u
Received string: "http://127.0.0.1:3118/setup"
Timeout: 30000ms

Call log:
  - Expect "not toHaveURL" with timeout 30000ms
    62 × unexpected value "http://127.0.0.1:3118/setup"

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
  - text: careeradapt-test-provider-key
- button "显示"
- paragraph: 内置 Hermes 会在应用启动时接管 AI；密钥经系统安全存储加密后保存在本机，不会保存在浏览器中。
- alert: 密钥未能写入系统安全存储，请重试。
- text: API 地址
- textbox "API 地址":
  - /placeholder: 使用应用内置配置，或填写自定义 OpenAI 兼容地址
  - text: http://127.0.0.1:61495/v1
- paragraph: 留空即可使用应用随附的 AI 接口配置。
- text: 模型名称
- textbox "模型名称":
  - /placeholder: 使用应用内置模型，或填写自定义模型
  - text: careeradapt-test
- paragraph: 留空即可使用应用随附的模型配置。
- button "开始使用"
- button "跳过，先体验其他功能"
- paragraph: 密钥由系统安全存储加密保存在本机，不会上传到任何服务器
- paragraph: 可随时在「设置 → AI 配置」中修改
- region "操作通知"
- alert
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | import { mkdir, writeFile } from "node:fs/promises";
  3  | import { readStore } from "./support/p51CoreWorkflow";
  4  | import { prepareA2Source } from "./support/ux013A2Fixture";
  5  | import type { AgentSession } from "@/agent/contracts/agentSession";
  6  | 
  7  | test("A2 real Hermes local Scripted Provider proposes four selected operations without source authority", async ({ page }, info) => {
  8  |   page.setDefaultTimeout(15_000);
  9  |   const directory = process.env.UX013_A2_SCRIPTED_DIR!;
  10 |   const provider = process.env.HERMES_INTEGRATION_PROVIDER_URL!, key = process.env.HERMES_INTEGRATION_PROVIDER_KEY!;
  11 |   expect(provider).toMatch(/^http:\/\/127\.0\.0\.1:/u);
  12 |   if (!directory || !provider || !key) throw new Error("isolated_scripted_provider_required");
  13 |   await mkdir(directory, { recursive: true });
  14 |   await page.goto("/setup");
  15 |   await page.getByLabel("API 密钥", { exact: true }).fill(key);
  16 |   await page.getByLabel("API 地址", { exact: true }).fill(provider);
  17 |   await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  18 |   await page.getByRole("button", { name: "开始使用", exact: true }).click();
> 19 |   await expect(page).not.toHaveURL(/\/setup$/u);
     |                          ^ Error: expect(page).not.toHaveURL(expected) failed
  20 |   await page.goto("/ai-workspace");
  21 |   await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 60_000 });
  22 |   const ready = await (await page.request.get("/api/agent/runtime/hermes/control")).json();
  23 |   expect(ready.snapshot).toMatchObject({ runReady: true, careerMcpReady: true, toolSurfaceReady: true });
  24 |   await writeFile(`${directory}/ready.json`, JSON.stringify(ready, null, 2));
  25 |   const selected = await prepareA2Source(page);
  26 |   await page.goto("/ai-workspace");
  27 |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  28 |   const panel = page.getByTestId("structured-resume-editor"); await panel.locator("summary").first().click();
  29 |   const activeSession = async () => (await readStore(page, "agentSessions")).find(s => s.activeProfileId === selected.profileId && !!s.taskState) as unknown as AgentSession | undefined;
  30 |   const snapshot = async () => ({ profiles: await readStore(page, "profiles"), branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions"),
  31 |     operations: await readStore(page, "resumeBranchOperations"), appMeta: await readStore(page, "appMeta"), session: await activeSession() });
  32 |   const kinds = ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"];
  33 |   for (const kind of kinds) {
  34 |     if (kind !== kinds[0]) await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  35 |     await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(selected.branchId);
  36 |     await panel.getByLabel("结构化操作", { exact: true }).selectOption(kind);
  37 |     const target = panel.getByLabel("结构化修改目标", { exact: true }), options = await target.locator("option").allTextContents();
  38 |     const index = kind === "fact_correction" ? options.findIndex(t => t.includes("项目名称")) : kind === "bullet_removal" ? options.findIndex(t => t.includes("要点 3")) : 1;
  39 |     expect(index).toBeGreaterThan(0); await target.selectOption({ index });
  40 |     if (kind === "fact_correction") await panel.getByLabel("我的纠正内容", { exact: true }).fill("Scripted 用户原始纠正名称");
  41 |     await panel.getByRole("button", { name: "选择目标，交给 AI", exact: true }).click();
  42 |     await expect(panel.getByText(/目标已选择/u)).toBeVisible();
  43 |     const before = await snapshot();
  44 |     const text = kind === "fact_correction" ? "UX013-A2-F 请把选中的项目名称更正为我刚刚直接提交的纠正内容，仅修改当前简历。"
  45 |       : kind === "confirmed_skill_addition" ? "UX013-A2-S 请把选中的已确认技能加入当前简历，等待审核，不同步资料库。"
  46 |         : kind === "bullet_removal" ? "UX013-A2-D 请删除选中的第三条要点，其他内容保持不变，先给我提案。"
  47 |           : "UX013-A2-R 请把所选经历的第二条要点移到第一条，原第一条排第二，文字不改，等待我确认。";
  48 |     await page.getByLabel("描述你的求职任务").fill(text);
  49 |     await page.getByRole("button", { name: "发送消息", exact: true }).click();
  50 |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  51 |     expect((await snapshot()).revisions).toEqual(before.revisions);
  52 |     const proposed = await snapshot();
  53 |     expect(proposed.session?.pendingConfirmation?.status).toBe("pending");
  54 |     await expect.poll(async () => (await activeSession())?.hermesRun?.status).toBe("completed");
  55 |     await page.screenshot({ path: info.outputPath(`${kind}-scripted-proposal.png`), fullPage: true });
  56 |     await page.reload(); await panel.locator("summary").first().click();
  57 |     await panel.getByRole("button", { name: "确认结构化修改", exact: true }).click();
  58 |     await expect(panel.getByText(/已保存版本：/u)).toBeVisible();
  59 |     const after = await snapshot();
  60 |     expect(after.profiles).toEqual(before.profiles);
  61 |     expect(after.branches.filter(b => b.id !== selected.branchId)).toEqual(before.branches.filter(b => b.id !== selected.branchId));
  62 |     expect(after.revisions).toHaveLength(before.revisions.length + 1);
  63 |     const receipt = after.operations.find(o => !before.operations.some(p => p.id === o.id)); expect(receipt?.revisionId).toBeTruthy();
  64 |     expect(after.revisions.filter(r => r.id !== receipt!.revisionId)).toEqual(before.revisions);
  65 |     const slot = proposed.session!.taskState!.knownSlots.preciseResumeEdit as { proposal: { operation: { type: string; factProposal?: { source: { turnId: string; messageId: string; content: string } } }; turnId: string } };
  66 |     expect(slot.proposal.operation.type).toBe(kind);
  67 |     if (kind === "fact_correction") {
  68 |       expect(slot.proposal.operation.factProposal?.source.content).toBe("Scripted 用户原始纠正名称");
  69 |       expect(slot.proposal.operation.factProposal?.source.turnId).not.toBe(slot.proposal.turnId);
  70 |     }
  71 |     await page.reload(); await panel.locator("summary").first().click();
  72 |     await expect(panel.getByText(`已保存版本：${receipt!.revisionId}`, { exact: true })).toBeVisible();
  73 |     expect((await snapshot()).revisions).toEqual(after.revisions);
  74 |     await writeFile(`${directory}/${kind}.json`, JSON.stringify({ before, proposed, after, receipt }, null, 2));
  75 |   }
  76 | });
  77 | 
```