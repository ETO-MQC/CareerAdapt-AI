# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ux013-material-business.spec.ts >> C/manual: unavailable real OCR preserves a decodable image and supports explicit transcription confirmation
- Location: tests\e2e\ux013-material-business.spec.ts:112:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  getByRole('dialog', { name: '导入资料', exact: true }).locator('select[name$="-type"]')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('dialog', { name: '导入资料', exact: true }).locator('select[name$="-type"]')
    14 × locator resolved to <select aria-label="待分类材料 1栏目类型" name="import-section-material-group-0-type">…</select>
       - unexpected value "hidden"

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
  - heading "我的简历" [level=1]
  - text: 0 份当前简历 · 7 条经历 · 5 项基础信息
  - region "当前人物与版本":
    - strong: 同学
    - text: V1 当前 创建于 2026/07/01 7 条经历 · 5 项基础信息 0 份简历
    - button "管理人物与版本"
    - group
  - article:
    - button "导入已有简历 核对来源后创建通用简历":
      - strong: 导入已有简历
      - text: 核对来源后创建通用简历
    - button "根据岗位创建 需要先在岗位工作区生成草稿" [disabled]:
      - strong: 根据岗位创建
      - text: 需要先在岗位工作区生成草稿
    - button "从个人资料库创建 复制已确认信息，之后由你决定是否再次同步":
      - strong: 从个人资料库创建
      - text: 复制已确认信息，之后由你决定是否再次同步
    - button "从零创建 不带入资料库内容，从空白字段开始":
      - strong: 从零创建
      - text: 不带入资料库内容，从空白字段开始
    - button "导入资料 证书、奖项、成绩单与经历证明":
      - strong: 导入资料
      - text: 证书、奖项、成绩单与经历证明
    - dialog "导入资料":
      - heading "导入资料" [level=2]
      - paragraph: 证书、奖项、成绩单与经历证明，核对后加入个人资料库。
      - button "关闭导入窗口": ×
      - paragraph: 来源：sample-certificate.png
      - button "选择另一份材料"
      - status: 等待核对。已恢复未确认的简历导入草稿。
      - button "选择要导入的简历文件"
      - group "导入目标":
        - text: 导入目标 材料用途
        - textbox "材料用途": 补充个人资料
        - radio "导入到已有资料" [checked]
        - text: 导入到已有资料
        - radio "创建新人物"
        - text: 创建新人物 目标人物
        - combobox "目标人物":
          - option "同学" [selected]
        - checkbox "同时创建通用简历" [disabled]
        - text: 同时创建通用简历
      - region "识别方式":
        - strong: 识别方式
        - text: 文本结构解析 仅本地
        - group: 路线详情
      - heading "核对结构" [level=3]
      - text: 0 项待处理 字段候选 0 项待确认 · 结构条目 0 项待确认 · 未识别来源 0 项 · 结构冲突 0 项
      - group: 批量操作
      - region "资料库导入核对":
        - heading "导入概览" [level=3]
        - paragraph: 只需处理近似重复或真实字段冲突。
        - term: 新增
        - definition: "0"
        - term: 已存在
        - definition: "0"
        - term: 融合来源
        - definition: "0"
        - term: 需确认
        - definition: "0"
      - complementary:
        - group:
          - text: 原始材料与来源：sample-certificate.png
          - paragraph:
            - text: SHA-256：
            - code: 59d48269827567138a321dfd721b7eeed718218407817ee2f748f95aa8fc5a0e
          - paragraph: 分类：UNKNOWN / REVIEW_REQUIRED · 用途：补充个人资料
          - link "查看 / 下载原附件":
            - /url: blob:http://127.0.0.1:3327/7a3b04af-8168-41bd-8db6-0d3066acf548
          - img "原始材料 sample-certificate.png"
          - img "来源区域"
          - paragraph: 识别置信度只描述识别结果，不代表事实真实性。人工修改保存在候选中。
          - group: 人工转写前的原始识别记录
          - group: 第 1 页 · 来源块 1 · manual_transcription · 0%
        - status:
          - strong: 纯文本
          - text: 1 个来源块
          - strong: 文本结构提取
          - text: 0 个字段候选
          - strong: 无遗漏项
          - text: 0 个未识别来源
        - text: 证书 SAMPLE CERTIFICATE ANONYMOUS ISSUER
        - paragraph: 1 个来源块已保存；请对照原文件核对。
      - strong: 基本信息
      - text: 姓名
      - textbox "姓名"
      - text: 邮箱
      - textbox "邮箱"
      - text: 电话
      - textbox "电话"
      - text: 地点
      - textbox "地点"
      - text: 求职意向
      - textbox "求职意向"
      - text: 概述
      - textbox "概述"
      - article:
        - checkbox "AI 已识别 / 低置信 / 需要核对 / 第 1 页"
        - text: AI 已识别 / 低置信 / 需要核对 / 第 1 页
        - button "采用此条"
        - button "舍弃"
        - term: 标题
        - definition: 证书
        - term: 内容
        - definition: 证书 SAMPLE CERTIFICATE ANONYMOUS ISSUER
        - term: 编辑候选 / 补充信息
        - definition:
          - text: 说明
          - textbox "材料候选说明": 证书SAMPLE CERTIFICATEANONYMOUS ISSUER
          - text: 修改保留为用户编辑，请采用此条后再正式确认。
        - group: 查看来源原文
        - button "上移"
        - button "下移"
        - button "合并"
        - button "拆分"
      - strong: 0 条已选内容
      - text: 导入到：同学 · 已恢复未确认的简历导入草稿。
      - button "取消"
      - button "确认导入"
  - article:
    - heading "简历中心" [level=2]
    - text: （0 份当前简历 / 0 份已归档 / 0 份在回收站）
    - tablist "简历筛选":
      - tab "最近 0" [selected]
      - tab "全部 0"
      - tab "通用 0"
      - tab "岗位 0"
      - tab "归档 0"
      - tab "回收站 0"
    - paragraph: 当前筛选下暂无简历。可以先导入已有简历，或在岗位工作区生成岗位建议草稿后创建。
