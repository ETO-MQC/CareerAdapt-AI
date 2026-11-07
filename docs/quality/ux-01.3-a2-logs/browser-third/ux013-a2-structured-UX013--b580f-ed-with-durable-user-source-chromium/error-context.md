# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-a2-structured.spec.ts >> UX013 A2 four structured operations reviewed committed and refreshed with durable user source
- Location: tests\e2e\ux013-a2-structured.spec.ts:12:5

# Error details

```
TimeoutError: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('details.toolbar-more > summary')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - alert [ref=e2]
  - generic [ref=e3]:
    - complementary "AI 工作区导航" [ref=e4]:
      - generic [ref=e5]:
        - link "职适AI 首页" [ref=e6] [cursor=pointer]:
          - /url: /
          - generic [ref=e7]: 职
          - generic [ref=e8]: 职适AI
        - button "收起 AI 导航" [ref=e9] [cursor=pointer]:
          - img [ref=e10]
      - generic [ref=e13]:
        - button "新任务" [ref=e14] [cursor=pointer]:
          - img [ref=e15]
          - generic [ref=e16]: 新任务
        - button "搜索 / 历史" [ref=e17] [cursor=pointer]:
          - img [ref=e18]
          - generic [ref=e21]: 搜索 / 历史
      - navigation "资产" [ref=e22]:
        - generic [ref=e23]: 资产
        - link "AI 助手" [ref=e24] [cursor=pointer]:
          - /url: /ai-workspace
          - img [ref=e25]
          - generic [ref=e28]: AI 助手
        - link "我的简历" [ref=e29] [cursor=pointer]:
          - /url: /resume
          - img [ref=e30]
          - generic [ref=e33]: 我的简历
        - link "个人资料库" [ref=e34] [cursor=pointer]:
          - /url: /profile
          - img [ref=e35]
          - generic [ref=e38]: 个人资料库
        - link "岗位" [ref=e39] [cursor=pointer]:
          - /url: /jobs
          - img [ref=e40]
          - generic [ref=e44]: 岗位
        - link "求职进度" [ref=e45] [cursor=pointer]:
          - /url: /applications
          - img [ref=e46]
          - generic [ref=e48]: 求职进度
        - link "回收站" [ref=e49] [cursor=pointer]:
          - /url: /recycle
          - img [ref=e50]
          - generic [ref=e57]: 回收站
      - region "最近任务" [ref=e58]:
        - text: 最近任务
        - paragraph [ref=e59]: 完成第一条任务后会显示在这里。
      - generic [ref=e60]:
        - generic "工作区模式" [ref=e61]:
          - button "AI" [pressed] [ref=e62] [cursor=pointer]:
            - generic [ref=e63]: AI
          - button "协作" [ref=e64] [cursor=pointer]:
            - generic [ref=e65]: 协作
          - button "手动" [ref=e66] [cursor=pointer]:
            - generic [ref=e67]: 手动
        - link "设置与更多" [ref=e68] [cursor=pointer]:
          - /url: /settings
          - img [ref=e69]
          - generic [ref=e72]: 设置与更多
        - generic [ref=e73]:
          - generic [ref=e74]: CA
          - generic [ref=e75]:
            - strong [ref=e76]: 求职工作区
            - generic [ref=e77]: 本地数据
    - main [ref=e80]:
      - generic [ref=e82]:
        - heading "我的简历" [level=1] [ref=e83]
        - generic [ref=e84]: 1 份当前简历 · 1 条经历 · 2 项基础信息
      - region "当前人物与版本" [ref=e85]:
        - generic [ref=e86]:
          - generic [ref=e87]: A
          - generic [ref=e88]:
            - generic [ref=e89]:
              - strong [ref=e90]: A2匿名候选人
              - generic [ref=e91]: V1
              - generic [ref=e92]: 当前
            - generic [ref=e93]:
              - generic [ref=e94]: 创建于 2026/11/06
              - generic [ref=e95]: 1 条经历 · 2 项基础信息
              - generic [ref=e96]: 1 份简历
        - generic [ref=e97]:
          - button "管理人物与版本" [ref=e98] [cursor=pointer]:
            - img [ref=e99]
            - text: 管理人物与版本
          - group [ref=e102]:
            - generic "更多人物与版本操作" [ref=e103] [cursor=pointer]:
              - img [ref=e104]
      - generic [ref=e108]:
        - article [ref=e109]:
          - generic [ref=e110]:
            - button "导入已有简历 核对来源后创建通用简历" [ref=e111] [cursor=pointer]:
              - strong [ref=e112]: 导入已有简历
              - generic [ref=e113]: 核对来源后创建通用简历
            - button "根据岗位创建 需要先在岗位工作区生成草稿" [disabled] [ref=e114]:
              - strong [ref=e115]: 根据岗位创建
              - generic [ref=e116]: 需要先在岗位工作区生成草稿
            - button "从个人资料库创建 复制已确认信息，之后由你决定是否再次同步" [ref=e117] [cursor=pointer]:
              - strong [ref=e118]: 从个人资料库创建
              - generic [ref=e119]: 复制已确认信息，之后由你决定是否再次同步
            - button "从零创建 不带入资料库内容，从空白字段开始" [ref=e120] [cursor=pointer]:
              - strong [ref=e121]: 从零创建
              - generic [ref=e122]: 不带入资料库内容，从空白字段开始
            - button "导入资料 证书、奖项、成绩单与经历证明" [ref=e123] [cursor=pointer]:
              - strong [ref=e124]: 导入资料
              - generic [ref=e125]: 证书、奖项、成绩单与经历证明
        - article [ref=e126]:
          - generic [ref=e127]:
            - heading "简历中心" [level=2] [ref=e128]
            - generic [ref=e129]: （1 份当前简历 / 0 份已归档 / 0 份在回收站）
          - tablist "简历筛选" [ref=e130]:
            - tab "最近 1" [selected] [ref=e131] [cursor=pointer]
            - tab "全部 1" [ref=e132] [cursor=pointer]
            - tab "通用 1" [ref=e133] [cursor=pointer]
            - tab "岗位 0" [ref=e134] [cursor=pointer]
            - tab "归档 0" [ref=e135] [cursor=pointer]
            - tab "回收站 0" [ref=e136] [cursor=pointer]
          - article [ref=e138] [cursor=pointer]:
            - button "通用简历 通用简历 · 可编辑 更新于 11/06 23:06" [ref=e139]:
              - strong [ref=e140]:
                - img [ref=e141]
                - text: 通用简历
              - generic "已同步" [ref=e144]: 通用简历 · 可编辑
              - generic [ref=e145]: 更新于 11/06 23:06
            - generic [ref=e146]:
              - button "打开" [ref=e147]
              - button "导出" [ref=e148]
              - group [ref=e149]:
                - generic "更多" [ref=e150]
  - region "操作通知"
```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | import { readStore } from "./support/p51CoreWorkflow";
  3   | import { mkdir, writeFile } from "node:fs/promises";
  4   | import type { ResumeBranch } from "@/domain/schemas";
  5   | 
  6   | test.use({ trace: "on", screenshot: "only-on-failure" });
  7   | const evidenceDir = process.env.UX013_A2_BROWSER_EVIDENCE_DIR ?? "docs/quality/ux-01.3-a2-logs/browser";
  8   | async function formal(page: Page) {
  9   |   return { profiles: await readStore(page, "profiles"), branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions"),
  10  |     operations: await readStore(page, "resumeBranchOperations"), appMeta: await readStore(page, "appMeta") };
  11  | }
  12  | test("UX013 A2 four structured operations reviewed committed and refreshed with durable user source", async ({ page }, info) => {
  13  |   test.setTimeout(180_000);
  14  |   page.setDefaultTimeout(15_000);
  15  |   // The direct user-input route exercises production Facade/Gateway without an upstream model call.
  16  |   // Any accidental provider request fails the test, instead of falling through to a real configured provider.
  17  |   let providerCalls = 0;
  18  |   await page.route("**/api/ai/**", route => { providerCalls++; return route.abort(); });
  19  |   await page.goto("/setup");
  20  |   await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
  21  |   await page.goto("/resume");
  22  |   await page.getByRole("button", { name: /导入已有简历/ }).click();
  23  |   const dialog = page.getByRole("dialog", { name: "导入简历" });
  24  |   await dialog.getByText("粘贴 JSON", { exact: true }).click();
  25  |   await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
  26  |     basics: { name: "A2匿名候选人", email: "a2@example.org", portfolioLinks: [], otherLinks: [], customFields: [] },
  27  |     sections: [{ id: "project", sectionType: "project", title: "项目经历", order: 0, visible: true, items: [{ id: "a2-project", sectionType: "project",
  28  |       title: "原项目名称", role: "项目成员", startDate: "2025-01", endDate: "2025-06", current: false,
  29  |       description: "参与接口测试。", highlights: ["执行接口测试。", "SQL 查询验证。", "执行接口测试。"], tools: [], outcomes: [], customFields: [] }] }], unclassifiedBlocks: [] }));
  30  |   await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  31  |   await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
  32  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  33  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  34  |   await dialog.locator(".import-review-footer button.primary-button").click();
  35  |   const open = page.getByRole("button", { name: "打开", exact: true }); if (await open.isVisible()) await open.click();
  36  |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  37  |   // Official confirmed import adds Profile skills without updating the existing Resume Branch.
  38  |   await page.goto("/resume");
