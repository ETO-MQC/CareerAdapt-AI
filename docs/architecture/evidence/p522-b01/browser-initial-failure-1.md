# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p4-tailoring-engine-v2.spec.ts >> three tailoring modes produce real deltas, apply a revision, and reject empty AI output
- Location: tests\e2e\p4-tailoring-engine-v2.spec.ts:5:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /\/resume\?.*branchId=/
Received string:  "http://127.0.0.1:3000/jobs"
Timeout: 20000ms

Call log:
  - Expect "toHaveURL" with timeout 20000ms
    43 × unexpected value "http://127.0.0.1:3000/jobs"

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
  - heading "岗位" [level=1]
  - text: 2 个当前岗位 · 0 个已归档
  - article:
    - heading "新增 / 更新岗位" [level=2]
    - paragraph: 粘贴完整 JD，系统会保留原文和来源。
    - text: 等待保存 岗位名称
    - textbox "岗位名称":
      - /placeholder: 例如：数据产品经理…
    - text: 公司名称
    - textbox "公司名称":
      - /placeholder: 例如：某科技公司…
    - text: 岗位描述
    - textbox "岗位描述":
      - /placeholder: 粘贴岗位职责、任职要求和加分项…
    - button "保存并分析岗位"
  - complementary:
    - heading "岗位列表" [level=2]
    - paragraph: 2 个当前岗位 · 0 个已归档
    - group "岗位状态":
      - button "当前"
      - button "已归档"
    - button "数据分析实习生 示例科技公司 2 条要求 · 7/1 · 示例岗位":
      - strong: 数据分析实习生
      - text: 示例科技公司 2 条要求 · 7/1 · 示例岗位
    - button "编辑 数据分析实习生"
    - button "删除 数据分析实习生"
    - button "外贸/跨境运营实习生 示例跨境公司 2 条要求 · 7/1 · 示例岗位":
      - strong: 外贸/跨境运营实习生
      - text: 示例跨境公司 2 条要求 · 7/1 · 示例岗位
    - button "编辑 外贸/跨境运营实习生"
    - button "删除 外贸/跨境运营实习生"
  - text: 示例科技公司
  - heading "数据分析实习生" [level=2]
  - paragraph: 2 条已确认要求 · 当前岗位 · 当前来源：资料库简历
  - button "重新编辑 JD"
  - button "更多岗位操作"
  - tablist "岗位工作内容":
    - tab "生成岗位简历" [selected]
    - tab "岗位信息"
    - tab "岗位要求"
    - tab "求职进度"
  - tabpanel:
    - heading "选择生成方式" [level=3]
    - paragraph: 两种方式都会创建独立岗位简历，不修改个人资料或原简历。
    - text: 推荐：优化已有简历
    - radiogroup "岗位简历来源":
      - radio "从资料库生成 从完整个人资料中筛选最相关的经历、项目和技能，重新组合岗位简历。":
        - strong: 从资料库生成
        - text: 从完整个人资料中筛选最相关的经历、项目和技能，重新组合岗位简历。
      - radio "优化已有简历 以一份现有简历为基础，调整重点、顺序和表达；原简历不会被修改。" [checked]:
        - strong: 优化已有简历
        - text: 以一份现有简历为基础，调整重点、顺序和表达；原简历不会被修改。
    - paragraph: 已有通用简历可作为成熟基础，针对岗位调整重点会更快。
    - text: 来源通用简历
    - combobox "来源通用简历":
      - option "请选择一份通用简历"
      - option "资料库简历" [selected]
    - text: 将分析当前正式版本并生成岗位简历；如已存在优化版本，可选择前往或新建。
    - button "分析中…" [disabled]
    - button "查看匹配详情"
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
  7  |   await page.goto("/resume");
  8  |   const skipSetup = page.getByRole("button", { name: "跳过，先体验其他功能" });
  9  |   const setupVisible = await skipSetup.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  10 |   if (setupVisible) {
  11 |     await skipSetup.click();
  12 |     await page.goto("/resume");
  13 |   }
  14 |   await page.getByRole("button").filter({ hasText: "从个人资料库创建" }).click();
  15 |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible({ timeout: 20_000 });
  16 |   await page.goto("/jobs");
  17 |   await page.getByRole("radio", { name: /优化已有简历/ }).check();
  18 |   const sourceSelect = page.getByLabel("来源通用简历");
  19 |   await expect(sourceSelect).toBeVisible({ timeout: 20_000 });
  20 |   await sourceSelect.selectOption({ index: 1 });
  21 |   const sourceBranchId = await sourceSelect.inputValue();
  22 |   const sourceBefore = await readFromStore<DbBranch>(page, "resumeBranches", sourceBranchId);
  23 |   const generateJobResume = page.getByRole("button", { name: "分析并生成岗位简历", exact: true });
  24 |   await expect(generateJobResume).toBeEnabled({ timeout: 20_000 });
  25 |   await generateJobResume.click();
