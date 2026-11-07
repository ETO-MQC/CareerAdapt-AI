# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-a2-structured.spec.ts >> UX013 A2 four structured operations reviewed committed and refreshed with durable user source
- Location: tests\e2e\ux013-a2-structured.spec.ts:11:5

# Error details

```
Test timeout of 180000ms exceeded.
```

```
Error: locator.fill: Test timeout of 180000ms exceeded.
Call log:
  - waiting for getByLabel('技能名称', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
        - heading "个人资料库" [level=1] [ref=e83]
        - generic [ref=e84]: A2匿名候选人 · 1 条经历 · 2 项基础信息 · 本地已保存
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
        - generic [ref=e96]:
          - button "管理人物与版本" [ref=e97] [cursor=pointer]:
            - img [ref=e98]
            - text: 管理人物与版本
          - button "导入资料" [ref=e101] [cursor=pointer]:
            - img [ref=e102]
            - text: 导入资料
          - button "导出 JSON" [ref=e105] [cursor=pointer]:
            - img [ref=e106]
            - text: 导出 JSON
          - group [ref=e109]:
            - generic "更多人物与版本操作" [ref=e110] [cursor=pointer]:
              - img [ref=e111]
      - generic [ref=e115]:
        - article [ref=e116]:
          - generic [ref=e117]:
            - heading "资料分类" [level=2] [ref=e119]
            - generic [ref=e121]: 本地已保存
          - listbox "资料分类" [ref=e122]:
            - button "基本信息 当前人物的基础资料 1" [ref=e123] [cursor=pointer]:
              - img [ref=e125]
              - generic [ref=e128]:
                - strong [ref=e129]: 基本信息
                - generic [ref=e130]: 当前人物的基础资料
              - generic [ref=e131]: "1"
            - button "自我评价 当前人物的基础资料 0" [ref=e132] [cursor=pointer]:
              - img [ref=e134]
              - generic [ref=e136]:
                - strong [ref=e137]: 自我评价
                - generic [ref=e138]: 当前人物的基础资料
              - generic [ref=e139]: "0"
            - button "教育经历 可复用的已确认资料 0" [ref=e140] [cursor=pointer]:
              - img [ref=e142]
              - generic [ref=e145]:
                - strong [ref=e146]: 教育经历
                - generic [ref=e147]: 可复用的已确认资料
              - generic [ref=e148]: "0"
            - button "工作经历 可复用的已确认资料 0" [ref=e149] [cursor=pointer]:
              - img [ref=e151]
              - generic [ref=e154]:
                - strong [ref=e155]: 工作经历
                - generic [ref=e156]: 可复用的已确认资料
              - generic [ref=e157]: "0"
            - button "实习经历 可复用的已确认资料 0" [ref=e158] [cursor=pointer]:
              - img [ref=e160]
              - generic [ref=e163]:
                - strong [ref=e164]: 实习经历
                - generic [ref=e165]: 可复用的已确认资料
              - generic [ref=e166]: "0"
            - button "项目经历 可复用的已确认资料 1" [ref=e167] [cursor=pointer]:
              - img [ref=e169]
              - generic [ref=e171]:
                - strong [ref=e172]: 项目经历
                - generic [ref=e173]: 可复用的已确认资料
              - generic [ref=e174]: "1"
            - button "科研经历 可复用的已确认资料 0" [ref=e175] [cursor=pointer]:
              - img [ref=e177]
              - generic [ref=e179]:
                - strong [ref=e180]: 科研经历
                - generic [ref=e181]: 可复用的已确认资料
              - generic [ref=e182]: "0"
            - button "校园经历 可复用的已确认资料 0" [ref=e183] [cursor=pointer]:
              - img [ref=e185]
              - generic [ref=e190]:
                - strong [ref=e191]: 校园经历
                - generic [ref=e192]: 可复用的已确认资料
              - generic [ref=e193]: "0"
            - button "志愿经历 可复用的已确认资料 0" [ref=e194] [cursor=pointer]:
              - img [ref=e196]
              - generic [ref=e198]:
                - strong [ref=e199]: 志愿经历
                - generic [ref=e200]: 可复用的已确认资料
              - generic [ref=e201]: "0"
            - button "培训经历 可复用的已确认资料 0" [ref=e202] [cursor=pointer]:
              - img [ref=e204]
              - generic [ref=e207]:
                - strong [ref=e208]: 培训经历
                - generic [ref=e209]: 可复用的已确认资料
              - generic [ref=e210]: "0"
            - button "奖项荣誉 可复用的已确认资料 0" [ref=e211] [cursor=pointer]:
              - img [ref=e213]
              - generic [ref=e216]:
                - strong [ref=e217]: 奖项荣誉
                - generic [ref=e218]: 可复用的已确认资料
              - generic [ref=e219]: "0"
            - button "专业技能 可复用的已确认资料 0" [ref=e220] [cursor=pointer]:
              - img [ref=e222]
              - generic [ref=e224]:
                - strong [ref=e225]: 专业技能
                - generic [ref=e226]: 可复用的已确认资料
              - generic [ref=e227]: "0"
            - button "证书 可复用的已确认资料 0" [ref=e228] [cursor=pointer]:
              - img [ref=e230]
              - generic [ref=e233]:
                - strong [ref=e234]: 证书
                - generic [ref=e235]: 可复用的已确认资料
              - generic [ref=e236]: "0"
            - button "语言能力 可复用的已确认资料 0" [ref=e237] [cursor=pointer]:
              - img [ref=e239]
              - generic [ref=e243]:
                - strong [ref=e244]: 语言能力
                - generic [ref=e245]: 可复用的已确认资料
              - generic [ref=e246]: "0"
            - button "论文与出版物 可复用的已确认资料 0" [ref=e247] [cursor=pointer]:
              - img [ref=e249]
              - generic [ref=e251]:
                - strong [ref=e252]: 论文与出版物
                - generic [ref=e253]: 可复用的已确认资料
              - generic [ref=e254]: "0"
            - button "专利 可复用的已确认资料 0" [ref=e255] [cursor=pointer]:
              - img [ref=e257]
              - generic [ref=e260]:
                - strong [ref=e261]: 专利
                - generic [ref=e262]: 可复用的已确认资料
              - generic [ref=e263]: "0"
            - button "作品集 可复用的已确认资料 0" [ref=e264] [cursor=pointer]:
              - img [ref=e266]
              - generic [ref=e268]:
                - strong [ref=e269]: 作品集
                - generic [ref=e270]: 可复用的已确认资料
              - generic [ref=e271]: "0"
            - button "其他内容 可复用的已确认资料 0" [ref=e272] [cursor=pointer]:
              - img [ref=e274]
              - generic [ref=e278]:
                - strong [ref=e279]: 其他内容
                - generic [ref=e280]: 可复用的已确认资料
              - generic [ref=e281]: "0"
            - button "自定义栏目 可复用的已确认资料 0" [ref=e282] [cursor=pointer]:
              - img [ref=e284]
              - generic [ref=e285]:
                - strong [ref=e286]: 自定义栏目
                - generic [ref=e287]: 可复用的已确认资料
              - generic [ref=e288]: "0"
        - article [ref=e289]:
          - generic [ref=e290]:
            - heading "专业技能" [level=2] [ref=e292]
            - generic [ref=e293]:
              - button "新增" [active] [ref=e294] [cursor=pointer]
              - button "批量删除" [ref=e295] [cursor=pointer]
          - generic [ref=e296]:
            - generic [ref=e297]:
              - generic [ref=e298]: 搜索
              - img
              - textbox "搜索" [ref=e299]:
                - /placeholder: 按名称、来源或内容筛选
            - generic [ref=e300]:
              - text: 使用状态
              - combobox "使用状态" [ref=e301]:
                - option "全部当前条目" [selected]
                - option "已被使用"
                - option "未被使用"
                - option "已归档"
          - generic [ref=e303]:
            - strong [ref=e304]: 当前筛选下没有条目
            - paragraph [ref=e305]: 可以新建当前分类条目，或切换到已归档筛选恢复内容。
        - article [ref=e306]:
          - generic [ref=e308]:
            - heading "详情" [level=2] [ref=e309]
            - paragraph [ref=e310]: 查看来源、使用状态和可编辑字段。
          - generic [ref=e311]:
            - generic [ref=e312]:
              - generic [ref=e313]:
                - generic [ref=e314]:
                  - generic [ref=e315]:
                    - text: 技能名称
                    - generic "必填" [ref=e316]: "*"
                  - generic [ref=e317]:
                    - textbox "技能名称 必填" [ref=e319]
                    - toolbar "字段工具：技能名称":
                      - button "删除字段内容：技能名称":
                        - img
                - generic [ref=e320]:
                  - generic [ref=e321]: 技能方向
                  - generic [ref=e322]:
                    - textbox "技能方向" [ref=e324]
                    - toolbar "字段工具：技能方向":
                      - button "删除字段内容：技能方向":
                        - img
              - generic [ref=e325]:
                - generic [ref=e326]: 熟练度
                - combobox "熟练度" [ref=e327]:
                  - option "了解"
                  - option "熟悉" [selected]
                  - option "熟练"
              - generic [ref=e328]:
                - generic [ref=e329]: 使用场景或能力说明
                - textbox "使用场景或能力说明" [ref=e330]
            - generic [ref=e331]:
              - button "保存" [ref=e332] [cursor=pointer]
              - button "取消" [ref=e333] [cursor=pointer]
  - region "操作通知"
```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | import { readStore } from "./support/p51CoreWorkflow";
  3   | import { mkdir, writeFile } from "node:fs/promises";
  4   | import type { ResumeBranch } from "@/domain/schemas";
  5   | 
  6   | const evidenceDir = process.env.UX013_A2_BROWSER_EVIDENCE_DIR ?? "docs/quality/ux-01.3-a2-logs/browser";
  7   | async function formal(page: Page) {
  8   |   return { profiles: await readStore(page, "profiles"), branches: await readStore(page, "resumeBranches"), revisions: await readStore(page, "resumeRevisions"),
  9   |     operations: await readStore(page, "resumeBranchOperations"), appMeta: await readStore(page, "appMeta") };
  10  | }
  11  | test("UX013 A2 four structured operations reviewed committed and refreshed with durable user source", async ({ page }, info) => {
  12  |   test.setTimeout(180_000);
  13  |   // The direct user-input route exercises production Facade/Gateway without an upstream model call.
  14  |   // Any accidental provider request fails the test, instead of falling through to a real configured provider.
  15  |   let providerCalls = 0;
  16  |   await page.route("**/api/ai/**", route => { providerCalls++; return route.abort(); });
  17  |   await page.goto("/setup");
  18  |   await page.getByRole("button", { name: "跳过，先体验其他功能" }).click();
  19  |   await page.goto("/resume");
  20  |   await page.getByRole("button", { name: /导入已有简历/ }).click();
  21  |   const dialog = page.getByRole("dialog", { name: "导入简历" });
  22  |   await dialog.getByText("粘贴 JSON", { exact: true }).click();
  23  |   await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
  24  |     basics: { name: "A2匿名候选人", email: "a2@example.org", portfolioLinks: [], otherLinks: [], customFields: [] },
  25  |     sections: [{ id: "project", sectionType: "project", title: "项目经历", order: 0, visible: true, items: [{ id: "a2-project", sectionType: "project",
  26  |       title: "原项目名称", role: "项目成员", startDate: "2025-01", endDate: "2025-06", current: false,
  27  |       description: "参与接口测试。", highlights: ["执行接口测试。", "SQL 查询验证。", "执行接口测试。"], tools: [], outcomes: [], customFields: [] }] }], unclassifiedBlocks: [] }));
  28  |   await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  29  |   await dialog.locator("label.import-target-option").filter({ hasText: "创建新人物" }).click();
  30  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  31  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  32  |   await dialog.locator(".import-review-footer button.primary-button").click();
  33  |   const open = page.getByRole("button", { name: "打开", exact: true }); if (await open.isVisible()) await open.click();
  34  |   await expect(page.getByTestId("resume-studio-shell")).toBeVisible();
  35  |   // Add a confirmed skill through the actual Profile editor after the source Branch has been created.
  36  |   // This keeps Profile and Branch intentionally different without writing business fixtures into IndexedDB.
  37  |   await page.goto("/profile");
  38  |   await page.locator('[data-profile-category="skill"]').click();
  39  |   await page.getByRole("button", { name: "新增", exact: true }).click();
