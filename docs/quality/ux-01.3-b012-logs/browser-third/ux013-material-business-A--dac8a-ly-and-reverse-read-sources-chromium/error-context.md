# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-material-business.spec.ts >> A/C: edit, reject, restore review, confirm Profile-only and reverse-read sources
- Location: tests\e2e\ux013-material-business.spec.ts:37:5

# Error details

```
Error: locator.fill: Error: strict mode violation: getByRole('dialog', { name: '导入资料', exact: true }).getByLabel('材料候选颁发方', { exact: true }) resolved to 2 elements:
    1) <input value="匿名颁发机构" aria-label="材料候选颁发方"/> aka getByRole('definition').filter({ hasText: '证书名称颁发方颁发日期证书编号说明修改保留为用户编辑，请采用此条后再正式确认。' }).getByLabel('材料候选颁发方')
    2) <input value="" aria-label="材料候选颁发方"/> aka getByRole('definition').filter({ hasText: '奖项名称颁发方获奖日期说明修改保留为用户编辑，请采用此条后再正式确认。' }).getByLabel('材料候选颁发方')

Call log:
  - waiting for getByRole('dialog', { name: '导入资料', exact: true }).getByLabel('材料候选颁发方', { exact: true })

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
        - heading "我的简历" [level=1] [ref=e83]
        - generic [ref=e84]: 0 份当前简历 · 7 条经历 · 5 项基础信息
      - region "当前人物与版本" [ref=e85]:
        - generic [ref=e86]:
          - generic [ref=e87]: 同
          - generic [ref=e88]:
            - generic [ref=e89]:
              - strong [ref=e90]: 同学
              - generic [ref=e91]: V1
              - generic [ref=e92]: 当前
            - generic [ref=e93]:
              - generic [ref=e94]: 创建于 2026/07/01
              - generic [ref=e95]: 7 条经历 · 5 项基础信息
              - generic [ref=e96]: 0 份简历
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
            - dialog "导入资料" [ref=e127]:
              - generic [ref=e128]:
                - generic [ref=e129]:
                  - heading "导入资料" [level=2] [ref=e130]
                  - paragraph [ref=e131]: 证书、奖项、成绩单与经历证明，核对后加入个人资料库。
                - button "关闭导入窗口" [ref=e132] [cursor=pointer]: ×
              - generic [ref=e133]:
                - paragraph [ref=e134]: 来源：匿名证书.json
                - generic [ref=e135]:
                  - status [ref=e136]: 等待核对。已切换目标或用途，请重新核对并明确确认。
                  - button "选择要导入的简历文件" [ref=e137]
                  - group "导入目标" [ref=e138]:
                    - generic [ref=e139]: 导入目标
                    - generic [ref=e140]:
                      - text: 材料用途
                      - textbox "材料用途" [ref=e141]: profile_material
                    - generic [ref=e142]:
                      - generic [ref=e143]:
                        - generic [ref=e144] [cursor=pointer]:
                          - radio "导入到已有资料" [ref=e145]
                          - text: 导入到已有资料
                        - generic [ref=e146] [cursor=pointer]:
                          - radio "创建新人物" [checked] [ref=e147]
                          - text: 创建新人物
                      - generic [ref=e148]:
                        - generic [ref=e149]:
                          - text: 人物名称
                          - textbox "人物名称" [active] [ref=e150]:
                            - /placeholder: 将从导入姓名预填
                            - text: B012匿名人物
                        - generic [ref=e151]:
                          - checkbox "同时创建通用简历" [disabled] [ref=e152]
                          - text: 同时创建通用简历
                  - region "识别方式" [ref=e153]:
                    - strong [ref=e154]: 识别方式
                    - generic "已使用的识别方式" [ref=e155]:
                      - generic [ref=e156]: 仅人工核对
                      - generic [ref=e157]: 仅本地
                    - group [ref=e158]:
                      - generic "路线详情" [ref=e159] [cursor=pointer]
                  - generic [ref=e160]:
                    - generic [ref=e161]:
                      - heading "核对结构" [level=3] [ref=e162]
                      - generic [ref=e163]: 0 项待处理
                      - generic [ref=e164]: 字段候选 0 项待确认 · 结构条目 0 项待确认 · 未识别来源 0 项 · 结构冲突 0 项
                    - group [ref=e165]:
                      - generic "批量操作" [ref=e166] [cursor=pointer]
                  - generic [ref=e167]:
                    - complementary [ref=e168]:
                      - group [ref=e169]:
                        - generic "原始材料与来源：匿名证书.json" [ref=e170]
                        - paragraph [ref=e171]:
                          - text: SHA-256：
                          - code [ref=e172]: d4213a997f0407fdba24eed1913244fc50fd8336ac0126dd96f44f2811a4ef8a
                        - paragraph [ref=e173]: 分类：UNKNOWN / REVIEW_REQUIRED · 用途：profile_material
                        - link "查看 / 下载原附件" [ref=e174] [cursor=pointer]:
                          - /url: blob:http://127.0.0.1:3327/aa622ebe-1abf-45f4-b564-bc13d795cd9c
                        - paragraph [ref=e175]: 识别置信度只描述识别结果，不代表事实真实性。人工修改保存在候选中。
                        - group [ref=e176]:
                          - generic "第 1 页 · 来源块 1 · json_mapper · 100%" [ref=e177]
                        - group [ref=e178]:
                          - generic "第 1 页 · 来源块 2 · json_mapper · 100%" [ref=e179]
                        - group [ref=e180]:
                          - generic "第 1 页 · 来源块 3 · json_mapper · 100%" [ref=e181]
                        - group [ref=e182]:
                          - generic "第 1 页 · 来源块 4 · json_mapper · 100%" [ref=e183]
                        - group [ref=e184]:
                          - generic "第 1 页 · 来源块 5 · json_mapper · 100%" [ref=e185]
                        - group [ref=e186]:
                          - generic "第 1 页 · 来源块 6 · json_mapper · 100%" [ref=e187]
                        - group [ref=e188]:
                          - generic "第 1 页 · 来源块 7 · json_mapper · 100%" [ref=e189]
                        - group [ref=e190]:
                          - generic "第 1 页 · 来源块 8 · json_mapper · 100%" [ref=e191]
                        - group [ref=e192]:
                          - generic "第 1 页 · 来源块 9 · json_mapper · 100%" [ref=e193]
                        - group [ref=e194]:
                          - generic "第 1 页 · 来源块 10 · json_mapper · 100%" [ref=e195]
                        - group [ref=e196]:
                          - generic "第 1 页 · 来源块 11 · json_mapper · 100%" [ref=e197]
                        - group [ref=e198]:
                          - generic "第 1 页 · 来源块 12 · json_mapper · 100%" [ref=e199]
                        - group [ref=e200]:
                          - generic "第 1 页 · 来源块 13 · json_mapper · 100%" [ref=e201]
                        - group [ref=e202]:
                          - generic "第 1 页 · 来源块 14 · json_mapper · 100%" [ref=e203]
                        - group [ref=e204]:
                          - generic "第 1 页 · 来源块 15 · json_mapper · 100%" [ref=e205]
                        - group [ref=e206]:
                          - generic "第 1 页 · 来源块 16 · json_mapper · 100%" [ref=e207]
                        - group [ref=e208]:
                          - generic "第 1 页 · 来源块 17 · json_mapper · 100%" [ref=e209]
                        - group [ref=e210]:
                          - generic "第 1 页 · 来源块 18 · json_mapper · 100%" [ref=e211]
                        - group [ref=e212]:
                          - generic "第 1 页 · 来源块 19 · json_mapper · 100%" [ref=e213]
                        - group [ref=e214]:
                          - generic "第 1 页 · 来源块 20 · json_mapper · 100%" [ref=e215]
                      - status [ref=e216]:
                        - generic [ref=e217]:
                          - strong [ref=e218]: 标准 JSON
                          - text: 20 个来源块
                        - generic [ref=e219]:
                          - strong [ref=e220]: 标准结构校验
                          - text: 0 个字段候选
                        - generic [ref=e221]:
                          - strong [ref=e222]: 无遗漏项
                          - text: 0 个未识别来源
                      - generic "第 1 页来源文本" [ref=e223]: 证书 证书名称：匿名职业资格证书 颁发方：匿名颁发机构 颁发日期：2025-06 奖项 奖项名称：待拒绝团队奖项
                      - paragraph [ref=e225]: 20 个来源块已保存；请对照原文件核对。
                    - generic [ref=e226]:
                      - generic [ref=e227]:
                        - strong [ref=e228]: 基本信息
                        - generic [ref=e229]:
                          - generic [ref=e231]:
                            - text: 姓名
                            - textbox "姓名" [ref=e232]
                          - generic [ref=e234]:
                            - text: 邮箱
                            - textbox "邮箱" [ref=e235]
                          - generic [ref=e237]:
                            - text: 电话
                            - textbox "电话" [ref=e238]
                          - generic [ref=e240]:
                            - text: 地点
                            - textbox "地点" [ref=e241]
                          - generic [ref=e243]:
                            - text: 求职意向
                            - textbox "求职意向" [ref=e244]
                          - generic [ref=e246]:
                            - text: 概述
                            - textbox "概述" [ref=e247]
                      - article [ref=e248]:
                        - generic [ref=e249]:
                          - generic [ref=e250]:
                            - checkbox "AI 已识别 / 第 1 页" [checked] [ref=e251]
                            - text: AI 已识别 / 第 1 页
                          - generic [ref=e252]:
                            - generic [ref=e253]:
                              - term [ref=e254]: 证书
                              - definition [ref=e255]: 匿名职业资格证书
                            - generic [ref=e256]:
                              - term [ref=e257]: 颁发方
                              - definition [ref=e258]: 匿名颁发机构
                            - generic [ref=e259]:
                              - term [ref=e260]: 颁发日期
                              - definition [ref=e261]: 2025-06
                            - generic [ref=e262]:
                              - term [ref=e263]: 编辑候选 / 补充信息
                              - definition [ref=e264]:
                                - generic [ref=e265]:
                                  - text: 证书名称
                                  - textbox "材料候选证书名称" [ref=e266]: 匿名职业资格证书
                                - generic [ref=e267]:
                                  - text: 颁发方
                                  - textbox "材料候选颁发方" [ref=e268]: 匿名颁发机构
                                - generic [ref=e269]:
                                  - text: 颁发日期
                                  - textbox "材料候选颁发日期" [ref=e270]: 2025-06
                                - generic [ref=e271]:
                                  - text: 证书编号
                                  - textbox "材料候选证书编号" [ref=e272]
                                - generic [ref=e273]:
                                  - text: 说明
                                  - textbox "材料候选说明" [ref=e274]
                                - generic [ref=e275]: 修改保留为用户编辑，请采用此条后再正式确认。
                          - group [ref=e276]:
                            - generic "查看来源原文" [ref=e277] [cursor=pointer]
                          - generic [ref=e278]:
                            - button "上移" [ref=e279] [cursor=pointer]
                            - button "下移" [ref=e280] [cursor=pointer]
                            - button "合并" [ref=e281] [cursor=pointer]
                            - button "拆分" [ref=e282] [cursor=pointer]
                      - article [ref=e283]:
                        - generic [ref=e284]:
                          - generic [ref=e285]:
                            - checkbox "AI 已识别 / 第 1 页" [checked] [ref=e286]
                            - text: AI 已识别 / 第 1 页
                          - generic [ref=e287]:
                            - generic [ref=e288]:
                              - term [ref=e289]: 奖项
                              - definition [ref=e290]: 待拒绝团队奖项
                            - generic [ref=e291]:
                              - term [ref=e292]: 编辑候选 / 补充信息
                              - definition [ref=e293]:
                                - generic [ref=e294]:
                                  - text: 奖项名称
                                  - textbox "材料候选奖项名称" [ref=e295]: 待拒绝团队奖项
                                - generic [ref=e296]:
                                  - text: 颁发方
                                  - textbox "材料候选颁发方" [ref=e297]
                                - generic [ref=e298]:
                                  - text: 获奖日期
                                  - textbox "材料候选获奖日期" [ref=e299]
                                - generic [ref=e300]:
                                  - text: 说明
                                  - textbox "材料候选说明" [ref=e301]
                                - generic [ref=e302]: 修改保留为用户编辑，请采用此条后再正式确认。
                          - group [ref=e303]:
                            - generic "查看来源原文" [ref=e304] [cursor=pointer]
                          - generic [ref=e305]:
                            - button "上移" [ref=e306] [cursor=pointer]
                            - button "下移" [ref=e307] [cursor=pointer]
                            - button "合并" [ref=e308] [cursor=pointer]
                            - button "拆分" [ref=e309] [cursor=pointer]
                  - generic [ref=e310]:
                    - generic [ref=e311]:
                      - strong [ref=e312]: 2 条已选内容
                      - generic [ref=e313]: 创建新人物：B012匿名人物 · 已切换目标或用途，请重新核对并明确确认。
                    - generic [ref=e314]:
                      - button "取消" [ref=e315] [cursor=pointer]
                      - button "确认导入" [ref=e316] [cursor=pointer]
        - article [ref=e317]:
          - generic [ref=e318]:
            - heading "简历中心" [level=2] [ref=e319]
            - generic [ref=e320]: （0 份当前简历 / 0 份已归档 / 0 份在回收站）
          - tablist "简历筛选" [ref=e321]:
            - tab "最近 0" [selected] [ref=e322] [cursor=pointer]
            - tab "全部 0" [ref=e323] [cursor=pointer]
            - tab "通用 0" [ref=e324] [cursor=pointer]
            - tab "岗位 0" [ref=e325] [cursor=pointer]
            - tab "归档 0" [ref=e326] [cursor=pointer]
            - tab "回收站 0" [ref=e327] [cursor=pointer]
          - paragraph [ref=e328]: 当前筛选下暂无简历。可以先导入已有简历，或在岗位工作区生成岗位建议草稿后创建。
  - region "操作通知"
```

