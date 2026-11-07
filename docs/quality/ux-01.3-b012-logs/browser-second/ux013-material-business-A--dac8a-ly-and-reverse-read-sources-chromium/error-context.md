# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-material-business.spec.ts >> A/C: edit, reject, restore review, confirm Profile-only and reverse-read sources
- Location: tests\e2e\ux013-material-business.spec.ts:37:5

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.selectOption: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByRole('dialog', { name: '导入资料', exact: true }).getByLabel('识别方式', { exact: true })

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
            - dialog "导入资料" [active] [ref=e127]:
              - generic [ref=e128]:
                - generic [ref=e129]:
                  - heading "导入资料" [level=2] [ref=e130]
                  - paragraph [ref=e131]: 证书、奖项、成绩单与经历证明，核对后加入个人资料库。
                - button "关闭导入窗口" [ref=e132] [cursor=pointer]: ×
              - generic [ref=e134]:
                - paragraph [ref=e135]: 使用与 AI 工作台相同的来源解析与核对流程。
                - generic [ref=e136]:
                  - text: 识别方式
                  - combobox "识别方式" [ref=e137]:
                    - option "仅本地解析 / OCR"
                    - option "允许 AI 识别并整理字段" [selected]
                - paragraph [ref=e138]: 图片和来源文字会发送给已配置的 AI 服务，请确认材料可用于识别。
                - generic [ref=e139]:
                  - text: 选择职业材料
                  - button "选择职业材料" [ref=e140]
        - article [ref=e141]:
          - generic [ref=e142]:
            - heading "简历中心" [level=2] [ref=e143]
            - generic [ref=e144]: （0 份当前简历 / 0 份已归档 / 0 份在回收站）
          - tablist "简历筛选" [ref=e145]:
            - tab "最近 0" [selected] [ref=e146] [cursor=pointer]
            - tab "全部 0" [ref=e147] [cursor=pointer]
            - tab "通用 0" [ref=e148] [cursor=pointer]
            - tab "岗位 0" [ref=e149] [cursor=pointer]
            - tab "归档 0" [ref=e150] [cursor=pointer]
            - tab "回收站 0" [ref=e151] [cursor=pointer]
          - paragraph [ref=e152]: 当前筛选下暂无简历。可以先导入已有简历，或在岗位工作区生成岗位建议草稿后创建。
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
> 20 |   await dialog.getByLabel("识别方式", { exact: true }).selectOption("local");
     |                                                    ^ Error: locator.selectOption: Test timeout of 45000ms exceeded.
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
  43 |   await issuer.fill("本人核对后的机构"); await issuer.blur();
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