> 40  |   await page.getByLabel("技能名称", { exact: true }).fill("SQL");
      |                                                  ^ Error: locator.fill: Test timeout of 180000ms exceeded.
  41  |   await page.getByLabel("使用场景或能力说明", { exact: true }).fill("使用 SQL 执行查询验证。");
  42  |   await page.getByRole("button", { name: "保存", exact: true }).click();
  43  |   await expect(page.getByRole("button", { name: "编辑 SQL", exact: true })).toBeVisible();
  44  |   const initial = await formal(page);
  45  |   const branch = initial.branches.find(b => b.branchPurpose === "general") as unknown as ResumeBranch;
  46  |   expect(branch).toBeTruthy();
  47  |   await page.goto("/ai-workspace"); await page.getByRole("button", { name: "新任务", exact: true }).click();
  48  |   const panel = page.getByTestId("structured-resume-editor"); await panel.locator("summary").first().click();
  49  |   await mkdir(evidenceDir, { recursive: true });
  50  |   const operations = ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"];
  51  |   let factRevisionId = "";
  52  |   for (const operation of operations) {
  53  |     if (operation !== operations[0]) await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  54  |     await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  55  |     await panel.getByLabel("结构化操作", { exact: true }).selectOption(operation);
  56  |     const target = panel.getByLabel("结构化修改目标", { exact: true });
  57  |     const options = await target.locator("option").allTextContents();
  58  |     const index = operation === "fact_correction" ? options.findIndex(t => t.includes("项目名称"))
  59  |       : operation === "bullet_removal" ? options.findIndex(t => t.includes("要点 3")) : 1;
  60  |     expect(index).toBeGreaterThan(0); await target.selectOption({ index });
  61  |     if (operation === "fact_correction") await panel.getByLabel("我的纠正内容", { exact: true }).fill("用户更正的新项目名称");
  62  |     if (operation === "bullet_reordering") await panel.getByLabel("要点新顺序", { exact: true }).fill("2,1");
  63  |     const before = await formal(page);
  64  |     await panel.getByRole("button", { name: "生成结构化审核提案", exact: true }).click();
  65  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  66  |     expect((await formal(page)).revisions).toEqual(before.revisions);
  67  |     await page.reload(); await panel.locator("summary").first().click();
  68  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  69  |     await page.setViewportSize({ width: 1024, height: 900 });
  70  |     const confirm = panel.getByRole("button", { name: "确认结构化修改", exact: true });
  71  |     await expect(confirm).toBeVisible();
  72  |     await page.screenshot({ path: info.outputPath(`${operation}-review-1024.png`), fullPage: true });
  73  |     await page.setViewportSize({ width: 1440, height: 1000 });
  74  |     await page.screenshot({ path: info.outputPath(`${operation}-review-wide.png`), fullPage: true });
  75  |     await confirm.click();
  76  |     await expect(panel.getByText(/已保存版本：/)).toBeVisible();
  77  |     const after = await formal(page), changed = after.branches.find(b => b.id === branch.id) as unknown as ResumeBranch;
  78  |     const revisionId = changed.currentRevisionId!;
  79  |     if (operation === "fact_correction") factRevisionId = revisionId;
  80  |     expect(after.profiles).toEqual(before.profiles);
  81  |     expect(after.branches.filter(b => b.id !== branch.id)).toEqual(before.branches.filter(b => b.id !== branch.id));
  82  |     expect(after.revisions).toHaveLength(before.revisions.length + 1);
  83  |     expect(after.revisions.filter(r => r.id !== revisionId)).toEqual(before.revisions);
  84  |     const original = (before.branches.find(b => b.id === branch.id) as unknown as ResumeBranch), expected = structuredClone(original);
  85  |     const project = expected.structuredContentItems!.find(i => i.data.sectionType === "project")!;
  86  |     if (operation === "confirmed_skill_addition") {
  87  |       expect(changed.structuredContentItems!.slice(0, -1)).toEqual(expected.structuredContentItems);
  88  |       expect(changed.contentItems.slice(0, -1)).toEqual(expected.contentItems);
  89  |     } else {
  90  |       const next = changed.structuredContentItems!.find(i => i.id === project.id)!;
  91  |       expect(changed.structuredContentItems!.filter(i => i.id !== project.id)).toEqual(expected.structuredContentItems!.filter(i => i.id !== project.id));
  92  |       expect(changed.contentItems.filter(i => i.id !== project.id)).toEqual(expected.contentItems.filter(i => i.id !== project.id));
  93  |       expect(next.data).toEqual({ ...project.data, ...(operation === "fact_correction" ? { title: "用户更正的新项目名称" }
  94  |         : { highlights: operation === "bullet_removal" ? ["执行接口测试。", "SQL 查询验证。"] : ["SQL 查询验证。", "执行接口测试。"] }) });
  95  |       expect(next.factRefs).toEqual(project.factRefs);
  96  |     }
  97  |     expect(changed).toEqual({ ...original, structuredContentItems: changed.structuredContentItems, contentItems: changed.contentItems,
  98  |       revision: original.revision + 1, currentRevisionId: revisionId, updatedAt: changed.updatedAt });
  99  |     const receipt = after.operations.find(r => r.revisionId === revisionId); expect(receipt).toBeTruthy();
  100 |     await page.reload(); await panel.locator("summary").first().click();
  101 |     await expect(panel.getByText(`已保存版本：${revisionId}`, { exact: true })).toBeVisible();
  102 |     expect((await formal(page)).revisions).toEqual(after.revisions);
  103 |     await writeFile(`${evidenceDir}/${operation}.json`, JSON.stringify({ before, after, receipt }, null, 2));
  104 |     if (operation === "confirmed_skill_addition") {
  105 |       await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  106 |       await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  107 |       await panel.getByLabel("结构化操作", { exact: true }).selectOption("confirmed_skill_addition");
  108 |       await expect(panel.getByLabel("结构化修改目标", { exact: true }).locator("option").filter({ hasText: "SQL（已存在）" })).toBeDisabled();
  109 |       // A reload restores the saved authoritative outcome; no new task has been selected or committed.
  110 |       await page.reload(); await panel.locator("summary").first().click();
  111 |     }
  112 |   }
  113 |   // The first correction remains traceable after three subsequent tasks replaced its TaskState proposal.
  114 |   await page.goto(`/resume?branchId=${encodeURIComponent(branch.id)}`);
  115 |   await page.locator("details.toolbar-more > summary").click();
  116 |   await page.getByText("查询版本操作来源", { exact: true }).click();
  117 |   await page.getByLabel("历史版本来源", { exact: true }).selectOption(factRevisionId);
  118 |   const historical = page.getByTestId("precise-revision-evidence"); await historical.locator("summary").click();
  119 |   await expect(historical.getByText("原始纠正声明：用户更正的新项目名称", { exact: true })).toBeVisible();
  120 |   await page.screenshot({ path: info.outputPath("historical-source.png"), fullPage: true });
  121 |   expect((await formal(page)).profiles).toEqual(initial.profiles);
  122 |   expect(providerCalls).toBe(0);
  123 |   await writeFile(`${evidenceDir}/summary.json`, JSON.stringify({ operations, factRevisionId, providerCalls, final: await formal(page) }, null, 2));
  124 | });
  125 | 
```