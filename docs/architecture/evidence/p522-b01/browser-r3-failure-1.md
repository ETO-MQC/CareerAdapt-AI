# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p4-tailoring-engine-v2.spec.ts >> three tailoring modes produce real deltas, apply a revision, and reject empty AI output
- Location: tests\e2e\p4-tailoring-engine-v2.spec.ts:5:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('job-optimization-panel').locator('.tailoring-suggestion-card').first()
Expected: visible
Timeout: 60000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 60000ms
  - waiting for getByTestId('job-optimization-panel').locator('.tailoring-suggestion-card').first()

```

```yaml
- alert
- complementary "AI 工作区导航":
  - button "展开 AI 导航"
  - button
  - button
  - navigation "资产":
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
  - region "最近任务"
  - link:
    - /url: /settings
- main:
  - button "返回"
  - text: 岗位简历 / 可编辑
  - heading "数据分析实习生 - 示例科技公司 - 同学" [level=2]
  - text: 自动保存已开启
  - status: 已保存
  - navigation "编辑模式":
    - button "编辑"
    - button "AI优化" [pressed]
  - button "撤销" [disabled]
  - button "重做" [disabled]
  - button "加入求职进度"
  - button "下载 PDF"
  - group: 更多
  - text: 当前岗位
  - strong: 数据分析实习生
  - text: 公司
  - strong: 示例科技公司
  - text: 来源通用简历
  - strong: 资料库简历
  - text: 匹配更新时间
  - strong: 11/07 12:41
  - text: 待处理建议
  - strong: "0"
  - text: 当前风险
  - strong: 未发现高风险
  - button "返回岗位"
  - button "AI 优化"
  - text: AI 岗位优化
  - button "最小化":
    - img
  - button "最大化":
    - img
  - button "关闭":
    - img
  - tablist "AI岗位优化工具":
    - button "岗位 优化"
    - button "投递 检查"
    - button "📋 日志"
  - region "AI 岗位优化":
    - navigation "岗位定制步骤":
      - button "1 匹配概览"
      - button "2 补充信息"
      - button "3 改写建议"
      - button "4 确认并应用"
    - heading "改写建议" [level=2]
    - paragraph: 可直接采用的建议已选中，需要确认的内容集中在下一步处理。
    - button "采用全部可直接应用建议"
    - strong: AI 评估结果
    - paragraph: 岗位评估失败：模型未返回有效 JSON，请重试或更换支持结构化输出的模型。 已切换为基于已确认事实的安全改写。
    - paragraph: 可直接改写 7 项 · 确认后可加入 0 项 · 需要回答 0 项 · 建议准备材料 0 项 · 保持不变 0 项
    - text: 没有生成可安全应用的具体文本；请检查岗位要求和已确认事实。
    - button "弃用建议"
    - button "返回概览"
    - button "确认并应用"
  - img
  - button "拖拽调整字段面板与 A4 预览宽度"
  - text: 第 1 页 / 共 1 页
  - article "A4 简历预览第 1 页":
    - heading "同学" [level=1]
    - paragraph: 数据分析实习生
    - text: 138****0000 demo.student@example.com 杭州
    - heading "自我评价" [level=2]
    - paragraph: 经济管理方向本科生，关注数据分析、AI应用和跨境业务流程。
    - heading "奖项荣誉" [level=2]
    - article:
      - heading "数据分析成员" [level=3]
      - strong: 统计建模竞赛项目
      - paragraph: 使用 Stata 清洗 31 个省级样本，完成描述统计、相关分析与区域差异分析，形成论文与汇报材料。
      - paragraph:
        - strong: 原始资料草稿：
        - text: 使用 Stata 清洗 31 个省级样本，完成描述统计、相关分析与区域差异分析，形成论文与汇报材料。
      - paragraph:
        - strong: 原始标签：
        - text: Stata、数据清洗、统计分析
      - paragraph:
        - strong: 原始证据引用：
        - text: evidence-stat-report
    - heading "项目经历" [level=2]
    - article:
      - heading "AI 求职应用课程项目" [level=3]
      - strong: 产品与验收协作
      - time: 2025.09–2025.12
      - paragraph: 参与 AI 应用项目需求梳理、原型设计和功能验收，协助将用户流程转化为可检查的功能清单。
      - list:
        - listitem: 参与 AI 应用项目的需求梳理、原型设计和功能验收。
      - paragraph:
        - strong: 原始资料草稿：
        - text: 参与 AI 应用项目需求梳理、原型设计和功能验收，协助将用户流程转化为可检查的功能清单。
      - paragraph:
        - strong: 原始标签：
        - text: 需求梳理、原型设计、功能验收
    - heading "实习经历" [level=2]
    - article:
      - heading "某政府部门" [level=3]
      - strong: 综合事务实习生
      - time: 2025.07–2025.08
      - paragraph: 协助处理公文流转与热线记录，保持信息记录准确、分类清晰。
      - list:
        - listitem: 处理公文流转和热线记录，关注记录准确性与信息整理。
      - paragraph:
        - strong: 原始资料草稿：
        - text: 协助处理公文流转与热线记录，保持信息记录准确、分类清晰。
      - paragraph:
        - strong: 原始标签：
        - text: 信息整理、沟通记录
    - heading "其他内容" [level=2]
    - article:
      - heading "外贸课程与语言学习" [level=3]
      - paragraph: CET-4 601，了解基础外贸业务流程，具备英文资料阅读和流程信息整理基础。
      - list:
        - listitem: CET-4 成绩 601，了解基础外贸业务流程。
      - paragraph:
        - strong: 原始资料草稿：
        - text: CET-4 601，了解基础外贸业务流程，具备英文资料阅读和流程信息整理基础。
      - paragraph:
        - strong: 原始标签：
        - text: 英语、外贸流程、信息整理
    - heading "专业技能" [level=2]
    - strong: Stata
    - text: （familiar） 使用 Stata 完成数据清洗和统计分析。
    - strong: Excel
    - text: （familiar） 能使用 Excel 整理表格数据和基础分析结果。
    - heading "证书" [level=2]
    - article:
      - heading "CET-4" [level=3]
      - strong: 全国大学英语四、六级考试委员会
      - time: "2024.12"
  - text: 1 页
  - group "画布缩放":
    - button "缩小预览": "-"
    - text: 100%
    - button "放大预览": +
    - button "适合宽度"
    - button "整页"
