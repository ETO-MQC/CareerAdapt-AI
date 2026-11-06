# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-precise-edit.spec.ts >> UX013 explicit field selection review refresh and one authoritative Revision
- Location: tests\e2e\ux013-precise-edit.spec.ts:6:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('precise-resume-editor').getByRole('region', { name: '精确修改审核' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByTestId('precise-resume-editor').getByRole('region', { name: '精确修改审核' })

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
- main:
  - strong: 新的对话
  - text: 固定：Core 候选人 · V1
  - button "Core 候选人 · V1 1 条经历 · 2 项基础信息 · 创建于 2026/11/06":
    - strong: Core 候选人 · V1
    - text: 1 条经历 · 2 项基础信息 · 创建于 2026/11/06
  - button "AI Runtime Hermes，状态 不可用": AI · 服务 不可用 控制
  - status: AI 就绪
  - button "打开历史记录"
  - button "更多任务操作"
  - group:
    - text: 精确修改一个字段
    - paragraph: 明确选择简历和字段后，可在对话中要求 AI 润色，或输入建议措辞供审核。
    - text: 简历
    - combobox "精确修改简历":
      - option "请选择简历"
      - option "通用简历 · 通用" [selected]
    - text: 字段
    - combobox "精确修改字段":
      - option "请选择条目与字段"
      - option "AI 应用项目 · 描述"
      - option "AI 应用项目 · 要点 1" [selected]
    - paragraph: 原文：参与 AI 应用项目的需求梳理、原型设计和功能验收。
    - button "选择此字段"
    - paragraph: 已选：branch-general-resume-import-89E86Zc0iz-fE8W08 / project / branch-item-import-core-project / highlights 第 1 条，基于版本 resume-revision-fnv-25db500b-100
    - text: 建议措辞
    - textbox "建议措辞": 参与需求梳理、原型设计和功能验收等 AI 应用项目工作。
    - button "生成审核提案"
    - alert: 这项修改需要核对事实或来源，尚未保存。请保留原事实后调整措辞。
  - region "今天想从哪一步开始？":
    - text: 从真实经历开始
    - heading "今天想从哪一步开始？" [level=1]
    - paragraph: 导入一次经历，生成每个岗位专属的简历与求职方案。
    - button "从零整理我的经历 通过简短访谈，把真实经历整理成可复用资料。"
    - button "导入现有简历 上传文件，提取内容并逐项核对来源。"
    - button "生成岗位定制简历 选择现有简历与岗位，生成安全的定制版本。"
    - button "从资料库组装简历 从已确认资料中选择经历，组织一份目标简历。"
    - button "分析岗位匹配度 核对岗位要求、证据覆盖和需要补充的内容。"
    - button "检查并导出简历 检查结构、排版与事实风险，准备导出。"
  - text: 描述你的求职任务
  - textbox "描述你的求职任务":
    - /placeholder: 描述你的求职任务，或粘贴一份岗位描述...
  - button "添加材料与工具"
  - button "上传文件"
  - text: AI 就绪
  - button "发送消息" [disabled]
  - text: 松开即可添加文件
- region "操作通知"
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { prepareCoreSourceResume, readStore } from "./support/p51CoreWorkflow";
  3  | import { mkdir, writeFile } from "node:fs/promises";
  4  | import type { ResumeBranch } from "@/domain/schemas";
  5  | 
  6  | test("UX013 explicit field selection review refresh and one authoritative Revision", async ({ page }, info) => {
  7  |   test.setTimeout(120_000);
  8  |   // No model quota or runtime request: this exercises the user-entered wording route through the same Facade/Gateway.
  9  |   await page.route("**/api/ai/**", route => route.abort());
  10 |   await page.goto("/setup");
  11 |   await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
  12 |   await prepareCoreSourceResume(page);
  13 |   const before = { branches: await readStore(page, "resumeBranches"), profiles: await readStore(page, "profiles"), revisions: await readStore(page, "resumeRevisions") };
  14 |   const branch = before.branches.find(b => b.branchPurpose === "general") as unknown as ResumeBranch;
  15 |   expect(branch).toBeTruthy();
  16 |   await page.goto("/ai-workspace");
  17 |   await page.getByRole("button", { name: "新任务", exact: true }).click();
  18 |   const panel = page.getByTestId("precise-resume-editor");
  19 |   await panel.locator("summary").click();
  20 |   await panel.getByLabel("精确修改简历", { exact: true }).selectOption(branch.id);
  21 |   const option = await panel.getByLabel("精确修改字段", { exact: true }).locator("option").filter({ hasText: /要点 1/ }).getAttribute("value");
  22 |   expect(option).toBeTruthy();
  23 |   await panel.getByLabel("精确修改字段", { exact: true }).selectOption(option!);
  24 |   await panel.getByRole("button", { name: "选择此字段", exact: true }).click();
  25 |   await panel.getByLabel("建议措辞", { exact: true }).fill("参与需求梳理、原型设计和功能验收等 AI 应用项目工作。");
  26 |   await panel.getByRole("button", { name: "生成审核提案", exact: true }).click();
> 27 |   await expect(panel.getByRole("region", { name: "精确修改审核" })).toBeVisible();
     |                                                               ^ Error: expect(locator).toBeVisible() failed
  28 |   expect(await readStore(page, "resumeRevisions")).toEqual(before.revisions);
  29 |   await page.reload();
  30 |   await panel.locator("summary").click();
  31 |   await expect(panel.getByText("建议：参与需求梳理、原型设计和功能验收等 AI 应用项目工作。", { exact: true })).toBeVisible();
  32 |   await page.screenshot({ path: info.outputPath("proposal.png"), fullPage: true });
  33 |   await panel.getByRole("button", { name: "确认修改", exact: true }).click();
  34 |   await expect(panel.getByText(/已保存版本：/)).toBeVisible();
  35 |   const after = { branches: await readStore(page, "resumeBranches"), profiles: await readStore(page, "profiles"), revisions: await readStore(page, "resumeRevisions") };
  36 |   expect(after.profiles).toEqual(before.profiles);
  37 |   expect(after.branches).toHaveLength(before.branches.length);
  38 |   expect(after.revisions).toHaveLength(before.revisions.length + 1);
  39 |   const revised = after.branches.find(b => b.id === branch.id) as unknown as ResumeBranch;
  40 |   const revisionId = revised.currentRevisionId;
  41 |   expect(after.revisions.some(r => r.id === revisionId && r.previousRevisionId === branch.currentRevisionId)).toBe(true);
  42 |   await page.reload(); await panel.locator("summary").click();
  43 |   await expect(panel.getByText(`已保存版本：${revisionId}`, { exact: true })).toBeVisible();
  44 |   expect(await readStore(page, "resumeRevisions")).toEqual(after.revisions);
  45 |   await page.screenshot({ path: info.outputPath("saved.png"), fullPage: true });
  46 |   await mkdir("docs/quality/ux-01.3-a0-a1-logs", { recursive: true });
  47 |   await writeFile("docs/quality/ux-01.3-a0-a1-logs/browser-data.json", JSON.stringify({ before, after, revisionId }, null, 2));
  48 | });
  49 | 
```