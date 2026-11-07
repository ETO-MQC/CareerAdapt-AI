# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-a2-structured.spec.ts >> UX013 A2 four structured operations reviewed committed and refreshed with durable user source
- Location: tests\e2e\ux013-a2-structured.spec.ts:12:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: '编辑 SQL', exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('button', { name: '编辑 SQL', exact: true })

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
  - heading "个人资料库" [level=1]
  - text: A2匿名候选人 · 1 条经历 · 2 项基础信息 · 本地已保存
  - region "当前人物与版本":
    - strong: A2匿名候选人
    - text: V1 当前 创建于 2026/11/06 1 条经历 · 2 项基础信息
    - button "管理人物与版本"
    - button "导入资料"
    - button "导出 JSON"
    - group
  - article:
    - heading "资料分类" [level=2]
    - text: 本地已保存
    - listbox "资料分类":
      - button "基本信息 当前人物的基础资料 1":
        - strong: 基本信息
        - text: 当前人物的基础资料 1
      - button "自我评价 当前人物的基础资料 0":
        - strong: 自我评价
        - text: 当前人物的基础资料 0
      - button "教育经历 可复用的已确认资料 0":
        - strong: 教育经历
        - text: 可复用的已确认资料 0
      - button "工作经历 可复用的已确认资料 0":
        - strong: 工作经历
        - text: 可复用的已确认资料 0
      - button "实习经历 可复用的已确认资料 0":
        - strong: 实习经历
        - text: 可复用的已确认资料 0
      - button "项目经历 可复用的已确认资料 1":
        - strong: 项目经历
        - text: 可复用的已确认资料 1
      - button "科研经历 可复用的已确认资料 0":
        - strong: 科研经历
        - text: 可复用的已确认资料 0
      - button "校园经历 可复用的已确认资料 0":
        - strong: 校园经历
        - text: 可复用的已确认资料 0
      - button "志愿经历 可复用的已确认资料 0":
        - strong: 志愿经历
        - text: 可复用的已确认资料 0
      - button "培训经历 可复用的已确认资料 0":
        - strong: 培训经历
        - text: 可复用的已确认资料 0
      - button "奖项荣誉 可复用的已确认资料 0":
        - strong: 奖项荣誉
        - text: 可复用的已确认资料 0
      - button "专业技能 可复用的已确认资料 0":
        - strong: 专业技能
        - text: 可复用的已确认资料 0
      - button "证书 可复用的已确认资料 0":
        - strong: 证书
        - text: 可复用的已确认资料 0
      - button "语言能力 可复用的已确认资料 0":
        - strong: 语言能力
        - text: 可复用的已确认资料 0
      - button "论文与出版物 可复用的已确认资料 0":
        - strong: 论文与出版物
        - text: 可复用的已确认资料 0
      - button "专利 可复用的已确认资料 0":
        - strong: 专利
        - text: 可复用的已确认资料 0
      - button "作品集 可复用的已确认资料 0":
        - strong: 作品集
        - text: 可复用的已确认资料 0
      - button "其他内容 可复用的已确认资料 0":
        - strong: 其他内容
        - text: 可复用的已确认资料 0
      - button "自定义栏目 可复用的已确认资料 0":
        - strong: 自定义栏目
        - text: 可复用的已确认资料 0
  - article:
    - heading "专业技能" [level=2]
    - button "新增"
    - button "批量删除"
    - text: 搜索
    - textbox "搜索":
      - /placeholder: 按名称、来源或内容筛选
    - text: 使用状态
    - combobox "使用状态":
      - option "全部当前条目" [selected]
      - option "已被使用"
      - option "未被使用"
      - option "已归档"
    - strong: 当前筛选下没有条目
    - paragraph: 可以新建当前分类条目，或切换到已归档筛选恢复内容。
  - article:
    - heading "详情" [level=2]
    - paragraph: 查看来源、使用状态和可编辑字段。
    - strong: 请选择一个条目
    - paragraph: 左侧切换分类，中间选择条目后在这里查看或编辑。
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
  37  |   // Add a confirmed skill through the actual Profile editor after the source Branch has been created.
  38  |   // This keeps Profile and Branch intentionally different without writing business fixtures into IndexedDB.
  39  |   await page.goto("/profile");
  40  |   await page.locator('[data-profile-category="skill"]').click();
  41  |   await page.getByRole("button", { name: "新增", exact: true }).click();
  42  |   await page.locator("#profile-skill-title").fill("SQL");
  43  |   await page.getByLabel("使用场景或能力说明", { exact: true }).fill("使用 SQL 执行查询验证。");
  44  |   await page.getByRole("button", { name: "保存", exact: true }).click();
