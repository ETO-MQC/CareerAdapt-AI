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
  - waiting for getByRole('button', { name: /导入已有简历/ })
    - locator resolved to <button type="button" class="resume-create-card">…</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
  - element was detached from the DOM, retrying

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - alert [ref=e2]
  - generic [ref=e3]:
    - complementary "AI 工作区导航" [ref=e4]:
      - button "展开 AI 导航" [ref=e6] [cursor=pointer]:
        - img [ref=e7]
      - generic [ref=e10]:
        - button [ref=e11] [cursor=pointer]:
          - img [ref=e12]
        - button [ref=e13] [cursor=pointer]:
          - img [ref=e14]
      - navigation "资产" [ref=e17]:
        - link "AI 助手" [ref=e18] [cursor=pointer]:
          - /url: /ai-workspace
          - img [ref=e19]
        - link "我的简历" [ref=e22] [cursor=pointer]:
          - /url: /resume
          - img [ref=e23]
        - link "个人资料库" [ref=e26] [cursor=pointer]:
          - /url: /profile
          - img [ref=e27]
        - link "岗位" [ref=e30] [cursor=pointer]:
          - /url: /jobs
          - img [ref=e31]
        - link "求职进度" [ref=e35] [cursor=pointer]:
          - /url: /applications
          - img [ref=e36]
        - link "回收站" [ref=e38] [cursor=pointer]:
          - /url: /recycle
          - img [ref=e39]
      - region "最近任务" [ref=e46]
      - generic [ref=e47]:
        - link [ref=e48] [cursor=pointer]:
          - /url: /settings
          - img [ref=e49]
        - generic [ref=e53]: CA
    - main [ref=e56]:
      - generic [ref=e57]:
        - button [ref=e59] [cursor=pointer]: 通用简历
        - generic [ref=e60]:
          - button "返回" [ref=e61] [cursor=pointer]
          - generic [ref=e62]:
            - generic [ref=e63]: 通用简历 / 可编辑
            - heading "通用简历" [level=2] [ref=e64]
            - generic [ref=e65]:
              - generic [ref=e66]: 自动保存已开启
              - status [ref=e67]: 已保存
        - navigation "编辑模式" [ref=e68]:
          - button "编辑" [pressed] [ref=e69] [cursor=pointer]:
            - generic [ref=e70]: 编辑
          - button "AI优化" [ref=e71] [cursor=pointer]:
            - generic [ref=e72]: AI优化
        - generic "简历工作栏" [ref=e73]:
          - generic [ref=e74]:
            - button "撤销" [disabled] [ref=e75] [cursor=pointer]
            - button "重做" [disabled] [ref=e76] [cursor=pointer]
            - button "下载 PDF" [ref=e77] [cursor=pointer]
            - group [ref=e78]:
              - generic "更多" [ref=e79] [cursor=pointer]
              - option "请选择版本" [selected]
              - option "版本 1"
      - generic [ref=e80]:
        - complementary [ref=e81]:
          - generic [ref=e82]:
            - generic [ref=e83]:
              - heading "简历内容" [level=2] [ref=e84]
              - paragraph [ref=e85]: 编辑个人信息、调整板块顺序，并实时查看预览。
            - navigation "简历内容管理" [ref=e86]:
              - generic [ref=e88]:
                - img [ref=e90]
                - button "基本信息" [ref=e93] [cursor=pointer]:
                  - strong [ref=e94]: 个人信息
                  - generic [ref=e95]: 姓名、联系方式与求职意向
                - button "展开或收起基本信息" [ref=e96] [cursor=pointer]:
                  - img [ref=e97]
              - generic [ref=e99]:
                - generic [ref=e100]:
                  - heading "简历板块" [level=3] [ref=e101]
                  - generic [ref=e102]: 6 个板块
                - generic [ref=e103]:
                  - button "展开全部" [ref=e104] [cursor=pointer]
                  - button "收起全部" [ref=e105] [cursor=pointer]
              - generic [ref=e107]:
                - button "拖动排序：自我评价，Alt加方向键移动" [ref=e108]:
                  - img [ref=e109]
                - img [ref=e117]
                - button "自我评价" [ref=e120] [cursor=pointer]:
                  - strong [ref=e121]: 自我评价
                  - generic [ref=e122]: 0 个条目
                - generic:
                  - button "上移板块：自我评价" [disabled]:
                    - img
                  - button "下移板块：自我评价":
                    - img
                  - button "编辑板块：自我评价":
                    - img
                  - button "显示板块：自我评价" [disabled]:
                    - img
                  - button "删除板块内容：自我评价":
                    - img
                - button "展开或收起自我评价" [ref=e123] [cursor=pointer]:
                  - img [ref=e124]
              - generic [ref=e127]:
                - button "拖动排序：教育经历，Alt加方向键移动" [ref=e128]:
                  - img [ref=e129]
                - img [ref=e137]
                - button "教育经历" [ref=e140] [cursor=pointer]:
                  - strong [ref=e141]: 教育经历
                  - generic [ref=e142]: 0 个条目
                - generic:
                  - button "上移板块：教育经历":
                    - img
                  - button "下移板块：教育经历":
                    - img
                  - button "编辑板块：教育经历":
                    - img
                  - button "显示板块：教育经历" [disabled]:
                    - img
                  - button "删除板块内容：教育经历":
                    - img
                - button "展开或收起教育经历" [ref=e143] [cursor=pointer]:
                  - img [ref=e144]
              - generic [ref=e147]:
                - button "拖动排序：工作经历，Alt加方向键移动" [ref=e148]:
                  - img [ref=e149]
                - img [ref=e157]
                - button "工作经历" [ref=e160] [cursor=pointer]:
                  - strong [ref=e161]: 工作经历
                  - generic [ref=e162]: 0 个条目
                - generic:
                  - button "上移板块：工作经历":
                    - img
                  - button "下移板块：工作经历":
                    - img
                  - button "编辑板块：工作经历":
                    - img
                  - button "显示板块：工作经历" [disabled]:
                    - img
                  - button "删除板块内容：工作经历":
                    - img
                - button "展开或收起工作经历" [ref=e163] [cursor=pointer]:
                  - img [ref=e164]
              - generic [ref=e167]:
                - button "拖动排序：实习经历，Alt加方向键移动" [ref=e168]:
                  - img [ref=e169]
                - img [ref=e177]
                - button "实习经历" [ref=e180] [cursor=pointer]:
                  - strong [ref=e181]: 实习经历
                  - generic [ref=e182]: 0 个条目
                - generic:
                  - button "上移板块：实习经历":
                    - img
                  - button "下移板块：实习经历":
                    - img
                  - button "编辑板块：实习经历":
                    - img
                  - button "显示板块：实习经历" [disabled]:
                    - img
                  - button "删除板块内容：实习经历":
                    - img
                - button "展开或收起实习经历" [ref=e183] [cursor=pointer]:
                  - img [ref=e184]
              - generic [ref=e187]:
                - button "拖动排序：项目经历，Alt加方向键移动" [ref=e188]:
                  - img [ref=e189]
                - img [ref=e197]
                - button "项目经历" [ref=e202] [cursor=pointer]:
                  - strong [ref=e203]: 项目经历
                  - generic [ref=e204]: 1 个条目
                - generic:
                  - button "上移板块：项目经历":
                    - img
                  - button "下移板块：项目经历":
                    - img
                  - button "编辑板块：项目经历":
                    - img
                  - button "隐藏板块：项目经历":
                    - img
                  - button "删除板块内容：项目经历":
                    - img
                - button "展开或收起项目经历" [ref=e205] [cursor=pointer]:
                  - img [ref=e206]
              - generic [ref=e209]:
                - button "拖动排序：专业技能，Alt加方向键移动" [ref=e210]:
                  - img [ref=e211]
                - img [ref=e219]
                - button "专业技能" [ref=e221] [cursor=pointer]:
                  - strong [ref=e222]: 专业技能
                  - generic [ref=e223]: 0 个条目
                - generic:
                  - button "上移板块：专业技能":
                    - img
                  - button "下移板块：专业技能" [disabled]:
                    - img
                  - button "编辑板块：专业技能":
                    - img
                  - button "显示板块：专业技能" [disabled]:
                    - img
                  - button "删除板块内容：专业技能":
                    - img
                - button "展开或收起专业技能" [ref=e224] [cursor=pointer]:
                  - img [ref=e225]
            - region "添加或管理简历栏目" [ref=e227]:
              - strong [ref=e229]: 添加板块
              - generic [ref=e230]:
                - button "+ 科研经历" [ref=e231] [cursor=pointer]:
                  - generic [ref=e232]: + 科研经历
                - button "+ 校园经历" [ref=e233] [cursor=pointer]:
                  - generic [ref=e234]: + 校园经历
                - button "+ 志愿经历" [ref=e235] [cursor=pointer]:
                  - generic [ref=e236]: + 志愿经历
                - button "+ 培训经历" [ref=e237] [cursor=pointer]:
                  - generic [ref=e238]: + 培训经历
                - button "+ 奖项荣誉" [ref=e239] [cursor=pointer]:
                  - generic [ref=e240]: + 奖项荣誉
                - button "+ 证书" [ref=e241] [cursor=pointer]:
                  - generic [ref=e242]: + 证书
                - button "+ 语言能力" [ref=e243] [cursor=pointer]:
                  - generic [ref=e244]: + 语言能力
                - button "+ 论文与出版物" [ref=e245] [cursor=pointer]:
                  - generic [ref=e246]: + 论文与出版物
                - button "+ 专利" [ref=e247] [cursor=pointer]:
                  - generic [ref=e248]: + 专利
                - button "+ 作品集" [ref=e249] [cursor=pointer]:
                  - generic [ref=e250]: + 作品集
                - button "+ 其他内容" [ref=e251] [cursor=pointer]:
                  - generic [ref=e252]: + 其他内容
              - generic [ref=e253]:
                - text: 自定义栏目
                - textbox "自定义栏目" [ref=e254]:
                  - /placeholder: 例如：开源贡献
              - button "创建自定义栏目" [ref=e255] [cursor=pointer]
        - button "拖拽调整字段面板与 A4 预览宽度" [ref=e256]
        - separator "调整设置栏宽度" [ref=e257]
        - complementary "简历排版设置" [ref=e258]:
          - generic [ref=e259]:
            - heading "页面排版" [level=2] [ref=e260]
            - paragraph [ref=e261]: 调整字体、间距、主题色。
            - button "折叠设置栏" [ref=e262] [cursor=pointer]: ›
          - tablist "排版设置" [ref=e263]:
            - tab "排版" [selected] [ref=e264] [cursor=pointer]
            - tab "样式" [ref=e265] [cursor=pointer]
            - tab "页面" [ref=e266] [cursor=pointer]
            - tab "模板" [ref=e267] [cursor=pointer]
          - generic [ref=e269]:
            - generic [ref=e270]:
              - heading "全局排版" [level=3] [ref=e271]
              - generic [ref=e272]:
                - generic [ref=e273]: 全局字号
                - generic [ref=e274]:
                  - generic [ref=e275]:
                    - button "减少全局字号" [ref=e276] [cursor=pointer]: −
                    - spinbutton "全局字号" [ref=e277]: "12.4"
                    - button "增加全局字号" [ref=e278] [cursor=pointer]: +
                  - generic [ref=e279]: px
              - generic [ref=e280]:
                - generic [ref=e281]: 行间距
                - generic [ref=e282]:
                  - generic [ref=e283]:
                    - button "减少行间距" [ref=e284] [cursor=pointer]: −
                    - spinbutton "行间距" [ref=e285]: "1.48"
                    - button "增加行间距" [ref=e286] [cursor=pointer]: +
                  - generic [ref=e287]: 倍
              - generic [ref=e288]:
                - generic [ref=e289]: 字间距
                - generic [ref=e290]:
                  - generic [ref=e291]:
                    - button "减少字间距" [ref=e292] [cursor=pointer]: −
                    - spinbutton "字间距" [ref=e293]: "0"
                    - button "增加字间距" [ref=e294] [cursor=pointer]: +
                  - generic [ref=e295]: px
              - generic [ref=e296]:
                - generic [ref=e297]: 板块间距
                - generic [ref=e298]:
                  - generic [ref=e299]:
                    - button "减少板块间距" [ref=e300] [cursor=pointer]: −
                    - spinbutton "板块间距" [ref=e301]: "18.9"
                    - button "增加板块间距" [ref=e302] [cursor=pointer]: +
                  - generic [ref=e303]: px
            - generic [ref=e304]:
              - heading "局部字号微调" [level=3] [ref=e305]
              - generic [ref=e306]:
                - generic [ref=e307]:
                  - generic [ref=e308]: 姓名
                  - generic [ref=e310]:
                    - button "减少姓名" [ref=e311] [cursor=pointer]: −
                    - spinbutton "姓名" [ref=e312]: "2.26"
                    - button "增加姓名" [ref=e313] [cursor=pointer]: +
                - generic [ref=e314]:
                  - generic [ref=e315]: 板块标题
                  - generic [ref=e317]:
                    - button "减少板块标题" [ref=e318] [cursor=pointer]: −
                    - spinbutton "板块标题" [ref=e319]: "1.2"
                    - button "增加板块标题" [ref=e320] [cursor=pointer]: +
                - generic [ref=e321]:
                  - generic [ref=e322]: 联系方式
                  - generic [ref=e324]:
                    - button "减少联系方式" [ref=e325] [cursor=pointer]: −
                    - spinbutton "联系方式" [ref=e326]: "0.95"
                    - button "增加联系方式" [ref=e327] [cursor=pointer]: +
                - generic [ref=e328]:
                  - generic [ref=e329]: 正文描述
                  - generic [ref=e331]:
                    - button "减少正文描述" [ref=e332] [cursor=pointer]: −
                    - spinbutton "正文描述" [ref=e333]: "1"
                    - button "增加正文描述" [ref=e334] [cursor=pointer]: +
                - generic [ref=e335]:
                  - generic [ref=e336]: 经历标题
                  - generic [ref=e338]:
                    - button "减少经历标题" [ref=e339] [cursor=pointer]: −
                    - spinbutton "经历标题" [ref=e340]: "1"
                    - button "增加经历标题" [ref=e341] [cursor=pointer]: +
                - generic [ref=e342]:
                  - generic [ref=e343]: 求职意向
                  - generic [ref=e345]:
                    - button "减少求职意向" [ref=e346] [cursor=pointer]: −
                    - spinbutton "求职意向" [ref=e347]: "1.07"
                    - button "增加求职意向" [ref=e348] [cursor=pointer]: +
            - generic [ref=e349]:
              - heading "排版密度" [level=3] [ref=e350]
              - generic [ref=e351]:
                - generic [ref=e352]: 密度预设
                - group "密度预设" [ref=e353]:
                  - button "紧凑" [ref=e354] [cursor=pointer]
                  - button "标准" [pressed] [ref=e355] [cursor=pointer]
                  - button "宽松" [ref=e356] [cursor=pointer]
        - generic [ref=e357]:
          - generic [ref=e360]:
            - generic [ref=e361]: 第 1 页 / 共 1 页
            - article "A4 简历预览第 1 页" [ref=e362]:
              - generic [ref=e363]:
                - heading "A2匿名候选人" [level=1] [ref=e365] [cursor=pointer]
                - generic [ref=e367] [cursor=pointer]: a2@example.org
              - generic [ref=e368]:
                - heading "项目经历" [level=2] [ref=e369] [cursor=pointer]
                - article [ref=e371] [cursor=pointer]:
                  - generic [ref=e372]:
                    - heading "原项目名称" [level=3] [ref=e373]
                    - strong [ref=e374]:
                      - generic [ref=e375]: 项目成员
                    - time [ref=e376]:
                      - generic [ref=e377]: "2025.01"
                      - generic [ref=e378]: –2025.06
                  - paragraph [ref=e379]: 参与接口测试。
                  - list [ref=e380]:
                    - listitem [ref=e381]: 执行接口测试。
                    - listitem [ref=e382]: SQL 查询验证。
          - generic "A4 预览工具":
            - generic: 1 页
            - group "画布缩放" [ref=e383]:
              - button "缩小预览" [ref=e384] [cursor=pointer]: "-"
              - generic [ref=e385]: 44%
              - button "放大预览" [ref=e386] [cursor=pointer]: +
              - button "适合宽度" [ref=e387] [cursor=pointer]
              - button "整页" [ref=e388] [cursor=pointer]
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
> 39  |   await page.getByRole("button", { name: /导入已有简历/ }).click();
      |                                                      ^ TimeoutError: locator.click: Timeout 15000ms exceeded.
  40  |   await dialog.getByText("粘贴 JSON", { exact: true }).click();
  41  |   await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
  42  |     basics: { name: "A2匿名候选人", portfolioLinks: [], otherLinks: [], customFields: [] },
  43  |     sections: [{ id: "skills", sectionType: "skills", title: "专业技能", order: 0, visible: true,
  44  |       items: [{ id: "a2-sql", sectionType: "skills", name: "SQL", description: "使用 SQL 执行查询验证。", customFields: [] }] }], unclassifiedBlocks: [] }));
  45  |   await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  46  |   await dialog.locator("label.import-target-option").filter({ hasText: "导入到已有资料" }).click();
  47  |   await dialog.locator('input[name="import-create-general-resume"]').uncheck();
  48  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  49  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  50  |   await dialog.locator(".import-review-footer button.primary-button").click();
  51  |   await expect.poll(async () => (await readStore(page, "profiles")).some(p => (p.skills as Array<{ name: string }>).some(s => s.name === "SQL"))).toBe(true);
  52  |   const initial = await formal(page);
  53  |   const branch = initial.branches.find(b => b.branchPurpose === "general") as unknown as ResumeBranch;
  54  |   expect(branch).toBeTruthy();
  55  |   await page.goto("/ai-workspace"); await page.getByRole("button", { name: "新任务", exact: true }).click();
  56  |   const panel = page.getByTestId("structured-resume-editor"); await panel.locator("summary").first().click();
  57  |   await mkdir(evidenceDir, { recursive: true });
  58  |   const operations = ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"];
  59  |   let factRevisionId = "";
  60  |   for (const operation of operations) {
  61  |     if (operation !== operations[0]) await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  62  |     await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  63  |     await panel.getByLabel("结构化操作", { exact: true }).selectOption(operation);
  64  |     const target = panel.getByLabel("结构化修改目标", { exact: true });
  65  |     const options = await target.locator("option").allTextContents();
  66  |     const index = operation === "fact_correction" ? options.findIndex(t => t.includes("项目名称"))
  67  |       : operation === "bullet_removal" ? options.findIndex(t => t.includes("要点 3")) : 1;
  68  |     expect(index).toBeGreaterThan(0); await target.selectOption({ index });
  69  |     if (operation === "fact_correction") await panel.getByLabel("我的纠正内容", { exact: true }).fill("用户更正的新项目名称");
  70  |     if (operation === "bullet_reordering") await panel.getByLabel("要点新顺序", { exact: true }).fill("2,1");
  71  |     const before = await formal(page);
  72  |     await panel.getByRole("button", { name: "生成结构化审核提案", exact: true }).click();
  73  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  74  |     expect((await formal(page)).revisions).toEqual(before.revisions);
  75  |     await page.reload(); await panel.locator("summary").first().click();
  76  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  77  |     await page.setViewportSize({ width: 1024, height: 900 });
  78  |     const confirm = panel.getByRole("button", { name: "确认结构化修改", exact: true });
  79  |     await expect(confirm).toBeVisible();
  80  |     await page.screenshot({ path: info.outputPath(`${operation}-review-1024.png`), fullPage: true });
  81  |     await page.setViewportSize({ width: 1440, height: 1000 });
  82  |     await page.screenshot({ path: info.outputPath(`${operation}-review-wide.png`), fullPage: true });
  83  |     await confirm.click();
  84  |     await expect(panel.getByText(/已保存版本：/)).toBeVisible();
  85  |     const after = await formal(page), changed = after.branches.find(b => b.id === branch.id) as unknown as ResumeBranch;
  86  |     const revisionId = changed.currentRevisionId!;
  87  |     if (operation === "fact_correction") factRevisionId = revisionId;
  88  |     expect(after.profiles).toEqual(before.profiles);
  89  |     expect(after.branches.filter(b => b.id !== branch.id)).toEqual(before.branches.filter(b => b.id !== branch.id));
  90  |     expect(after.revisions).toHaveLength(before.revisions.length + 1);
  91  |     expect(after.revisions.filter(r => r.id !== revisionId)).toEqual(before.revisions);
  92  |     const original = (before.branches.find(b => b.id === branch.id) as unknown as ResumeBranch), expected = structuredClone(original);
  93  |     const project = expected.structuredContentItems!.find(i => i.data.sectionType === "project")!;
  94  |     if (operation === "confirmed_skill_addition") {
  95  |       expect(changed.structuredContentItems!.slice(0, -1)).toEqual(expected.structuredContentItems);
  96  |       expect(changed.contentItems.slice(0, -1)).toEqual(expected.contentItems);
  97  |     } else {
  98  |       const next = changed.structuredContentItems!.find(i => i.id === project.id)!;
  99  |       expect(changed.structuredContentItems!.filter(i => i.id !== project.id)).toEqual(expected.structuredContentItems!.filter(i => i.id !== project.id));
  100 |       expect(changed.contentItems.filter(i => i.id !== project.id)).toEqual(expected.contentItems.filter(i => i.id !== project.id));
  101 |       expect(next.data).toEqual({ ...project.data, ...(operation === "fact_correction" ? { title: "用户更正的新项目名称" }
  102 |         : { highlights: operation === "bullet_removal" ? ["执行接口测试。", "SQL 查询验证。"] : ["SQL 查询验证。", "执行接口测试。"] }) });
  103 |       expect(next.factRefs).toEqual(project.factRefs);
  104 |     }
  105 |     expect(changed).toEqual({ ...original, structuredContentItems: changed.structuredContentItems, contentItems: changed.contentItems,
  106 |       revision: original.revision + 1, currentRevisionId: revisionId, updatedAt: changed.updatedAt });
  107 |     const receipt = after.operations.find(r => r.revisionId === revisionId); expect(receipt).toBeTruthy();
  108 |     await page.reload(); await panel.locator("summary").first().click();
  109 |     await expect(panel.getByText(`已保存版本：${revisionId}`, { exact: true })).toBeVisible();
  110 |     expect((await formal(page)).revisions).toEqual(after.revisions);
  111 |     await writeFile(`${evidenceDir}/${operation}.json`, JSON.stringify({ before, after, receipt }, null, 2));
  112 |     if (operation === "confirmed_skill_addition") {
  113 |       await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  114 |       await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  115 |       await panel.getByLabel("结构化操作", { exact: true }).selectOption("confirmed_skill_addition");
  116 |       await expect(panel.getByLabel("结构化修改目标", { exact: true }).locator("option").filter({ hasText: "SQL（已存在）" })).toBeDisabled();
  117 |       // A reload restores the saved authoritative outcome; no new task has been selected or committed.
  118 |       await page.reload(); await panel.locator("summary").first().click();
  119 |     }
  120 |   }
  121 |   // The first correction remains traceable after three subsequent tasks replaced its TaskState proposal.
  122 |   await page.goto(`/resume?branchId=${encodeURIComponent(branch.id)}`);
  123 |   await page.locator("details.toolbar-more > summary").click();
  124 |   await page.getByText("查询版本操作来源", { exact: true }).click();
  125 |   await page.getByLabel("历史版本来源", { exact: true }).selectOption(factRevisionId);
  126 |   const historical = page.getByTestId("precise-revision-evidence"); await historical.locator("summary").click();
  127 |   await expect(historical.getByText("原始纠正声明：用户更正的新项目名称", { exact: true })).toBeVisible();
  128 |   await page.screenshot({ path: info.outputPath("historical-source.png"), fullPage: true });
  129 |   expect((await formal(page)).profiles).toEqual(initial.profiles);
  130 |   expect(providerCalls).toBe(0);
  131 |   await writeFile(`${evidenceDir}/summary.json`, JSON.stringify({ operations, factRevisionId, providerCalls, final: await formal(page) }, null, 2));
  132 | });
  133 | 
```