# Test source

```ts
  1  | import { expect, test, type Page } from "@playwright/test";
  2  | import { writeFile } from "node:fs/promises";
  3  | 
  4  | async function open(page: Page) {
  5  |   await page.goto("/resume");
  6  |   const skip = page.getByRole("button", { name: "跳过，先体验其他功能", exact: true });
  7  |   if (await skip.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) { await skip.click(); await page.goto("/resume"); }
  8  |   await expect(page.getByRole("button", { name: "导入资料", exact: false })).toBeVisible();
  9  |   await page.getByRole("button", { name: "导入资料", exact: false }).click();
  10 |   return page.getByRole("dialog", { name: "导入资料", exact: true });
  11 | }
  12 | function material(issuer = "匿名颁发机构", award = false) {
  13 |   return JSON.stringify({ schemaVersion: "careeradapt-resume-v2", locale: "zh-CN", basics: { portfolioLinks: [], otherLinks: [], customFields: [] },
  14 |     sections: [{ id: "certificates", sectionType: "certificates", title: "证书", order: 0, visible: true,
  15 |       items: [{ id: "certificate-one", sectionType: "certificates", name: "匿名职业资格证书", issuer, issuedAt: "2025-06", customFields: [] }] },
  16 |     ...(award ? [{ id: "awards", sectionType: "awards", title: "奖项", order: 1, visible: true, items: [{ id: "award-one", sectionType: "awards", name: "待拒绝团队奖项", customFields: [] }] }] : [])], unclassifiedBlocks: [] });
  17 | }
  18 | async function upload(page: Page, text: string) {
  19 |   const dialog = await open(page);
  20 |   await dialog.getByLabel("识别方式").selectOption("local");
  21 |   await dialog.getByLabel("选择职业材料").setInputFiles({ name: "匿名证书.json", mimeType: "application/json", buffer: Buffer.from(text) });
  22 |   await expect(dialog.getByLabel("材料候选证书名称")).toHaveValue("匿名职业资格证书");
  23 |   return dialog;
  24 | }
  25 | async function snapshot(page: Page) {
  26 |   return page.evaluate(() => new Promise<{ profiles: Array<{ id: string; name: string; version: number; certificates: Array<{ name: string; issuer?: string }>; structuredFacts?: Array<{ data: { sectionType: string; name?: string } }> }>; branches: unknown[]; revisions: unknown[]; meta: Array<{ key: string; value: unknown }> }>((resolve, reject) => {
  27 |     const request = indexedDB.open("CareerAdaptDb"); request.onerror = () => reject(request.error);
  28 |     request.onsuccess = () => {
  29 |       const db = request.result; const tx = db.transaction(["profiles", "resumeBranches", "resumeRevisions", "appMeta"], "readonly");
  30 |       const profiles = tx.objectStore("profiles").getAll(), branches = tx.objectStore("resumeBranches").getAll(), revisions = tx.objectStore("resumeRevisions").getAll(), meta = tx.objectStore("appMeta").getAll();
  31 |       tx.oncomplete = () => { db.close(); resolve({ profiles: profiles.result, branches: branches.result, revisions: revisions.result,
  32 |         meta: meta.result.filter((row) => /^(material-|imported-resume-draft:|profile-reconciliation:|resume-import-operation:)/u.test(row.key)) }); };
  33 |       tx.onerror = () => reject(tx.error);
  34 |     };
  35 |   }));
  36 | }
  37 | test("A/C: edit, reject, restore review, confirm Profile-only and reverse-read sources", async ({ page }, info) => {
  38 |   let dialog = await upload(page, material("匿名颁发机构", true));
  39 |   const before = await snapshot(page);
  40 |   await dialog.getByText("创建新人物", { exact: true }).click();
  41 |   await dialog.locator('input[name="new-profile-name"]').fill("B012匿名人物");
  42 |   const issuer = dialog.getByLabel("材料候选颁发方", { exact: true });
> 43 |   await issuer.fill("本人核对后的机构"); await issuer.blur();
     |                ^ Error: locator.fill: Error: strict mode violation: getByRole('dialog', { name: '导入资料', exact: true }).getByLabel('材料候选颁发方', { exact: true }) resolved to 2 elements:
  44 |   await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  45 |   const awardRow = dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="奖项栏目类型"]') });
  46 |   await awardRow.locator('input[name$="-included"]').last().uncheck();
  47 |   await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain("B012匿名人物");
  48 |   await page.screenshot({ path: info.outputPath("review-edited-source.png"), fullPage: true });
  49 |   const provisional = await snapshot(page); expect(provisional.profiles).toEqual(before.profiles); expect(provisional.revisions).toEqual(before.revisions);
  50 |   await page.reload(); dialog = await open(page);
  51 |   await expect(dialog.locator('input[name="new-profile-name"]')).toHaveValue("B012匿名人物");
  52 |   await expect(dialog.getByLabel("材料候选颁发方", { exact: true })).toHaveValue("本人核对后的机构");
  53 |   await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  54 |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  55 |   await expect(dialog).not.toBeVisible();
  56 |   await page.reload();
  57 |   await expect.poll(async () => (await snapshot(page)).profiles.some((profile) => profile.name === "B012匿名人物")).toBe(true);
  58 |   const after = await snapshot(page); const saved = after.profiles.find((profile) => profile.name === "B012匿名人物")!;
  59 |   expect(saved.certificates).toHaveLength(1); expect(saved.certificates[0].issuer).toBe("本人核对后的机构");
  60 |   expect(saved.structuredFacts?.some((entry) => entry.data.sectionType === "awards")).toBe(false);
  61 |   expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  62 |   await writeFile(info.outputPath("formal-before-after.json"), JSON.stringify({ before, provisional, after }, null, 2));
  63 |   await page.goto("/profile");
  64 |   await page.getByRole("button", { name: /证书/ }).first().click();
  65 |   await expect(page.getByText(/原始材料与来源：匿名证书.json/).first()).toBeVisible();
  66 |   await page.screenshot({ path: info.outputPath("profile-source-after-reload.png"), fullPage: true });
  67 | });
  68 | 
  69 | test("D: changing target and purpose isolates review identity and makes no formal writes", async ({ page }, info) => {
  70 |   const dialog = await upload(page, material());
  71 |   const before = await snapshot(page);
  72 |   await dialog.getByText("创建新人物", { exact: true }).click();
  73 |   await dialog.locator('input[name="new-profile-name"]').fill("另一个人物");
  74 |   const purpose = dialog.getByLabel("材料用途", { exact: true }); await purpose.fill("资格复核"); await purpose.blur();
  75 |   await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain("资格复核");
  76 |   const after = await snapshot(page);
  77 |   expect(after.profiles).toEqual(before.profiles); expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  78 |   const targets = after.meta.filter((row) => row.key.startsWith("material-target:")); expect(targets.length).toBeGreaterThanOrEqual(3);
  79 |   await writeFile(info.outputPath("target-isolation.json"), JSON.stringify({ before, after }, null, 2));
  80 |   await page.screenshot({ path: info.outputPath("target-purpose-review.png"), fullPage: true });
  81 | });
  82 | 
```