- region "操作通知"
```

# Test source

```ts
  32  |         meta: meta.result.filter((row) => /^(material-|importedResumeDraft:|profileReconciliation:|resumeImportOperation:)/u.test(row.key)) }); };
  33  |       tx.onerror = () => reject(tx.error);
  34  |     };
  35  |   }));
  36  | }
  37  | test("A/C: edit, reject, restore review, confirm Profile-only and reverse-read sources", async ({ page }, info) => {
  38  |   let dialog = await upload(page, material("匿名颁发机构", true));
  39  |   const before = await snapshot(page);
  40  |   await dialog.getByText("创建新人物", { exact: true }).click();
  41  |   await dialog.locator('input[name="new-profile-name"]').fill("B012匿名人物");
  42  |   const certificateRow = dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="证书栏目类型"]') });
  43  |   const issuer = certificateRow.getByLabel("材料候选颁发方", { exact: true });
  44  |   await issuer.fill("本人核对后的机构"); await issuer.blur();
  45  |   await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  46  |   const awardRow = dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="奖项栏目类型"]') });
  47  |   await awardRow.locator('input[name$="-included"]').last().uncheck();
  48  |   await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain("B012匿名人物");
  49  |   await page.screenshot({ path: info.outputPath("review-edited-source.png"), fullPage: true });
  50  |   const provisional = await snapshot(page); expect(provisional.profiles).toEqual(before.profiles); expect(provisional.revisions).toEqual(before.revisions);
  51  |   await page.reload(); dialog = await open(page);
  52  |   await expect(dialog.locator('input[name="new-profile-name"]')).toHaveValue("B012匿名人物");
  53  |   await expect(dialog.locator("article.review-row").filter({ has: page.locator('select[aria-label="证书栏目类型"]') }).getByLabel("材料候选颁发方", { exact: true })).toHaveValue("本人核对后的机构");
  54  |   await expect(dialog.locator('input[name="import-create-general-resume"]').first()).not.toBeChecked();
  55  |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  56  |   await expect(dialog).not.toBeVisible();
  57  |   await page.reload();
  58  |   await expect.poll(async () => (await snapshot(page)).profiles.some((profile) => profile.name === "B012匿名人物")).toBe(true);
  59  |   const after = await snapshot(page); const saved = after.profiles.find((profile) => profile.name === "B012匿名人物")!;
  60  |   expect(saved.certificates).toHaveLength(1); expect(saved.certificates[0].issuer).toBe("本人核对后的机构");
  61  |   expect(saved.structuredFacts?.some((entry) => entry.data.sectionType === "awards")).toBe(false);
  62  |   expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  63  |   await writeFile(info.outputPath("formal-before-after.json"), JSON.stringify({ before, provisional, after }, null, 2));
  64  |   await page.goto("/profile");
  65  |   await page.getByRole("button", { name: /证书/ }).first().click();
  66  |   await expect(page.getByText(/原始材料与来源：匿名证书.json/).first()).toBeVisible();
  67  |   await page.screenshot({ path: info.outputPath("profile-source-after-reload.png"), fullPage: true });
  68  | });
  69  | 
  70  | test("D: changing target and purpose isolates review identity and makes no formal writes", async ({ page }, info) => {
  71  |   const dialog = await upload(page, material());
  72  |   const before = await snapshot(page);
  73  |   await dialog.getByText("创建新人物", { exact: true }).click();
  74  |   await dialog.locator('input[name="new-profile-name"]').fill("另一个人物");
  75  |   const purpose = dialog.getByLabel("材料用途", { exact: true }); await purpose.fill("资格复核"); await purpose.blur();
  76  |   await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain("资格复核");
  77  |   const after = await snapshot(page);
  78  |   expect(after.profiles).toEqual(before.profiles); expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  79  |   const targets = after.meta.filter((row) => row.key.startsWith("material-target:")); expect(targets.length).toBeGreaterThanOrEqual(3);
  80  |   await writeFile(info.outputPath("target-isolation.json"), JSON.stringify({ before, after }, null, 2));
  81  |   await page.screenshot({ path: info.outputPath("target-purpose-review.png"), fullPage: true });
  82  | });
  83  | 
  84  | test("B: duplicate receipt, new evidence and explicit conflict resolution keep one entity", async ({ page }, info) => {
  85  |   let dialog = await upload(page, material());
  86  |   await dialog.getByText("创建新人物", { exact: true }).click();
  87  |   await dialog.locator('input[name="new-profile-name"]').fill("B012对账人物");
  88  |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  89  |   await page.reload(); const initial = await snapshot(page);
  90  |   const person = initial.profiles.find((profile) => profile.name === "B012对账人物")!;
  91  |   dialog = await open(page);
  92  |   await dialog.getByLabel("选择职业材料").setInputFiles({ name: "匿名证书.json", mimeType: "application/json", buffer: Buffer.from(material()) });
  93  |   await expect(dialog.getByText(/这份材料已经确认保存/).first()).toBeVisible();
  94  |   expect((await snapshot(page)).profiles).toEqual(initial.profiles);
  95  |   await page.keyboard.press("Escape");
  96  |   dialog = await upload(page, material() + "\n");
  97  |   await expect(dialog.locator(".profile-reconciliation-summary").getByText("融合来源")).toBeVisible();
  98  |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  99  |   await page.reload();
  100 |   dialog = await upload(page, material("另一个颁发机构"));
  101 |   await expect(dialog.locator(".profile-reconciliation-comparison")).toBeVisible();
  102 |   await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeDisabled();
  103 |   await page.screenshot({ path: info.outputPath("conflict-before-resolution.png"), fullPage: true });
  104 |   await dialog.locator(".profile-reconciliation-actions").getByRole("button", { name: "保留原数据", exact: true }).click();
  105 |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  106 |   await page.reload(); const after = await snapshot(page); const saved = after.profiles.find((profile) => profile.id === person.id)!;
  107 |   expect(saved.certificates).toHaveLength(1); expect(saved.certificates[0].issuer).toBe("匿名颁发机构");
  108 |   expect(after.branches).toEqual(initial.branches); expect(after.revisions).toEqual(initial.revisions);
  109 |   await writeFile(info.outputPath("dedup-conflict-before-after.json"), JSON.stringify({ initial, after }, null, 2));
  110 | });
  111 | 
  112 | test("C/manual: unavailable real OCR preserves a decodable image and supports explicit transcription confirmation", async ({ page }, info) => {
  113 |   const dialog = await open(page); await dialog.getByLabel("识别方式").selectOption("local");
  114 |   const image = await page.evaluate(() => {
  115 |     const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 300;
  116 |     const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, 600, 300);
  117 |     context.fillStyle = "black"; context.font = "28px sans-serif"; context.fillText("SAMPLE CERTIFICATE", 40, 100); context.fillText("ANONYMOUS ISSUER", 40, 170);
  118 |     return canvas.toDataURL("image/png").split(",")[1];
  119 |   });
  120 |   await dialog.getByLabel("选择职业材料").setInputFiles({ name: "sample-certificate.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
  121 |   await expect(dialog.getByLabel("对照原件补充文字")).toBeVisible();
  122 |   await expect.poll(() => dialog.getByRole("img", { name: "原始材料 sample-certificate.png" }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 600)).toBe(true);
  123 |   await page.screenshot({ path: info.outputPath("original-image-manual-review.png"), fullPage: true });
  124 |   const before = await snapshot(page);
  125 |   await dialog.getByLabel("对照原件补充文字").fill("证书\nSAMPLE CERTIFICATE\nANONYMOUS ISSUER");
  126 |   await dialog.getByRole("button", { name: "继续核对", exact: true }).click();
  127 |   await writeFile(info.outputPath("classification-layout.json"), JSON.stringify(await dialog.locator('select[name$="-type"]').evaluate((element) => {
  128 |     const rows = []; let current: Element | null = element;
  129 |     while (current) { const style = getComputedStyle(current); rows.push({ tag: current.tagName, className: current.className, rect: current.getBoundingClientRect().toJSON(), display: style.display, visibility: style.visibility, height: style.height, overflow: style.overflow }); current = current.parentElement; }
  130 |     return rows;
  131 |   }), null, 2));
> 132 |   await expect(dialog.locator('select[name$="-type"]')).toBeVisible();
      |                                                         ^ Error: expect(locator).toBeVisible() failed
  133 |   await dialog.getByText("创建新人物", { exact: true }).click();
  134 |   await dialog.locator('input[name="new-profile-name"]').fill("B012人工转写人物");
  135 |   await dialog.locator('select[name$="-type"]').selectOption("certificates");
  136 |   await dialog.getByLabel("材料候选证书名称").fill("SAMPLE CERTIFICATE"); await dialog.getByLabel("材料候选证书名称").blur();
  137 |   await expect.poll(async () => JSON.stringify((await snapshot(page)).meta)).toContain('"userEdited":true');
  138 |   await dialog.getByRole("button", { name: "采用此条", exact: true }).click();
  139 |   await page.evaluate(() => {
  140 |     const original = IDBObjectStore.prototype.put;
  141 |     IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
  142 |       if (this.name === "profiles") { IDBObjectStore.prototype.put = original; throw new DOMException("B012 storage fault injection", "UnknownError"); }
  143 |       return original.apply(this, args);
  144 |     };
  145 |   });
  146 |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  147 |   await expect(dialog.getByRole("button", { name: "确认导入", exact: true })).toBeEnabled();
  148 |   const failed = await snapshot(page); expect(failed.profiles).toEqual(before.profiles); expect(failed.revisions).toEqual(before.revisions);
  149 |   await dialog.getByRole("button", { name: "确认导入", exact: true }).click(); await expect(dialog).not.toBeVisible();
  150 |   await page.reload(); const after = await snapshot(page);
  151 |   expect(after.profiles.find((profile) => profile.name === "B012人工转写人物")!.certificates[0].name).toBe("SAMPLE CERTIFICATE");
  152 |   expect(after.branches).toEqual(before.branches); expect(after.revisions).toEqual(before.revisions);
  153 |   expect(JSON.stringify(after.meta)).toContain("manual_transcription");
  154 |   await writeFile(info.outputPath("manual-transcription-before-after.json"), JSON.stringify({ before, failed, after }, null, 2));
  155 | });
  156 | 
```