- region "操作通知"
```

# Test source

```ts
  1  | import { expect, test, type Page } from "@playwright/test";
  2  | 
  3  | type DbBranch = { id: string; revision: number; currentRevisionId?: string; sourceBranchId?: string; contentItems: Array<{ id: string; text: string }> };
  4  | 
  5  | test("three tailoring modes produce real deltas, apply a revision, and reject empty AI output", async ({ page }) => {
  6  |   test.setTimeout(240_000);
  7  |   // Deterministic business acceptance: optional semantic matching is unavailable.
  8  |   // The real service, Gateway/Repository writes and tailoring model driver remain active.
  9  |   await page.route("**/api/ai/structured", async (route) => {
  10 |     const body = route.request().postDataJSON() as { task?: string };
  11 |     if (body.task === "resume-tailor") return route.continue();
  12 |     await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({
  13 |       ok: false, error: { code: "invalid_json", message: "Deterministic acceptance: optional semantic provider unavailable." }
  14 |     }) });
  15 |   });
  16 | 
  17 |   await page.goto("/resume");
  18 |   const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  19 |   const setupVisible = await skipSetup.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  20 |   if (setupVisible) {
  21 |     await skipSetup.click();
  22 |     await page.goto("/resume");
  23 |   }
  24 |   await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
  25 |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
  26 |   await page.goto("/jobs");
  27 |   await page.getByRole("radio", { name: /优化已有简历/ }).check();
  28 |   const sourceSelect = page.getByLabel("来源通用简历");
  29 |   await expect(sourceSelect).toBeVisible({ timeout: 20_000 });
  30 |   await sourceSelect.selectOption({ index: 1 });
  31 |   const sourceBranchId = await sourceSelect.inputValue();
  32 |   const sourceBefore = await readFromStore<DbBranch>(page, "resumeBranches", sourceBranchId);
  33 |   const generateJobResume = page.getByRole("button", { name: "分析并生成岗位简历", exact: true });
  34 |   await expect(generateJobResume).toBeEnabled({ timeout: 20_000 });
  35 |   await generateJobResume.click();
  36 |   await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
  37 |   const branchId = new URL(page.url()).searchParams.get("branchId")!;
  38 |   const branchBefore = await readFromStore<DbBranch>(page, "resumeBranches", branchId);
  39 | 
  40 |   await page.getByTitle("AI岗位优化").first().click();
  41 |   const panel = page.getByTestId("job-optimization-panel");
  42 |   await expect(panel).toBeVisible();
  43 |   const results = new Map<string, string>();
  44 |   for (const mode of ["steady", "competitive", "max_fit"] as const) {
  45 |     await panel.locator('label[aria-label="定制模式（原推荐改写力度）"] select').selectOption(mode);
  46 |     await panel.getByRole("button", { name: /生成改写建议/ }).click();
  47 |     while (await panel.getByRole("button", { name: "没有使用过", exact: true }).isVisible().catch(() => false)) {
  48 |       await panel.getByRole("button", { name: "没有使用过", exact: true }).click();
  49 |       await panel.getByRole("button", { name: "提交回答", exact: true }).click();
  50 |     }
  51 |     const cards = panel.locator(".tailoring-suggestion-card");
> 52 |     await expect(cards.first()).toBeVisible({ timeout: 60_000 });
     |                                 ^ Error: expect(locator).toBeVisible() failed
  53 |     const deltas = await cards.evaluateAll((nodes) => nodes.map((node) => {
  54 |       const blocks = Array.from(node.children).filter((child) => child.tagName === "DIV");
  55 |       return { before: blocks[1]?.querySelector("p")?.textContent?.trim() ?? "", after: blocks[2]?.querySelector("p")?.textContent?.trim() ?? "" };
  56 |     }));
  57 |     expect(deltas.length).toBeGreaterThan(0);
  58 |     expect(deltas.every((delta) => delta.after.length > 0 && delta.after !== delta.before)).toBe(true);
  59 |     results.set(mode, deltas.map((delta) => delta.after).join("\n"));
  60 |     await panel.getByRole("button", { name: /1 匹配概览/ }).click();
  61 |   }
  62 |   expect(new Set(results.values()).size).toBe(3);
  63 |   await expect(panel.getByText("自我评价", { exact: true })).toBeVisible();
  64 | 
  65 |   await panel.getByRole("button", { name: /采用全部可直接应用建议/ }).click();
  66 |   await panel.getByRole("button", { name: "确认并应用", exact: true }).click();
  67 |   await expect(panel.getByText(/将修改/)).toBeVisible();
  68 |   await panel.getByRole("button", { name: /应用选择并保存新版本/ }).click();
  69 |   await expect.poll(async () => (await readFromStore<DbBranch>(page, "resumeBranches", branchId))?.revision, { timeout: 60_000 }).toBe((branchBefore?.revision ?? 0) + 1);
  70 |   const sourceAfter = await readFromStore<DbBranch>(page, "resumeBranches", sourceBranchId);
  71 |   expect(sourceAfter).toMatchObject({ revision: sourceBefore?.revision, currentRevisionId: sourceBefore?.currentRevisionId, contentItems: sourceBefore?.contentItems });
  72 | 
  73 |   await page.route("**/api/ai/structured", async (route) => {
  74 |     const body = route.request().postDataJSON() as { task?: string };
  75 |     if (body.task !== "resume-tailor") return route.continue();
  76 |     await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: "resume-tailor", promptVersion: "resume-tailor.v2-empty-e2e", output: { suggestions: [] }, meta: { provider: "mock", model: "empty", inputLength: 1, outputLength: 1, latencyMs: 1 } }) });
  77 |   });
  78 |   await panel.locator('label[aria-label="定制模式（原推荐改写力度）"] select').selectOption("steady");
  79 |   await panel.getByRole("button", { name: /1 匹配概览/ }).click();
  80 |   await panel.getByRole("button", { name: /生成改写建议/ }).click();
  81 |   await expect(panel.getByRole("alert")).toContainText("AI 未生成有效改写", { timeout: 60_000 });
  82 |   await expect(panel.locator(".tailoring-suggestion-card")).toHaveCount(0);
  83 | });
  84 | 
  85 | async function readFromStore<T>(page: Page, storeName: string, key: string): Promise<T | undefined> {
  86 |   return page.evaluate(async ({ storeName, key }) => new Promise<T | undefined>((resolve, reject) => {
  87 |     const request = indexedDB.open("CareerAdaptDb");
  88 |     request.onerror = () => reject(request.error);
  89 |     request.onsuccess = () => {
  90 |       const database = request.result;
  91 |       const get = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
  92 |       get.onerror = () => reject(get.error);
  93 |       get.onsuccess = () => { resolve(get.result as T | undefined); database.close(); };
  94 |     };
  95 |   }), { storeName, key });
  96 | }
  97 | 
```