> 39  |   await page.locator("details.toolbar-more > summary").click();
      |                                                        ^ TimeoutError: locator.click: Timeout 15000ms exceeded.
  40  |   await page.getByTestId("open-resume-import").click();
  41  |   await dialog.getByText("粘贴 JSON", { exact: true }).click();
  42  |   await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
  43  |     basics: { name: "A2匿名候选人", portfolioLinks: [], otherLinks: [], customFields: [] },
  44  |     sections: [{ id: "skills", sectionType: "skills", title: "专业技能", order: 0, visible: true,
  45  |       items: [{ id: "a2-sql", sectionType: "skills", name: "SQL", description: "使用 SQL 执行查询验证。", customFields: [] }] }], unclassifiedBlocks: [] }));
  46  |   await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  47  |   await dialog.locator("label.import-target-option").filter({ hasText: "导入到已有资料" }).click();
  48  |   await dialog.locator('input[name="import-create-general-resume"]').uncheck();
  49  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  50  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  51  |   await dialog.locator(".import-review-footer button.primary-button").click();
  52  |   await expect.poll(async () => (await readStore(page, "profiles")).some(p => (p.skills as Array<{ name: string }>).some(s => s.name === "SQL"))).toBe(true);
  53  |   const initial = await formal(page);
  54  |   const branch = initial.branches.find(b => b.branchPurpose === "general") as unknown as ResumeBranch;
  55  |   expect(branch).toBeTruthy();
  56  |   await page.goto("/ai-workspace"); await page.getByRole("button", { name: "新任务", exact: true }).click();
  57  |   const panel = page.getByTestId("structured-resume-editor"); await panel.locator("summary").first().click();
  58  |   await mkdir(evidenceDir, { recursive: true });
  59  |   const operations = ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"];
  60  |   let factRevisionId = "";
  61  |   for (const operation of operations) {
  62  |     if (operation !== operations[0]) await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  63  |     await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  64  |     await panel.getByLabel("结构化操作", { exact: true }).selectOption(operation);
  65  |     const target = panel.getByLabel("结构化修改目标", { exact: true });
  66  |     const options = await target.locator("option").allTextContents();
  67  |     const index = operation === "fact_correction" ? options.findIndex(t => t.includes("项目名称"))
  68  |       : operation === "bullet_removal" ? options.findIndex(t => t.includes("要点 3")) : 1;
  69  |     expect(index).toBeGreaterThan(0); await target.selectOption({ index });
  70  |     if (operation === "fact_correction") await panel.getByLabel("我的纠正内容", { exact: true }).fill("用户更正的新项目名称");
  71  |     if (operation === "bullet_reordering") await panel.getByLabel("要点新顺序", { exact: true }).fill("2,1");
  72  |     const before = await formal(page);
  73  |     await panel.getByRole("button", { name: "生成结构化审核提案", exact: true }).click();
  74  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  75  |     expect((await formal(page)).revisions).toEqual(before.revisions);
  76  |     await page.reload(); await panel.locator("summary").first().click();
  77  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  78  |     await page.setViewportSize({ width: 1024, height: 900 });
  79  |     const confirm = panel.getByRole("button", { name: "确认结构化修改", exact: true });
  80  |     await expect(confirm).toBeVisible();
  81  |     await page.screenshot({ path: info.outputPath(`${operation}-review-1024.png`), fullPage: true });
  82  |     await page.setViewportSize({ width: 1440, height: 1000 });
  83  |     await page.screenshot({ path: info.outputPath(`${operation}-review-wide.png`), fullPage: true });
  84  |     await confirm.click();
  85  |     await expect(panel.getByText(/已保存版本：/)).toBeVisible();
  86  |     const after = await formal(page), changed = after.branches.find(b => b.id === branch.id) as unknown as ResumeBranch;
  87  |     const revisionId = changed.currentRevisionId!;
  88  |     if (operation === "fact_correction") factRevisionId = revisionId;
  89  |     expect(after.profiles).toEqual(before.profiles);
  90  |     expect(after.branches.filter(b => b.id !== branch.id)).toEqual(before.branches.filter(b => b.id !== branch.id));
  91  |     expect(after.revisions).toHaveLength(before.revisions.length + 1);
  92  |     expect(after.revisions.filter(r => r.id !== revisionId)).toEqual(before.revisions);
  93  |     const original = (before.branches.find(b => b.id === branch.id) as unknown as ResumeBranch), expected = structuredClone(original);
  94  |     const project = expected.structuredContentItems!.find(i => i.data.sectionType === "project")!;
  95  |     if (operation === "confirmed_skill_addition") {
  96  |       expect(changed.structuredContentItems!.slice(0, -1)).toEqual(expected.structuredContentItems);
  97  |       expect(changed.contentItems.slice(0, -1)).toEqual(expected.contentItems);
  98  |     } else {
  99  |       const next = changed.structuredContentItems!.find(i => i.id === project.id)!;
  100 |       expect(changed.structuredContentItems!.filter(i => i.id !== project.id)).toEqual(expected.structuredContentItems!.filter(i => i.id !== project.id));
  101 |       expect(changed.contentItems.filter(i => i.id !== project.id)).toEqual(expected.contentItems.filter(i => i.id !== project.id));
  102 |       expect(next.data).toEqual({ ...project.data, ...(operation === "fact_correction" ? { title: "用户更正的新项目名称" }
  103 |         : { highlights: operation === "bullet_removal" ? ["执行接口测试。", "SQL 查询验证。"] : ["SQL 查询验证。", "执行接口测试。"] }) });
  104 |       expect(next.factRefs).toEqual(project.factRefs);
  105 |     }
  106 |     expect(changed).toEqual({ ...original, structuredContentItems: changed.structuredContentItems, contentItems: changed.contentItems,
  107 |       revision: original.revision + 1, currentRevisionId: revisionId, updatedAt: changed.updatedAt });
  108 |     const receipt = after.operations.find(r => r.revisionId === revisionId); expect(receipt).toBeTruthy();
  109 |     await page.reload(); await panel.locator("summary").first().click();
  110 |     await expect(panel.getByText(`已保存版本：${revisionId}`, { exact: true })).toBeVisible();
  111 |     expect((await formal(page)).revisions).toEqual(after.revisions);
  112 |     await writeFile(`${evidenceDir}/${operation}.json`, JSON.stringify({ before, after, receipt }, null, 2));
  113 |     if (operation === "confirmed_skill_addition") {
  114 |       await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  115 |       await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  116 |       await panel.getByLabel("结构化操作", { exact: true }).selectOption("confirmed_skill_addition");
  117 |       await expect(panel.getByLabel("结构化修改目标", { exact: true }).locator("option").filter({ hasText: "SQL（已存在）" })).toBeDisabled();
  118 |       // A reload restores the saved authoritative outcome; no new task has been selected or committed.
  119 |       await page.reload(); await panel.locator("summary").first().click();
  120 |     }
  121 |   }
  122 |   // The first correction remains traceable after three subsequent tasks replaced its TaskState proposal.
  123 |   await page.goto(`/resume?branchId=${encodeURIComponent(branch.id)}`);
  124 |   await page.locator("details.toolbar-more > summary").click();
  125 |   await page.getByText("查询版本操作来源", { exact: true }).click();
  126 |   await page.getByLabel("历史版本来源", { exact: true }).selectOption(factRevisionId);
  127 |   const historical = page.getByTestId("precise-revision-evidence"); await historical.locator("summary").click();
  128 |   await expect(historical.getByText("原始纠正声明：用户更正的新项目名称", { exact: true })).toBeVisible();
  129 |   await page.screenshot({ path: info.outputPath("historical-source.png"), fullPage: true });
  130 |   expect((await formal(page)).profiles).toEqual(initial.profiles);
  131 |   expect(providerCalls).toBe(0);
  132 |   await writeFile(`${evidenceDir}/summary.json`, JSON.stringify({ operations, factRevisionId, providerCalls, final: await formal(page) }, null, 2));
  133 | });
  134 | 
```