> 26 |   await expect(page).toHaveURL(/\/resume\?.*branchId=/, { timeout: 20_000 });
     |                      ^ Error: expect(page).toHaveURL(expected) failed
  27 |   const branchId = new URL(page.url()).searchParams.get("branchId")!;
  28 |   const branchBefore = await readFromStore<DbBranch>(page, "resumeBranches", branchId);
  29 | 
  30 |   await page.getByTitle("AI岗位优化").first().click();
  31 |   const panel = page.getByTestId("job-optimization-panel");
  32 |   await expect(panel).toBeVisible();
  33 |   const results = new Map<string, string>();
  34 |   for (const mode of ["steady", "competitive", "max_fit"] as const) {
  35 |     await panel.getByLabel("定制模式").selectOption(mode);
  36 |     await panel.getByRole("button", { name: /生成改写建议/ }).click();
  37 |     while (await panel.getByRole("button", { name: "没有使用过", exact: true }).isVisible().catch(() => false)) {
  38 |       await panel.getByRole("button", { name: "没有使用过", exact: true }).click();
  39 |       await panel.getByRole("button", { name: "提交回答", exact: true }).click();
  40 |     }
  41 |     const cards = panel.locator(".tailoring-suggestion-card");
  42 |     await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  43 |     const deltas = await cards.evaluateAll((nodes) => nodes.map((node) => {
  44 |       const blocks = Array.from(node.children).filter((child) => child.tagName === "DIV");
  45 |       return { before: blocks[1]?.querySelector("p")?.textContent?.trim() ?? "", after: blocks[2]?.querySelector("p")?.textContent?.trim() ?? "" };
  46 |     }));
  47 |     expect(deltas.length).toBeGreaterThan(0);
  48 |     expect(deltas.every((delta) => delta.after.length > 0 && delta.after !== delta.before)).toBe(true);
  49 |     results.set(mode, deltas.map((delta) => delta.after).join("\n"));
  50 |     await panel.getByRole("button", { name: /1 匹配概览/ }).click();
  51 |   }
  52 |   expect(new Set(results.values()).size).toBe(3);
  53 |   await expect(panel.getByText("自我评价", { exact: true })).toBeVisible();
  54 | 
  55 |   await panel.getByRole("button", { name: /采用全部可直接应用建议/ }).click();
  56 |   await panel.getByRole("button", { name: "确认并应用", exact: true }).click();
  57 |   await expect(panel.getByText(/将修改/)).toBeVisible();
  58 |   await panel.getByRole("button", { name: /应用选择并保存新版本/ }).click();
  59 |   await expect.poll(async () => (await readFromStore<DbBranch>(page, "resumeBranches", branchId))?.revision, { timeout: 60_000 }).toBe((branchBefore?.revision ?? 0) + 1);
  60 |   const sourceAfter = await readFromStore<DbBranch>(page, "resumeBranches", sourceBranchId);
  61 |   expect(sourceAfter).toMatchObject({ revision: sourceBefore?.revision, currentRevisionId: sourceBefore?.currentRevisionId, contentItems: sourceBefore?.contentItems });
  62 | 
  63 |   await page.route("**/api/ai/structured", async (route) => {
  64 |     const body = route.request().postDataJSON() as { task?: string };
  65 |     if (body.task !== "resume-tailor") return route.continue();
  66 |     await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, task: "resume-tailor", promptVersion: "resume-tailor.v2-empty-e2e", output: { suggestions: [] }, meta: { provider: "mock", model: "empty", inputLength: 1, outputLength: 1, latencyMs: 1 } }) });
  67 |   });
  68 |   await panel.getByLabel("定制模式").selectOption("steady");
  69 |   await panel.getByRole("button", { name: /1 匹配概览/ }).click();
  70 |   await panel.getByRole("button", { name: /生成改写建议/ }).click();
  71 |   await expect(panel.getByRole("alert")).toContainText("AI 未生成有效改写", { timeout: 60_000 });
  72 |   await expect(panel.locator(".tailoring-suggestion-card")).toHaveCount(0);
  73 | });
  74 | 
  75 | async function readFromStore<T>(page: Page, storeName: string, key: string): Promise<T | undefined> {
  76 |   return page.evaluate(async ({ storeName, key }) => new Promise<T | undefined>((resolve, reject) => {
  77 |     const request = indexedDB.open("CareerAdaptDb");
  78 |     request.onerror = () => reject(request.error);
  79 |     request.onsuccess = () => {
  80 |       const database = request.result;
  81 |       const get = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
  82 |       get.onerror = () => reject(get.error);
  83 |       get.onsuccess = () => { resolve(get.result as T | undefined); database.close(); };
  84 |     };
  85 |   }), { storeName, key });
  86 | }
  87 | 
```