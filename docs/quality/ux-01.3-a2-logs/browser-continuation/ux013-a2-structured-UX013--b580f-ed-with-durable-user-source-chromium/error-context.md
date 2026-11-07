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
  - waiting for getByRole('dialog', { name: '导入简历' }).getByText('粘贴 JSON', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
              - generic [ref=e80]:
                - button "导入" [ref=e81] [cursor=pointer]
                - button "从资料库更新简历" [ref=e82] [cursor=pointer]
                - button "重新检查" [ref=e83] [cursor=pointer]
                - button "导出 JSON" [ref=e84] [cursor=pointer]
                - button "打印 / 保存 PDF" [ref=e85] [cursor=pointer]
                - generic [ref=e86] [cursor=pointer]:
                  - checkbox "画布编辑" [checked] [ref=e87]
                  - text: 画布直接编辑
                - generic [ref=e88]: 历史版本（1）
                - button "仅回退排版" [disabled] [ref=e89]
                - button "归档" [ref=e90] [cursor=pointer]
                - group [ref=e91]:
                  - generic "查询版本操作来源" [ref=e92]
                  - option "请选择版本" [selected]
                  - option "版本 1"
                - button "恢复版本 1 · 内容修改" [disabled] [ref=e93]
      - dialog "导入另一份简历" [active] [ref=e95]:
        - generic [ref=e96]:
          - generic [ref=e97]:
            - heading "导入另一份简历" [level=2] [ref=e98]
            - paragraph [ref=e99]: PDF · DOCX · Markdown · TXT · JSON
          - button "关闭导入窗口" [ref=e100] [cursor=pointer]: ×
        - generic [ref=e102]:
          - status [ref=e103]: 等待上传。选择或拖入简历，AI 将自动识别；写入前可核对。
          - button "选择要导入的简历文件" [ref=e104]
          - group "导入目标" [ref=e105]:
            - generic [ref=e106]: 导入目标
            - generic [ref=e107]:
              - generic [ref=e108]:
                - generic [ref=e109] [cursor=pointer]:
                  - radio "导入到已有资料" [checked] [ref=e110]
                  - text: 导入到已有资料
                - generic [ref=e111] [cursor=pointer]:
                  - radio "创建新人物" [ref=e112]
                  - text: 创建新人物
              - generic [ref=e113]:
                - generic [ref=e114]:
                  - text: 目标人物
                  - combobox "目标人物" [ref=e115]:
                    - option "A2匿名候选人" [selected]
                    - option "同学"
                - generic [ref=e116]:
                  - checkbox "同时创建通用简历" [checked] [ref=e117]
                  - text: 同时创建通用简历
          - region "识别方式" [ref=e118]:
            - generic [ref=e119]:
              - strong [ref=e120]: 识别方式
              - group "简历识别方式" [ref=e121]:
                - button "使用 AI 智能识别" [pressed] [ref=e122] [cursor=pointer]:
                  - generic [ref=e123]: ✦
                  - text: AI 智能识别 · 推荐
                - button "仅本地" [ref=e124] [cursor=pointer]
              - generic [ref=e125]:
                - generic [ref=e126]: 默认 AI 自动识别；扫描 PDF 和图片会发送页面图像给当前模型
                - group [ref=e127]:
                  - generic "隐私说明" [ref=e128] [cursor=pointer]
            - group "高级识别路线" [ref=e130]:
              - button "自动提取" [pressed] [ref=e131] [cursor=pointer]
              - button "PDF.js 文本层" [ref=e132] [cursor=pointer]
              - button "本地 OCR" [ref=e133] [cursor=pointer]
              - button "人工核对" [ref=e134] [cursor=pointer]
          - button "拖放简历到这里 PDF · DOCX · MD · TXT · JSON · PNG · JPG" [ref=e135] [cursor=pointer]:
            - generic [ref=e136]: ↑
            - strong [ref=e137]: 拖放简历到这里
            - generic [ref=e138]: PDF · DOCX · MD · TXT · JSON · PNG · JPG
          - generic "辅助导入工具" [ref=e139]:
            - group [ref=e140]:
              - generic "粘贴 JSON" [ref=e141] [cursor=pointer]
            - button "扫描件导入" [ref=e142] [cursor=pointer]
            - link "导入设置" [ref=e143] [cursor=pointer]:
              - /url: /settings
      - generic [ref=e144]:
        - complementary [ref=e145]:
          - generic [ref=e146]:
            - generic [ref=e147]:
              - heading "简历内容" [level=2] [ref=e148]
              - paragraph [ref=e149]: 编辑个人信息、调整板块顺序，并实时查看预览。
            - navigation "简历内容管理" [ref=e150]:
              - generic [ref=e152]:
                - img [ref=e154]
                - button "基本信息" [ref=e157] [cursor=pointer]:
                  - strong [ref=e158]: 个人信息
                  - generic [ref=e159]: 姓名、联系方式与求职意向
                - button "展开或收起基本信息" [ref=e160] [cursor=pointer]:
                  - img [ref=e161]
              - generic [ref=e163]:
                - generic [ref=e164]:
                  - heading "简历板块" [level=3] [ref=e165]
                  - generic [ref=e166]: 6 个板块
                - generic [ref=e167]:
                  - button "展开全部" [ref=e168] [cursor=pointer]
                  - button "收起全部" [ref=e169] [cursor=pointer]
              - generic [ref=e171]:
                - button "拖动排序：自我评价，Alt加方向键移动" [ref=e172]:
                  - img [ref=e173]
                - img [ref=e181]
                - button "自我评价" [ref=e184] [cursor=pointer]:
                  - strong [ref=e185]: 自我评价
                  - generic [ref=e186]: 0 个条目
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
                - button "展开或收起自我评价" [ref=e187] [cursor=pointer]:
                  - img [ref=e188]
              - generic [ref=e191]:
                - button "拖动排序：教育经历，Alt加方向键移动" [ref=e192]:
                  - img [ref=e193]
                - img [ref=e201]
                - button "教育经历" [ref=e204] [cursor=pointer]:
                  - strong [ref=e205]: 教育经历
                  - generic [ref=e206]: 0 个条目
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
                - button "展开或收起教育经历" [ref=e207] [cursor=pointer]:
                  - img [ref=e208]
              - generic [ref=e211]:
                - button "拖动排序：工作经历，Alt加方向键移动" [ref=e212]:
                  - img [ref=e213]
                - img [ref=e221]
                - button "工作经历" [ref=e224] [cursor=pointer]:
                  - strong [ref=e225]: 工作经历
                  - generic [ref=e226]: 0 个条目
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
                - button "展开或收起工作经历" [ref=e227] [cursor=pointer]:
                  - img [ref=e228]
              - generic [ref=e231]:
                - button "拖动排序：实习经历，Alt加方向键移动" [ref=e232]:
                  - img [ref=e233]
                - img [ref=e241]
                - button "实习经历" [ref=e244] [cursor=pointer]:
                  - strong [ref=e245]: 实习经历
                  - generic [ref=e246]: 0 个条目
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
                - button "展开或收起实习经历" [ref=e247] [cursor=pointer]:
                  - img [ref=e248]
              - generic [ref=e251]:
                - button "拖动排序：项目经历，Alt加方向键移动" [ref=e252]:
                  - img [ref=e253]
                - img [ref=e261]
                - button "项目经历" [ref=e266] [cursor=pointer]:
                  - strong [ref=e267]: 项目经历
                  - generic [ref=e268]: 1 个条目
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
                - button "展开或收起项目经历" [ref=e269] [cursor=pointer]:
                  - img [ref=e270]
              - generic [ref=e273]:
                - button "拖动排序：专业技能，Alt加方向键移动" [ref=e274]:
                  - img [ref=e275]
                - img [ref=e283]
                - button "专业技能" [ref=e285] [cursor=pointer]:
                  - strong [ref=e286]: 专业技能
                  - generic [ref=e287]: 0 个条目
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
                - button "展开或收起专业技能" [ref=e288] [cursor=pointer]:
                  - img [ref=e289]
            - region "添加或管理简历栏目" [ref=e291]:
              - strong [ref=e293]: 添加板块
              - generic [ref=e294]:
                - button "+ 科研经历" [ref=e295] [cursor=pointer]:
                  - generic [ref=e296]: + 科研经历
                - button "+ 校园经历" [ref=e297] [cursor=pointer]:
                  - generic [ref=e298]: + 校园经历
                - button "+ 志愿经历" [ref=e299] [cursor=pointer]:
                  - generic [ref=e300]: + 志愿经历
                - button "+ 培训经历" [ref=e301] [cursor=pointer]:
                  - generic [ref=e302]: + 培训经历
                - button "+ 奖项荣誉" [ref=e303] [cursor=pointer]:
                  - generic [ref=e304]: + 奖项荣誉
                - button "+ 证书" [ref=e305] [cursor=pointer]:
                  - generic [ref=e306]: + 证书
                - button "+ 语言能力" [ref=e307] [cursor=pointer]:
                  - generic [ref=e308]: + 语言能力
                - button "+ 论文与出版物" [ref=e309] [cursor=pointer]:
                  - generic [ref=e310]: + 论文与出版物
                - button "+ 专利" [ref=e311] [cursor=pointer]:
                  - generic [ref=e312]: + 专利
                - button "+ 作品集" [ref=e313] [cursor=pointer]:
                  - generic [ref=e314]: + 作品集
                - button "+ 其他内容" [ref=e315] [cursor=pointer]:
                  - generic [ref=e316]: + 其他内容
              - generic [ref=e317]:
                - text: 自定义栏目
                - textbox "自定义栏目" [ref=e318]:
                  - /placeholder: 例如：开源贡献
              - button "创建自定义栏目" [ref=e319] [cursor=pointer]
        - button "拖拽调整字段面板与 A4 预览宽度" [ref=e320]
        - separator "调整设置栏宽度" [ref=e321]
        - complementary "简历排版设置" [ref=e322]:
          - generic [ref=e323]:
            - heading "页面排版" [level=2] [ref=e324]
            - paragraph [ref=e325]: 调整字体、间距、主题色。
            - button "折叠设置栏" [ref=e326] [cursor=pointer]: ›
          - tablist "排版设置" [ref=e327]:
            - tab "排版" [selected] [ref=e328] [cursor=pointer]
            - tab "样式" [ref=e329] [cursor=pointer]
            - tab "页面" [ref=e330] [cursor=pointer]
            - tab "模板" [ref=e331] [cursor=pointer]
          - generic [ref=e333]:
            - generic [ref=e334]:
              - heading "全局排版" [level=3] [ref=e335]
              - generic [ref=e336]:
                - generic [ref=e337]: 全局字号
                - generic [ref=e338]:
                  - generic [ref=e339]:
                    - button "减少全局字号" [ref=e340] [cursor=pointer]: −
                    - spinbutton "全局字号" [ref=e341]: "12.4"
                    - button "增加全局字号" [ref=e342] [cursor=pointer]: +
                  - generic [ref=e343]: px
              - generic [ref=e344]:
                - generic [ref=e345]: 行间距
                - generic [ref=e346]:
                  - generic [ref=e347]:
                    - button "减少行间距" [ref=e348] [cursor=pointer]: −
                    - spinbutton "行间距" [ref=e349]: "1.48"
                    - button "增加行间距" [ref=e350] [cursor=pointer]: +
                  - generic [ref=e351]: 倍
              - generic [ref=e352]:
                - generic [ref=e353]: 字间距
                - generic [ref=e354]:
                  - generic [ref=e355]:
                    - button "减少字间距" [ref=e356] [cursor=pointer]: −
                    - spinbutton "字间距" [ref=e357]: "0"
                    - button "增加字间距" [ref=e358] [cursor=pointer]: +
                  - generic [ref=e359]: px
              - generic [ref=e360]:
                - generic [ref=e361]: 板块间距
                - generic [ref=e362]:
                  - generic [ref=e363]:
                    - button "减少板块间距" [ref=e364] [cursor=pointer]: −
                    - spinbutton "板块间距" [ref=e365]: "18.9"
                    - button "增加板块间距" [ref=e366] [cursor=pointer]: +
                  - generic [ref=e367]: px
            - generic [ref=e368]:
              - heading "局部字号微调" [level=3] [ref=e369]
              - generic [ref=e370]:
                - generic [ref=e371]:
                  - generic [ref=e372]: 姓名
                  - generic [ref=e374]:
                    - button "减少姓名" [ref=e375] [cursor=pointer]: −
                    - spinbutton "姓名" [ref=e376]: "2.26"
                    - button "增加姓名" [ref=e377] [cursor=pointer]: +
                - generic [ref=e378]:
                  - generic [ref=e379]: 板块标题
                  - generic [ref=e381]:
                    - button "减少板块标题" [ref=e382] [cursor=pointer]: −
                    - spinbutton "板块标题" [ref=e383]: "1.2"
                    - button "增加板块标题" [ref=e384] [cursor=pointer]: +
                - generic [ref=e385]:
                  - generic [ref=e386]: 联系方式
                  - generic [ref=e388]:
                    - button "减少联系方式" [ref=e389] [cursor=pointer]: −
                    - spinbutton "联系方式" [ref=e390]: "0.95"
                    - button "增加联系方式" [ref=e391] [cursor=pointer]: +
                - generic [ref=e392]:
                  - generic [ref=e393]: 正文描述
                  - generic [ref=e395]:
                    - button "减少正文描述" [ref=e396] [cursor=pointer]: −
                    - spinbutton "正文描述" [ref=e397]: "1"
                    - button "增加正文描述" [ref=e398] [cursor=pointer]: +
                - generic [ref=e399]:
                  - generic [ref=e400]: 经历标题
                  - generic [ref=e402]:
                    - button "减少经历标题" [ref=e403] [cursor=pointer]: −
                    - spinbutton "经历标题" [ref=e404]: "1"
                    - button "增加经历标题" [ref=e405] [cursor=pointer]: +
                - generic [ref=e406]:
                  - generic [ref=e407]: 求职意向
                  - generic [ref=e409]:
                    - button "减少求职意向" [ref=e410] [cursor=pointer]: −
                    - spinbutton "求职意向" [ref=e411]: "1.07"
                    - button "增加求职意向" [ref=e412] [cursor=pointer]: +
            - generic [ref=e413]:
              - heading "排版密度" [level=3] [ref=e414]
              - generic [ref=e415]:
                - generic [ref=e416]: 密度预设
                - group "密度预设" [ref=e417]:
                  - button "紧凑" [ref=e418] [cursor=pointer]
                  - button "标准" [pressed] [ref=e419] [cursor=pointer]
                  - button "宽松" [ref=e420] [cursor=pointer]
        - generic [ref=e421]:
          - generic [ref=e424]:
            - generic [ref=e425]: 第 1 页 / 共 1 页
            - article "A4 简历预览第 1 页" [ref=e426]:
              - generic [ref=e427]:
                - heading "A2匿名候选人" [level=1] [ref=e429] [cursor=pointer]
                - generic [ref=e431] [cursor=pointer]: a2@example.org
              - generic [ref=e432]:
                - heading "项目经历" [level=2] [ref=e433] [cursor=pointer]
                - article [ref=e435] [cursor=pointer]:
                  - generic [ref=e436]:
                    - heading "原项目名称" [level=3] [ref=e437]
                    - strong [ref=e438]:
                      - generic [ref=e439]: 项目成员
                    - time [ref=e440]:
                      - generic [ref=e441]: "2025.01"
                      - generic [ref=e442]: –2025.06
                  - paragraph [ref=e443]: 参与接口测试。
                  - list [ref=e444]:
                    - listitem [ref=e445]: 执行接口测试。
                    - listitem [ref=e446]: SQL 查询验证。
          - generic "A4 预览工具":
            - generic: 1 页
            - group "画布缩放" [ref=e447]:
              - button "缩小预览" [ref=e448] [cursor=pointer]: "-"
              - generic [ref=e449]: 44%
              - button "放大预览" [ref=e450] [cursor=pointer]: +
              - button "适合宽度" [ref=e451] [cursor=pointer]
              - button "整页" [ref=e452] [cursor=pointer]
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
  37  |   // Explicit Branch URL waits for hydration instead of racing the transient list/restore view.
  38  |   const sourceId = (await readStore(page, "resumeBranches")).find(b => b.branchPurpose === "general")!.id as string;
  39  |   await page.goto(`/resume?branchId=${encodeURIComponent(sourceId)}`);
  40  |   await page.locator("details.toolbar-more > summary").click();
  41  |   await page.getByTestId("open-resume-import").click();
> 42  |   await dialog.getByText("粘贴 JSON", { exact: true }).click();
      |                                                      ^ TimeoutError: locator.click: Timeout 15000ms exceeded.
  43  |   await dialog.getByLabel("JSON 内容").fill(JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN",
  44  |     basics: { name: "A2匿名候选人", portfolioLinks: [], otherLinks: [], customFields: [] },
  45  |     sections: [{ id: "skills", sectionType: "skills", title: "专业技能", order: 0, visible: true,
  46  |       items: [{ id: "a2-sql", sectionType: "skills", name: "SQL", description: "使用 SQL 执行查询验证。", customFields: [] }] }], unclassifiedBlocks: [] }));
  47  |   await dialog.getByRole("button", { name: "导入 JSON", exact: true }).click();
  48  |   await dialog.locator("label.import-target-option").filter({ hasText: "导入到已有资料" }).click();
  49  |   await dialog.locator('input[name="import-create-general-resume"]').uncheck();
  50  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "确认此字段", exact: true }).count(); i++) await page.getByRole("button", { name: "确认此字段", exact: true }).first().click();
  51  |   for (let i = 0; i < 40 && await page.getByRole("button", { name: "核对并保留来源", exact: true }).count(); i++) await page.getByRole("button", { name: "核对并保留来源", exact: true }).first().click();
  52  |   await dialog.locator(".import-review-footer button.primary-button").click();
  53  |   await expect.poll(async () => (await readStore(page, "profiles")).some(p => (p.skills as Array<{ name: string }>).some(s => s.name === "SQL"))).toBe(true);
  54  |   const initial = await formal(page);
  55  |   const branch = initial.branches.find(b => b.branchPurpose === "general") as unknown as ResumeBranch;
  56  |   expect(branch).toBeTruthy();
  57  |   await page.goto("/ai-workspace"); await page.getByRole("button", { name: "新任务", exact: true }).click();
  58  |   const panel = page.getByTestId("structured-resume-editor"); await panel.locator("summary").first().click();
  59  |   await mkdir(evidenceDir, { recursive: true });
  60  |   const operations = ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"];
  61  |   let factRevisionId = "";
  62  |   for (const operation of operations) {
  63  |     if (operation !== operations[0]) await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  64  |     await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  65  |     await panel.getByLabel("结构化操作", { exact: true }).selectOption(operation);
  66  |     const target = panel.getByLabel("结构化修改目标", { exact: true });
  67  |     const options = await target.locator("option").allTextContents();
  68  |     const index = operation === "fact_correction" ? options.findIndex(t => t.includes("项目名称"))
  69  |       : operation === "bullet_removal" ? options.findIndex(t => t.includes("要点 3")) : 1;
  70  |     expect(index).toBeGreaterThan(0); await target.selectOption({ index });
  71  |     if (operation === "fact_correction") await panel.getByLabel("我的纠正内容", { exact: true }).fill("用户更正的新项目名称");
  72  |     if (operation === "bullet_reordering") await panel.getByLabel("要点新顺序", { exact: true }).fill("2,1");
  73  |     const before = await formal(page);
  74  |     await panel.getByRole("button", { name: "生成结构化审核提案", exact: true }).click();
  75  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  76  |     expect((await formal(page)).revisions).toEqual(before.revisions);
  77  |     await page.reload(); await panel.locator("summary").first().click();
  78  |     await expect(panel.getByRole("region", { name: "结构化修改审核" })).toBeVisible();
  79  |     await page.setViewportSize({ width: 1024, height: 900 });
  80  |     const confirm = panel.getByRole("button", { name: "确认结构化修改", exact: true });
  81  |     await expect(confirm).toBeVisible();
  82  |     await page.screenshot({ path: info.outputPath(`${operation}-review-1024.png`), fullPage: true });
  83  |     await page.setViewportSize({ width: 1440, height: 1000 });
  84  |     await page.screenshot({ path: info.outputPath(`${operation}-review-wide.png`), fullPage: true });
  85  |     await confirm.click();
  86  |     await expect(panel.getByText(/已保存版本：/)).toBeVisible();
  87  |     const after = await formal(page), changed = after.branches.find(b => b.id === branch.id) as unknown as ResumeBranch;
  88  |     const revisionId = changed.currentRevisionId!;
  89  |     if (operation === "fact_correction") factRevisionId = revisionId;
  90  |     expect(after.profiles).toEqual(before.profiles);
  91  |     expect(after.branches.filter(b => b.id !== branch.id)).toEqual(before.branches.filter(b => b.id !== branch.id));
  92  |     expect(after.revisions).toHaveLength(before.revisions.length + 1);
  93  |     expect(after.revisions.filter(r => r.id !== revisionId)).toEqual(before.revisions);
  94  |     const original = (before.branches.find(b => b.id === branch.id) as unknown as ResumeBranch), expected = structuredClone(original);
  95  |     const project = expected.structuredContentItems!.find(i => i.data.sectionType === "project")!;
  96  |     if (operation === "confirmed_skill_addition") {
  97  |       expect(changed.structuredContentItems!.slice(0, -1)).toEqual(expected.structuredContentItems);
  98  |       expect(changed.contentItems.slice(0, -1)).toEqual(expected.contentItems);
  99  |     } else {
  100 |       const next = changed.structuredContentItems!.find(i => i.id === project.id)!;
  101 |       expect(changed.structuredContentItems!.filter(i => i.id !== project.id)).toEqual(expected.structuredContentItems!.filter(i => i.id !== project.id));
  102 |       expect(changed.contentItems.filter(i => i.id !== project.id)).toEqual(expected.contentItems.filter(i => i.id !== project.id));
  103 |       expect(next.data).toEqual({ ...project.data, ...(operation === "fact_correction" ? { title: "用户更正的新项目名称" }
  104 |         : { highlights: operation === "bullet_removal" ? ["执行接口测试。", "SQL 查询验证。"] : ["SQL 查询验证。", "执行接口测试。"] }) });
  105 |       expect(next.factRefs).toEqual(project.factRefs);
  106 |     }
  107 |     expect(changed).toEqual({ ...original, structuredContentItems: changed.structuredContentItems, contentItems: changed.contentItems,
  108 |       revision: original.revision + 1, currentRevisionId: revisionId, updatedAt: changed.updatedAt });
  109 |     const receipt = after.operations.find(r => r.revisionId === revisionId); expect(receipt).toBeTruthy();
  110 |     await page.reload(); await panel.locator("summary").first().click();
  111 |     await expect(panel.getByText(`已保存版本：${revisionId}`, { exact: true })).toBeVisible();
  112 |     expect((await formal(page)).revisions).toEqual(after.revisions);
  113 |     await writeFile(`${evidenceDir}/${operation}.json`, JSON.stringify({ before, after, receipt }, null, 2));
  114 |     if (operation === "confirmed_skill_addition") {
  115 |       await panel.getByRole("button", { name: "开始另一项结构化操作", exact: true }).click();
  116 |       await panel.getByLabel("结构化修改简历", { exact: true }).selectOption(branch.id);
  117 |       await panel.getByLabel("结构化操作", { exact: true }).selectOption("confirmed_skill_addition");
  118 |       await expect(panel.getByLabel("结构化修改目标", { exact: true }).locator("option").filter({ hasText: "SQL（已存在）" })).toBeDisabled();
  119 |       // A reload restores the saved authoritative outcome; no new task has been selected or committed.
  120 |       await page.reload(); await panel.locator("summary").first().click();
  121 |     }
  122 |   }
  123 |   // The first correction remains traceable after three subsequent tasks replaced its TaskState proposal.
  124 |   await page.goto(`/resume?branchId=${encodeURIComponent(branch.id)}`);
  125 |   await page.locator("details.toolbar-more > summary").click();
  126 |   await page.getByText("查询版本操作来源", { exact: true }).click();
  127 |   await page.getByLabel("历史版本来源", { exact: true }).selectOption(factRevisionId);
  128 |   const historical = page.getByTestId("precise-revision-evidence"); await historical.locator("summary").click();
  129 |   await expect(historical.getByText("原始纠正声明：用户更正的新项目名称", { exact: true })).toBeVisible();
  130 |   await page.screenshot({ path: info.outputPath("historical-source.png"), fullPage: true });
  131 |   expect((await formal(page)).profiles).toEqual(initial.profiles);
  132 |   expect(providerCalls).toBe(0);
  133 |   await writeFile(`${evidenceDir}/summary.json`, JSON.stringify({ operations, factRevisionId, providerCalls, final: await formal(page) }, null, 2));
  134 | });
  135 | 
```