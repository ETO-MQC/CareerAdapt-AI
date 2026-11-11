# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: p522-core-closure.spec.ts >> E2E-B: material edit/reject, refresh confirmation, Agent stop and edited-message recovery
- Location: tests\e2e\p522-core-closure.spec.ts:58:5

# Error details

```
Error: locator.fill: Error: strict mode violation: getByRole('dialog', { name: '导入资料', exact: true }).getByLabel('材料候选颁发方', { exact: true }) resolved to 2 elements:
    1) <input value="原机构" aria-label="材料候选颁发方"/> aka getByRole('definition').filter({ hasText: '证书名称颁发方颁发日期证书编号说明修改保留为用户编辑，请采用此条后再正式确认。' }).getByLabel('材料候选颁发方')
    2) <input value="" aria-label="材料候选颁发方"/> aka getByRole('definition').filter({ hasText: '奖项名称颁发方获奖日期说明修改保留为用户编辑，请采用此条后再正式确认。' }).getByLabel('材料候选颁发方')

Call log:
  - waiting for getByRole('dialog', { name: '导入资料', exact: true }).getByLabel('材料候选颁发方', { exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e12]:
    - complementary "AI 工作区导航" [ref=e13]:
      - generic [ref=e14]:
        - link "职适AI 首页" [ref=e15] [cursor=pointer]:
          - /url: /
          - generic [ref=e16]: 职
          - generic [ref=e17]: 职适AI
        - button "收起 AI 导航" [ref=e18] [cursor=pointer]:
          - img [ref=e19]
      - generic [ref=e22]:
        - button "新任务" [ref=e23] [cursor=pointer]:
          - img [ref=e24]
          - generic [ref=e25]: 新任务
        - button "搜索 / 历史" [ref=e26] [cursor=pointer]:
          - img [ref=e27]
          - generic [ref=e30]: 搜索 / 历史
      - navigation "资产" [ref=e31]:
        - generic [ref=e32]: 资产
        - link "AI 助手" [ref=e33] [cursor=pointer]:
          - /url: /ai-workspace
          - img [ref=e34]
          - generic [ref=e37]: AI 助手
        - link "我的简历" [ref=e38] [cursor=pointer]:
          - /url: /resume
          - img [ref=e39]
          - generic [ref=e42]: 我的简历
        - link "个人资料库" [ref=e43] [cursor=pointer]:
          - /url: /profile
          - img [ref=e44]
          - generic [ref=e47]: 个人资料库
        - link "岗位" [ref=e48] [cursor=pointer]:
          - /url: /jobs
          - img [ref=e49]
          - generic [ref=e53]: 岗位
        - link "求职进度" [ref=e54] [cursor=pointer]:
          - /url: /applications
          - img [ref=e55]
          - generic [ref=e57]: 求职进度
        - link "回收站" [ref=e58] [cursor=pointer]:
          - /url: /recycle
          - img [ref=e59]
          - generic [ref=e66]: 回收站
      - region "最近任务" [ref=e67]:
        - text: 最近任务
        - paragraph [ref=e68]: 完成第一条任务后会显示在这里。
      - generic [ref=e69]:
        - generic "工作区模式" [ref=e70]:
          - button "AI" [pressed] [ref=e71] [cursor=pointer]:
            - generic [ref=e72]: AI
          - button "协作" [ref=e73] [cursor=pointer]:
            - generic [ref=e74]: 协作
          - button "手动" [ref=e75] [cursor=pointer]:
            - generic [ref=e76]: 手动
        - link "设置与更多" [ref=e77] [cursor=pointer]:
          - /url: /settings
          - img [ref=e78]
          - generic [ref=e81]: 设置与更多
        - generic [ref=e82]:
          - generic [ref=e83]: CA
          - generic [ref=e84]:
            - strong [ref=e85]: 求职工作区
            - generic [ref=e86]: 本地数据
    - main [ref=e89]:
      - generic [ref=e91]:
        - heading "我的简历" [level=1] [ref=e92]
        - generic [ref=e93]: 0 份当前简历 · 7 条经历 · 5 项基础信息
      - region "当前人物与版本" [ref=e94]:
        - generic [ref=e95]:
          - generic [ref=e96]: 同
          - generic [ref=e97]:
            - generic [ref=e98]:
              - strong [ref=e99]: 同学
              - generic [ref=e100]: V1
              - generic [ref=e101]: 当前
            - generic [ref=e102]:
              - generic [ref=e103]: 创建于 2026/07/01
              - generic [ref=e104]: 7 条经历 · 5 项基础信息
              - generic [ref=e105]: 0 份简历
        - generic [ref=e106]:
          - button "管理人物与版本" [ref=e107] [cursor=pointer]:
            - img [ref=e108]
            - text: 管理人物与版本
          - group [ref=e111]:
            - generic "更多人物与版本操作" [ref=e112] [cursor=pointer]:
              - img [ref=e113]
      - generic [ref=e117]:
        - article [ref=e118]:
          - generic [ref=e119]:
            - button "导入已有简历 核对来源后创建通用简历" [ref=e120] [cursor=pointer]:
              - strong [ref=e121]: 导入已有简历
              - generic [ref=e122]: 核对来源后创建通用简历
            - button "根据岗位创建 需要先在岗位工作区生成草稿" [disabled] [ref=e123]:
              - strong [ref=e124]: 根据岗位创建
              - generic [ref=e125]: 需要先在岗位工作区生成草稿
            - button "从个人资料库创建 复制已确认信息，之后由你决定是否再次同步" [ref=e126] [cursor=pointer]:
              - strong [ref=e127]: 从个人资料库创建
              - generic [ref=e128]: 复制已确认信息，之后由你决定是否再次同步
            - button "从零创建 不带入资料库内容，从空白字段开始" [ref=e129] [cursor=pointer]:
              - strong [ref=e130]: 从零创建
              - generic [ref=e131]: 不带入资料库内容，从空白字段开始
            - button "导入资料 证书、奖项、成绩单与经历证明" [ref=e132] [cursor=pointer]:
              - strong [ref=e133]: 导入资料
              - generic [ref=e134]: 证书、奖项、成绩单与经历证明
            - dialog "导入资料" [ref=e136]:
              - generic [ref=e137]:
                - generic [ref=e138]:
                  - heading "导入资料" [level=2] [ref=e139]
                  - paragraph [ref=e140]: 证书、奖项、成绩单与经历证明，核对后加入个人资料库。
                - button "关闭导入窗口" [ref=e141] [cursor=pointer]: ×
              - generic [ref=e143]:
                - generic [ref=e144]:
                  - paragraph [ref=e145]: 来源：p522-material.json
                  - button "选择另一份材料" [ref=e146] [cursor=pointer]
                - generic [ref=e147]:
                  - status [ref=e148]: 等待核对。已切换目标或用途，请重新核对并明确确认。
                  - button "选择要导入的简历文件" [ref=e149]
                  - group "导入目标" [ref=e150]:
                    - generic [ref=e151]: 导入目标
                    - generic [ref=e152]:
                      - text: 材料用途
                      - textbox "材料用途" [ref=e153]: 补充个人资料
                    - generic [ref=e154]:
                      - generic [ref=e155]:
                        - generic [ref=e156] [cursor=pointer]:
                          - radio "导入到已有资料" [ref=e157]
                          - text: 导入到已有资料
                        - generic [ref=e158] [cursor=pointer]:
                          - radio "创建新人物" [checked] [ref=e159]
                          - text: 创建新人物
                      - generic [ref=e160]:
                        - generic [ref=e161]:
                          - text: 人物名称
                          - textbox "人物名称" [active] [ref=e162]:
                            - /placeholder: 将从导入姓名预填
                            - text: P522 合成人物
                        - generic [ref=e163]:
                          - checkbox "同时创建通用简历" [disabled] [ref=e164]
                          - text: 同时创建通用简历
                  - region "识别方式" [ref=e165]:
                    - strong [ref=e166]: 识别方式
                    - generic "已使用的识别方式" [ref=e167]:
                      - generic [ref=e168]: 仅人工核对
                      - generic [ref=e169]: 仅本地
                    - group [ref=e170]:
                      - generic "路线详情" [ref=e171] [cursor=pointer]
                  - generic [ref=e172]:
                    - generic [ref=e173]:
                      - heading "核对结构" [level=3] [ref=e174]
                      - generic [ref=e175]: 0 项待处理
                      - generic [ref=e176]: 字段候选 0 项待确认 · 结构条目 0 项待确认 · 未识别来源 0 项 · 结构冲突 0 项
                    - group [ref=e177]:
                      - generic "批量操作" [ref=e178] [cursor=pointer]
                  - generic [ref=e179]:
                    - complementary [ref=e180]:
                      - group [ref=e181]:
                        - generic "原始材料与来源：p522-material.json" [ref=e182]
                        - paragraph [ref=e183]:
                          - text: SHA-256：
                          - code [ref=e184]: e48ff13da626a57b3ce533466ec7147a333e191271e6412553eabf5afd88b795
                        - paragraph [ref=e185]: 分类：UNKNOWN / REVIEW_REQUIRED · 用途：补充个人资料
                        - link "查看 / 下载原附件" [ref=e186] [cursor=pointer]:
                          - /url: blob:http://127.0.0.1:3198/3ca93501-2cc9-4555-bf09-bcbef0b6be88
                        - paragraph [ref=e187]: 识别置信度只描述识别结果，不代表事实真实性。人工修改保存在候选中。
                        - group [ref=e188]:
                          - generic "第 1 页 · 来源块 1 · json_mapper · 100%" [ref=e189]
                        - group [ref=e190]:
                          - generic "第 1 页 · 来源块 2 · json_mapper · 100%" [ref=e191]
                        - group [ref=e192]:
                          - generic "第 1 页 · 来源块 3 · json_mapper · 100%" [ref=e193]
                        - group [ref=e194]:
                          - generic "第 1 页 · 来源块 4 · json_mapper · 100%" [ref=e195]
                        - group [ref=e196]:
                          - generic "第 1 页 · 来源块 5 · json_mapper · 100%" [ref=e197]
                        - group [ref=e198]:
                          - generic "第 1 页 · 来源块 6 · json_mapper · 100%" [ref=e199]
                        - group [ref=e200]:
                          - generic "第 1 页 · 来源块 7 · json_mapper · 100%" [ref=e201]
                        - group [ref=e202]:
                          - generic "第 1 页 · 来源块 8 · json_mapper · 100%" [ref=e203]
                        - group [ref=e204]:
                          - generic "第 1 页 · 来源块 9 · json_mapper · 100%" [ref=e205]
                        - group [ref=e206]:
                          - generic "第 1 页 · 来源块 10 · json_mapper · 100%" [ref=e207]
                        - group [ref=e208]:
                          - generic "第 1 页 · 来源块 11 · json_mapper · 100%" [ref=e209]
                        - group [ref=e210]:
                          - generic "第 1 页 · 来源块 12 · json_mapper · 100%" [ref=e211]
                        - group [ref=e212]:
                          - generic "第 1 页 · 来源块 13 · json_mapper · 100%" [ref=e213]
                        - group [ref=e214]:
                          - generic "第 1 页 · 来源块 14 · json_mapper · 100%" [ref=e215]
                        - group [ref=e216]:
                          - generic "第 1 页 · 来源块 15 · json_mapper · 100%" [ref=e217]
                        - group [ref=e218]:
                          - generic "第 1 页 · 来源块 16 · json_mapper · 100%" [ref=e219]
                        - group [ref=e220]:
                          - generic "第 1 页 · 来源块 17 · json_mapper · 100%" [ref=e221]
                        - group [ref=e222]:
                          - generic "第 1 页 · 来源块 18 · json_mapper · 100%" [ref=e223]
                        - group [ref=e224]:
                          - generic "第 1 页 · 来源块 19 · json_mapper · 100%" [ref=e225]
                      - status [ref=e226]:
                        - generic [ref=e227]:
                          - strong [ref=e228]: 标准 JSON
                          - text: 19 个来源块
                        - generic [ref=e229]:
                          - strong [ref=e230]: 标准结构校验
                          - text: 0 个字段候选
                        - generic [ref=e231]:
                          - strong [ref=e232]: 无遗漏项
                          - text: 0 个未识别来源
                      - generic "第 1 页来源文本" [ref=e233]: 证书 证书名称：P522 合成资格证书 颁发方：原机构 奖项 奖项名称：不应入库奖项
                      - paragraph [ref=e235]: 19 个来源块已保存；请对照原文件核对。
                    - generic [ref=e236]:
                      - generic [ref=e237]:
                        - strong [ref=e238]: 基本信息
                        - generic [ref=e239]:
                          - generic [ref=e241]:
                            - text: 姓名
                            - textbox "姓名" [ref=e242]
                          - generic [ref=e244]:
                            - text: 邮箱
                            - textbox "邮箱" [ref=e245]
                          - generic [ref=e247]:
                            - text: 电话
                            - textbox "电话" [ref=e248]
                          - generic [ref=e250]:
                            - text: 地点
                            - textbox "地点" [ref=e251]
                          - generic [ref=e253]:
                            - text: 求职意向
                            - textbox "求职意向" [ref=e254]
                          - generic [ref=e256]:
                            - text: 概述
                            - textbox "概述" [ref=e257]
                      - article [ref=e258]:
                        - generic [ref=e259]:
                          - generic [ref=e260]:
                            - checkbox "证书" [checked] [ref=e261]
                            - text: 证书
                          - combobox "证书栏目类型" [ref=e262]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历"
                            - option "项目成果"
                            - option "奖项"
                            - option "技能"
                            - option "证书" [selected]
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e263]:
                            - button "本栏目使用导入" [ref=e264] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e265] [cursor=pointer]
                        - generic [ref=e266]:
                          - generic [ref=e267]:
                            - checkbox "AI 已识别 / 第 1 页" [checked] [ref=e268]
                            - text: AI 已识别 / 第 1 页
                          - generic [ref=e269]:
                            - generic [ref=e270]:
                              - term [ref=e271]: 证书
                              - definition [ref=e272]: P522 合成资格证书
                            - generic [ref=e273]:
                              - term [ref=e274]: 颁发方
                              - definition [ref=e275]: 原机构
                            - generic [ref=e276]:
                              - term [ref=e277]: 编辑候选 / 补充信息
                              - definition [ref=e278]:
                                - generic [ref=e279]:
                                  - text: 证书名称
                                  - textbox "材料候选证书名称" [ref=e280]: P522 合成资格证书
                                - generic [ref=e281]:
                                  - text: 颁发方
                                  - textbox "材料候选颁发方" [ref=e282]: 原机构
                                - generic [ref=e283]:
                                  - text: 颁发日期
                                  - textbox "材料候选颁发日期" [ref=e284]
                                - generic [ref=e285]:
                                  - text: 证书编号
                                  - textbox "材料候选证书编号" [ref=e286]
                                - generic [ref=e287]:
                                  - text: 说明
                                  - textbox "材料候选说明" [ref=e288]
                                - generic [ref=e289]: 修改保留为用户编辑，请采用此条后再正式确认。
                          - group [ref=e290]:
                            - generic "查看来源原文" [ref=e291] [cursor=pointer]
                          - generic [ref=e292]:
                            - button "上移" [ref=e293] [cursor=pointer]
                            - button "下移" [ref=e294] [cursor=pointer]
                            - button "合并" [ref=e295] [cursor=pointer]
                            - button "拆分" [ref=e296] [cursor=pointer]
                      - article [ref=e297]:
                        - generic [ref=e298]:
                          - generic [ref=e299]:
                            - checkbox "奖项" [checked] [ref=e300]
                            - text: 奖项
                          - combobox "奖项栏目类型" [ref=e301]:
                            - option "个人概述"
                            - option "教育经历"
                            - option "工作经历"
                            - option "实习经历"
                            - option "项目成果"
                            - option "奖项" [selected]
                            - option "技能"
                            - option "证书"
                            - option "语言"
                            - option "其他材料"
                            - option "旧版经历（需拆分）"
                            - option "其他/待确认"
                          - generic [ref=e302]:
                            - button "本栏目使用导入" [ref=e303] [cursor=pointer]
                            - button "本栏目保留现有" [ref=e304] [cursor=pointer]
                        - generic [ref=e305]:
                          - generic [ref=e306]:
                            - checkbox "AI 已识别 / 第 1 页" [checked] [ref=e307]
                            - text: AI 已识别 / 第 1 页
                          - generic [ref=e308]:
                            - generic [ref=e309]:
                              - term [ref=e310]: 奖项
                              - definition [ref=e311]: 不应入库奖项
                            - generic [ref=e312]:
                              - term [ref=e313]: 编辑候选 / 补充信息
                              - definition [ref=e314]:
                                - generic [ref=e315]:
                                  - text: 奖项名称
                                  - textbox "材料候选奖项名称" [ref=e316]: 不应入库奖项
                                - generic [ref=e317]:
                                  - text: 颁发方
                                  - textbox "材料候选颁发方" [ref=e318]
                                - generic [ref=e319]:
                                  - text: 获奖日期
                                  - textbox "材料候选获奖日期" [ref=e320]
                                - generic [ref=e321]:
                                  - text: 说明
                                  - textbox "材料候选说明" [ref=e322]
                                - generic [ref=e323]: 修改保留为用户编辑，请采用此条后再正式确认。
                          - group [ref=e324]:
                            - generic "查看来源原文" [ref=e325] [cursor=pointer]
                          - generic [ref=e326]:
                            - button "上移" [ref=e327] [cursor=pointer]
                            - button "下移" [ref=e328] [cursor=pointer]
                            - button "合并" [ref=e329] [cursor=pointer]
                            - button "拆分" [ref=e330] [cursor=pointer]
                  - generic [ref=e331]:
                    - generic [ref=e332]:
                      - strong [ref=e333]: 2 条已选内容
                      - generic [ref=e334]: 创建新人物：P522 合成人物 · 已切换目标或用途，请重新核对并明确确认。
                    - generic [ref=e335]:
                      - button "取消" [ref=e336] [cursor=pointer]
                      - button "确认导入" [ref=e337] [cursor=pointer]
        - article [ref=e338]:
          - generic [ref=e339]:
            - heading "简历中心" [level=2] [ref=e340]
            - generic [ref=e341]: （0 份当前简历 / 0 份已归档 / 0 份在回收站）
          - tablist "简历筛选" [ref=e342]:
            - tab "最近 0" [selected] [ref=e343] [cursor=pointer]
            - tab "全部 0" [ref=e344] [cursor=pointer]
            - tab "通用 0" [ref=e345] [cursor=pointer]
            - tab "岗位 0" [ref=e346] [cursor=pointer]
            - tab "归档 0" [ref=e347] [cursor=pointer]
            - tab "回收站 0" [ref=e348] [cursor=pointer]
          - paragraph [ref=e349]: 当前筛选下暂无简历。可以先导入已有简历，或在岗位工作区生成岗位建议草稿后创建。
  - region "操作通知"
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import { prepareCoreSourceResume, completeCoreResumeWorkflow, readStore, verifyCoreResumePdf } from "./support/p51CoreWorkflow";
  3   | 
  4   | test.use({ actionTimeout: 15_000 });
  5   | 
  6   | async function setup(page: Page) {
  7   |   await page.goto("/setup");
  8   |   await expect.poll(async () => (await (await page.request.get("/api/agent/runtime/hermes/control")).json()).snapshot?.apiReady, { timeout: 90_000 }).toBe(true);
  9   |   await page.getByLabel("API 密钥", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_KEY!);
  10  |   await page.getByLabel("API 地址", { exact: true }).fill(process.env.HERMES_INTEGRATION_PROVIDER_URL!);
  11  |   await page.getByLabel("模型名称", { exact: true }).fill("careeradapt-test");
  12  |   await page.getByRole("button", { name: "开始使用", exact: true }).click();
  13  |   await expect(page).not.toHaveURL(/\/setup$/u, { timeout: 90_000 });
  14  | }
  15  | 
  16  | async function snapshot(page: Page) {
  17  |   return Object.fromEntries(await Promise.all(["profiles", "resumeBranches", "resumeRevisions", "jobDescriptions", "exportRecords"].map(async name => [name, await readStore(page, name)])));
  18  | }
  19  | 
  20  | test("E2E-A: official import, General PDF, Job A and Job B confirmed revisions remain isolated", async ({ page }, info) => {
  21  |   test.setTimeout(300_000);
  22  |   await setup(page);
  23  |   await prepareCoreSourceResume(page);
  24  |   const general = (await readStore(page, "resumeBranches")).find(b => b.branchPurpose === "general")!;
  25  |   expect(general).toBeTruthy();
  26  |   const baseline = await snapshot(page);
  27  |   await verifyCoreResumePdf(page, String(general.id));
  28  |   await info.attach("general-preview", { body: await page.screenshot(), contentType: "image/png" });
  29  |   let previous: Awaited<ReturnType<typeof snapshot>> | undefined;
  30  |   for (const suffix of ["A", "B"]) {
  31  |     await page.goto("/jobs");
  32  |     await page.getByTestId("job-title-input").fill(`AI 应用开发 P522-${suffix}`);
  33  |     await page.getByTestId("job-company-input").fill(`合成公司 ${suffix}`);
  34  |     await page.getByTestId("job-raw-textarea").fill("岗位职责\n1. 参与 AI 应用需求梳理和功能验收。\n任职要求\n1. 熟悉 Python 或 SQL。\n2. 团队协作能力优先。");
  35  |     await page.getByTestId("save-job-raw-input").click();
  36  |     await page.getByTestId("job-manual-mode-dialog").click();
  37  |     const dialog = page.getByRole("dialog");
  38  |     const checks = dialog.getByRole("checkbox");
  39  |     for (let i = 0; i < await checks.count(); i++) await checks.nth(i).check();
  40  |     await dialog.getByTestId("commit-job").click();
  41  |     await expect(page.getByTestId("conversion-result")).toBeVisible();
  42  |     const job = (await readStore(page, "jobDescriptions")).find(j => String(j.title).includes(`P522-${suffix}`))!;
  43  |     await completeCoreResumeWorkflow(page, String(job.id));
  44  |     const after = await snapshot(page);
  45  |     expect(after.profiles).toEqual(baseline.profiles);
  46  |     expect(after.resumeBranches.find(b => b.id === general.id)).toEqual(general);
  47  |     if (previous) {
  48  |       for (const branch of previous.resumeBranches) expect(after.resumeBranches.find(b => b.id === branch.id)).toEqual(branch);
  49  |       for (const revision of previous.resumeRevisions) expect(after.resumeRevisions.find(r => r.id === revision.id)).toEqual(revision);
  50  |     }
  51  |     previous = after;
  52  |     await info.attach(`job-${suffix}-preview`, { body: await page.screenshot(), contentType: "image/png" });
  53  |   }
  54  |   expect(previous!.resumeBranches.filter(b => b.profileId === general.profileId)).toHaveLength(3);
  55  |   await info.attach("business-before-after", { body: JSON.stringify({ baseline, after: previous }, null, 2), contentType: "application/json" });
  56  | });
  57  | 
  58  | test("E2E-B: material edit/reject, refresh confirmation, Agent stop and edited-message recovery", async ({ page }, info) => {
  59  |   test.setTimeout(240_000);
  60  |   await setup(page);
  61  |   await page.goto("/resume");
  62  |   const open = async () => {
  63  |     await page.getByRole("button", { name: "导入资料", exact: false }).click();
  64  |     return page.getByRole("dialog", { name: "导入资料", exact: true });
  65  |   };
  66  |   let dialog = await open();
  67  |   await dialog.getByLabel("识别方式").selectOption("local");
  68  |   const material = { schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { portfolioLinks: [], otherLinks: [], customFields: [] }, sections: [
  69  |     { id: "cert", sectionType: "certificates", title: "证书", order: 0, visible: true, items: [{ id: "cert1", sectionType: "certificates", name: "P522 合成资格证书", issuer: "原机构", customFields: [] }] },
  70  |     { id: "award", sectionType: "awards", title: "奖项", order: 1, visible: true, items: [{ id: "award1", sectionType: "awards", name: "不应入库奖项", customFields: [] }] }
  71  |   ], unclassifiedBlocks: [] };
  72  |   await dialog.getByLabel("选择职业材料").setInputFiles({ name: "p522-material.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(material)) });
  73  |   await expect(dialog.getByLabel("材料候选证书名称")).toHaveValue("P522 合成资格证书");
  74  |   const before = await snapshot(page);
  75  |   await dialog.getByText("创建新人物", { exact: true }).click();
  76  |   await dialog.locator('input[name="new-profile-name"]').fill("P522 合成人物");
  77  |   const issuer = dialog.getByLabel("材料候选颁发方", { exact: true });
> 78  |   await issuer.fill("人工核对机构"); await issuer.blur();
      |                ^ Error: locator.fill: Error: strict mode violation: getByRole('dialog', { name: '导入资料', exact: true }).getByLabel('材料候选颁发方', { exact: true }) resolved to 2 elements:
  79  |   await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  80  |   await dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="奖项栏目类型"]') }).locator('input[name$="-included"]').last().uncheck();
  81  |   expect(await snapshot(page)).toEqual(before);
  82  |   await page.reload(); dialog = await open();
  83  |   await expect(dialog.getByLabel("材料候选颁发方", { exact: true })).toHaveValue("人工核对机构");
  84  |   await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  85  |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  86  |   await expect(dialog).not.toBeVisible();
  87  |   await page.reload();
  88  |   const saved = await snapshot(page);
  89  |   expect(saved.resumeBranches).toEqual(before.resumeBranches);
  90  |   expect(saved.resumeRevisions).toEqual(before.resumeRevisions);
  91  |   const profile = saved.profiles.find(p => p.name === "P522 合成人物")!;
  92  |   expect(JSON.stringify(profile)).toContain("人工核对机构");
  93  |   expect(JSON.stringify(profile)).not.toContain("不应入库奖项");
  94  |   await page.goto("/ai-workspace");
  95  |   await expect(page.locator(".agent-runtime-status")).toHaveAttribute("aria-label", /状态 Ready/u, { timeout: 90_000 });
  96  |   await page.getByLabel("描述你的求职任务").fill("P522-STOP-A 读取当前资料，不要修改。");
  97  |   await page.getByRole("button", { name: "发送消息", exact: true }).click();
  98  |   const sessions = () => readStore(page, "agentSessions");
  99  |   await expect.poll(async () => (await sessions()).some(s => (s.hermesRun as { status?: string })?.status === "running"), { timeout: 60_000 }).toBe(true);
  100 |   await page.getByRole("button", { name: "停止运行", exact: true }).click();
  101 |   await expect(page.getByRole("button", { name: "停止运行", exact: true })).toBeDisabled();
  102 |   await page.getByRole("button", { name: "编辑并重发", exact: true }).last().click();
  103 |   await page.getByLabel("编辑消息", { exact: true }).fill("P522-EDIT-B 读取当前资料，仅概览。");
  104 |   await page.getByRole("button", { name: "确认并重发", exact: true }).click();
  105 |   await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("P522 当前资料已读取", { timeout: 90_000 });
  106 |   await page.reload();
  107 |   await expect(page.locator(".agent-message-row.is-assistant").last()).toContainText("P522 当前资料已读取");
  108 |   expect(await snapshot(page)).toEqual(saved);
  109 |   await info.attach("material-agent-before-after", { body: JSON.stringify({ before, saved, sessions: await sessions() }, null, 2), contentType: "application/json" });
  110 |   await info.attach("recovered-workspace", { body: await page.screenshot(), contentType: "image/png" });
  111 | });
  112 | 
```