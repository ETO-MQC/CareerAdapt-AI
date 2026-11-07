# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p4-tailoring-engine-v2.spec.ts >> three tailoring modes produce real deltas, apply a revision, and reject empty AI output
- Location: tests\e2e\p4-tailoring-engine-v2.spec.ts:5:5

# Error details

```
Error: locator.selectOption: Error: strict mode violation: getByTestId('job-optimization-panel').getByLabel('定制模式') resolved to 2 elements:
    1) <label class="field-label" aria-label="定制模式（原推荐改写力度）">…</label> aka getByLabel('定制模式（原推荐改写力度）')
    2) <select>…</select> aka getByLabel('定制模式稳健：只用已证明经历竞争力：加入确认能力最大匹配：补问岗位缺口')

Call log:
  - waiting for getByTestId('job-optimization-panel').getByLabel('定制模式')

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
      - button "展开 AI 导航" [ref=e24] [cursor=pointer]:
        - img [ref=e25]
      - generic [ref=e28]:
        - button [ref=e29] [cursor=pointer]:
          - img [ref=e30]
        - button [ref=e31] [cursor=pointer]:
          - img [ref=e32]
      - navigation "资产" [ref=e35]:
        - link "AI 助手" [ref=e36] [cursor=pointer]:
          - /url: /ai-workspace
          - img [ref=e37]
        - link "我的简历" [ref=e40] [cursor=pointer]:
          - /url: /resume
          - img [ref=e41]
        - link "个人资料库" [ref=e44] [cursor=pointer]:
          - /url: /profile
          - img [ref=e45]
        - link "岗位" [ref=e48] [cursor=pointer]:
          - /url: /jobs
          - img [ref=e49]
        - link "求职进度" [ref=e53] [cursor=pointer]:
          - /url: /applications
          - img [ref=e54]
        - link "回收站" [ref=e56] [cursor=pointer]:
          - /url: /recycle
          - img [ref=e57]
      - region "最近任务" [ref=e64]
      - generic [ref=e65]:
        - link [ref=e66] [cursor=pointer]:
          - /url: /settings
          - img [ref=e67]
        - generic [ref=e71]: CA
    - main [ref=e74]:
      - generic [ref=e75]:
        - generic [ref=e76]:
          - button [ref=e77] [cursor=pointer]: 数据分析实习生 - 示例科技公司 - 同学
          - button [ref=e78] [cursor=pointer]: 资料库简历
        - generic [ref=e79]:
          - button "返回" [ref=e80] [cursor=pointer]
          - generic [ref=e81]:
            - generic [ref=e82]: 岗位简历 / 可编辑
            - heading "数据分析实习生 - 示例科技公司 - 同学" [level=2] [ref=e83]
            - generic [ref=e84]:
              - generic [ref=e85]: 自动保存已开启
              - status [ref=e86]: 已保存
        - navigation "编辑模式" [ref=e87]:
          - button "编辑" [ref=e88] [cursor=pointer]:
            - generic [ref=e89]: 编辑
          - button "AI优化" [active] [pressed] [ref=e90] [cursor=pointer]:
            - generic [ref=e91]: AI优化
        - generic "简历工作栏" [ref=e92]:
          - generic [ref=e93]:
            - button "撤销" [disabled] [ref=e94] [cursor=pointer]
            - button "重做" [disabled] [ref=e95] [cursor=pointer]
            - button "加入求职进度" [ref=e96] [cursor=pointer]
            - button "下载 PDF" [ref=e97] [cursor=pointer]
            - group [ref=e98]:
              - generic "更多" [ref=e99] [cursor=pointer]
        - generic [ref=e100]:
          - generic [ref=e101]:
            - generic [ref=e102]: 当前岗位
            - strong [ref=e103]: 数据分析实习生
          - generic [ref=e104]:
            - generic [ref=e105]: 公司
            - strong [ref=e106]: 示例科技公司
          - generic [ref=e107]:
            - generic [ref=e108]: 来源通用简历
            - strong [ref=e109]: 资料库简历
          - generic [ref=e110]:
            - generic [ref=e111]: 匹配更新时间
            - strong [ref=e112]: 11/07 12:39
          - generic [ref=e113]:
            - generic [ref=e114]: 待处理建议
            - strong [ref=e115]: "0"
          - generic [ref=e116]:
            - generic [ref=e117]: 当前风险
            - strong [ref=e118]: 未发现高风险
          - generic [ref=e119]:
            - button "返回岗位" [ref=e120] [cursor=pointer]
            - button "AI 优化" [ref=e121] [cursor=pointer]
      - generic [ref=e122]:
        - generic [ref=e123]:
          - generic [ref=e124]:
            - generic [ref=e125]: AI 岗位优化
            - generic [ref=e126]:
              - button "最小化" [ref=e127] [cursor=pointer]:
                - img [ref=e128]
              - button "最大化" [ref=e129] [cursor=pointer]:
                - img [ref=e130]
              - button "关闭" [ref=e132] [cursor=pointer]:
                - img [ref=e133]
          - generic [ref=e136]:
            - tablist "AI岗位优化工具" [ref=e137]:
              - button "岗位 优化" [ref=e138] [cursor=pointer]:
                - generic [ref=e139]: 岗位
                - generic [ref=e140]: 优化
              - button "投递 检查" [ref=e141] [cursor=pointer]:
                - generic [ref=e142]: 投递
                - generic [ref=e143]: 检查
              - button "📋 日志" [ref=e144] [cursor=pointer]:
                - generic [ref=e145]: 📋
                - generic [ref=e146]: 日志
            - region "AI 岗位优化" [ref=e148]:
              - navigation "岗位定制步骤" [ref=e149]:
                - button "1 匹配概览" [ref=e150] [cursor=pointer]
                - button "2 补充信息" [disabled] [ref=e151] [cursor=pointer]
                - button "3 改写建议" [disabled] [ref=e152] [cursor=pointer]
                - button "4 确认并应用" [disabled] [ref=e153] [cursor=pointer]
              - generic [ref=e154]:
                - generic [ref=e155]:
                  - generic [ref=e156]:
                    - text: 示例科技公司
                    - heading "数据分析实习生" [level=2] [ref=e157]
                    - paragraph [ref=e158]: 岗位适配度，不代表 ATS 通过率或录取概率
                  - strong [ref=e159]: "50"
                - generic "定制模式（原推荐改写力度）" [ref=e160]:
                  - text: 定制模式
                  - combobox "定制模式（原推荐改写力度）" [ref=e161]:
                    - option "稳健：只用已证明经历"
                    - option "竞争力：加入确认能力" [selected]
                    - option "最大匹配：补问岗位缺口"
                - generic [ref=e162]:
                  - generic [ref=e163]:
                    - generic [ref=e164]: 硬性条件
                    - strong [ref=e165]: "0"
                  - generic [ref=e166]:
                    - generic [ref=e167]: 核心能力
                    - strong [ref=e168]: "50"
                  - generic [ref=e169]:
                    - generic [ref=e170]: 职责匹配
                    - strong [ref=e171]: "50"
                  - generic [ref=e172]:
                    - generic [ref=e173]: 加分项
                    - strong [ref=e174]: "0"
                  - generic [ref=e175]:
                    - generic [ref=e176]: 关键词覆盖
                    - strong [ref=e177]: "80"
                - generic [ref=e178]:
                  - heading "你的优势" [level=3] [ref=e179]
                  - list [ref=e180]:
                    - listitem [ref=e181]: 暂未识别到可直接证明的岗位优势
                - generic [ref=e182]:
                  - heading "主要缺口" [level=3] [ref=e183]
                  - list [ref=e184]:
                    - listitem [ref=e185]: 暂未发现明显缺口
                - generic [ref=e186]:
                  - strong [ref=e187]: 当前策略
                  - paragraph [ref=e188]: 优先呈现已证明经历，并把用户确认的可迁移能力集中标为待确认项。
                - button "生成改写建议" [ref=e189] [cursor=pointer]:
                  - img [ref=e190]
                  - text: 生成改写建议
          - generic "拖动窗口" [ref=e193]:
            - img [ref=e194]
        - button "拖拽调整字段面板与 A4 预览宽度"
        - generic [ref=e205]:
          - generic [ref=e208]:
            - generic [ref=e209]: 第 1 页 / 共 1 页
            - article "A4 简历预览第 1 页" [ref=e210]:
              - generic [ref=e211]:
                - generic [ref=e212]:
                  - heading "同学" [level=1] [ref=e213]
                  - paragraph [ref=e214]: 数据分析实习生
                - generic [ref=e215]:
                  - generic [ref=e216]: 138****0000
                  - generic [ref=e217]: demo.student@example.com
                  - generic [ref=e218]: 杭州
              - generic [ref=e219]:
                - heading "自我评价" [level=2] [ref=e220]
                - paragraph [ref=e223]: 经济管理方向本科生，关注数据分析、AI应用和跨境业务流程。
              - generic [ref=e224]:
                - heading "奖项荣誉" [level=2] [ref=e225]
                - article [ref=e227]:
                  - generic [ref=e228]:
                    - heading "数据分析成员" [level=3] [ref=e229]
                    - strong [ref=e230]:
                      - generic [ref=e231]: 统计建模竞赛项目
                  - paragraph [ref=e232]: 使用 Stata 清洗 31 个省级样本，完成描述统计、相关分析与区域差异分析，形成论文与汇报材料。
                  - generic [ref=e233]:
                    - paragraph [ref=e234]:
                      - strong [ref=e235]: 原始资料草稿：
                      - text: 使用 Stata 清洗 31 个省级样本，完成描述统计、相关分析与区域差异分析，形成论文与汇报材料。
                    - paragraph [ref=e236]:
                      - strong [ref=e237]: 原始标签：
                      - text: Stata、数据清洗、统计分析
                    - paragraph [ref=e238]:
                      - strong [ref=e239]: 原始证据引用：
                      - text: evidence-stat-report
              - generic [ref=e240]:
                - heading "项目经历" [level=2] [ref=e241]
                - article [ref=e243]:
                  - generic [ref=e244]:
                    - heading "AI 求职应用课程项目" [level=3] [ref=e245]
                    - strong [ref=e246]:
                      - generic [ref=e247]: 产品与验收协作
                    - time [ref=e248]:
                      - generic [ref=e249]: "2025.09"
                      - generic [ref=e250]: –2025.12
                  - paragraph [ref=e251]: 参与 AI 应用项目需求梳理、原型设计和功能验收，协助将用户流程转化为可检查的功能清单。
                  - list [ref=e252]:
                    - listitem [ref=e253]: 参与 AI 应用项目的需求梳理、原型设计和功能验收。
                  - generic [ref=e254]:
                    - paragraph [ref=e255]:
                      - strong [ref=e256]: 原始资料草稿：
                      - text: 参与 AI 应用项目需求梳理、原型设计和功能验收，协助将用户流程转化为可检查的功能清单。
                    - paragraph [ref=e257]:
                      - strong [ref=e258]: 原始标签：
                      - text: 需求梳理、原型设计、功能验收
              - generic [ref=e259]:
                - heading "实习经历" [level=2] [ref=e260]
                - article [ref=e262]:
                  - generic [ref=e263]:
                    - heading "某政府部门" [level=3] [ref=e264]
                    - strong [ref=e265]:
                      - generic [ref=e266]: 综合事务实习生
                    - time [ref=e267]:
                      - generic [ref=e268]: "2025.07"
                      - generic [ref=e269]: –2025.08
                  - paragraph [ref=e270]: 协助处理公文流转与热线记录，保持信息记录准确、分类清晰。
                  - list [ref=e271]:
                    - listitem [ref=e272]: 处理公文流转和热线记录，关注记录准确性与信息整理。
                  - generic [ref=e273]:
                    - paragraph [ref=e274]:
                      - strong [ref=e275]: 原始资料草稿：
                      - text: 协助处理公文流转与热线记录，保持信息记录准确、分类清晰。
                    - paragraph [ref=e276]:
                      - strong [ref=e277]: 原始标签：
                      - text: 信息整理、沟通记录
              - generic [ref=e278]:
                - heading "其他内容" [level=2] [ref=e279]
                - article [ref=e281]:
                  - heading "外贸课程与语言学习" [level=3] [ref=e283]
                  - paragraph [ref=e284]: CET-4 601，了解基础外贸业务流程，具备英文资料阅读和流程信息整理基础。
                  - list [ref=e285]:
                    - listitem [ref=e286]: CET-4 成绩 601，了解基础外贸业务流程。
                  - generic [ref=e287]:
                    - paragraph [ref=e288]:
                      - strong [ref=e289]: 原始资料草稿：
                      - text: CET-4 601，了解基础外贸业务流程，具备英文资料阅读和流程信息整理基础。
                    - paragraph [ref=e290]:
                      - strong [ref=e291]: 原始标签：
                      - text: 英语、外贸流程、信息整理
              - generic [ref=e292]:
                - heading "专业技能" [level=2] [ref=e293]
                - generic [ref=e296]:
                  - generic [ref=e297]:
                    - generic [ref=e298]:
                      - strong [ref=e299]: Stata
                      - generic [ref=e300]: （familiar）
                    - generic [ref=e301]: 使用 Stata 完成数据清洗和统计分析。
                  - generic [ref=e302]:
                    - generic [ref=e303]:
                      - strong [ref=e304]: Excel
                      - generic [ref=e305]: （familiar）
                    - generic [ref=e306]: 能使用 Excel 整理表格数据和基础分析结果。
              - generic [ref=e307]:
                - heading "证书" [level=2] [ref=e308]
                - article [ref=e310]:
                  - generic [ref=e311]:
                    - heading "CET-4" [level=3] [ref=e312]
                    - strong [ref=e313]:
                      - generic [ref=e314]: 全国大学英语四、六级考试委员会
                    - time [ref=e315]:
                      - generic [ref=e316]: "2024.12"
          - generic "A4 预览工具":
            - generic: 1 页
            - group "画布缩放" [ref=e317]:
              - button "缩小预览" [ref=e318] [cursor=pointer]: "-"
              - generic [ref=e319]: 100%
              - button "放大预览" [ref=e320] [cursor=pointer]: +
              - button "适合宽度" [ref=e321] [cursor=pointer]
              - button "整页" [ref=e322] [cursor=pointer]
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
> 45 |     await panel.getByLabel("定制模式").selectOption(mode);
     |                                    ^ Error: locator.selectOption: Error: strict mode violation: getByTestId('job-optimization-panel').getByLabel('定制模式') resolved to 2 elements:
  46 |     await panel.getByRole("button", { name: /生成改写建议/ }).click();
  47 |     while (await panel.getByRole("button", { name: "没有使用过", exact: true }).isVisible().catch(() => false)) {
  48 |       await panel.getByRole("button", { name: "没有使用过", exact: true }).click();
  49 |       await panel.getByRole("button", { name: "提交回答", exact: true }).click();
  50 |     }
  51 |     const cards = panel.locator(".tailoring-suggestion-card");
  52 |     await expect(cards.first()).toBeVisible({ timeout: 60_000 });
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
  78 |   await panel.getByLabel("定制模式").selectOption("steady");
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