> 45  |   await expect(page.getByRole("button", { name: "编辑 SQL", exact: true })).toBeVisible();
      |                                                                           ^ Error: expect(locator).toBeVisible() failed
  46  |   const initial = await formal(page);
  47  |   const branch = initial.branches.find(b => b.branchPurpose === "general") as unknown as ResumeBranch;
  48  |   expect(branch).toBeTruthy();
  49  |   await page.goto("/ai-workspace"); await page.getByRole("button", { name: "新任务", exact: true }).click();
  50  |   const panel = page.getByTestId("structured-resume-editor"); await panel.locator("summary").first().click();
  51  |   await mkdir(evidenceDir, { recursive: true });
  52  |   const operations = ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"];
  53  |   let factRevisionId = "";
  54  |   for (const operation of operations) {
  55  |     if (operation !== operations[0]) await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  56  |     await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  57  |     await panel.getByLabel("结构化操作", { exact: true }).selectOption(operation);
  58  |     const target = panel.getByLabel("结构化修改目标", { exact: true });
  59  |     const options = await target.locator("option").allTextContents();
  60  |     const index = operation === "fact_correction" ? options.findIndex(t => t.includes("项目名称"))
  61  |       : operation === "bullet_removal" ? options.findIndex(t => t.includes("要点 3")) : 1;
  62  |     expect(index).toBeGreaterThan(0); await target.selectOption({ index });
  63  |     if (operation === "fact_correction") await panel.getByLabel("我的纠正内容", { exact: true }).fill("用户更正的新项目名称");
  64  |     if (operation === "bullet_reordering") await panel.getByLabel("要点新顺序", { exact: true }).fill("2,1");
  65  |     const before = await formal(page);
  66  |     await panel.getByRole("button", { name: "生成结构化审核提案", exact: true }).click();
  67  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  68  |     expect((await formal(page)).revisions).toEqual(before.revisions);
  69  |     await page.reload(); await panel.locator("summary").first().click();
  70  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  71  |     await page.setViewportSize({ width: 1024, height: 900 });
  72  |     const confirm = panel.getByRole("button", { name: "确认结构化修改", exact: true });
  73  |     await expect(confirm).toBeVisible();
  74  |     await page.screenshot({ path: info.outputPath(`${operation}-review-1024.png`), fullPage: true });
  75  |     await page.setViewportSize({ width: 1440, height: 1000 });
  76  |     await page.screenshot({ path: info.outputPath(`${operation}-review-wide.png`), fullPage: true });
  77  |     await confirm.click();
  78  |     await expect(panel.getByText(/已保存版本：/)).toBeVisible();
  79  |     const after = await formal(page), changed = after.branches.find(b => b.id === branch.id) as unknown as ResumeBranch;
  80  |     const revisionId = changed.currentRevisionId!;
  81  |     if (operation === "fact_correction") factRevisionId = revisionId;
  82  |     expect(after.profiles).toEqual(before.profiles);
  83  |     expect(after.branches.filter(b => b.id !== branch.id)).toEqual(before.branches.filter(b => b.id !== branch.id));
  84  |     expect(after.revisions).toHaveLength(before.revisions.length + 1);
  85  |     expect(after.revisions.filter(r => r.id !== revisionId)).toEqual(before.revisions);
  86  |     const original = (before.branches.find(b => b.id === branch.id) as unknown as ResumeBranch), expected = structuredClone(original);
  87  |     const project = expected.structuredContentItems!.find(i => i.data.sectionType === "project")!;
  88  |     if (operation === "confirmed_skill_addition") {
  89  |       expect(changed.structuredContentItems!.slice(0, -1)).toEqual(expected.structuredContentItems);
  90  |       expect(changed.contentItems.slice(0, -1)).toEqual(expected.contentItems);
  91  |     } else {
  92  |       const next = changed.structuredContentItems!.find(i => i.id === project.id)!;
  93  |       expect(changed.structuredContentItems!.filter(i => i.id !== project.id)).toEqual(expected.structuredContentItems!.filter(i => i.id !== project.id));
  94  |       expect(changed.contentItems.filter(i => i.id !== project.id)).toEqual(expected.contentItems.filter(i => i.id !== project.id));
  95  |       expect(next.data).toEqual({ ...project.data, ...(operation === "fact_correction" ? { title: "用户更正的新项目名称" }
  96  |         : { highlights: operation === "bullet_removal" ? ["执行接口测试。", "SQL 查询验证。"] : ["SQL 查询验证。", "执行接口测试。"] }) });
  97  |       expect(next.factRefs).toEqual(project.factRefs);
  98  |     }
  99  |     expect(changed).toEqual({ ...original, structuredContentItems: changed.structuredContentItems, contentItems: changed.contentItems,
  100 |       revision: original.revision + 1, currentRevisionId: revisionId, updatedAt: changed.updatedAt });
  101 |     const receipt = after.operations.find(r => r.revisionId === revisionId); expect(receipt).toBeTruthy();
  102 |     await page.reload(); await panel.locator("summary").first().click();
  103 |     await expect(panel.getByText(`已保存版本：${revisionId}`, { exact: true })).toBeVisible();
  104 |     expect((await formal(page)).revisions).toEqual(after.revisions);
  105 |     await writeFile(`${evidenceDir}/${operation}.json`, JSON.stringify({ before, after, receipt }, null, 2));
  106 |     if (operation === "confirmed_skill_addition") {
  107 |       await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  108 |       await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  109 |       await panel.getByLabel("结构化操作", { exact: true }).selectOption("confirmed_skill_addition");
  110 |       await expect(panel.getByLabel("结构化修改目标", { exact: true }).locator("option").filter({ hasText: "SQL（已存在）" })).toBeDisabled();
  111 |       // A reload restores the saved authoritative outcome; no new task has been selected or committed.
  112 |       await page.reload(); await panel.locator("summary").first().click();
  113 |     }
  114 |   }
  115 |   // The first correction remains traceable after three subsequent tasks replaced its TaskState proposal.
  116 |   await page.goto(`/resume?branchId=${encodeURIComponent(branch.id)}`);
  117 |   await page.locator("details.toolbar-more > summary").click();
  118 |   await page.getByText("查询版本操作来源", { exact: true }).click();
  119 |   await page.getByLabel("历史版本来源", { exact: true }).selectOption(factRevisionId);
  120 |   const historical = page.getByTestId("precise-revision-evidence"); await historical.locator("summary").click();
  121 |   await expect(historical.getByText("原始纠正声明：用户更正的新项目名称", { exact: true })).toBeVisible();
  122 |   await page.screenshot({ path: info.outputPath("historical-source.png"), fullPage: true });
  123 |   expect((await formal(page)).profiles).toEqual(initial.profiles);
  124 |   expect(providerCalls).toBe(0);
  125 |   await writeFile(`${evidenceDir}/summary.json`, JSON.stringify({ operations, factRevisionId, providerCalls, final: await formal(page) }, null, 2));
  126 | });
  127 | 
```